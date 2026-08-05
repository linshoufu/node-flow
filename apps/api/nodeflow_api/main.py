from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
import asyncio
import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .credentials import CredentialVault
from .executor import WorkflowExecutor
from .node_registry import NodeRegistry
from .node_package_installer import NodePackageInstaller
from .project_config import local_web_origins
from .storage import Storage
from .scheduler import WorkflowScheduler
from .run_recovery import RunRecoveryService
from .run_dispatcher import WorkflowRunDispatcher
from .webhook_test_listeners import WebhookTestListenerRegistry
from .routes.common import make_workflow_validator
from .routes.node_catalog import build_node_catalog_router
from .routes.runs import build_run_router
from .routes.webhooks import build_webhook_router
from .routes.workflows import build_workflow_router
from .routes.workspace_resources import build_workspace_resources_router


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
    validate_workflow_document = make_workflow_validator(registry, storage)

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

    app.include_router(build_node_catalog_router(registry, node_package_installer, storage))
    app.include_router(build_workspace_resources_router(storage, registry, credential_vault))
    app.include_router(
        build_workflow_router(
            storage,
            registry,
            scheduler,
            webhook_test_listeners,
            validate_workflow_document,
        )
    )
    app.include_router(build_run_router(storage, dispatcher, registry, validate_workflow_document))
    app.include_router(
        build_webhook_router(
            storage,
            dispatcher,
            credential_vault,
            webhook_test_listeners,
            validate_workflow_document,
        )
    )
    return app
