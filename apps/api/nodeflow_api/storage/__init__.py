"""持久化层：按领域组合的 Storage 门面。

各领域的仓储实现位于独立模块（base/package_policies/resources/workflows/runs），
`Storage` 通过 mixin 组合保持原有方法签名与调用方式不变。
"""

from .base import StorageBase, WorkflowVersionConflictError, utc_now
from .package_policies import NodePackagePolicyMixin
from .resources import WorkspaceResourceMixin
from .runs import RunRepositoryMixin
from .workflows import WorkflowRepositoryMixin


class Storage(
    NodePackagePolicyMixin,
    WorkspaceResourceMixin,
    WorkflowRepositoryMixin,
    RunRepositoryMixin,
    StorageBase,
):
    """统一的 SQLite 持久化门面，由各领域仓储组合而成。"""


__all__ = ["Storage", "WorkflowVersionConflictError", "utc_now"]
