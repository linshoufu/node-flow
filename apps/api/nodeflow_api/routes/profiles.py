"""Generic typed configuration resources declared by node packages."""
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from nodeflow_sdk.non_secret import assert_non_secret

from ..resource_profiles import profile_types, referenced_profiles
from ..config_bindings import resolve_workflow_bindings


def _all_nodes(nodes):
    for node in nodes:
        yield node
        for body in node.subflows.values():
            yield from _all_nodes(body.nodes)


class ProfileWrite(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=120)
    type_id: str
    data: dict[str, Any]
    credential_id: str | None = None


def build_profile_router(storage, registry, refresh=None):
    router = APIRouter()

    def validate(request):
        (refresh or registry.scan_if_changed)()
        spec = profile_types(registry).get(request.type_id)
        if spec is None:
            raise HTTPException(422, "配置档类型不存在或所属包未启用")
        try:
            assert_non_secret(request.data)
            data = spec.model.model_validate(request.data, extra="forbid").model_dump(mode="json")
        except ValidationError as exc:
            raise HTTPException(422, [{"path": ".".join(str(part) for part in error["loc"]), "message": error["msg"]} for error in exc.errors()]) from exc
        except ValueError as exc:
            raise HTTPException(422, "配置档字段不完整或类型错误") from exc
        if request.credential_id:
            credential = storage.get_credential(request.credential_id)
            if credential is None or (spec.credential_type_ids and credential.type_id not in spec.credential_type_ids):
                raise HTTPException(422, "凭据不存在或与配置档类型不匹配")
        elif spec.credential_type_ids:
            raise HTTPException(422, "请选择配置档使用的凭据")
        return data

    @router.get("/api/profile-types")
    def types():
        (refresh or registry.scan_if_changed)()
        return [spec.to_dict() for spec in profile_types(registry).values()]

    @router.get("/api/profiles")
    def profiles():
        return storage.list_profiles()

    @router.post("/api/profiles", status_code=201)
    def create(request: ProfileWrite):
        return storage.save_profile(**{**request.model_dump(), "data": validate(request)})

    @router.put("/api/profiles/{profile_id}")
    def update(profile_id: str, request: ProfileWrite):
        current = storage.get_profile(profile_id)
        if current is None:
            raise HTTPException(404, "配置档不存在")
        if current["type_id"] != request.type_id:
            raise HTTPException(422, "不能修改已有配置档的类型")
        return storage.save_profile(profile_id=profile_id, **{**request.model_dump(), "data": validate(request)})

    @router.delete("/api/profiles/{profile_id}", status_code=204)
    def delete(profile_id: str):
        for summary in storage.list_workflows():
            workflow = storage.get_workflow(summary.id)
            for environment in storage.list_project_environments():
                try:
                    bound = resolve_workflow_bindings(workflow, registry)
                    if any("profile_id" in node.configBindings for node in _all_nodes(bound.nodes)):
                        raise ValueError("运行参数配置档引用尚未确定")
                    references = list(referenced_profiles(bound.nodes, {"project": environment.variables, "vars": workflow.settings.variables}))
                except ValueError:
                    raise HTTPException(409, "工作流使用动态配置档引用，请先解除引用") from None
                if profile_id in references:
                    raise HTTPException(409, "配置档仍被工作流引用")
        if not storage.delete_profile(profile_id):
            raise HTTPException(404, "配置档不存在")

    return router
