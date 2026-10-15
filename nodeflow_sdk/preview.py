"""Public, business-independent preview contract for node packages."""
from dataclasses import dataclass, field
from typing import Any, Literal

RunMode = Literal["live", "preview"]
NodeEffect = Literal["pure", "read", "write", "unknown"]
PreviewSupport = Literal["execute", "plan", "unsupported"]


@dataclass(frozen=True)
class PlannedEffect:
    operation: str
    target: str
    details: Any = None
    description: str = ""


@dataclass(frozen=True)
class PreviewResult:
    effects: tuple[PlannedEffect, ...] = ()
    outputs: dict[str, Any] = field(default_factory=dict)
    # True means the output contract is available without inventing real IDs.
    complete: bool = False
