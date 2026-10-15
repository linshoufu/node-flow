from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, ClassVar, Generic, Literal, Mapping, TypeVar, cast, get_args, get_origin

from pydantic import BaseModel, ConfigDict
from .profiles import ProfileType


ConfigT = TypeVar("ConfigT", bound=BaseModel)
NodeClassT = TypeVar("NodeClassT", bound=type["BaseNode[Any]"])


@dataclass(frozen=True)
class Input:
    required: bool = True
    description: str = ""
    display_name: str | None = None
    category: str | None = None
    filter: dict[str, Any] | None = None
    schema: dict[str, Any] | None = None
    connection_kind: str = "data"
    max_connections: int | None = 1
    data_mode: str = "value"

    def to_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {"required": self.required, "description": self.description}
        if self.display_name is not None:
            result["displayName"] = self.display_name
        if self.category is not None:
            result["category"] = self.category
        if self.filter is not None:
            result["filter"] = self.filter
        if self.schema is not None:
            result["schema"] = self.schema
        if self.connection_kind != "data":
            result["connectionKind"] = self.connection_kind
        if self.max_connections != 1:
            result["maxConnections"] = self.max_connections
        if self.data_mode != "value":
            result["dataMode"] = self.data_mode
        return result


@dataclass(frozen=True)
class Output:
    description: str = ""
    display_name: str | None = None
    category: str | None = None
    filter: dict[str, Any] | None = None
    schema: dict[str, Any] | None = None
    connection_kind: str = "data"
    max_connections: int | None = None

    def to_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {"description": self.description}
        if self.display_name is not None:
            result["displayName"] = self.display_name
        if self.category is not None:
            result["category"] = self.category
        if self.filter is not None:
            result["filter"] = self.filter
        if self.schema is not None:
            result["schema"] = self.schema
        if self.connection_kind != "data":
            result["connectionKind"] = self.connection_kind
        if self.max_connections is not None:
            result["maxConnections"] = self.max_connections
        return result


FormControl = Literal[
    "text",
    "textarea",
    "password",
    "number",
    "switch",
    "select",
    "json",
    "dynamic_output_list",
    "dynamic_input_list",
    "url",
    "credential",
    "http_profile", "column_rules", "mapping_rules", "group_fields",
    "parameter_list",
    "string_list",
]
FormExpressionMode = Literal["allowed", "disabled", "required"]
FieldPlacement = Literal["inline", "panel"]


@dataclass(frozen=True)
class SelectOption:
    value: str
    label: str

    def to_dict(self) -> dict[str, str]:
        return {"value": self.value, "label": self.label}


@dataclass(frozen=True)
class FormCondition:
    field: str
    equals: Any | None = None
    one_of: tuple[Any, ...] = ()
    not_empty: bool = False

    def to_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {"field": self.field}
        if self.one_of:
            result["oneOf"] = list(self.one_of)
        elif self.not_empty:
            result["notEmpty"] = True
        else:
            result["equals"] = self.equals
        return result


@dataclass(frozen=True)
class FormField:
    key: str
    control: FormControl = "text"
    label: str | None = None
    description: str | None = None
    placeholder: str | None = None
    options: tuple[SelectOption | tuple[str, str], ...] = ()
    visible_when: FormCondition | None = None
    expression: FormExpressionMode | None = None
    credential_type_ids: tuple[str, ...] = ()
    placement: FieldPlacement = "panel"

    def __post_init__(self) -> None:
        normalized_options = tuple(
            option if isinstance(option, SelectOption) else SelectOption(*option)
            for option in self.options
        )
        object.__setattr__(self, "options", normalized_options)

    def to_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {"key": self.key, "control": self.control}
        if self.label is not None:
            result["label"] = self.label
        if self.description is not None:
            result["description"] = self.description
        if self.placeholder is not None:
            result["placeholder"] = self.placeholder
        if self.options:
            result["options"] = [option.to_dict() for option in self.options]
        if self.visible_when is not None:
            result["visibleWhen"] = self.visible_when.to_dict()
        if self.expression is not None:
            result["expression"] = self.expression
        if self.credential_type_ids:
            result["credentialTypeIds"] = list(self.credential_type_ids)
        if self.placement != "panel":
            result["placement"] = self.placement
        return result


@dataclass(frozen=True)
class FormGroup:
    id: str
    label: str
    fields: tuple[FormField, ...]
    description: str | None = None
    visible_when: FormCondition | None = None

    def to_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "id": self.id,
            "label": self.label,
            "fields": [field.to_dict() for field in self.fields],
        }
        if self.description is not None:
            result["description"] = self.description
        if self.visible_when is not None:
            result["visibleWhen"] = self.visible_when.to_dict()
        return result


@dataclass(frozen=True)
class NodeForm:
    groups: tuple[FormGroup, ...]

    def to_dict(self) -> dict[str, Any]:
        return {"groups": [group.to_dict() for group in self.groups]}


class NodeFormManifest(BaseModel):
    """节点呈现覆盖清单：编辑结果不写回 py 源码，而是在 py 文件旁生成 .nodeform.json。

    ``port_presentation`` 仅控制端口在编辑器和画布中的呈现；端口的
    handle、类型和运行语义始终由 Python 节点类声明。
    """

    model_config = ConfigDict(extra="forbid")

    version: int = 1
    form: dict[str, Any] | None = None
    defaults: dict[str, Any] | None = None
    placements: dict[str, FieldPlacement] | None = None
    portPresentation: dict[str, dict[str, dict[str, Any]]] | None = None
    cardStyle: dict[str, Any] | None = None
    summaryTemplate: dict[str, str] | None = None


@dataclass(frozen=True)
class DynamicOutputList:
    """Describe output ports derived from a list-valued node configuration field."""

    config_key: str
    id_key: str = "id"
    label_key: str = "label"
    output: Output = Output()
    default_items: tuple[dict[str, Any], ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "configKey": self.config_key,
            "idKey": self.id_key,
            "labelKey": self.label_key,
            "output": self.output.to_dict(),
            "defaultItems": list(self.default_items),
        }


@dataclass(frozen=True)
class DynamicInputList:
    """Describe input ports derived from a list-valued node configuration field."""

    config_key: str
    id_key: str = "id"
    label_key: str = "label"
    input: Input = Input()
    default_items: tuple[dict[str, Any], ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "configKey": self.config_key,
            "idKey": self.id_key,
            "labelKey": self.label_key,
            "input": self.input.to_dict(),
            "defaultItems": list(self.default_items),
        }


@dataclass(frozen=True)
class NodeMeta:
    id: str
    name: str
    category: str
    description: str = ""
    display_name: str | None = None
    group: str = "action"
    icon: str | None = None
    tags: tuple[str, ...] = ()
    keywords: tuple[str, ...] = ()
    documentation_url: str | None = None
    version: int = 1
    form: NodeForm | None = None
    dynamic_inputs: DynamicInputList | None = None
    dynamic_outputs: DynamicOutputList | None = None


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


@dataclass(frozen=True)
class CredentialData:
    id: str
    type_id: str
    name: str
    data: Mapping[str, str]


class NodeContext:
    def __init__(
        self,
        *,
        run_id: str,
        node_id: str,
        scope: list[str] | None = None,
        secrets: dict[str, str] | None = None,
        credentials: Mapping[str, CredentialData] | None = None,
        redact_secret: Callable[[str], None] | None = None,
        data: dict[str, Any] | None = None,
        workflow_id: str | None = None,
        static_data: Any | None = None,
        run_resources: dict[str, Any] | None = None,
        profile: Mapping[str, Any] | None = None,
        run_mode: Literal["live", "preview"] = "live",
    ) -> None:
        self.run_id = run_id
        self.node_id = node_id
        self.scope = scope or []
        self.cancelled = False
        self.logs: list[dict[str, Any]] = []
        self.progress: float | None = None
        self._secrets = secrets or {}
        self._credentials = dict(credentials or {})
        self._redact_secret = redact_secret
        self.data = data or {}
        self.workflow_id = workflow_id
        self._static_data = static_data
        self._run_resources = run_resources if run_resources is not None else {}
        self.profile = dict(profile or {})
        self._run_mode = run_mode
        self.log = NodeLogger(self.logs)

    @property
    def run_mode(self) -> Literal["live", "preview"]:
        """Immutable policy snapshotted by the platform for this invocation."""
        return self._run_mode

    def emit_progress(self, value: float) -> None:
        self.progress = max(0.0, min(1.0, value))

    def get_secret(self, key: str) -> str | None:
        return self._secrets.get(key)

    def get_credential(self, credential_id: str) -> CredentialData | None:
        return self._credentials.get(credential_id)

    def register_secret(self, value: str) -> None:
        if value and self._redact_secret is not None:
            self._redact_secret(value)

    def set_variable(self, name: str, value: Any) -> dict[str, Any]:
        variables = self.data.setdefault("variables", {})
        if not isinstance(variables, dict):
            raise ValueError("Node context variables must be a dictionary")
        variables[name] = value
        return dict(variables)

    def get_or_create_run_resource(self, key: str, factory: Callable[[], Any]) -> Any:
        """Return private state shared by nodes during one workflow run only."""
        if key not in self._run_resources:
            self._run_resources[key] = factory()
        return self._run_resources[key]

    def get_workflow_static_data(self, key: str, default: Any = None) -> Any:
        return self._get_static_data("workflow", key, default)

    def set_workflow_static_data(self, key: str, value: Any) -> None:
        self._set_static_data("workflow", key, value)

    def delete_workflow_static_data(self, key: str) -> None:
        self._delete_static_data("workflow", key)

    def get_node_static_data(self, key: str, default: Any = None) -> Any:
        return self._get_static_data("node", key, default)

    def set_node_static_data(self, key: str, value: Any) -> None:
        self._set_static_data("node", key, value)

    def delete_node_static_data(self, key: str) -> None:
        self._delete_static_data("node", key)

    def _get_static_data(self, scope: str, key: str, default: Any) -> Any:
        return self._require_static_data().get(self.workflow_id, self.node_id, scope, key, default)

    def _set_static_data(self, scope: str, key: str, value: Any) -> None:
        self._require_static_data().set(self.workflow_id, self.node_id, scope, key, value)

    def _delete_static_data(self, scope: str, key: str) -> None:
        self._require_static_data().delete(self.workflow_id, self.node_id, scope, key)

    def _require_static_data(self) -> Any:
        if self.workflow_id is None or self._static_data is None:
            raise RuntimeError("Workflow static data is only available during workflow execution")
        return self._static_data


def execution_item(
    data: Any,
    *,
    binary: Any | None = None,
    paired_item: Any | None = None,
) -> dict[str, Any]:
    """Build one portable execution-data item for a node output.

    Return this dictionary (or a list of these dictionaries) as an output-port
    value when a node needs to preserve source pairing or binary metadata.
    """

    item: dict[str, Any] = {"json": data}
    if binary is not None:
        item["binary"] = binary
    if paired_item is not None:
        item["pairedItem"] = paired_item
    return item


class BaseNode(Generic[ConfigT]):
    effect: ClassVar[Literal["pure", "read", "write", "unknown"]] = "unknown"
    preview_support: ClassVar[Literal["execute", "plan", "unsupported"]] = "unsupported"
    profile_type: ClassVar[ProfileType | None] = None
    retry_safe: ClassVar[bool] = True

    @classmethod
    def can_retry(cls, config: dict[str, Any]) -> bool:
        """Whether this configured operation is safe to repeat after failure."""
        return cls.retry_safe
    inputs: ClassVar[dict[str, Input]] = {}
    outputs: ClassVar[dict[str, Output]] = {"success": Output()}
    resolve_config_expressions: ClassVar[bool] = True

    async def preview(self, ctx: NodeContext, inputs: dict):
        raise NotImplementedError("此节点未实现预演接口")

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

    @classmethod
    def output_ports(cls, config: Mapping[str, Any] | BaseModel | None = None) -> dict[str, Output]:
        return dict(cls.outputs)

    @classmethod
    def input_ports(cls, config: Mapping[str, Any] | BaseModel | None = None) -> dict[str, Input]:
        return dict(cls.inputs)

    @classmethod
    def migrate_config(cls, from_version: int, config: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError(f"{cls.__name__} 未定义从版本 {from_version} 的迁移函数")

    @classmethod
    def validate_outputs(
        cls,
        outputs: Any,
        config: Mapping[str, Any] | BaseModel | None = None,
    ) -> dict[str, Any]:
        if not isinstance(outputs, dict):
            raise ValueError(
                f"{cls.__name__}.execute() must return a dict of output names to values"
            )
        declared_ports = cls.output_ports(config)
        undeclared = sorted(str(name) for name in outputs if name not in declared_ports)
        if undeclared:
            declared = ", ".join(sorted(declared_ports)) or "<none>"
            returned = ", ".join(undeclared)
            raise ValueError(
                f"{cls.__name__}.execute() returned undeclared output(s): {returned}. "
                f"Declared outputs: {declared}"
            )
        return outputs

    async def execute(self, ctx: NodeContext, inputs: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError


class NodeConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")


class EmptyConfig(NodeConfig):
    pass


def node(
    *,
    id: str,
    name: str,
    category: str,
    description: str = "",
    display_name: str | None = None,
    group: str = "action",
    icon: str | None = None,
    tags: list[str] | tuple[str, ...] = (),
    keywords: list[str] | tuple[str, ...] = (),
    documentation_url: str | None = None,
    version: int = 1,
    form: NodeForm | None = None,
    dynamic_inputs: DynamicInputList | None = None,
    dynamic_outputs: DynamicOutputList | None = None,
) -> Callable[[NodeClassT], NodeClassT]:
    def decorator(cls: NodeClassT) -> NodeClassT:
        cls.__node_meta__ = NodeMeta(
            id=id,
            name=name,
            category=category,
            description=description,
            display_name=display_name or name,
            group=group,
            icon=icon,
            tags=tuple(tags),
            keywords=tuple(keywords),
            documentation_url=documentation_url,
            version=version,
            form=form,
            dynamic_inputs=dynamic_inputs,
            dynamic_outputs=dynamic_outputs,
        )
        return cls

    return decorator
