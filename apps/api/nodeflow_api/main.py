from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
import asyncio
import hashlib
import hmac
import os
from secrets import compare_digest
import sqlite3
from pathlib import Path
import time

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .credentials import (
    CredentialStorageUnavailableError,
    CredentialVault,
    credential_type_api_dict,
    credential_type_by_id,
    list_credential_types,
    validate_credential_data,
)
from .credential_references import credential_reference_fields
from .executor import ExecutionContext, WorkflowExecutor
from .node_registry import NodeRegistry
from .node_package_installer import (
    MAX_ARCHIVE_BYTES,
    NodePackageInstallError,
    NodePackageInstaller,
)
from .project_config import local_web_origins
from .schemas import (
    CredentialCreateRequest,
    CredentialReference,
    CredentialSummary,
    ProjectVariable,
    ProjectVariableCreateRequest,
    ProjectVariableUpdateRequest,
    ProjectEnvironment,
    ProjectEnvironmentCreateRequest,
    ProjectEnvironmentUpdateRequest,
    CredentialUpdateRequest,
    NodeConfigChange,
    NodePackageSettingsUpdate,
    NodeUpgradeSummary,
    RunExecutionMode,
    RunInvocation,
    ManualRunRequest,
    RunEvent,
    RunQueueStatus,
    RunStatus,
    WorkflowActivationUpdate,
    WorkflowDocument,
    WorkflowPublicationStatus,
    WorkflowTriggerStatus,
    WorkflowUpgradePreview,
    WebhookTestListenerRequest,
    WebhookTestListenerStatus,
)
from .storage import Storage, WorkflowVersionConflictError, utc_now
from .scheduler import WorkflowScheduler
from .run_recovery import RunRecoveryService
from .run_dispatcher import WorkflowRunDispatcher
from .validation import manual_run_entry_issues, validate_workflow
from .workflow_node_migrations import WorkflowNodeMigrationError, preview_workflow_node_upgrades
from .webhook_test_listeners import WebhookTestListenerRegistry


def _workflow_version_conflict(
    exc: WorkflowVersionConflictError,
    *,
    message: str = "工作流已被其他操作更新，请重新加载后再继续。",
) -> HTTPException:
    return HTTPException(
        status_code=409,
        detail={
            "code": "workflow_version_conflict",
            "message": message,
            "expected_version": exc.expected_version,
            "current_version": exc.current_version,
        },
    )


def create_app(
    database_path: str = "node-flow.sqlite3",
    nodes_dir: str | Path | None = None,
    max_concurrent_runs: int = 4,
    execution_mode: str | None = None,
) -> FastAPI:
    execution_mode = (execution_mode or os.getenv("NODE_FLOW_EXECUTION_MODE", "embedded")).lower()
    if execution_mode not in {"embedded", "worker"}:
        raise ValueError("execution_mode must be 'embedded' or 'worker'")
    storage = Storage(database_path)
    storage.init_schema()
    repo_root = Path(__file__).resolve().parents[3]
    default_nodes_dir = repo_root / "nodes"
    registry = NodeRegistry(
        nodes_dir=Path(nodes_dir) if nodes_dir is not None else default_nodes_dir,
        package_policy_provider=storage.node_package_policies,
    )
    node_package_installer = NodePackageInstaller(
        nodes_dir=registry.nodes_dir,
        registry=registry,
        node_type_reference_provider=storage.list_node_type_references,
    )
    node_package_installer.recover_incomplete_transactions()
    executor = WorkflowExecutor(
        storage=storage,
        registry=registry,
        registry_refresh=node_package_installer.scan_registry_if_changed,
    )
    dispatcher = WorkflowRunDispatcher(
        storage=storage,
        executor=executor,
        max_concurrent_runs=max_concurrent_runs,
        auto_execute=execution_mode == "embedded",
    )
    scheduler = WorkflowScheduler(
        storage=storage,
        executor=executor,
        registry=registry,
        dispatcher=dispatcher,
    )
    recovery = RunRecoveryService(
        storage=storage,
        dispatcher=dispatcher,
        mark_interrupted_running=execution_mode == "embedded",
        resume_queued_runs=execution_mode == "embedded",
    )
    credential_vault = CredentialVault()
    webhook_test_listeners = WebhookTestListenerRegistry()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        await recovery.recover()
        scheduler_task = asyncio.create_task(scheduler.serve())
        try:
            yield
        finally:
            scheduler_task.cancel()
            try:
                await scheduler_task
            except asyncio.CancelledError:
                pass
            await scheduler.stop()
            await recovery.stop()
            storage.close()

    app = FastAPI(title="Node Flow API", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=local_web_origins(),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.state.storage = storage
    app.state.registry = registry
    app.state.node_package_installer = node_package_installer
    app.state.executor = executor
    app.state.dispatcher = dispatcher
    app.state.execution_mode = execution_mode
    app.state.scheduler = scheduler
    app.state.recovery = recovery
    app.state.credential_vault = credential_vault
    app.state.webhook_test_listeners = webhook_test_listeners

    def _validate_workflow(workflow: WorkflowDocument):
        return validate_workflow(
            workflow,
            registry,
            credential_lookup=storage.get_credential,
            credential_type_lookup=_credential_type_by_id,
            error_workflow_lookup=storage.get_workflow,
        )

    def _credential_type_by_id(type_id: str):
        return credential_type_by_id(type_id) or registry.get_credential_type(type_id)

    def _list_credential_types():
        return (*list_credential_types(), *registry.list_credential_types())

    def _node_credential_ids(node: WorkflowNode) -> tuple[str, ...]:
        form = registry.get(node.type).form if registry.has(node.type) else None
        return tuple(credential_id for _, credential_id, _ in credential_reference_fields(node.config, form))

    def _validate_environment_credential_overrides(overrides: dict[str, str]) -> None:
        issues: list[dict[str, str]] = []
        for source_id, target_id in overrides.items():
            path = f"credential_overrides.{source_id}"
            if source_id == target_id:
                issues.append(
                    {
                        "path": path,
                        "message": "来源凭据和目标凭据不能相同。",
                        "code": "credential_mapping_identity",
                    }
                )
                continue
            source = storage.get_credential(source_id)
            target = storage.get_credential(target_id)
            if source is None:
                issues.append({"path": path, "message": "来源凭据不存在。", "code": "credential_not_found"})
                continue
            if target is None:
                issues.append({"path": path, "message": "目标凭据不存在。", "code": "credential_not_found"})
                continue
            if source.type_id != target.type_id:
                issues.append({"path": path, "message": "来源凭据和目标凭据必须属于同一类型。", "code": "credential_type_mismatch"})
        if issues:
            raise HTTPException(status_code=422, detail=issues)

    def _require_credential_type(type_id: str):
        credential_type = _credential_type_by_id(type_id)
        if credential_type is None:
            raise HTTPException(
                status_code=422,
                detail=[
                    {
                        "path": "type_id",
                        "message": "不支持的凭据类型。",
                        "code": "credential_type_unknown",
                    }
                ],
            )
        return credential_type

    def _encrypt_credential_data(type_id: str, data: dict[str, str]) -> str:
        credential_type = _require_credential_type(type_id)
        try:
            normalized_data = validate_credential_data(credential_type, data)
            return credential_vault.encrypt(normalized_data)
        except ValueError as exc:
            raise HTTPException(
                status_code=422,
                detail=[{"path": "data", "message": str(exc), "code": "credential_data_invalid"}],
            ) from exc
        except CredentialStorageUnavailableError as exc:
            raise HTTPException(status_code=503, detail="当前系统不支持本地凭据库。") from exc

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/node-types")
    def node_types() -> list[dict]:
        try:
            node_package_installer.scan_registry_if_changed(timeout_seconds=5.0)
        except NodePackageInstallError as exc:
            raise HTTPException(
                status_code=exc.status_code,
                detail=exc.to_detail(),
            ) from exc
        return [node_type.to_api_dict() for node_type in registry.list_node_types()]

    @app.post("/api/node-types/reload")
    def reload_node_types() -> list[dict]:
        try:
            node_package_installer.scan_registry()
        except NodePackageInstallError as exc:
            raise HTTPException(
                status_code=exc.status_code,
                detail=exc.to_detail(),
            ) from exc
        return [node_type.to_api_dict() for node_type in registry.list_node_types()]

    @app.get("/api/node-packages")
    def node_packages() -> dict[str, object]:
        try:
            node_package_installer.scan_registry_if_changed(timeout_seconds=5.0)
        except NodePackageInstallError as exc:
            raise HTTPException(
                status_code=exc.status_code,
                detail=exc.to_detail(),
            ) from exc
        result = registry.scan_result.to_api_dict()
        result["recoveries"] = [
            event.to_api_dict() for event in node_package_installer.recovery_events()
        ]
        return result

    @app.post("/api/node-packages/install", status_code=201)
    async def install_node_package(
        request: Request,
        filename: str,
    ) -> dict[str, object]:
        content_length = request.headers.get("content-length")
        if content_length is not None:
            try:
                if int(content_length) > MAX_ARCHIVE_BYTES:
                    raise HTTPException(status_code=413, detail="节点包 ZIP 不能超过 10 MB。")
            except ValueError:
                raise HTTPException(status_code=400, detail="Content-Length 无效。")
        archive = bytearray()
        async for chunk in request.stream():
            archive.extend(chunk)
            if len(archive) > MAX_ARCHIVE_BYTES:
                raise HTTPException(status_code=413, detail="节点包 ZIP 不能超过 10 MB。")
        try:
            return node_package_installer.install_archive(
                bytes(archive),
                filename=filename,
            ).to_api_dict()
        except NodePackageInstallError as exc:
            raise HTTPException(
                status_code=exc.status_code,
                detail=exc.to_detail(),
            ) from exc

    @app.get("/api/node-packages/{package_id}/revisions")
    def list_node_package_revisions(package_id: str) -> list[dict[str, object]]:
        try:
            return [
                revision.to_api_dict()
                for revision in node_package_installer.list_revisions(package_id)
            ]
        except NodePackageInstallError as exc:
            raise HTTPException(
                status_code=exc.status_code,
                detail=exc.to_detail(),
            ) from exc

    @app.post(
        "/api/node-packages/{package_id}/revisions/{revision_id}/activate"
    )
    def activate_node_package_revision(
        package_id: str,
        revision_id: str,
    ) -> dict[str, object]:
        try:
            return node_package_installer.activate_revision(
                package_id,
                revision_id,
            ).to_api_dict()
        except NodePackageInstallError as exc:
            raise HTTPException(
                status_code=exc.status_code,
                detail=exc.to_detail(),
            ) from exc

    @app.put("/api/node-packages/{package_id}/settings")
    def update_node_package_settings(
        package_id: str,
        request: NodePackageSettingsUpdate,
    ) -> dict[str, object]:
        try:
            with node_package_installer.mutation_guard(
                operation="settings",
                package_id=package_id,
            ):
                node_package = next(
                    (
                        candidate
                        for candidate in registry.list_packages()
                        if candidate.id == package_id
                    ),
                    None,
                )
                if node_package is None:
                    raise HTTPException(status_code=404, detail="节点包不存在。")
                if not node_package.managed:
                    raise HTTPException(
                        status_code=409,
                        detail="内置节点包由平台管理，不能停用或锁定。",
                    )
                if node_package.enabled and not request.enabled:
                    references = storage.list_node_type_references(node_package.node_ids)
                    if references:
                        raise HTTPException(
                            status_code=409,
                            detail={
                                "message": "仍有工作流使用该节点包，请先移除相关节点。",
                                "references": [
                                    reference.model_dump() for reference in references
                                ],
                            },
                        )
                storage.set_node_package_policy(
                    package_id,
                    enabled=request.enabled,
                    locked_version=request.locked_version,
                )
                registry.scan()
                return registry.scan_result.to_api_dict()
        except NodePackageInstallError as exc:
            raise HTTPException(
                status_code=exc.status_code,
                detail=exc.to_detail(),
            ) from exc

    @app.delete("/api/node-packages/{package_id}")
    def uninstall_node_package(package_id: str) -> dict[str, object]:
        try:
            scan = node_package_installer.uninstall(package_id)
        except NodePackageInstallError as exc:
            raise HTTPException(
                status_code=exc.status_code,
                detail=exc.to_detail(),
            ) from exc
        storage.delete_node_package_policy(package_id)
        return scan.to_api_dict()

    @app.get("/api/credential-types")
    def credential_types() -> list[dict[str, object]]:
        return [credential_type_api_dict(credential_type) for credential_type in _list_credential_types()]

    @app.get("/api/credentials")
    def list_credentials() -> list[CredentialSummary]:
        return storage.list_credentials()

    @app.post("/api/credentials", status_code=201)
    def create_credential(request: CredentialCreateRequest) -> CredentialSummary:
        encrypted_data = _encrypt_credential_data(request.type_id, request.data)
        try:
            record = storage.create_credential(
                type_id=request.type_id,
                name=request.name,
                encrypted_data=encrypted_data,
            )
        except sqlite3.IntegrityError as exc:
            raise HTTPException(status_code=409, detail="同类型下已存在同名凭据。") from exc
        return CredentialSummary(**record.model_dump())

    @app.patch("/api/credentials/{credential_id}")
    def update_credential(credential_id: str, request: CredentialUpdateRequest) -> CredentialSummary:
        credential = storage.get_credential(credential_id)
        if credential is None:
            raise HTTPException(status_code=404, detail="凭据不存在。")
        encrypted_data = (
            _encrypt_credential_data(credential.type_id, request.data)
            if request.data is not None
            else None
        )
        try:
            updated = storage.update_credential(
                credential_id,
                name=request.name,
                encrypted_data=encrypted_data,
            )
        except sqlite3.IntegrityError as exc:
            raise HTTPException(status_code=409, detail="同类型下已存在同名凭据。") from exc
        if updated is None:
            raise HTTPException(status_code=404, detail="凭据不存在。")
        return CredentialSummary(**updated.model_dump())

    @app.get("/api/credentials/{credential_id}/references")
    def credential_references(credential_id: str) -> list[CredentialReference]:
        if storage.get_credential(credential_id) is None:
            raise HTTPException(status_code=404, detail="凭据不存在。")
        return storage.list_credential_references(
            credential_id,
            credential_ids_for_node=_node_credential_ids,
        )

    @app.delete("/api/credentials/{credential_id}", status_code=204)
    def delete_credential(credential_id: str) -> None:
        if storage.get_credential(credential_id) is None:
            raise HTTPException(status_code=404, detail="凭据不存在。")
        references = storage.list_credential_references(
            credential_id,
            credential_ids_for_node=_node_credential_ids,
        )
        if references:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "凭据仍被工作流引用，无法删除。",
                    "code": "credential_in_use",
                    "references": [reference.model_dump() for reference in references],
                },
            )
        environment_references = storage.list_environment_credential_references(credential_id)
        if environment_references:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "凭据仍被运行环境映射，无法删除。",
                    "code": "credential_environment_mapped",
                    "environments": [
                        {"id": environment.id, "name": environment.name}
                        for environment in environment_references
                    ],
                },
            )
        storage.delete_credential(credential_id)

    @app.get("/api/project-variables")
    def list_project_variables() -> list[ProjectVariable]:
        return storage.list_project_variables()

    @app.post("/api/project-variables", status_code=201)
    def create_project_variable(request: ProjectVariableCreateRequest) -> ProjectVariable:
        try:
            return storage.create_project_variable(name=request.name, value=request.value)
        except sqlite3.IntegrityError as exc:
            raise HTTPException(status_code=409, detail="项目变量名已存在") from exc

    @app.patch("/api/project-variables/{name}")
    def update_project_variable(name: str, request: ProjectVariableUpdateRequest) -> ProjectVariable:
        variable = storage.update_project_variable(name, value=request.value)
        if variable is None:
            raise HTTPException(status_code=404, detail="项目变量不存在")
        return variable

    @app.delete("/api/project-variables/{name}", status_code=204)
    def delete_project_variable(name: str) -> None:
        if not storage.delete_project_variable(name):
            raise HTTPException(status_code=404, detail="项目变量不存在")

    @app.get("/api/project-environments")
    def list_project_environments() -> list[ProjectEnvironment]:
        return storage.list_project_environments()

    @app.post("/api/project-environments", status_code=201)
    def create_project_environment(request: ProjectEnvironmentCreateRequest) -> ProjectEnvironment:
        _validate_environment_credential_overrides(request.credential_overrides)
        try:
            return storage.create_project_environment(
                name=request.name,
                variables=request.variables,
                credential_overrides=request.credential_overrides,
            )
        except sqlite3.IntegrityError as exc:
            raise HTTPException(status_code=409, detail="已存在同名环境") from exc

    @app.patch("/api/project-environments/{environment_id}")
    def update_project_environment(
        environment_id: str,
        request: ProjectEnvironmentUpdateRequest,
    ) -> ProjectEnvironment:
        if request.credential_overrides is not None:
            _validate_environment_credential_overrides(request.credential_overrides)
        try:
            environment = storage.update_project_environment(
                environment_id,
                name=request.name,
                variables=request.variables,
                credential_overrides=request.credential_overrides,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except sqlite3.IntegrityError as exc:
            raise HTTPException(status_code=409, detail="已存在同名环境") from exc
        if environment is None:
            raise HTTPException(status_code=404, detail="运行环境不存在")
        return environment

    @app.delete("/api/project-environments/{environment_id}", status_code=204)
    def delete_project_environment(environment_id: str) -> None:
        try:
            deleted = storage.delete_project_environment(environment_id)
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        if not deleted:
            raise HTTPException(status_code=404, detail="运行环境不存在")

    @app.get("/api/workflows")
    def list_workflows():
        return storage.list_workflows()

    @app.post("/api/workflows")
    def save_workflow(
        workflow: WorkflowDocument,
        draft: bool = False,
        expected_version: int | None = Header(
            default=None,
            alias="X-Workflow-Expected-Version",
        ),
    ):
        if storage.get_project_environment(workflow.settings.environment_id) is None:
            raise HTTPException(
                status_code=422,
                detail=[
                    {
                        "path": "settings.environment_id",
                        "message": "所选运行环境不存在。",
                        "code": "environment_not_found",
                    }
                ],
            )
        result = _validate_workflow(workflow)
        if not result.valid:
            raise HTTPException(
                status_code=422,
                detail=[issue.model_dump(exclude_none=True) for issue in result.issues],
            )
        if not draft and workflow.active:
            _raise_on_webhook_conflict(workflow)
        try:
            return storage.save_workflow(
                workflow,
                publish=False if draft else None,
                expected_version=expected_version,
            )
        except WorkflowVersionConflictError as exc:
            raise _workflow_version_conflict(
                exc,
                message="工作流已被其他操作更新，请重新加载后再保存。",
            ) from exc

    @app.post("/api/workflows/validate")
    def validate(workflow: WorkflowDocument):
        return _validate_workflow(workflow)

    @app.delete("/api/workflows/{workflow_id}", status_code=204)
    def delete_workflow(workflow_id: str) -> None:
        outcome, references = storage.delete_workflow(workflow_id)
        if outcome == "not_found":
            raise HTTPException(status_code=404, detail="工作流不存在。")
        if outcome == "referenced":
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "工作流仍被其他工作流调用，无法删除。",
                    "code": "workflow_in_use",
                    "references": [reference.model_dump() for reference in references],
                },
            )
        if outcome == "open_runs":
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "工作流仍有排队或运行中的任务，无法删除。",
                    "code": "workflow_has_open_runs",
                },
            )
        webhook_test_listeners.disarm_workflow(workflow_id)

    @app.get("/api/workflows/{workflow_id}")
    def get_workflow(workflow_id: str):
        workflow = storage.get_workflow(workflow_id)
        if workflow is None:
            raise HTTPException(status_code=404, detail="Workflow not found")
        return workflow

    @app.get(
        "/api/workflows/{workflow_id}/publication",
        response_model=WorkflowPublicationStatus,
    )
    def get_workflow_publication(workflow_id: str) -> WorkflowPublicationStatus:
        status = storage.get_workflow_publication_status(workflow_id)
        if status is None:
            raise HTTPException(status_code=404, detail="Workflow not found")
        return status

    @app.get("/api/workflows/{workflow_id}/versions")
    def list_workflow_versions(workflow_id: str):
        _require_workflow(workflow_id)
        return storage.list_workflow_versions(workflow_id)

    @app.get("/api/workflows/{workflow_id}/versions/{version}")
    def get_workflow_version(workflow_id: str, version: int) -> WorkflowDocument:
        workflow = storage.get_workflow(workflow_id, version)
        if workflow is None:
            raise HTTPException(status_code=404, detail="Workflow version not found")
        return workflow

    @app.post("/api/workflows/{workflow_id}/versions/{version}/restore")
    def restore_workflow_version(
        workflow_id: str,
        version: int,
        expected_version: int | None = Header(
            default=None,
            alias="X-Workflow-Expected-Version",
        ),
    ) -> WorkflowDocument:
        restored = storage.get_workflow(workflow_id, version)
        if restored is None:
            raise HTTPException(status_code=404, detail="Workflow version not found")
        if storage.get_project_environment(restored.settings.environment_id) is None:
            raise HTTPException(status_code=422, detail="所选运行环境不存在")
        result = _validate_workflow(restored)
        if not result.valid:
            raise HTTPException(
                status_code=422,
                detail=[issue.model_dump(exclude_none=True) for issue in result.issues],
            )
        try:
            return storage.save_workflow(
                restored,
                publish=False,
                action="restore",
                source_version=version,
                expected_version=expected_version,
            )
        except WorkflowVersionConflictError as exc:
            raise _workflow_version_conflict(exc) from exc

    @app.post("/api/workflows/{workflow_id}/versions/{version}/rollback")
    def rollback_workflow_version(
        workflow_id: str,
        version: int,
        expected_version: int | None = Header(
            default=None,
            alias="X-Workflow-Expected-Version",
        ),
    ) -> WorkflowDocument:
        publication = storage.get_workflow_publication_status(workflow_id)
        if publication is None:
            raise HTTPException(status_code=404, detail="Workflow not found")
        if not publication.active:
            raise HTTPException(status_code=409, detail="工作流尚未发布，无法回滚生产版本。")

        source = storage.get_workflow(workflow_id, version)
        if source is None:
            raise HTTPException(status_code=404, detail="Workflow version not found")
        if storage.get_project_environment(source.settings.environment_id) is None:
            raise HTTPException(status_code=422, detail="所选运行环境不存在")
        result = _validate_workflow(source)
        if not result.valid:
            raise HTTPException(
                status_code=422,
                detail=[issue.model_dump(exclude_none=True) for issue in result.issues],
            )
        _raise_on_webhook_conflict(source.model_copy(update={"active": True}))
        try:
            rolled_back = storage.rollback_workflow_version(
                workflow_id,
                version,
                expected_version=expected_version,
            )
        except WorkflowVersionConflictError as exc:
            raise _workflow_version_conflict(exc) from exc
        if rolled_back is None:
            raise HTTPException(status_code=409, detail="无法回滚生产版本。")
        return rolled_back

    @app.post("/api/workflows/{workflow_id}/activation")
    def update_workflow_activation(
        workflow_id: str,
        update: WorkflowActivationUpdate,
        expected_version: int | None = Header(
            default=None,
            alias="X-Workflow-Expected-Version",
        ),
    ) -> WorkflowDocument:
        workflow = _require_workflow(workflow_id)
        if not update.active:
            try:
                unpublished = storage.unpublish_workflow(
                    workflow_id,
                    expected_version=expected_version,
                )
            except WorkflowVersionConflictError as exc:
                raise _workflow_version_conflict(exc) from exc
            if unpublished is None:
                raise HTTPException(status_code=404, detail="Workflow not found")
            return unpublished

        publish_candidate = workflow.model_copy(update={"active": True})
        if storage.get_project_environment(publish_candidate.settings.environment_id) is None:
            raise HTTPException(status_code=422, detail="所选运行环境不存在")
        result = _validate_workflow(publish_candidate)
        if not result.valid:
            raise HTTPException(
                status_code=422,
                detail=[issue.model_dump(exclude_none=True) for issue in result.issues],
            )
        _raise_on_webhook_conflict(publish_candidate)
        try:
            published = storage.publish_workflow(
                workflow_id,
                expected_version=expected_version,
            )
        except WorkflowVersionConflictError as exc:
            raise _workflow_version_conflict(exc) from exc
        if published is None:
            raise HTTPException(status_code=404, detail="Workflow not found")
        return published

    @app.post("/api/workflows/{workflow_id}/webhook-test/listen", response_model=WebhookTestListenerStatus)
    def start_webhook_test_listener(
        workflow_id: str,
        request: WebhookTestListenerRequest,
    ) -> WebhookTestListenerStatus:
        workflow = _require_workflow(workflow_id)
        _require_webhook_test_trigger(workflow, request.node_id)
        listener = webhook_test_listeners.arm(workflow_id, request.node_id)
        return WebhookTestListenerStatus(
            workflow_id=listener.workflow_id,
            node_id=listener.node_id,
            active=True,
            expires_at=listener.expires_at.isoformat(),
        )

    @app.get(
        "/api/workflows/{workflow_id}/webhook-test/listen/{node_id}",
        response_model=WebhookTestListenerStatus,
    )
    def get_webhook_test_listener(workflow_id: str, node_id: str) -> WebhookTestListenerStatus:
        _require_workflow(workflow_id)
        listener = webhook_test_listeners.status(workflow_id, node_id)
        if listener is None:
            return WebhookTestListenerStatus(
                workflow_id=workflow_id,
                node_id=node_id,
                active=False,
            )
        return WebhookTestListenerStatus(
            workflow_id=listener.workflow_id,
            node_id=listener.node_id,
            active=True,
            expires_at=listener.expires_at.isoformat(),
        )

    @app.delete(
        "/api/workflows/{workflow_id}/webhook-test/listen/{node_id}",
        response_model=WebhookTestListenerStatus,
    )
    def stop_webhook_test_listener(workflow_id: str, node_id: str) -> WebhookTestListenerStatus:
        _require_workflow(workflow_id)
        webhook_test_listeners.disarm(workflow_id, node_id)
        return WebhookTestListenerStatus(
            workflow_id=workflow_id,
            node_id=node_id,
            active=False,
        )

    @app.get("/api/workflows/{workflow_id}/triggers")
    def list_workflow_triggers(workflow_id: str) -> list[WorkflowTriggerStatus]:
        workflow = _require_workflow(workflow_id)
        published_workflow = storage.get_published_workflow(workflow_id)
        return scheduler.trigger_statuses(
            published_workflow or workflow.model_copy(update={"active": False})
        )

    @app.post("/api/workflows/{workflow_id}/upgrades/preview")
    def preview_workflow_upgrades(workflow_id: str) -> JSONResponse:
        workflow = _require_workflow(workflow_id)
        preview = _preview_workflow_upgrades(workflow)
        payload = preview.model_dump(mode="json")
        payload["workflow"] = preview.workflow.model_dump(mode="json", exclude_none=True)
        return JSONResponse(content=payload)

    @app.post("/api/workflows/{workflow_id}/upgrades/apply")
    def apply_workflow_upgrades(
        workflow_id: str,
        expected_version: int | None = Header(
            default=None,
            alias="X-Workflow-Expected-Version",
        ),
    ) -> WorkflowDocument:
        workflow = _require_workflow(workflow_id)
        if expected_version is not None and workflow.version != expected_version:
            raise _workflow_version_conflict(
                WorkflowVersionConflictError(
                    workflow_id=workflow_id,
                    expected_version=expected_version,
                    current_version=workflow.version,
                )
            )
        preview = _preview_workflow_upgrades(workflow)
        if not preview.upgrades:
            return workflow
        result = _validate_workflow(preview.workflow)
        if not result.valid:
            raise HTTPException(
                status_code=422,
                detail=[issue.model_dump(exclude_none=True) for issue in result.issues],
            )
        try:
            return storage.save_workflow(
                preview.workflow,
                publish=False,
                expected_version=expected_version,
            )
        except WorkflowVersionConflictError as exc:
            raise _workflow_version_conflict(exc) from exc

    @app.get("/api/workflows/{workflow_id}/runs")
    def list_workflow_runs(workflow_id: str, limit: int = 10, offset: int = 0, status: RunStatus | None = None):
        workflow = storage.get_workflow(workflow_id)
        if workflow is None:
            raise HTTPException(status_code=404, detail="Workflow not found")
        return storage.list_workflow_runs(workflow_id, limit=limit, offset=offset, status=status)

    @app.post("/api/workflows/{workflow_id}/runs")
    async def create_run(workflow_id: str, request: ManualRunRequest | None = None):
        workflow = storage.get_workflow(workflow_id)
        if workflow is None:
            raise HTTPException(status_code=404, detail="Workflow not found")
        result = _validate_workflow(workflow)
        if not result.valid:
            raise HTTPException(
                status_code=422,
                detail=[issue.model_dump(exclude_none=True) for issue in result.issues],
            )
        entry_node_id = request.entry_node_id if request is not None else None
        has_initial_input = request is not None and "initial_input" in request.model_fields_set
        initial_input = request.initial_input if has_initial_input else {}
        environment_id = request.environment_id if request and request.environment_id else workflow.settings.environment_id
        if storage.get_project_environment(environment_id) is None:
            raise HTTPException(status_code=422, detail="所选运行环境不存在")
        entry_issues = manual_run_entry_issues(workflow, registry, entry_node_id)
        if entry_issues:
            raise HTTPException(
                status_code=422,
                detail=[issue.model_dump(exclude_none=True) for issue in entry_issues],
            )
        run = storage.create_run(
            workflow,
            invocation=RunInvocation(
                execution_mode="manual",
                entry_node_id=entry_node_id,
                initial_input=initial_input,
                has_initial_input=has_initial_input,
                environment_id=environment_id,
            ),
        )
        dispatcher.submit(run, workflow)
        return run

    @app.get("/api/runs/{run_id}")
    def get_run(run_id: str):
        run = storage.get_run(run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="Run not found")
        return run

    @app.get("/api/runs/{run_id}/queue", response_model_exclude_none=True)
    def get_run_queue_status(run_id: str) -> RunQueueStatus | None:
        if storage.get_run(run_id) is None:
            raise HTTPException(status_code=404, detail="Run not found")
        return dispatcher.queue_status(run_id)

    @app.get("/api/runs/{run_id}/events")
    def list_run_events(run_id: str):
        if storage.get_run(run_id) is None:
            raise HTTPException(status_code=404, detail="Run not found")
        return storage.list_events(run_id)

    @app.post("/api/runs/{run_id}/cancel")
    def cancel_run(run_id: str):
        if not dispatcher.cancel(run_id):
            raise HTTPException(status_code=404, detail="Run not found")
        run = storage.get_run(run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="Run not found")
        return run

    @app.post("/api/runs/{run_id}/retry")
    async def retry_run(run_id: str):
        source_run = storage.get_run(run_id)
        if source_run is None:
            raise HTTPException(status_code=404, detail="Run not found")
        if source_run.status not in {"failed", "cancelled"}:
            raise HTTPException(
                status_code=409,
                detail="Only completed failed or cancelled runs can be retried",
            )

        source_invocation = storage.get_run_invocation(run_id) or RunInvocation()
        if source_run.parent_run_id or source_invocation.execution_mode not in {"manual", "schedule"}:
            raise HTTPException(
                status_code=409,
                detail="Only manual or scheduled root runs can be retried",
            )

        workflow = storage.get_workflow(source_run.workflow_id, source_run.workflow_version)
        if workflow is None:
            raise HTTPException(status_code=409, detail="The workflow version used by this run is no longer available")
        result = _validate_workflow(workflow)
        if not result.valid:
            raise HTTPException(
                status_code=422,
                detail=[issue.model_dump(exclude_none=True) for issue in result.issues],
            )
        entry_issues = manual_run_entry_issues(workflow, registry, source_invocation.entry_node_id)
        if entry_issues:
            raise HTTPException(
                status_code=422,
                detail=[issue.model_dump(exclude_none=True) for issue in entry_issues],
            )

        retry_invocation = source_invocation.model_copy(update={"execution_mode": "manual"})
        retry = storage.create_run(workflow, invocation=retry_invocation)
        storage.append_event(
            RunEvent(
                run_id=source_run.id,
                type="run_retry_requested",
                timestamp=utc_now(),
                payload={"retry_run_id": retry.id, "workflow_version": source_run.workflow_version},
            )
        )
        storage.append_event(
            RunEvent(
                run_id=retry.id,
                type="run_retried",
                timestamp=utc_now(),
                payload={"source_run_id": source_run.id, "source_workflow_version": source_run.workflow_version},
            )
        )
        dispatcher.submit(retry, workflow, retry_invocation)
        return retry

    @app.api_route("/webhooks/{webhook_path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    async def invoke_webhook(webhook_path: str, request: Request):
        binding = storage.find_webhook_binding(method=request.method, path=webhook_path)
        if binding is None:
            raise HTTPException(status_code=404, detail="Webhook not found")
        workflow, entry_node_id = binding
        return await _invoke_webhook(workflow, entry_node_id, request, webhook_path, execution_mode="webhook")

    @app.api_route("/webhooks-test/{workflow_id}/{webhook_path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    async def invoke_webhook_test(workflow_id: str, webhook_path: str, request: Request):
        workflow = _require_workflow(workflow_id)
        entry_node_id = _matching_webhook_trigger_id(workflow, request.method, webhook_path)
        if entry_node_id is None:
            raise HTTPException(status_code=404, detail="Webhook not found")
        if not webhook_test_listeners.consume(workflow.id, entry_node_id):
            raise HTTPException(status_code=409, detail="Webhook test listener is not active")
        return await _invoke_webhook(workflow, entry_node_id, request, webhook_path, execution_mode="webhook_test")

    async def _invoke_webhook(
        workflow: WorkflowDocument,
        entry_node_id: str,
        request: Request,
        webhook_path: str,
        *,
        execution_mode: RunExecutionMode,
    ):
        result = _validate_workflow(workflow)
        if not result.valid:
            raise HTTPException(
                status_code=422,
                detail=[issue.model_dump(exclude_none=True) for issue in result.issues],
            )
        protected_header_name = await _authorize_webhook_request(workflow, entry_node_id, request)
        initial_input = await _webhook_input(
            request,
            webhook_path,
            redacted_header_names={protected_header_name} if protected_header_name else set(),
        )
        run = storage.create_run(
            workflow,
            invocation=RunInvocation(
                entry_node_id=entry_node_id,
                initial_input=initial_input,
                execution_mode=execution_mode,
                allow_pinned_data=False,
            ),
        )
        if _webhook_response_mode(workflow, entry_node_id) == "immediate":
            dispatcher.submit(
                run,
                workflow,
                storage.get_run_invocation(run.id),
            )
            return JSONResponse(
                status_code=202,
                content={
                    "status": "accepted",
                    "run": {
                        "id": run.id,
                        "status": run.status,
                        "workflow_id": run.workflow_id,
                        "workflow_version": run.workflow_version,
                    },
                },
                headers={"Location": f"/api/runs/{run.id}"},
            )
        execution_context = ExecutionContext(
            deadline=time.monotonic() + workflow.settings.timeout_seconds,
            initial_input=initial_input,
            allow_pinned_data=False,
            is_webhook_request=True,
        )
        output = await dispatcher.execute(
            run,
            workflow,
            is_webhook_request=True,
            execution_context=execution_context,
        )
        completed_run = storage.get_run(run.id)
        if completed_run is None:
            raise HTTPException(status_code=500, detail="Webhook run was not recorded")
        if completed_run.status != "succeeded":
            raise HTTPException(status_code=500, detail="Webhook workflow failed")
        if execution_context.webhook_response:
            response = execution_context.webhook_response
            return JSONResponse(
                content=response["body"],
                status_code=response["status_code"],
                headers=response["headers"],
            )
        return {"run": completed_run, "output": output}

    def _webhook_response_mode(workflow: WorkflowDocument, entry_node_id: str) -> str:
        trigger = next((node for node in workflow.nodes if node.id == entry_node_id), None)
        return str(trigger.config.get("response_mode", "sync")) if trigger is not None else "sync"

    def _require_workflow(workflow_id: str) -> WorkflowDocument:
        workflow = storage.get_workflow(workflow_id)
        if workflow is None:
            raise HTTPException(status_code=404, detail="Workflow not found")
        return workflow

    def _matching_webhook_trigger_id(
        workflow: WorkflowDocument,
        method: str,
        path: str,
    ) -> str | None:
        normalized_path = path.strip().strip("/")
        for node in workflow.nodes:
            if node.type != "webhook.trigger" or node.disabled:
                continue
            if (
                str(node.config.get("method", "POST")).upper() == method.upper()
                and str(node.config.get("path", "")).strip().strip("/") == normalized_path
            ):
                return node.id
        return None

    def _require_webhook_test_trigger(workflow: WorkflowDocument, node_id: str) -> None:
        node = next((candidate for candidate in workflow.nodes if candidate.id == node_id), None)
        if node is None or node.type != "webhook.trigger" or node.disabled:
            raise HTTPException(status_code=422, detail="Webhook test listener requires an enabled Webhook trigger")

    def _raise_on_webhook_conflict(workflow: WorkflowDocument) -> None:
        for node in workflow.nodes:
            if node.type != "webhook.trigger" or node.disabled:
                continue
            conflict = storage.find_webhook_binding(
                method=str(node.config.get("method", "POST")),
                path=str(node.config.get("path", "")),
                exclude_workflow_id=workflow.id,
            )
            if conflict is not None:
                conflicting_workflow, _ = conflict
                raise HTTPException(
                    status_code=409,
                    detail=f"Webhook endpoint is already used by workflow: {conflicting_workflow.name}",
                )

    async def _authorize_webhook_request(
        workflow: WorkflowDocument,
        entry_node_id: str,
        request: Request,
    ) -> str | None:
        trigger = next((node for node in workflow.nodes if node.id == entry_node_id), None)
        credential_id = trigger.config.get("credential_id") if trigger is not None else None
        if not isinstance(credential_id, str) or not credential_id:
            return None

        credential = storage.get_credential(credential_id)
        if credential is None or credential.type_id not in {"http.header", "webhook.hmac_sha256"}:
            raise HTTPException(status_code=401, detail="Webhook authentication failed")
        try:
            credential_data = credential_vault.decrypt(credential.encrypted_data)
        except (CredentialStorageUnavailableError, OSError, ValueError):
            raise HTTPException(status_code=401, detail="Webhook authentication failed") from None

        if credential.type_id == "http.header":
            header_name = credential_data.get("name")
            expected_value = credential_data.get("value")
            received_value = request.headers.get(header_name) if isinstance(header_name, str) else None
            valid = (
                isinstance(header_name, str)
                and isinstance(expected_value, str)
                and isinstance(received_value, str)
                and compare_digest(received_value, expected_value)
            )
        else:
            header_name = credential_data.get("header_name")
            secret = credential_data.get("secret")
            received_value = request.headers.get(header_name) if isinstance(header_name, str) else None
            raw_body = await request.body()
            expected_value = hmac.new(
                secret.encode("utf-8") if isinstance(secret, str) else b"",
                raw_body,
                hashlib.sha256,
            ).hexdigest()
            received_signature = received_value.removeprefix("sha256=") if isinstance(received_value, str) else ""
            valid = (
                isinstance(header_name, str)
                and isinstance(secret, str)
                and bool(received_signature)
                and compare_digest(received_signature, expected_value)
            )
        if not valid:
            raise HTTPException(status_code=401, detail="Webhook authentication failed")
        return header_name

    def _preview_workflow_upgrades(workflow: WorkflowDocument) -> WorkflowUpgradePreview:
        try:
            preview = preview_workflow_node_upgrades(workflow, registry)
        except WorkflowNodeMigrationError as exc:
            raise HTTPException(
                status_code=422,
                detail=[
                    {
                        "path": exc.path,
                        "message": exc.message,
                        "code": "node_migration_unavailable",
                    }
                ],
            ) from exc
        return WorkflowUpgradePreview(
            workflow=preview.workflow,
            upgrades=[
                NodeUpgradeSummary(
                    nodeId=upgrade.node_id,
                    path=upgrade.path,
                    nodeType=upgrade.node_type,
                    fromVersion=upgrade.from_version,
                    toVersion=upgrade.to_version,
                    configChanges=[
                        NodeConfigChange(
                            path=change.path,
                            kind=change.kind,
                            before=change.before,
                            after=change.after,
                        )
                        for change in upgrade.config_changes
                    ],
                    migrationNotes=upgrade.migration_notes,
                )
                for upgrade in preview.upgrades
            ],
        )

    return app


async def _webhook_input(
    request: Request,
    webhook_path: str,
    *,
    redacted_header_names: set[str] | None = None,
) -> dict:
    raw_body = await request.body()
    body: object
    if not raw_body:
        body = None
    elif "application/json" in request.headers.get("content-type", ""):
        try:
            body = await request.json()
        except ValueError:
            body = raw_body.decode("utf-8", errors="replace")
    else:
        body = raw_body.decode("utf-8", errors="replace")
    redacted_header_names = {name.lower() for name in redacted_header_names or set()}
    headers = {
        name: "***" if name.lower() in redacted_header_names else value
        for name, value in request.headers.items()
    }
    return {
        "method": request.method,
        "path": webhook_path.strip("/"),
        "headers": headers,
        "query": dict(request.query_params),
        "body": body,
    }
