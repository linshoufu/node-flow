from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, ClassVar, Generic, TypeVar, cast, get_args, get_origin

from pydantic import BaseModel, ConfigDict


ConfigT = TypeVar("ConfigT", bound=BaseModel)
NodeClassT = TypeVar("NodeClassT", bound=type["BaseNode[Any]"])


@dataclass(frozen=True)
class Input:
    required: bool = True
    description: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {"required": self.required, "description": self.description}


@dataclass(frozen=True)
class Output:
    description: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {"description": self.description}


@dataclass(frozen=True)
class NodeMeta:
    id: str
    name: str
    category: str
    description: str = ""


class NodeLogger:
    def __init__(self, sink: list[dict[str, Any]]) -> None:
        self._sink = sink

    def info(self, message: str, **fields: Any) -> None:
        self._append("info", message, fields)

    def warning(self, message: str, **fields: Any) -> None:
        self._append("warning", message, fields)

    def error(self, message: str, **fields: Any) -> None:
        self._append("error", message, fields)

    def _append(self, level: str, message: str, fields: dict[str, Any]) -> None:
        self._sink.append(
            {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "level": level,
                "message": message,
                "fields": fields,
            }
        )


class NodeContext:
    def __init__(
        self,
        *,
        run_id: str,
        node_id: str,
        scope: list[str] | None = None,
        secrets: dict[str, str] | None = None,
    ) -> None:
        self.run_id = run_id
        self.node_id = node_id
        self.scope = scope or []
        self.cancelled = False
        self.logs: list[dict[str, Any]] = []
        self.progress: float | None = None
        self._secrets = secrets or {}
        self.log = NodeLogger(self.logs)

    def emit_progress(self, value: float) -> None:
        self.progress = max(0.0, min(1.0, value))

    def get_secret(self, key: str) -> str | None:
        return self._secrets.get(key)


class BaseNode(Generic[ConfigT]):
    inputs: ClassVar[dict[str, Input]] = {}
    outputs: ClassVar[dict[str, Output]] = {"success": Output()}

    def __init__(self, *, config: dict[str, Any] | ConfigT | None = None) -> None:
        model = self.config_model()
        raw_config = config or {}
        self.config: ConfigT = (
            raw_config
            if isinstance(raw_config, model)
            else model.model_validate(raw_config, extra="forbid")
        )

    @classmethod
    def config_model(cls) -> type[ConfigT]:
        for base in getattr(cls, "__orig_bases__", []):
            if get_origin(base) is BaseNode:
                args = get_args(base)
                if args and isinstance(args[0], type) and issubclass(args[0], BaseModel):
                    return args[0]
        return cast(type[ConfigT], EmptyConfig)

    @classmethod
    def config_schema(cls) -> dict[str, Any]:
        return cls.config_model().model_json_schema()

    async def execute(self, ctx: NodeContext, inputs: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError


class NodeConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")


class EmptyConfig(NodeConfig):
    pass


def node(
    *, id: str, name: str, category: str, description: str = ""
) -> Callable[[NodeClassT], NodeClassT]:
    def decorator(cls: NodeClassT) -> NodeClassT:
        cls.__node_meta__ = NodeMeta(
            id=id,
            name=name,
            category=category,
            description=description,
        )
        return cls

    return decorator
