"""工作区资源路由：凭据、项目变量、运行环境。"""

from __future__ import annotations

import sqlite3

from fastapi import APIRouter, HTTPException

from ..credentials import (
    CredentialStorageUnavailableError,
    CredentialVault,
    credential_type_api_dict,
    validate_credential_data,
)
from ..credential_references import credential_reference_fields
from ..schemas import (
    CredentialCreateRequest,
    CredentialReference,
    CredentialSummary,
    CredentialUpdateRequest,
    HttpProfile,
    HttpProfileCreateRequest,
    HttpProfileUpdateRequest,
    ProjectEnvironment,
    ProjectEnvironmentCreateRequest,
    ProjectEnvironmentUpdateRequest,
    ProjectVariable,
    ProjectVariableCreateRequest,
    ProjectVariableUpdateRequest,
)
from ..storage import Storage
from .common import list_all_credential_types, lookup_credential_type


def build_workspace_resources_router(
    storage: Storage,
    registry,
    credential_vault: CredentialVault,
) -> APIRouter:
    router = APIRouter()

    def _require_credential_type(type_id: str):
        credential_type = lookup_credential_type(type_id, registry)
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
            raise HTTPException(
                status_code=503,
                detail="凭据库不可用，请检查服务密钥配置及密钥文件权限。",
            ) from exc

    def _node_credential_ids(node) -> tuple[str, ...]:
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

    def _validate_http_profile_headers(headers: dict[str, str]) -> None:
        sensitive_names = {"authorization", "cookie", "proxy-authorization", "x-api-key"}
        invalid = [name for name in headers if name.strip().lower() in sensitive_names]
        if invalid:
            raise HTTPException(
                status_code=422,
                detail="公共请求头不能保存认证信息，请使用 HTTP 凭据。",
            )

    def _validate_http_profile_credential(credential_id: str | None) -> None:
        if credential_id is None:
            return
        credential = storage.get_credential(credential_id)
        if credential is None:
            raise HTTPException(status_code=422, detail="HTTP 配置档引用的凭据不存在。")

    @router.get("/api/credential-types")
    def credential_types() -> list[dict[str, object]]:
        return [credential_type_api_dict(credential_type) for credential_type in list_all_credential_types(registry)]

    @router.get("/api/credentials")
    def list_credentials() -> list[CredentialSummary]:
        return storage.list_credentials()

    @router.post("/api/credentials", status_code=201)
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

    @router.patch("/api/credentials/{credential_id}")
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

    @router.get("/api/credentials/{credential_id}/references")
    def credential_references(credential_id: str) -> list[CredentialReference]:
        if storage.get_credential(credential_id) is None:
            raise HTTPException(status_code=404, detail="凭据不存在。")
        return storage.list_credential_references(
            credential_id,
            credential_ids_for_node=_node_credential_ids,
        )

    @router.delete("/api/credentials/{credential_id}", status_code=204)
    def delete_credential(credential_id: str) -> None:
        if any(profile.get("credential_id") == credential_id for profile in storage.list_profiles()):
            raise HTTPException(status_code=409, detail="凭据仍被配置档引用")
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

    @router.get("/api/project-variables")
    def list_project_variables() -> list[ProjectVariable]:
        return storage.list_project_variables()

    @router.post("/api/project-variables", status_code=201)
    def create_project_variable(request: ProjectVariableCreateRequest) -> ProjectVariable:
        try:
            return storage.create_project_variable(name=request.name, value=request.value)
        except sqlite3.IntegrityError as exc:
            raise HTTPException(status_code=409, detail="项目变量名已存在") from exc

    @router.patch("/api/project-variables/{name}")
    def update_project_variable(name: str, request: ProjectVariableUpdateRequest) -> ProjectVariable:
        variable = storage.update_project_variable(name, value=request.value)
        if variable is None:
            raise HTTPException(status_code=404, detail="项目变量不存在")
        return variable

    @router.delete("/api/project-variables/{name}", status_code=204)
    def delete_project_variable(name: str) -> None:
        if not storage.delete_project_variable(name):
            raise HTTPException(status_code=404, detail="项目变量不存在")

    @router.get("/api/http-profiles")
    def list_http_profiles() -> list[HttpProfile]:
        return storage.list_http_profiles()

    @router.post("/api/http-profiles", status_code=201)
    def create_http_profile(request: HttpProfileCreateRequest) -> HttpProfile:
        _validate_http_profile_headers(request.headers)
        _validate_http_profile_credential(request.credential_id)
        try:
            return storage.create_http_profile(
                name=request.name, base_url=request.base_url, headers=request.headers,
                credential_id=request.credential_id, timeout_seconds=request.timeout_seconds,
                authentication=request.authentication,
            )
        except sqlite3.IntegrityError as exc:
            raise HTTPException(status_code=409, detail="已存在同名 HTTP 配置档") from exc

    @router.patch("/api/http-profiles/{profile_id}")
    def update_http_profile(profile_id: str, request: HttpProfileUpdateRequest) -> HttpProfile:
        if request.headers is not None:
            _validate_http_profile_headers(request.headers)
        if "credential_id" in request.model_fields_set:
            _validate_http_profile_credential(request.credential_id)
        try:
            updated = storage.update_http_profile(
                profile_id,
                **{field: getattr(request, field) for field in request.model_fields_set},
            )
        except sqlite3.IntegrityError as exc:
            raise HTTPException(status_code=409, detail="已存在同名 HTTP 配置档") from exc
        if updated is None:
            raise HTTPException(status_code=404, detail="HTTP 配置档不存在")
        return updated

    @router.delete("/api/http-profiles/{profile_id}", status_code=204)
    def delete_http_profile(profile_id: str) -> None:
        if not storage.delete_http_profile(profile_id):
            raise HTTPException(status_code=404, detail="HTTP 配置档不存在")

    @router.get("/api/project-environments")
    def list_project_environments() -> list[ProjectEnvironment]:
        return storage.list_project_environments()

    @router.post("/api/project-environments", status_code=201)
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

    @router.patch("/api/project-environments/{environment_id}")
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

    @router.delete("/api/project-environments/{environment_id}", status_code=204)
    def delete_project_environment(environment_id: str) -> None:
        try:
            deleted = storage.delete_project_environment(environment_id)
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        if not deleted:
            raise HTTPException(status_code=404, detail="运行环境不存在")

    return router
