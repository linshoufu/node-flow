"""节点目录路由：健康检查、节点类型、节点包管理、节点资产。"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request

from ..node_package_installer import (
    MAX_ARCHIVE_BYTES,
    NodePackageInstallError,
    NodePackageInstaller,
)
from ..node_registry import NodeRegistry
from ..node_registry_manifest import (
    delete_manifest,
    read_manifest,
    write_manifest,
)
from ..schemas import NodeAssetOpenSourceRequest, NodeFormManifestRequest, NodePackageSettingsUpdate
from ..storage import Storage


def _open_in_system_handler(path: Path) -> None:
    """用系统默认程序（本机编辑器）打开节点源文件。"""
    if sys.platform.startswith("win"):
        os.startfile(path)
        return
    command = "open" if sys.platform == "darwin" else "xdg-open"
    subprocess.Popen(
        [command, str(path)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


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

    @router.post("/api/node-assets/open-source")
    def open_node_asset_source(request: NodeAssetOpenSourceRequest) -> dict[str, object]:
        # 只允许打开 nodes_dir 内的文件，防止路径穿越访问其他磁盘文件
        base_dir = registry.nodes_dir.resolve()
        candidate = (base_dir / request.source_path).resolve()
        if not candidate.is_relative_to(base_dir):
            raise HTTPException(status_code=400, detail="源文件路径不合法。")
        if not candidate.is_file():
            raise HTTPException(
                status_code=404,
                detail="源文件不存在，请重新扫描节点库后再试。",
            )
        _open_in_system_handler(candidate)
        return {"opened": True, "sourcePath": request.source_path}

    @router.get("/api/node-types/{node_type_id}")
    def get_node_type(node_type_id: str) -> dict[str, object]:
        """获取单个节点类型详情，供节点定义编辑页加载。"""
        node_type = registry.get_node_type(node_type_id)
        if node_type is None:
            raise HTTPException(status_code=404, detail="节点类型不存在。")
        return node_type.to_api_dict()

    @router.get("/api/node-types/{node_type_id}/manifest")
    def get_node_type_manifest(node_type_id: str) -> dict[str, object]:
        """读取节点类型的 manifest 覆盖文件。"""
        node_type = registry.get_node_type(node_type_id)
        if node_type is None:
            raise HTTPException(status_code=404, detail="节点类型不存在。")
        source_path = registry.source_path_for(node_type_id)
        if source_path is None or not source_path.is_file():
            raise HTTPException(status_code=404, detail="节点源文件不存在，请重新扫描节点库后再试。")
        manifest = read_manifest(source_path)
        if manifest is None:
            raise HTTPException(status_code=404, detail="该节点没有 manifest 覆盖文件。")
        return manifest

    @router.put("/api/node-types/{node_type_id}/manifest")
    def save_node_type_manifest(node_type_id: str, request: NodeFormManifestRequest) -> dict[str, object]:
        """保存节点类型的 manifest 覆盖文件并触发重扫。

        仅允许编辑本地脚本节点（无 package 或有 package 但 source 为 workspace）。
        builtin 和 installed 节点返回 403。
        """
        node_type = registry.get_node_type(node_type_id)
        if node_type is None:
            raise HTTPException(status_code=404, detail="节点类型不存在。")
        # 只读保护：已安装包节点不允许编辑
        if node_type.package is not None and node_type.package.source == "installed":
            raise HTTPException(
                status_code=403,
                detail="此节点来自已安装包，不支持编辑 manifest。仅本地脚本节点可编辑。",
            )
        source_path = registry.source_path_for(node_type_id)
        if source_path is None or not source_path.is_file():
            raise HTTPException(status_code=404, detail="节点源文件不存在，请重新扫描节点库后再试。")

        manifest_dict = request.model_dump(exclude_none=True)
        manifest_dict.setdefault("version", 1)
        try:
            write_manifest(source_path, manifest_dict)
        except OSError as exc:
            raise HTTPException(status_code=500, detail=f"manifest 写入失败：{exc}") from exc

        # 写入后触发重扫
        try:
            node_package_installer.scan_registry()
        except NodePackageInstallError as exc:
            raise HTTPException(
                status_code=exc.status_code,
                detail=exc.to_detail(),
            ) from exc
        return {"saved": True, "nodeTypeId": node_type_id}

    @router.delete("/api/node-types/{node_type_id}/manifest")
    def delete_node_type_manifest(node_type_id: str) -> dict[str, object]:
        """删除节点类型的 manifest 覆盖文件并触发重扫。"""
        node_type = registry.get_node_type(node_type_id)
        if node_type is None:
            raise HTTPException(status_code=404, detail="节点类型不存在。")
        if node_type.package is not None and node_type.package.source == "installed":
            raise HTTPException(
                status_code=403,
                detail="此节点来自已安装包，不支持编辑 manifest。仅本地脚本节点可编辑。",
            )
        source_path = registry.source_path_for(node_type_id)
        if source_path is None:
            raise HTTPException(status_code=404, detail="节点源文件不存在，请重新扫描节点库后再试。")

        deleted = delete_manifest(source_path)
        # 无论是否真的删除了文件，都触发重扫更新内存状态
        try:
            node_package_installer.scan_registry()
        except NodePackageInstallError as exc:
            raise HTTPException(
                status_code=exc.status_code,
                detail=exc.to_detail(),
            ) from exc
        return {"deleted": deleted, "nodeTypeId": node_type_id}

    return router
