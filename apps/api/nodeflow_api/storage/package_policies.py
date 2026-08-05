"""节点包策略仓储。"""

from __future__ import annotations

from ..node_package_lifecycle import NodePackagePolicy
from .base import utc_now


class NodePackagePolicyMixin:
    def node_package_policies(self) -> dict[str, NodePackagePolicy]:
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT package_id, enabled, locked_version, updated_at
                FROM node_package_settings
                ORDER BY package_id
                """
            ).fetchall()
        return {
            row["package_id"]: NodePackagePolicy(
                package_id=row["package_id"],
                enabled=bool(row["enabled"]),
                locked_version=row["locked_version"],
                updated_at=row["updated_at"],
            )
            for row in rows
        }

    def set_node_package_policy(
        self,
        package_id: str,
        *,
        enabled: bool,
        locked_version: str | None,
    ) -> NodePackagePolicy:
        policy = NodePackagePolicy(
            package_id=package_id,
            enabled=enabled,
            locked_version=locked_version,
            updated_at=utc_now(),
        )
        with self._lock:
            with self._connection:
                self._connection.execute(
                    """
                    INSERT INTO node_package_settings (
                      package_id, enabled, locked_version, updated_at
                    )
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(package_id) DO UPDATE SET
                      enabled = excluded.enabled,
                      locked_version = excluded.locked_version,
                      updated_at = excluded.updated_at
                    """,
                    (
                        policy.package_id,
                        int(policy.enabled),
                        policy.locked_version,
                        policy.updated_at,
                    ),
                )
        return policy

    def delete_node_package_policy(self, package_id: str) -> bool:
        with self._lock:
            with self._connection:
                cursor = self._connection.execute(
                    "DELETE FROM node_package_settings WHERE package_id = ?",
                    (package_id,),
                )
        return cursor.rowcount > 0
