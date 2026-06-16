from __future__ import annotations

import importlib.util
import hashlib
import inspect
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from nodeflow_sdk import BaseNode


@dataclass(frozen=True)
class RegisteredNodeType:
    id: str
    name: str
    category: str
    description: str
    inputs: dict[str, dict[str, Any]]
    outputs: dict[str, dict[str, Any]]
    config_schema: dict[str, Any]
    node_class: type[BaseNode[Any]]

    def to_api_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "category": self.category,
            "description": self.description,
            "inputs": self.inputs,
            "outputs": self.outputs,
            "configSchema": self.config_schema,
        }


class NodeRegistry:
    def __init__(self, *, nodes_dir: Path) -> None:
        self.nodes_dir = nodes_dir
        self._nodes: dict[str, RegisteredNodeType] = {}

    def scan(self) -> None:
        self._nodes = {}
        if not self.nodes_dir.exists():
            return
        for file_path in sorted(self.nodes_dir.rglob("*.py")):
            if file_path.name.startswith("_"):
                continue
            self._load_file(file_path)

    def list_node_types(self) -> list[RegisteredNodeType]:
        return sorted(
            self._nodes.values(), key=lambda node_type: (node_type.category, node_type.name)
        )

    def get(self, node_id: str) -> RegisteredNodeType:
        try:
            return self._nodes[node_id]
        except KeyError as exc:
            raise KeyError(f"Unknown node type: {node_id}") from exc

    def has(self, node_id: str) -> bool:
        return node_id in self._nodes

    def _load_file(self, file_path: Path) -> None:
        module_name = self._module_name_for(file_path)
        spec = importlib.util.spec_from_file_location(module_name, file_path)
        if spec is None or spec.loader is None:
            raise RuntimeError(f"Cannot import node file: {file_path}")
        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        spec.loader.exec_module(module)
        for value in module.__dict__.values():
            if (
                inspect.isclass(value)
                and issubclass(value, BaseNode)
                and hasattr(value, "__node_meta__")
                and value.__module__ == module.__name__
            ):
                self._register(value)

    def _module_name_for(self, file_path: Path) -> str:
        resolved_path = file_path.resolve()
        try:
            path_parts = resolved_path.relative_to(self.nodes_dir.resolve()).with_suffix("").parts
        except ValueError:
            path_parts = resolved_path.with_suffix("").parts
        safe_parts = [re.sub(r"\W+", "_", part).strip("_") for part in path_parts]
        safe_stem = "_".join(part for part in safe_parts if part)
        path_hash = hashlib.sha1(str(resolved_path).encode("utf-8")).hexdigest()[:10]
        return f"nodeflow_user_node_{safe_stem}_{path_hash}"

    def _register(self, node_class: type[BaseNode[Any]]) -> None:
        meta = node_class.__node_meta__
        if meta.id in self._nodes:
            raise ValueError(f"Duplicate node id: {meta.id}")
        self._nodes[meta.id] = RegisteredNodeType(
            id=meta.id,
            name=meta.name,
            category=meta.category,
            description=meta.description,
            inputs={name: value.to_dict() for name, value in node_class.inputs.items()},
            outputs={name: value.to_dict() for name, value in node_class.outputs.items()},
            config_schema=node_class.config_schema(),
            node_class=node_class,
        )
