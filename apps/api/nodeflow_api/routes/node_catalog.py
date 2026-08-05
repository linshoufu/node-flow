"""节点目录路由：健康检查、节点类型、节点包管理。"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from ..node_package_installer import (
    MAX_ARCHIVE_BYTES,
    NodePackageInstallError,
    NodePackageInstaller,
)
from ..node_registry import NodeRegistry
from ..schemas import NodePackageSettingsUpdate
from ..storage import Storage


def build_node_catalog_router(
    registry: NodeRegistry,
    node_package_installer: NodePackageInstaller,
    storage: Storage,
) -> APIRouter:
    router = APIRouter()

    @router.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @router.get("/api/node-types")
    def node_types() -> list[dict]:
        try:
            node_package_installer.scan_registry_if_changed(timeout_seconds=5.0)
        except NodePackageInstallError as exc:
            raise HTTPException(
                status_code=exc.status_code,
                detail=exc.to_detail(),
            ) from exc
        return [node_type.to_api_dict() for node_type in registry.list_node_types()]

    @router.post("/api/node-types/reload")
    def reload_node_types() -> list[dict]:
        try:
            node_package_installer.scan_registry()
        except NodePackageInstallError as exc:
            raise HTTPException(
                status_code=exc.status_code,
                detail=exc.to_detail(),
            ) from exc
        return [node_type.to_api_dict() for node_type in registry.list_node_types()]

    @router.get("/api/node-packages")
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

    @router.post("/api/node-packages/install", status_code=201)
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

    @router.get("/api/node-packages/{package_id}/revisions")
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

    @router.post(
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

    @router.put("/api/node-packages/{package_id}/settings")
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

    @router.delete("/api/node-packages/{package_id}")
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

    return router
