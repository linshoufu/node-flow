"""Create a minimal, loadable Node Flow Python node package."""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

from .version import SUPPORTED_NODEFLOW_ENGINE_RANGE


_NAMESPACED_ID_PATTERN = re.compile(
    r"^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z][A-Za-z0-9_-]*)+$"
)


@dataclass(frozen=True)
class PackageScaffoldOptions:
    target: Path
    package_id: str
    package_name: str
    node_id: str
    node_name: str
    category: str = "Custom"


@dataclass(frozen=True)
class PackageScaffoldResult:
    package_dir: Path
    manifest_path: Path
    node_path: Path


def scaffold_package(options: PackageScaffoldOptions) -> PackageScaffoldResult:
    """Create one package manifest and one runnable example node.

    The target directory must not already exist so the command can never
    silently overwrite a developer's package.
    """

    _validate_namespaced_id("Package ID", options.package_id)
    _validate_namespaced_id("Node ID", options.node_id)
    _validate_non_empty("Package name", options.package_name)
    _validate_non_empty("Node name", options.node_name)
    _validate_non_empty("Category", options.category)
    if options.target.exists():
        raise FileExistsError(f"Package directory already exists: {options.target}")

    node_filename = _node_filename(options.node_id)
    manifest_path = options.target / "nodeflow-package.json"
    node_path = options.target / node_filename
    options.target.mkdir(parents=True)
    manifest_path.write_text(
        json.dumps(
            {
                "id": options.package_id,
                "name": options.package_name,
                "version": "0.1.0",
                "description": "Custom Node Flow nodes.",
                "engines": {
                    "nodeflow": SUPPORTED_NODEFLOW_ENGINE_RANGE,
                    "python": ">=3.11",
                },
                "pythonDependencies": [],
                "nodeEntrypoints": [node_filename],
            },
            indent=2,
            ensure_ascii=True,
        )
        + "\n",
        encoding="utf-8",
    )
    node_path.write_text(_node_source(options), encoding="utf-8")
    return PackageScaffoldResult(
        package_dir=options.target,
        manifest_path=manifest_path,
        node_path=node_path,
    )


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Create a Node Flow Python node package.")
    parser.add_argument("target", type=Path, help="new package directory")
    parser.add_argument("--package-id", required=True, help="namespaced package ID, for example acme.tools")
    parser.add_argument("--package-name", required=True, help="package display name")
    parser.add_argument("--node-id", required=True, help="namespaced node ID, for example acme.echo")
    parser.add_argument("--node-name", required=True, help="node display name")
    parser.add_argument("--category", default="Custom", help="node library category")
    args = parser.parse_args(argv)
    try:
        result = scaffold_package(
            PackageScaffoldOptions(
                target=args.target,
                package_id=args.package_id,
                package_name=args.package_name,
                node_id=args.node_id,
                node_name=args.node_name,
                category=args.category,
            )
        )
    except (FileExistsError, ValueError) as exc:
        parser.error(str(exc))

    print(f"Created Node Flow package: {result.package_dir}")
    print(f"  Manifest: {result.manifest_path.name}")
    print(f"  Example node: {result.node_path.name}")
    return 0


def _validate_namespaced_id(label: str, value: str) -> None:
    if not _NAMESPACED_ID_PATTERN.fullmatch(value):
        raise ValueError(f"{label} must use a namespace, for example acme.example")


def _validate_non_empty(label: str, value: str) -> None:
    if not value.strip():
        raise ValueError(f"{label} must not be empty")


def _node_filename(node_id: str) -> str:
    segment = node_id.rsplit(".", maxsplit=1)[-1]
    safe_segment = re.sub(r"[^A-Za-z0-9_]", "_", segment)
    return f"{safe_segment}.py"


def _node_source(options: PackageScaffoldOptions) -> str:
    return f'''from typing import Any

from nodeflow_sdk import BaseNode, Input, NodeConfig, NodeContext, Output, node


class ExampleConfig(NodeConfig):
    message: str = "hello"


@node(
    id={_python_literal(options.node_id)},
    name={_python_literal(options.node_name)},
    category={_python_literal(options.category)},
    description="A custom Node Flow node.",
)
class ExampleNode(BaseNode[ExampleConfig]):
    inputs = {{
        "input": Input(required=False, description="Optional input data"),
    }}
    outputs = {{
        "success": Output(description="Node result"),
    }}

    async def execute(self, ctx: NodeContext, inputs: dict[str, Any]) -> dict[str, Any]:
        ctx.log.info("Running custom node")
        return {{
            "success": {{
                "message": self.config.message,
                "input": inputs.get("input"),
            }}
        }}
'''


def _python_literal(value: str) -> str:
    return json.dumps(value, ensure_ascii=True)


if __name__ == "__main__":
    raise SystemExit(main())
