# Workflow Node Editor MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first usable version of an independent workflow node editor where Python class scripts become executable workflow nodes.

**Architecture:** Use a pnpm monorepo for the React editor and a FastAPI backend. The backend owns node discovery, workflow validation, SQLite persistence, and single-process async execution. Python nodes are class-based plugins registered with decorators and described to the frontend through generated JSON Schema.

**Tech Stack:** React, TypeScript, Vite, React Flow, Vitest, FastAPI, Pydantic v2, pytest, SQLite, Python stdlib `asyncio`, Python stdlib `sqlite3`.

---

## Scope

This plan implements the MVP from `docs/superpowers/specs/2026-06-16-workflow-node-editor-design.md`.

It includes:

- Git/project initialization.
- Python SDK for class-and-decorator node scripts.
- FastAPI backend with node discovery, workflow storage, validation, execution, and run events.
- Built-in Python nodes for trigger, HTTP, logic, variables, transform, log, delay, foreach, and while.
- React Flow editor with node palette, config panel, save/validate/run actions, run log panel, and basic nested subflow editing.

It excludes:

- Authentication.
- Online Python script editing.
- Distributed workers.
- Arbitrary graph back-edges.
- Production secret storage.
- Full publish/rollback UI.

## File Map

Create these files:

- `.gitignore`: ignores Python, Node, SQLite, cache, and build outputs.
- `README.md`: development commands and project overview.
- `package.json`: root pnpm scripts.
- `pnpm-workspace.yaml`: pnpm workspace declaration.
- `pyproject.toml`: Python package metadata, dependencies, pytest config.
- `nodeflow_sdk/__init__.py`: SDK exports.
- `nodeflow_sdk/core.py`: `@node`, `BaseNode`, `Input`, `Output`, `NodeContext`.
- `apps/api/nodeflow_api/__init__.py`: backend package marker.
- `apps/api/nodeflow_api/main.py`: FastAPI app and routes.
- `apps/api/nodeflow_api/node_registry.py`: filesystem scanner and node metadata extraction.
- `apps/api/nodeflow_api/schemas.py`: Pydantic API and workflow models.
- `apps/api/nodeflow_api/storage.py`: SQLite persistence.
- `apps/api/nodeflow_api/validation.py`: graph and config validation.
- `apps/api/nodeflow_api/expressions.py`: safe path-expression resolver.
- `apps/api/nodeflow_api/executor.py`: single-process async workflow executor.
- `nodes/builtin/*.py`: built-in node definitions.
- `tests/api/*.py`: backend unit and API tests.
- `apps/web/package.json`: web app dependencies and scripts.
- `apps/web/index.html`: Vite HTML entry.
- `apps/web/vite.config.ts`: Vite config.
- `apps/web/tsconfig.json`: TypeScript config.
- `apps/web/src/main.tsx`: React entry.
- `apps/web/src/App.tsx`: app shell.
- `apps/web/src/api/client.ts`: typed API client.
- `apps/web/src/types.ts`: shared frontend types.
- `apps/web/src/components/*.tsx`: editor panels and canvas.
- `apps/web/src/lib/*.ts`: workflow helpers and JSON Schema form helpers.
- `apps/web/src/App.test.tsx`: frontend smoke test.

Modify these files during implementation:

- `docs/superpowers/plans/2026-06-16-workflow-node-editor-mvp.md`: check off completed steps.

---

## Task 1: Initialize Repository And Tooling

**Files:**
- Create: `.gitignore`
- Create: `README.md`
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `pyproject.toml`

- [x] **Step 1: Initialize git**

Run:

```powershell
git init
```

Expected: output includes `Initialized empty Git repository`.

- [x] **Step 2: Create root project files**

Create `.gitignore`:

```gitignore
.venv/
__pycache__/
.pytest_cache/
.ruff_cache/
*.pyc
*.sqlite
*.sqlite3
node_modules/
dist/
coverage/
.DS_Store
.env
```

Create `package.json`:

```json
{
  "name": "node-flow",
  "private": true,
  "scripts": {
    "dev:web": "pnpm --filter @node-flow/web dev",
    "build:web": "pnpm --filter @node-flow/web build",
    "test:web": "pnpm --filter @node-flow/web test",
    "dev:api": "uvicorn apps.api.nodeflow_api.main:app --reload --host 127.0.0.1 --port 8000",
    "test:api": "pytest tests/api -q",
    "test": "pnpm test:web && pytest tests/api -q"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^5.0.0",
    "typescript": "^5.8.0",
    "vite": "^7.0.0",
    "vitest": "^3.2.0"
  }
}
```

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/web"
```

Create `pyproject.toml`:

```toml
[project]
name = "node-flow"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
  "fastapi>=0.115.0",
  "httpx>=0.28.0",
  "pydantic>=2.10.0",
  "uvicorn[standard]>=0.34.0"
]

[project.optional-dependencies]
test = [
  "pytest>=8.3.0",
  "pytest-asyncio>=0.25.0"
]

[tool.pytest.ini_options]
pythonpath = ["."]
asyncio_mode = "auto"
```

Create `README.md`:

```markdown
# Node Flow

Node Flow is a workflow automation editor with a React Flow frontend and a FastAPI backend. Python classes registered with decorators become workflow node types.

## Development

Install frontend dependencies:

```powershell
pnpm install
```

Run the backend:

```powershell
pnpm dev:api
```

Run the frontend:

```powershell
pnpm dev:web
```

Run tests:

```powershell
pnpm test
```
```

- [x] **Step 3: Verify root files exist**

Run:

```powershell
Get-ChildItem -Force
```

Expected: output includes `.git`, `.gitignore`, `README.md`, `package.json`, `pnpm-workspace.yaml`, and `pyproject.toml`.

- [x] **Step 4: Commit tooling**

Run:

```powershell
git add .gitignore README.md package.json pnpm-workspace.yaml pyproject.toml
git commit -m "chore: initialize project tooling"
```

Expected: commit succeeds.

---

## Task 2: Python Node SDK

**Files:**
- Create: `nodeflow_sdk/__init__.py`
- Create: `nodeflow_sdk/core.py`
- Test: `tests/api/test_sdk.py`

- [x] **Step 1: Write SDK tests first**

Create `tests/api/test_sdk.py`:

```python
from typing import Literal

import pytest
from pydantic import BaseModel, Field

from nodeflow_sdk import BaseNode, Input, NodeContext, Output, node


class DemoConfig(BaseModel):
    mode: Literal["fast", "safe"] = "fast"
    count: int = Field(default=1, ge=1)


@node(id="demo.node", name="Demo Node", category="Demo", description="A demo node.")
class DemoNode(BaseNode[DemoConfig]):
    inputs = {"input": Input(required=True)}
    outputs = {"success": Output(description="Successful output")}

    async def execute(self, ctx: NodeContext, inputs: dict):
        ctx.log.info("running")
        return {"success": {"count": self.config.count, "input": inputs["input"]}}


def test_node_decorator_attaches_metadata():
    assert DemoNode.__node_meta__.id == "demo.node"
    assert DemoNode.__node_meta__.name == "Demo Node"
    assert DemoNode.__node_meta__.category == "Demo"


def test_base_node_extracts_config_model():
    assert DemoNode.config_model() is DemoConfig
    schema = DemoNode.config_schema()
    assert schema["properties"]["mode"]["enum"] == ["fast", "safe"]


@pytest.mark.asyncio
async def test_node_context_collects_logs():
    ctx = NodeContext(run_id="run_1", node_id="node_1")
    node_instance = DemoNode(config={"count": 2})
    result = await node_instance.execute(ctx, {"input": "hello"})
    assert result == {"success": {"count": 2, "input": "hello"}}
    assert ctx.logs[0]["level"] == "info"
    assert ctx.logs[0]["message"] == "running"
```

- [x] **Step 2: Run SDK tests and verify failure**

Run:

```powershell
pytest tests/api/test_sdk.py -q
```

Expected: FAIL with `ModuleNotFoundError: No module named 'nodeflow_sdk'`.

- [x] **Step 3: Implement SDK exports**

Create `nodeflow_sdk/__init__.py`:

```python
from .core import BaseNode, Input, NodeContext, Output, node

__all__ = ["BaseNode", "Input", "NodeContext", "Output", "node"]
```

- [x] **Step 4: Implement SDK core**

Create `nodeflow_sdk/core.py`:

```python
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, ClassVar, Generic, TypeVar, get_args, get_origin

from pydantic import BaseModel


ConfigT = TypeVar("ConfigT", bound=BaseModel)


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
        self.config = raw_config if isinstance(raw_config, model) else model.model_validate(raw_config)

    @classmethod
    def config_model(cls) -> type[BaseModel]:
        for base in getattr(cls, "__orig_bases__", []):
            if get_origin(base) is BaseNode:
                args = get_args(base)
                if args and isinstance(args[0], type) and issubclass(args[0], BaseModel):
                    return args[0]
        return EmptyConfig

    @classmethod
    def config_schema(cls) -> dict[str, Any]:
        return cls.config_model().model_json_schema()

    async def execute(self, ctx: NodeContext, inputs: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError


class EmptyConfig(BaseModel):
    pass


def node(*, id: str, name: str, category: str, description: str = ""):
    def decorator(cls: type[BaseNode[Any]]) -> type[BaseNode[Any]]:
        cls.__node_meta__ = NodeMeta(
            id=id,
            name=name,
            category=category,
            description=description,
        )
        return cls

    return decorator
```

- [x] **Step 5: Run SDK tests and verify pass**

Run:

```powershell
pytest tests/api/test_sdk.py -q
```

Expected: PASS, `3 passed`.

- [x] **Step 6: Commit SDK**

Run:

```powershell
git add nodeflow_sdk tests/api/test_sdk.py
git commit -m "feat: add python node sdk"
```

Expected: commit succeeds.

---

## Task 3: Node Registry And Built-In Metadata

**Files:**
- Create: `apps/api/nodeflow_api/__init__.py`
- Create: `apps/api/nodeflow_api/node_registry.py`
- Create: `nodes/builtin/manual_trigger.py`
- Create: `nodes/builtin/http_request.py`
- Create: `nodes/builtin/logic.py`
- Create: `nodes/builtin/utility.py`
- Create: `nodes/builtin/control.py`
- Test: `tests/api/test_node_registry.py`

- [x] **Step 1: Write registry tests first**

Create `tests/api/test_node_registry.py`:

```python
from pathlib import Path

from apps.api.nodeflow_api.node_registry import NodeRegistry


def test_registry_discovers_builtin_nodes():
    registry = NodeRegistry(nodes_dir=Path("nodes"))
    registry.scan()
    node_ids = {node.id for node in registry.list_node_types()}
    assert "manual.trigger" in node_ids
    assert "http.request" in node_ids
    assert "logic.if" in node_ids
    assert "control.foreach" in node_ids
    assert "control.while" in node_ids


def test_registry_returns_json_schema_for_config():
    registry = NodeRegistry(nodes_dir=Path("nodes"))
    registry.scan()
    node_type = registry.get("http.request")
    assert node_type.config_schema["properties"]["url"]["title"] == "URL"
    assert node_type.outputs["success"]["description"] == "Response data"
```

- [x] **Step 2: Run registry tests and verify failure**

Run:

```powershell
pytest tests/api/test_node_registry.py -q
```

Expected: FAIL with `ModuleNotFoundError` or import error for `node_registry`.

- [x] **Step 3: Create backend package marker**

Create `apps/api/nodeflow_api/__init__.py`:

```python
__all__ = []
```

- [x] **Step 4: Implement node registry**

Create `apps/api/nodeflow_api/node_registry.py`:

```python
from __future__ import annotations

import importlib.util
import inspect
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
        return sorted(self._nodes.values(), key=lambda node_type: (node_type.category, node_type.name))

    def get(self, node_id: str) -> RegisteredNodeType:
        try:
            return self._nodes[node_id]
        except KeyError as exc:
            raise KeyError(f"Unknown node type: {node_id}") from exc

    def has(self, node_id: str) -> bool:
        return node_id in self._nodes

    def _load_file(self, file_path: Path) -> None:
        module_name = "nodeflow_user_node_" + "_".join(file_path.with_suffix("").parts[-6:])
        spec = importlib.util.spec_from_file_location(module_name, file_path)
        if spec is None or spec.loader is None:
            raise RuntimeError(f"Cannot import node file: {file_path}")
        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        spec.loader.exec_module(module)
        for value in module.__dict__.values():
            if inspect.isclass(value) and issubclass(value, BaseNode) and hasattr(value, "__node_meta__"):
                self._register(value)

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
```

- [x] **Step 5: Add built-in nodes**

Create `nodes/builtin/manual_trigger.py`:

```python
from pydantic import BaseModel

from nodeflow_sdk import BaseNode, NodeContext, Output, node


class ManualTriggerConfig(BaseModel):
    payload: dict = {}


@node(id="manual.trigger", name="Manual Trigger", category="Triggers", description="Start a workflow manually.")
class ManualTriggerNode(BaseNode[ManualTriggerConfig]):
    outputs = {"success": Output(description="Initial payload")}

    async def execute(self, ctx: NodeContext, inputs: dict):
        return {"success": self.config.payload}
```

Create `nodes/builtin/http_request.py`:

```python
from typing import Literal

import httpx
from pydantic import BaseModel, Field

from nodeflow_sdk import BaseNode, Input, NodeContext, Output, node


class HttpRequestConfig(BaseModel):
    method: Literal["GET", "POST", "PUT", "PATCH", "DELETE"] = "GET"
    url: str = Field(..., title="URL")
    timeout_seconds: int = Field(default=30, ge=1, le=300)


@node(id="http.request", name="HTTP Request", category="Network", description="Send an HTTP request.")
class HttpRequestNode(BaseNode[HttpRequestConfig]):
    inputs = {
        "body": Input(required=False, description="Request body"),
        "headers": Input(required=False, description="Request headers"),
    }
    outputs = {
        "success": Output(description="Response data"),
        "error": Output(description="Request error"),
    }

    async def execute(self, ctx: NodeContext, inputs: dict):
        headers = inputs.get("headers") or {}
        body = inputs.get("body")
        async with httpx.AsyncClient(timeout=self.config.timeout_seconds) as client:
            response = await client.request(
                self.config.method,
                self.config.url,
                headers=headers,
                json=body if body is not None else None,
            )
        if response.is_error:
            return {
                "error": {
                    "status_code": response.status_code,
                    "body": response.text,
                }
            }
        try:
            response_body = response.json()
        except ValueError:
            response_body = response.text
        return {
            "success": {
                "status_code": response.status_code,
                "headers": dict(response.headers),
                "body": response_body,
            }
        }
```

Create `nodes/builtin/logic.py`:

```python
from pydantic import BaseModel, Field

from nodeflow_sdk import BaseNode, Input, NodeContext, Output, node


class IfConfig(BaseModel):
    condition: str = Field(..., title="Condition expression")


@node(id="logic.if", name="If", category="Logic", description="Route execution by a truthy expression.")
class IfNode(BaseNode[IfConfig]):
    inputs = {"input": Input(required=False)}
    outputs = {
        "true": Output(description="Condition is truthy"),
        "false": Output(description="Condition is falsey"),
    }

    async def execute(self, ctx: NodeContext, inputs: dict):
        return {"true": inputs}


class SetVariableConfig(BaseModel):
    name: str = Field(..., title="Variable name")
    value: str = Field(..., title="Value expression")


@node(id="logic.set_variable", name="Set Variable", category="Logic", description="Set a runtime variable.")
class SetVariableNode(BaseNode[SetVariableConfig]):
    inputs = {"input": Input(required=False)}
    outputs = {"success": Output(description="Updated variables")}

    async def execute(self, ctx: NodeContext, inputs: dict):
        return {"success": inputs}
```

Create `nodes/builtin/utility.py`:

```python
import asyncio

from pydantic import BaseModel, Field

from nodeflow_sdk import BaseNode, Input, NodeContext, Output, node


class TransformConfig(BaseModel):
    value: str = Field(..., title="Value expression")


@node(id="utility.transform", name="Transform", category="Utility", description="Return a selected expression value.")
class TransformNode(BaseNode[TransformConfig]):
    inputs = {"input": Input(required=False)}
    outputs = {"success": Output(description="Transformed value")}

    async def execute(self, ctx: NodeContext, inputs: dict):
        return {"success": inputs}


class LogConfig(BaseModel):
    message: str = Field(..., title="Message")


@node(id="utility.log", name="Log", category="Utility", description="Write a message into run logs.")
class LogNode(BaseNode[LogConfig]):
    inputs = {"input": Input(required=False)}
    outputs = {"success": Output(description="Input passthrough")}

    async def execute(self, ctx: NodeContext, inputs: dict):
        ctx.log.info(self.config.message)
        return {"success": inputs}


class DelayConfig(BaseModel):
    seconds: float = Field(default=1.0, ge=0.0, le=300.0)


@node(id="utility.delay", name="Delay", category="Utility", description="Wait before continuing.")
class DelayNode(BaseNode[DelayConfig]):
    inputs = {"input": Input(required=False)}
    outputs = {"success": Output(description="Input passthrough")}

    async def execute(self, ctx: NodeContext, inputs: dict):
        await asyncio.sleep(self.config.seconds)
        return {"success": inputs}
```

Create `nodes/builtin/control.py`:

```python
from pydantic import BaseModel, Field

from nodeflow_sdk import BaseNode, Input, NodeContext, Output, node


class ForEachConfig(BaseModel):
    items_expression: str = Field(..., title="Items expression")
    max_items: int = Field(default=100, ge=1, le=10000)
    continue_on_error: bool = False
    timeout_seconds: int = Field(default=300, ge=1, le=86400)


@node(id="control.foreach", name="For Each", category="Control", description="Run a body subflow for each item.")
class ForEachNode(BaseNode[ForEachConfig]):
    inputs = {"input": Input(required=False)}
    outputs = {
        "done": Output(description="All iterations completed"),
        "error": Output(description="Loop failed"),
    }

    async def execute(self, ctx: NodeContext, inputs: dict):
        return {"done": inputs}


class WhileConfig(BaseModel):
    condition: str = Field(..., title="Condition expression")
    max_iterations: int = Field(default=100, ge=1, le=10000)
    timeout_seconds: int = Field(default=300, ge=1, le=86400)


@node(id="control.while", name="While", category="Control", description="Run a body subflow while a condition is true.")
class WhileNode(BaseNode[WhileConfig]):
    inputs = {"input": Input(required=False)}
    outputs = {
        "done": Output(description="Condition became false"),
        "max_reached": Output(description="Maximum iterations reached"),
        "error": Output(description="Loop failed"),
    }

    async def execute(self, ctx: NodeContext, inputs: dict):
        return {"done": inputs}
```

- [x] **Step 6: Run registry tests and verify pass**

Run:

```powershell
pytest tests/api/test_node_registry.py -q
```

Expected: PASS, `2 passed`.

- [x] **Step 7: Commit registry and built-ins**

Run:

```powershell
git add apps/api/nodeflow_api/__init__.py apps/api/nodeflow_api/node_registry.py nodes tests/api/test_node_registry.py
git commit -m "feat: discover python node plugins"
```

Expected: commit succeeds.

---

## Task 4: Backend Schemas, Storage, And Node-Type API

**Files:**
- Create: `apps/api/nodeflow_api/schemas.py`
- Create: `apps/api/nodeflow_api/storage.py`
- Create: `apps/api/nodeflow_api/main.py`
- Test: `tests/api/test_api_basics.py`

- [x] **Step 1: Write API tests first**

Create `tests/api/test_api_basics.py`:

```python
from fastapi.testclient import TestClient

from apps.api.nodeflow_api.main import create_app


def test_health_check():
    client = TestClient(create_app(database_path=":memory:"))
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_node_types_endpoint_lists_builtin_nodes():
    client = TestClient(create_app(database_path=":memory:"))
    response = client.get("/api/node-types")
    assert response.status_code == 200
    payload = response.json()
    ids = {node["id"] for node in payload}
    assert "manual.trigger" in ids
    assert "http.request" in ids
```

- [x] **Step 2: Run API tests and verify failure**

Run:

```powershell
pytest tests/api/test_api_basics.py -q
```

Expected: FAIL because `apps.api.nodeflow_api.main` does not define `create_app`.

- [x] **Step 3: Implement API schemas**

Create `apps/api/nodeflow_api/schemas.py`:

```python
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class Position(BaseModel):
    x: float
    y: float


class WorkflowNode(BaseModel):
    id: str
    type: str
    position: Position
    config: dict[str, Any] = Field(default_factory=dict)
    subflows: dict[str, "WorkflowSubflow"] = Field(default_factory=dict)


class WorkflowEdge(BaseModel):
    id: str
    source: str
    sourceHandle: str
    target: str
    targetHandle: str


class WorkflowSubflow(BaseModel):
    nodes: list[WorkflowNode] = Field(default_factory=list)
    edges: list[WorkflowEdge] = Field(default_factory=list)


class WorkflowDocument(BaseModel):
    id: str
    name: str
    version: int = 1
    nodes: list[WorkflowNode] = Field(default_factory=list)
    edges: list[WorkflowEdge] = Field(default_factory=list)


class WorkflowSummary(BaseModel):
    id: str
    name: str
    version: int


class ValidationIssue(BaseModel):
    path: str
    message: str


class ValidationResult(BaseModel):
    valid: bool
    issues: list[ValidationIssue] = Field(default_factory=list)


RunStatus = Literal["queued", "running", "succeeded", "failed", "cancelled"]


class RunRecord(BaseModel):
    id: str
    workflow_id: str
    workflow_version: int
    status: RunStatus
    created_at: str
    started_at: str | None = None
    completed_at: str | None = None
    error: str | None = None


class RunEvent(BaseModel):
    id: int | None = None
    run_id: str
    type: str
    timestamp: str
    node_id: str | None = None
    scope: list[str] = Field(default_factory=list)
    payload: dict[str, Any] = Field(default_factory=dict)
```

- [x] **Step 4: Implement SQLite storage**

Create `apps/api/nodeflow_api/storage.py`:

```python
from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from .schemas import RunEvent, RunRecord, WorkflowDocument, WorkflowSummary


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Storage:
    def __init__(self, database_path: str | Path) -> None:
        self.database_path = str(database_path)
        self._connection = sqlite3.connect(self.database_path, check_same_thread=False)
        self._connection.row_factory = sqlite3.Row

    def init_schema(self) -> None:
        self._connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS workflows (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              current_version INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS workflow_versions (
              workflow_id TEXT NOT NULL,
              version INTEGER NOT NULL,
              document_json TEXT NOT NULL,
              created_at TEXT NOT NULL,
              PRIMARY KEY (workflow_id, version)
            );
            CREATE TABLE IF NOT EXISTS runs (
              id TEXT PRIMARY KEY,
              workflow_id TEXT NOT NULL,
              workflow_version INTEGER NOT NULL,
              status TEXT NOT NULL,
              created_at TEXT NOT NULL,
              started_at TEXT,
              completed_at TEXT,
              error TEXT
            );
            CREATE TABLE IF NOT EXISTS run_events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              run_id TEXT NOT NULL,
              type TEXT NOT NULL,
              timestamp TEXT NOT NULL,
              node_id TEXT,
              scope_json TEXT NOT NULL,
              payload_json TEXT NOT NULL
            );
            """
        )
        self._connection.commit()

    def list_workflows(self) -> list[WorkflowSummary]:
        rows = self._connection.execute(
            "SELECT id, name, current_version FROM workflows ORDER BY name"
        ).fetchall()
        return [
            WorkflowSummary(id=row["id"], name=row["name"], version=row["current_version"])
            for row in rows
        ]

    def save_workflow(self, workflow: WorkflowDocument) -> WorkflowDocument:
        current = self._connection.execute(
            "SELECT current_version FROM workflows WHERE id = ?",
            (workflow.id,),
        ).fetchone()
        version = 1 if current is None else int(current["current_version"]) + 1
        saved = workflow.model_copy(update={"version": version})
        self._connection.execute(
            """
            INSERT INTO workflows (id, name, current_version)
            VALUES (?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET name = excluded.name, current_version = excluded.current_version
            """,
            (saved.id, saved.name, saved.version),
        )
        self._connection.execute(
            """
            INSERT INTO workflow_versions (workflow_id, version, document_json, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (saved.id, saved.version, saved.model_dump_json(), utc_now()),
        )
        self._connection.commit()
        return saved

    def get_workflow(self, workflow_id: str, version: int | None = None) -> WorkflowDocument | None:
        if version is None:
            row = self._connection.execute(
                """
                SELECT v.document_json
                FROM workflow_versions v
                JOIN workflows w ON w.id = v.workflow_id AND w.current_version = v.version
                WHERE w.id = ?
                """,
                (workflow_id,),
            ).fetchone()
        else:
            row = self._connection.execute(
                "SELECT document_json FROM workflow_versions WHERE workflow_id = ? AND version = ?",
                (workflow_id, version),
            ).fetchone()
        if row is None:
            return None
        return WorkflowDocument.model_validate_json(row["document_json"])

    def create_run(self, workflow: WorkflowDocument) -> RunRecord:
        run = RunRecord(
            id=f"run_{uuid4().hex}",
            workflow_id=workflow.id,
            workflow_version=workflow.version,
            status="queued",
            created_at=utc_now(),
        )
        self._connection.execute(
            """
            INSERT INTO runs (id, workflow_id, workflow_version, status, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (run.id, run.workflow_id, run.workflow_version, run.status, run.created_at),
        )
        self._connection.commit()
        return run

    def update_run(self, run_id: str, *, status: str, error: str | None = None) -> None:
        timestamp = utc_now()
        if status == "running":
            self._connection.execute(
                "UPDATE runs SET status = ?, started_at = ? WHERE id = ?",
                (status, timestamp, run_id),
            )
        elif status in {"succeeded", "failed", "cancelled"}:
            self._connection.execute(
                "UPDATE runs SET status = ?, completed_at = ?, error = ? WHERE id = ?",
                (status, timestamp, error, run_id),
            )
        else:
            self._connection.execute(
                "UPDATE runs SET status = ?, error = ? WHERE id = ?",
                (status, error, run_id),
            )
        self._connection.commit()

    def get_run(self, run_id: str) -> RunRecord | None:
        row = self._connection.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
        if row is None:
            return None
        return RunRecord(**dict(row))

    def append_event(self, event: RunEvent) -> None:
        self._connection.execute(
            """
            INSERT INTO run_events (run_id, type, timestamp, node_id, scope_json, payload_json)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                event.run_id,
                event.type,
                event.timestamp,
                event.node_id,
                json.dumps(event.scope),
                json.dumps(event.payload),
            ),
        )
        self._connection.commit()

    def list_events(self, run_id: str) -> list[RunEvent]:
        rows = self._connection.execute(
            "SELECT * FROM run_events WHERE run_id = ? ORDER BY id",
            (run_id,),
        ).fetchall()
        return [
            RunEvent(
                id=row["id"],
                run_id=row["run_id"],
                type=row["type"],
                timestamp=row["timestamp"],
                node_id=row["node_id"],
                scope=json.loads(row["scope_json"]),
                payload=json.loads(row["payload_json"]),
            )
            for row in rows
        ]
```

- [x] **Step 5: Implement FastAPI app and node endpoint**

Create `apps/api/nodeflow_api/main.py`:

```python
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .node_registry import NodeRegistry
from .schemas import WorkflowDocument
from .storage import Storage


def create_app(database_path: str = "node-flow.sqlite3") -> FastAPI:
    app = FastAPI(title="Node Flow API")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    storage = Storage(database_path)
    storage.init_schema()
    registry = NodeRegistry(nodes_dir=Path("nodes"))
    registry.scan()
    app.state.storage = storage
    app.state.registry = registry

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/node-types")
    def node_types() -> list[dict]:
        return [node_type.to_api_dict() for node_type in registry.list_node_types()]

    @app.get("/api/workflows")
    def list_workflows():
        return storage.list_workflows()

    @app.post("/api/workflows")
    def save_workflow(workflow: WorkflowDocument):
        return storage.save_workflow(workflow)

    @app.get("/api/workflows/{workflow_id}")
    def get_workflow(workflow_id: str):
        workflow = storage.get_workflow(workflow_id)
        if workflow is None:
            raise HTTPException(status_code=404, detail="Workflow not found")
        return workflow

    return app


app = create_app()
```

- [x] **Step 6: Run API tests and verify pass**

Run:

```powershell
pytest tests/api/test_api_basics.py -q
```

Expected: PASS, `2 passed`.

- [x] **Step 7: Commit backend API basics**

Run:

```powershell
git add apps/api/nodeflow_api/schemas.py apps/api/nodeflow_api/storage.py apps/api/nodeflow_api/main.py tests/api/test_api_basics.py
git commit -m "feat: add backend api basics"
```

Expected: commit succeeds.

---

## Task 5: Workflow Validation

**Files:**
- Create: `apps/api/nodeflow_api/validation.py`
- Modify: `apps/api/nodeflow_api/main.py`
- Test: `tests/api/test_validation.py`

- [x] **Step 1: Write validation tests first**

Create `tests/api/test_validation.py`:

```python
from pathlib import Path

from apps.api.nodeflow_api.node_registry import NodeRegistry
from apps.api.nodeflow_api.schemas import Position, WorkflowDocument, WorkflowEdge, WorkflowNode
from apps.api.nodeflow_api.validation import validate_workflow


def registry() -> NodeRegistry:
    node_registry = NodeRegistry(nodes_dir=Path("nodes"))
    node_registry.scan()
    return node_registry


def test_validation_rejects_unknown_node_type():
    workflow = WorkflowDocument(
        id="wf_1",
        name="Demo",
        nodes=[WorkflowNode(id="a", type="missing.node", position=Position(x=0, y=0))],
        edges=[],
    )
    result = validate_workflow(workflow, registry())
    assert not result.valid
    assert result.issues[0].message == "Unknown node type: missing.node"


def test_validation_rejects_invalid_config():
    workflow = WorkflowDocument(
        id="wf_1",
        name="Demo",
        nodes=[WorkflowNode(id="http_1", type="http.request", position=Position(x=0, y=0), config={})],
        edges=[],
    )
    result = validate_workflow(workflow, registry())
    assert not result.valid
    assert "url" in result.issues[0].message.lower()


def test_validation_rejects_invalid_edge_handle():
    workflow = WorkflowDocument(
        id="wf_1",
        name="Demo",
        nodes=[
            WorkflowNode(id="a", type="manual.trigger", position=Position(x=0, y=0)),
            WorkflowNode(id="b", type="utility.log", position=Position(x=200, y=0), config={"message": "ok"}),
        ],
        edges=[WorkflowEdge(id="e1", source="a", sourceHandle="missing", target="b", targetHandle="input")],
    )
    result = validate_workflow(workflow, registry())
    assert not result.valid
    assert result.issues[0].message == "Unknown source handle: missing"
```

- [x] **Step 2: Run validation tests and verify failure**

Run:

```powershell
pytest tests/api/test_validation.py -q
```

Expected: FAIL because `validation.py` does not exist.

- [x] **Step 3: Implement validation**

Create `apps/api/nodeflow_api/validation.py`:

```python
from __future__ import annotations

from pydantic import ValidationError

from .node_registry import NodeRegistry
from .schemas import ValidationIssue, ValidationResult, WorkflowDocument, WorkflowEdge, WorkflowNode


CONTROL_NODE_TYPES = {"control.foreach", "control.while"}


def validate_workflow(workflow: WorkflowDocument, registry: NodeRegistry) -> ValidationResult:
    issues: list[ValidationIssue] = []
    node_by_id = {node.id: node for node in workflow.nodes}
    if len(node_by_id) != len(workflow.nodes):
        issues.append(ValidationIssue(path="nodes", message="Node IDs must be unique"))
    for node in workflow.nodes:
        _validate_node(node, registry, f"nodes.{node.id}", issues)
    for edge in workflow.edges:
        _validate_edge(edge, node_by_id, registry, issues)
    _validate_no_cycles(workflow.nodes, workflow.edges, issues)
    for node in workflow.nodes:
        for subflow_name, subflow in node.subflows.items():
            nested = WorkflowDocument(
                id=f"{workflow.id}:{node.id}:{subflow_name}",
                name=f"{workflow.name} {node.id} {subflow_name}",
                nodes=subflow.nodes,
                edges=subflow.edges,
            )
            nested_result = validate_workflow(nested, registry)
            for issue in nested_result.issues:
                issues.append(
                    ValidationIssue(
                        path=f"nodes.{node.id}.subflows.{subflow_name}.{issue.path}",
                        message=issue.message,
                    )
                )
    return ValidationResult(valid=not issues, issues=issues)


def _validate_node(node: WorkflowNode, registry: NodeRegistry, path: str, issues: list[ValidationIssue]) -> None:
    if not registry.has(node.type):
        issues.append(ValidationIssue(path=path, message=f"Unknown node type: {node.type}"))
        return
    node_type = registry.get(node.type)
    try:
        node_type.node_class.config_model().model_validate(node.config)
    except ValidationError as exc:
        issues.append(ValidationIssue(path=f"{path}.config", message=str(exc)))
    if node.type in CONTROL_NODE_TYPES and "body" not in node.subflows:
        issues.append(ValidationIssue(path=f"{path}.subflows", message="Control nodes require a body subflow"))


def _validate_edge(
    edge: WorkflowEdge,
    node_by_id: dict[str, WorkflowNode],
    registry: NodeRegistry,
    issues: list[ValidationIssue],
) -> None:
    source = node_by_id.get(edge.source)
    target = node_by_id.get(edge.target)
    if source is None:
        issues.append(ValidationIssue(path=f"edges.{edge.id}.source", message=f"Unknown source node: {edge.source}"))
        return
    if target is None:
        issues.append(ValidationIssue(path=f"edges.{edge.id}.target", message=f"Unknown target node: {edge.target}"))
        return
    source_type = registry.get(source.type)
    target_type = registry.get(target.type)
    if edge.sourceHandle not in source_type.outputs:
        issues.append(ValidationIssue(path=f"edges.{edge.id}.sourceHandle", message=f"Unknown source handle: {edge.sourceHandle}"))
    if edge.targetHandle not in target_type.inputs:
        issues.append(ValidationIssue(path=f"edges.{edge.id}.targetHandle", message=f"Unknown target handle: {edge.targetHandle}"))


def _validate_no_cycles(nodes: list[WorkflowNode], edges: list[WorkflowEdge], issues: list[ValidationIssue]) -> None:
    graph: dict[str, list[str]] = {node.id: [] for node in nodes}
    for edge in edges:
        if edge.source in graph and edge.target in graph:
            graph[edge.source].append(edge.target)
    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(node_id: str) -> bool:
        if node_id in visiting:
            return True
        if node_id in visited:
            return False
        visiting.add(node_id)
        for target in graph[node_id]:
            if visit(target):
                return True
        visiting.remove(node_id)
        visited.add(node_id)
        return False

    for node_id in graph:
        if visit(node_id):
            issues.append(ValidationIssue(path="edges", message="Workflow graph contains a cycle"))
            return
```

- [x] **Step 4: Add validation endpoint**

Modify `apps/api/nodeflow_api/main.py` to import and expose validation:

```python
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .node_registry import NodeRegistry
from .schemas import WorkflowDocument
from .storage import Storage
from .validation import validate_workflow


def create_app(database_path: str = "node-flow.sqlite3") -> FastAPI:
    app = FastAPI(title="Node Flow API")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    storage = Storage(database_path)
    storage.init_schema()
    registry = NodeRegistry(nodes_dir=Path("nodes"))
    registry.scan()
    app.state.storage = storage
    app.state.registry = registry

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/node-types")
    def node_types() -> list[dict]:
        return [node_type.to_api_dict() for node_type in registry.list_node_types()]

    @app.get("/api/workflows")
    def list_workflows():
        return storage.list_workflows()

    @app.post("/api/workflows")
    def save_workflow(workflow: WorkflowDocument):
        result = validate_workflow(workflow, registry)
        if not result.valid:
            raise HTTPException(status_code=422, detail=[issue.model_dump() for issue in result.issues])
        return storage.save_workflow(workflow)

    @app.post("/api/workflows/validate")
    def validate(workflow: WorkflowDocument):
        return validate_workflow(workflow, registry)

    @app.get("/api/workflows/{workflow_id}")
    def get_workflow(workflow_id: str):
        workflow = storage.get_workflow(workflow_id)
        if workflow is None:
            raise HTTPException(status_code=404, detail="Workflow not found")
        return workflow

    return app


app = create_app()
```

- [x] **Step 5: Run validation tests and API tests**

Run:

```powershell
pytest tests/api/test_validation.py tests/api/test_api_basics.py -q
```

Expected: PASS, `5 passed`.

- [x] **Step 6: Commit validation**

Run:

```powershell
git add apps/api/nodeflow_api/validation.py apps/api/nodeflow_api/main.py tests/api/test_validation.py
git commit -m "feat: validate workflow graphs"
```

Expected: commit succeeds.

---

## Task 6: Expressions And Executor MVP

**Files:**
- Create: `apps/api/nodeflow_api/expressions.py`
- Create: `apps/api/nodeflow_api/executor.py`
- Modify: `apps/api/nodeflow_api/main.py`
- Test: `tests/api/test_expressions.py`
- Test: `tests/api/test_executor.py`

- [x] **Step 1: Write expression tests first**

Create `tests/api/test_expressions.py`:

```python
import pytest

from apps.api.nodeflow_api.expressions import ExpressionError, resolve_expression


def test_resolve_expression_reads_nested_path():
    context = {"nodes": {"http_1": {"outputs": {"success": {"body": {"ok": True}}}}}}
    assert resolve_expression("{{ nodes.http_1.outputs.success.body.ok }}", context) is True


def test_resolve_expression_returns_literals_without_template():
    assert resolve_expression("hello", {}) == "hello"


def test_resolve_expression_rejects_unknown_path():
    with pytest.raises(ExpressionError):
        resolve_expression("{{ missing.value }}", {})
```

- [x] **Step 2: Write executor tests first**

Create `tests/api/test_executor.py`:

```python
from pathlib import Path

import pytest

from apps.api.nodeflow_api.executor import WorkflowExecutor
from apps.api.nodeflow_api.node_registry import NodeRegistry
from apps.api.nodeflow_api.schemas import Position, WorkflowDocument, WorkflowEdge, WorkflowNode
from apps.api.nodeflow_api.storage import Storage


def make_registry() -> NodeRegistry:
    registry = NodeRegistry(nodes_dir=Path("nodes"))
    registry.scan()
    return registry


@pytest.mark.asyncio
async def test_executor_runs_linear_workflow():
    storage = Storage(":memory:")
    storage.init_schema()
    registry = make_registry()
    workflow = WorkflowDocument(
        id="wf_1",
        name="Linear",
        nodes=[
            WorkflowNode(id="start", type="manual.trigger", position=Position(x=0, y=0), config={"payload": {"name": "Ada"}}),
            WorkflowNode(id="log", type="utility.log", position=Position(x=200, y=0), config={"message": "done"}),
        ],
        edges=[WorkflowEdge(id="e1", source="start", sourceHandle="success", target="log", targetHandle="input")],
    )
    saved = storage.save_workflow(workflow)
    run = storage.create_run(saved)
    executor = WorkflowExecutor(storage=storage, registry=registry)
    await executor.execute(run.id, saved)
    stored_run = storage.get_run(run.id)
    events = storage.list_events(run.id)
    assert stored_run is not None
    assert stored_run.status == "succeeded"
    assert [event.type for event in events if event.node_id == "log"] == ["node_started", "node_succeeded"]


@pytest.mark.asyncio
async def test_executor_routes_if_false_branch():
    storage = Storage(":memory:")
    storage.init_schema()
    registry = make_registry()
    workflow = WorkflowDocument(
        id="wf_if",
        name="If",
        nodes=[
            WorkflowNode(id="start", type="manual.trigger", position=Position(x=0, y=0), config={"payload": {"enabled": False}}),
            WorkflowNode(id="if_1", type="logic.if", position=Position(x=200, y=0), config={"condition": "{{ nodes.start.outputs.success.enabled }}"}),
            WorkflowNode(id="false_log", type="utility.log", position=Position(x=400, y=100), config={"message": "false"}),
        ],
        edges=[
            WorkflowEdge(id="e1", source="start", sourceHandle="success", target="if_1", targetHandle="input"),
            WorkflowEdge(id="e2", source="if_1", sourceHandle="false", target="false_log", targetHandle="input"),
        ],
    )
    saved = storage.save_workflow(workflow)
    run = storage.create_run(saved)
    executor = WorkflowExecutor(storage=storage, registry=registry)
    await executor.execute(run.id, saved)
    events = storage.list_events(run.id)
    assert any(event.node_id == "false_log" and event.type == "node_succeeded" for event in events)
```

- [x] **Step 3: Run executor tests and verify failure**

Run:

```powershell
pytest tests/api/test_expressions.py tests/api/test_executor.py -q
```

Expected: FAIL because `expressions.py` and `executor.py` do not exist.

- [x] **Step 4: Implement expression resolver**

Create `apps/api/nodeflow_api/expressions.py`:

```python
from __future__ import annotations

import re
from typing import Any


EXPRESSION_RE = re.compile(r"^\s*\{\{\s*([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\s*\}\}\s*$")


class ExpressionError(ValueError):
    pass


def resolve_expression(value: Any, context: dict[str, Any]) -> Any:
    if not isinstance(value, str):
        return value
    match = EXPRESSION_RE.match(value)
    if match is None:
        return value
    return resolve_path(match.group(1), context)


def resolve_path(path: str, context: dict[str, Any]) -> Any:
    current: Any = context
    for part in path.split("."):
        if isinstance(current, dict) and part in current:
            current = current[part]
        elif isinstance(current, list) and part.isdigit():
            current = current[int(part)]
        else:
            raise ExpressionError(f"Cannot resolve expression path: {path}")
    return current
```

- [x] **Step 5: Implement executor**

Create `apps/api/nodeflow_api/executor.py`:

```python
from __future__ import annotations

import traceback
from collections import defaultdict
from typing import Any

from nodeflow_sdk import NodeContext

from .expressions import resolve_expression
from .node_registry import NodeRegistry
from .schemas import RunEvent, WorkflowDocument, WorkflowEdge, WorkflowNode
from .storage import Storage, utc_now


class WorkflowExecutor:
    def __init__(self, *, storage: Storage, registry: NodeRegistry) -> None:
        self.storage = storage
        self.registry = registry

    async def execute(self, run_id: str, workflow: WorkflowDocument) -> None:
        self.storage.update_run(run_id, status="running")
        context: dict[str, Any] = {"inputs": {}, "nodes": {}, "variables": {}}
        try:
            await self._execute_graph(run_id, workflow.nodes, workflow.edges, context, scope=[])
        except Exception as exc:
            self._event(run_id, "run_failed", payload={"error": str(exc), "traceback": traceback.format_exc()})
            self.storage.update_run(run_id, status="failed", error=str(exc))
            return
        self._event(run_id, "run_succeeded")
        self.storage.update_run(run_id, status="succeeded")

    async def _execute_graph(
        self,
        run_id: str,
        nodes: list[WorkflowNode],
        edges: list[WorkflowEdge],
        context: dict[str, Any],
        *,
        scope: list[str],
    ) -> None:
        node_by_id = {node.id: node for node in nodes}
        incoming = defaultdict(list)
        outgoing = defaultdict(list)
        for edge in edges:
            incoming[edge.target].append(edge)
            outgoing[edge.source].append(edge)
        start_nodes = [node for node in nodes if not incoming[node.id]]
        for node in start_nodes:
            await self._execute_from_node(run_id, node, node_by_id, outgoing, context, scope)

    async def _execute_from_node(
        self,
        run_id: str,
        node: WorkflowNode,
        node_by_id: dict[str, WorkflowNode],
        outgoing: dict[str, list[WorkflowEdge]],
        context: dict[str, Any],
        scope: list[str],
        inputs: dict[str, Any] | None = None,
    ) -> None:
        output_values = await self._execute_node(run_id, node, context, scope, inputs or {})
        context.setdefault("nodes", {}).setdefault(node.id, {})["outputs"] = output_values
        for handle, value in output_values.items():
            for edge in outgoing.get(node.id, []):
                if edge.sourceHandle == handle:
                    target = node_by_id[edge.target]
                    await self._execute_from_node(
                        run_id,
                        target,
                        node_by_id,
                        outgoing,
                        context,
                        scope,
                        {edge.targetHandle: value},
                    )

    async def _execute_node(
        self,
        run_id: str,
        node: WorkflowNode,
        context: dict[str, Any],
        scope: list[str],
        inputs: dict[str, Any],
    ) -> dict[str, Any]:
        self._event(run_id, "node_started", node_id=node.id, scope=scope, payload={"inputs": inputs})
        if node.type == "logic.if":
            condition = resolve_expression(node.config["condition"], context)
            output = {"true": inputs} if bool(condition) else {"false": inputs}
            self._event(run_id, "node_succeeded", node_id=node.id, scope=scope, payload={"outputs": output})
            return output
        node_type = self.registry.get(node.type)
        instance = node_type.node_class(config=node.config)
        ctx = NodeContext(run_id=run_id, node_id=node.id, scope=scope)
        try:
            outputs = await instance.execute(ctx, inputs)
        except Exception as exc:
            error_output = {"error": {"message": str(exc), "traceback": traceback.format_exc()}}
            self._event(run_id, "node_failed", node_id=node.id, scope=scope, payload={"error": error_output["error"], "logs": ctx.logs})
            return error_output
        self._event(run_id, "node_succeeded", node_id=node.id, scope=scope, payload={"outputs": outputs, "logs": ctx.logs})
        return outputs

    def _event(
        self,
        run_id: str,
        event_type: str,
        *,
        node_id: str | None = None,
        scope: list[str] | None = None,
        payload: dict[str, Any] | None = None,
    ) -> None:
        self.storage.append_event(
            RunEvent(
                run_id=run_id,
                type=event_type,
                timestamp=utc_now(),
                node_id=node_id,
                scope=scope or [],
                payload=payload or {},
            )
        )
```

- [x] **Step 6: Add run endpoints**

Modify `apps/api/nodeflow_api/main.py`:

```python
from __future__ import annotations

import asyncio
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .executor import WorkflowExecutor
from .node_registry import NodeRegistry
from .schemas import WorkflowDocument
from .storage import Storage
from .validation import validate_workflow


def create_app(database_path: str = "node-flow.sqlite3") -> FastAPI:
    app = FastAPI(title="Node Flow API")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    storage = Storage(database_path)
    storage.init_schema()
    registry = NodeRegistry(nodes_dir=Path("nodes"))
    registry.scan()
    executor = WorkflowExecutor(storage=storage, registry=registry)
    app.state.storage = storage
    app.state.registry = registry
    app.state.executor = executor

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/node-types")
    def node_types() -> list[dict]:
        return [node_type.to_api_dict() for node_type in registry.list_node_types()]

    @app.get("/api/workflows")
    def list_workflows():
        return storage.list_workflows()

    @app.post("/api/workflows")
    def save_workflow(workflow: WorkflowDocument):
        result = validate_workflow(workflow, registry)
        if not result.valid:
            raise HTTPException(status_code=422, detail=[issue.model_dump() for issue in result.issues])
        return storage.save_workflow(workflow)

    @app.post("/api/workflows/validate")
    def validate(workflow: WorkflowDocument):
        return validate_workflow(workflow, registry)

    @app.get("/api/workflows/{workflow_id}")
    def get_workflow(workflow_id: str):
        workflow = storage.get_workflow(workflow_id)
        if workflow is None:
            raise HTTPException(status_code=404, detail="Workflow not found")
        return workflow

    @app.post("/api/workflows/{workflow_id}/runs")
    async def create_run(workflow_id: str):
        workflow = storage.get_workflow(workflow_id)
        if workflow is None:
            raise HTTPException(status_code=404, detail="Workflow not found")
        run = storage.create_run(workflow)
        asyncio.create_task(executor.execute(run.id, workflow))
        return run

    @app.get("/api/runs/{run_id}")
    def get_run(run_id: str):
        run = storage.get_run(run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="Run not found")
        return run

    @app.get("/api/runs/{run_id}/events")
    def get_run_events(run_id: str):
        if storage.get_run(run_id) is None:
            raise HTTPException(status_code=404, detail="Run not found")
        return storage.list_events(run_id)

    return app


app = create_app()
```

- [x] **Step 7: Run executor tests and verify pass**

Run:

```powershell
pytest tests/api/test_expressions.py tests/api/test_executor.py -q
```

Expected: PASS, `5 passed`.

- [x] **Step 8: Run all API tests**

Run:

```powershell
pytest tests/api -q
```

Expected: all API tests pass.

- [x] **Step 9: Commit executor MVP**

Run:

```powershell
git add apps/api/nodeflow_api/expressions.py apps/api/nodeflow_api/executor.py apps/api/nodeflow_api/main.py tests/api/test_expressions.py tests/api/test_executor.py
git commit -m "feat: execute basic workflows"
```

Expected: commit succeeds.

---

## Task 7: Structured Loop Execution

**Files:**
- Modify: `apps/api/nodeflow_api/executor.py`
- Test: `tests/api/test_loops.py`

- [x] **Step 1: Write loop tests first**

Create `tests/api/test_loops.py`:

```python
from pathlib import Path

import pytest

from apps.api.nodeflow_api.executor import WorkflowExecutor
from apps.api.nodeflow_api.node_registry import NodeRegistry
from apps.api.nodeflow_api.schemas import Position, WorkflowDocument, WorkflowEdge, WorkflowNode, WorkflowSubflow
from apps.api.nodeflow_api.storage import Storage


def make_registry() -> NodeRegistry:
    registry = NodeRegistry(nodes_dir=Path("nodes"))
    registry.scan()
    return registry


@pytest.mark.asyncio
async def test_foreach_runs_body_for_each_item():
    storage = Storage(":memory:")
    storage.init_schema()
    registry = make_registry()
    body = WorkflowSubflow(
        nodes=[WorkflowNode(id="log_item", type="utility.log", position=Position(x=0, y=0), config={"message": "item"})],
        edges=[],
    )
    workflow = WorkflowDocument(
        id="wf_each",
        name="Each",
        nodes=[
            WorkflowNode(id="start", type="manual.trigger", position=Position(x=0, y=0), config={"payload": {"items": [1, 2, 3]}}),
            WorkflowNode(
                id="each",
                type="control.foreach",
                position=Position(x=200, y=0),
                config={"items_expression": "{{ nodes.start.outputs.success.items }}", "max_items": 10, "continue_on_error": False, "timeout_seconds": 30},
                subflows={"body": body},
            ),
        ],
        edges=[WorkflowEdge(id="e1", source="start", sourceHandle="success", target="each", targetHandle="input")],
    )
    saved = storage.save_workflow(workflow)
    run = storage.create_run(saved)
    await WorkflowExecutor(storage=storage, registry=registry).execute(run.id, saved)
    events = storage.list_events(run.id)
    item_successes = [event for event in events if event.node_id == "log_item" and event.type == "node_succeeded"]
    assert len(item_successes) == 3
    assert item_successes[1].scope == ["each", "iteration:1"]


@pytest.mark.asyncio
async def test_while_stops_at_max_reached_handle():
    storage = Storage(":memory:")
    storage.init_schema()
    registry = make_registry()
    body = WorkflowSubflow(nodes=[], edges=[])
    workflow = WorkflowDocument(
        id="wf_while",
        name="While",
        nodes=[
            WorkflowNode(id="while_1", type="control.while", position=Position(x=0, y=0), config={"condition": "{{ inputs.always }}", "max_iterations": 2, "timeout_seconds": 30}, subflows={"body": body}),
            WorkflowNode(id="max_log", type="utility.log", position=Position(x=200, y=0), config={"message": "max"}),
        ],
        edges=[WorkflowEdge(id="e1", source="while_1", sourceHandle="max_reached", target="max_log", targetHandle="input")],
    )
    saved = storage.save_workflow(workflow)
    run = storage.create_run(saved)
    executor = WorkflowExecutor(storage=storage, registry=registry)
    await executor.execute(run.id, saved.model_copy(update={"nodes": saved.nodes}))
    events = storage.list_events(run.id)
    assert any(event.node_id == "max_log" and event.type == "node_succeeded" for event in events)
```

- [x] **Step 2: Run loop tests and verify failure**

Run:

```powershell
pytest tests/api/test_loops.py -q
```

Expected: FAIL because `control.foreach` and `control.while` still use normal node execution.

- [x] **Step 3: Add loop execution to executor**

Modify `apps/api/nodeflow_api/executor.py` by adding this import at the top:

```python
import asyncio
```

Then replace the `_execute_node` method with:

```python
    async def _execute_node(
        self,
        run_id: str,
        node: WorkflowNode,
        context: dict[str, Any],
        scope: list[str],
        inputs: dict[str, Any],
    ) -> dict[str, Any]:
        self._event(run_id, "node_started", node_id=node.id, scope=scope, payload={"inputs": inputs})
        if node.type == "logic.if":
            condition = resolve_expression(node.config["condition"], context)
            output = {"true": inputs} if bool(condition) else {"false": inputs}
            self._event(run_id, "node_succeeded", node_id=node.id, scope=scope, payload={"outputs": output})
            return output
        if node.type == "control.foreach":
            output = await self._execute_foreach(run_id, node, context, scope)
            self._event(run_id, "node_succeeded", node_id=node.id, scope=scope, payload={"outputs": output})
            return output
        if node.type == "control.while":
            output = await self._execute_while(run_id, node, context, scope)
            self._event(run_id, "node_succeeded", node_id=node.id, scope=scope, payload={"outputs": output})
            return output
        node_type = self.registry.get(node.type)
        instance = node_type.node_class(config=node.config)
        ctx = NodeContext(run_id=run_id, node_id=node.id, scope=scope)
        try:
            outputs = await instance.execute(ctx, inputs)
        except Exception as exc:
            error_output = {"error": {"message": str(exc), "traceback": traceback.format_exc()}}
            self._event(run_id, "node_failed", node_id=node.id, scope=scope, payload={"error": error_output["error"], "logs": ctx.logs})
            return error_output
        self._event(run_id, "node_succeeded", node_id=node.id, scope=scope, payload={"outputs": outputs, "logs": ctx.logs})
        return outputs
```

Add these methods below `_execute_node`:

```python
    async def _execute_foreach(
        self,
        run_id: str,
        node: WorkflowNode,
        context: dict[str, Any],
        scope: list[str],
    ) -> dict[str, Any]:
        timeout_seconds = float(node.config.get("timeout_seconds", 300))
        async with asyncio.timeout(timeout_seconds):
            items = resolve_expression(node.config["items_expression"], context)
            if not isinstance(items, list):
                raise ValueError("ForEach items_expression must resolve to a list")
            max_items = int(node.config.get("max_items", 100))
            if len(items) > max_items:
                raise ValueError(f"ForEach item count {len(items)} exceeds max_items {max_items}")
            body = node.subflows["body"]
            results: list[dict[str, Any]] = []
            for index, item in enumerate(items):
                previous_loop = context.get("loop")
                context["loop"] = {"item": item, "index": index}
                await self._execute_graph(run_id, body.nodes, body.edges, context, scope=[*scope, node.id, f"iteration:{index}"])
                results.append({"index": index, "item": item})
                if previous_loop is None:
                    context.pop("loop", None)
                else:
                    context["loop"] = previous_loop
            return {"done": {"iterations": results}}

    async def _execute_while(
        self,
        run_id: str,
        node: WorkflowNode,
        context: dict[str, Any],
        scope: list[str],
    ) -> dict[str, Any]:
        timeout_seconds = float(node.config["timeout_seconds"])
        async with asyncio.timeout(timeout_seconds):
            body = node.subflows["body"]
            max_iterations = int(node.config["max_iterations"])
            for index in range(max_iterations):
                condition = resolve_expression(node.config["condition"], context)
                if not bool(condition):
                    return {"done": {"iterations": index}}
                previous_loop = context.get("loop")
                context["loop"] = {"index": index}
                await self._execute_graph(run_id, body.nodes, body.edges, context, scope=[*scope, node.id, f"iteration:{index}"])
                if previous_loop is None:
                    context.pop("loop", None)
                else:
                    context["loop"] = previous_loop
            return {"max_reached": {"iterations": max_iterations}}
```

- [x] **Step 4: Fix while test context**

Modify `tests/api/test_loops.py` so the while workflow begins with a trigger payload:

```python
@pytest.mark.asyncio
async def test_while_stops_at_max_reached_handle():
    storage = Storage(":memory:")
    storage.init_schema()
    registry = make_registry()
    body = WorkflowSubflow(nodes=[], edges=[])
    workflow = WorkflowDocument(
        id="wf_while",
        name="While",
        nodes=[
            WorkflowNode(id="start", type="manual.trigger", position=Position(x=0, y=0), config={"payload": {"always": True}}),
            WorkflowNode(id="while_1", type="control.while", position=Position(x=200, y=0), config={"condition": "{{ nodes.start.outputs.success.always }}", "max_iterations": 2, "timeout_seconds": 30}, subflows={"body": body}),
            WorkflowNode(id="max_log", type="utility.log", position=Position(x=400, y=0), config={"message": "max"}),
        ],
        edges=[
            WorkflowEdge(id="e1", source="start", sourceHandle="success", target="while_1", targetHandle="input"),
            WorkflowEdge(id="e2", source="while_1", sourceHandle="max_reached", target="max_log", targetHandle="input"),
        ],
    )
    saved = storage.save_workflow(workflow)
    run = storage.create_run(saved)
    await WorkflowExecutor(storage=storage, registry=registry).execute(run.id, saved)
    events = storage.list_events(run.id)
    assert any(event.node_id == "max_log" and event.type == "node_succeeded" for event in events)
```

- [x] **Step 5: Run loop tests and verify pass**

Run:

```powershell
pytest tests/api/test_loops.py -q
```

Expected: PASS, `2 passed`.

- [x] **Step 6: Run all API tests**

Run:

```powershell
pytest tests/api -q
```

Expected: all API tests pass.

- [x] **Step 7: Commit loops**

Run:

```powershell
git add apps/api/nodeflow_api/executor.py tests/api/test_loops.py
git commit -m "feat: execute structured loops"
```

Expected: commit succeeds.

---

## Task 8: Frontend Project Skeleton

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/index.html`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/App.tsx`
- Create: `apps/web/src/App.test.tsx`
- Create: `apps/web/src/styles.css`

- [x] **Step 1: Create frontend package files**

Create `apps/web/package.json`:

```json
{
  "name": "@node-flow/web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --host 127.0.0.1 --port 5173",
    "build": "tsc && vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "@vitejs/plugin-react": "^5.0.0",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "reactflow": "^11.11.4"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.0",
    "@testing-library/react": "^16.3.0",
    "@types/react": "^19.1.0",
    "@types/react-dom": "^19.1.0",
    "jsdom": "^26.1.0",
    "typescript": "^5.8.0",
    "vite": "^7.0.0",
    "vitest": "^3.2.0"
  }
}
```

Create `apps/web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Node Flow</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Create `apps/web/vite.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: []
  }
});
```

Create `apps/web/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["DOM", "DOM.Iterable", "ES2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Node",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx"
  },
  "include": ["src"],
  "references": []
}
```

- [x] **Step 2: Create React shell**

Create `apps/web/src/main.tsx`:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import "reactflow/dist/style.css";
import "./styles.css";
import { App } from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

Create `apps/web/src/App.tsx`:

```tsx
export function App() {
  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <strong>Node Flow</strong>
          <span className="muted">Workflow editor</span>
        </div>
      </header>
      <section className="workspace">
        <aside className="panel">Nodes</aside>
        <div className="canvas-shell">Canvas</div>
        <aside className="panel">Config</aside>
      </section>
    </main>
  );
}
```

Create `apps/web/src/styles.css`:

```css
:root {
  color: #17202a;
  background: #eef1f4;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

body {
  margin: 0;
}

button,
input,
select,
textarea {
  font: inherit;
}

.app-shell {
  min-height: 100vh;
  display: grid;
  grid-template-rows: 48px 1fr;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  border-bottom: 1px solid #cfd7df;
  background: #ffffff;
}

.muted {
  color: #697783;
  margin-left: 10px;
  font-size: 13px;
}

.workspace {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr) 320px;
  min-height: 0;
}

.panel {
  background: #ffffff;
  border-right: 1px solid #d9e0e7;
  padding: 12px;
  overflow: auto;
}

.panel:last-child {
  border-right: 0;
  border-left: 1px solid #d9e0e7;
}

.canvas-shell {
  min-width: 0;
  min-height: 0;
  background: #f8fafc;
}
```

Create `apps/web/src/App.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("renders the editor shell", () => {
    render(<App />);
    expect(screen.getByText("Node Flow")).toBeInTheDocument();
    expect(screen.getByText("Canvas")).toBeInTheDocument();
  });
});
```

- [x] **Step 3: Install frontend dependencies**

Run:

```powershell
pnpm install
```

Expected: dependencies install and `pnpm-lock.yaml` is created.

- [x] **Step 4: Run frontend test and verify initial matcher issue**

Run:

```powershell
pnpm test:web
```

Expected: FAIL because `toBeInTheDocument` is not registered.

- [x] **Step 5: Register jest-dom matchers**

Create `apps/web/src/test-setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

Modify `apps/web/vite.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"]
  }
});
```

- [x] **Step 6: Run frontend test and build**

Run:

```powershell
pnpm test:web
pnpm build:web
```

Expected: both commands pass.

- [x] **Step 7: Commit frontend skeleton**

Run:

```powershell
git add apps/web package.json pnpm-lock.yaml
git commit -m "feat: add frontend shell"
```

Expected: commit succeeds.

---

## Task 9: Frontend API Client And Types

**Files:**
- Create: `apps/web/src/types.ts`
- Create: `apps/web/src/api/client.ts`
- Test: `apps/web/src/api/client.test.ts`

- [x] **Step 1: Add frontend types**

Create `apps/web/src/types.ts`:

```ts
export type NodeType = {
  id: string;
  name: string;
  category: string;
  description: string;
  inputs: Record<string, { required: boolean; description: string }>;
  outputs: Record<string, { description: string }>;
  configSchema: JsonSchema;
};

export type JsonSchema = {
  type?: string;
  title?: string;
  default?: unknown;
  enum?: unknown[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  minimum?: number;
  maximum?: number;
  description?: string;
};

export type WorkflowNode = {
  id: string;
  type: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
  subflows?: Record<string, WorkflowSubflow>;
};

export type WorkflowEdge = {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
};

export type WorkflowSubflow = {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
};

export type WorkflowDocument = {
  id: string;
  name: string;
  version: number;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
};

export type ValidationIssue = {
  path: string;
  message: string;
};

export type ValidationResult = {
  valid: boolean;
  issues: ValidationIssue[];
};

export type RunRecord = {
  id: string;
  workflow_id: string;
  workflow_version: number;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  error?: string | null;
};

export type RunEvent = {
  id?: number;
  run_id: string;
  type: string;
  timestamp: string;
  node_id?: string | null;
  scope: string[];
  payload: Record<string, unknown>;
};
```

- [x] **Step 2: Write API client tests first**

Create `apps/web/src/api/client.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "./client";

describe("ApiClient", () => {
  it("loads node types", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: "manual.trigger" }]
    });
    const client = new ApiClient("http://api.test", fetchMock as unknown as typeof fetch);
    const nodeTypes = await client.listNodeTypes();
    expect(fetchMock).toHaveBeenCalledWith("http://api.test/api/node-types", undefined);
    expect(nodeTypes[0].id).toBe("manual.trigger");
  });

  it("throws on failed response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "broken"
    });
    const client = new ApiClient("http://api.test", fetchMock as unknown as typeof fetch);
    await expect(client.listNodeTypes()).rejects.toThrow("API 500: broken");
  });
});
```

- [x] **Step 3: Run API client tests and verify failure**

Run:

```powershell
pnpm test:web
```

Expected: FAIL because `client.ts` does not exist.

- [x] **Step 4: Implement API client**

Create `apps/web/src/api/client.ts`:

```ts
import type { NodeType, RunEvent, RunRecord, ValidationResult, WorkflowDocument } from "../types";

export class ApiClient {
  constructor(
    private readonly baseUrl = "http://127.0.0.1:8000",
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  listNodeTypes(): Promise<NodeType[]> {
    return this.request("/api/node-types");
  }

  listWorkflows(): Promise<Array<{ id: string; name: string; version: number }>> {
    return this.request("/api/workflows");
  }

  getWorkflow(id: string): Promise<WorkflowDocument> {
    return this.request(`/api/workflows/${id}`);
  }

  saveWorkflow(workflow: WorkflowDocument): Promise<WorkflowDocument> {
    return this.request("/api/workflows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(workflow)
    });
  }

  validateWorkflow(workflow: WorkflowDocument): Promise<ValidationResult> {
    return this.request("/api/workflows/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(workflow)
    });
  }

  createRun(workflowId: string): Promise<RunRecord> {
    return this.request(`/api/workflows/${workflowId}/runs`, { method: "POST" });
  }

  getRun(runId: string): Promise<RunRecord> {
    return this.request(`/api/runs/${runId}`);
  }

  getRunEvents(runId: string): Promise<RunEvent[]> {
    return this.request(`/api/runs/${runId}/events`);
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, init);
    if (!response.ok) {
      throw new Error(`API ${response.status}: ${await response.text()}`);
    }
    return response.json() as Promise<T>;
  }
}

export const apiClient = new ApiClient();
```

- [x] **Step 5: Run frontend tests and verify pass**

Run:

```powershell
pnpm test:web
```

Expected: all frontend tests pass.

- [x] **Step 6: Commit API client**

Run:

```powershell
git add apps/web/src/types.ts apps/web/src/api
git commit -m "feat: add web api client"
```

Expected: commit succeeds.

---

## Task 10: React Flow Editor

**Files:**
- Create: `apps/web/src/lib/workflow.ts`
- Create: `apps/web/src/components/NodePalette.tsx`
- Create: `apps/web/src/components/FlowCanvas.tsx`
- Create: `apps/web/src/components/ConfigPanel.tsx`
- Create: `apps/web/src/components/RunPanel.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/lib/workflow.test.ts`

- [x] **Step 1: Write workflow helper tests first**

Create `apps/web/src/lib/workflow.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createEmptyWorkflow, createWorkflowNode } from "./workflow";

describe("workflow helpers", () => {
  it("creates an empty workflow", () => {
    const workflow = createEmptyWorkflow();
    expect(workflow.name).toBe("Untitled Workflow");
    expect(workflow.nodes).toEqual([]);
  });

  it("creates a configured node from node type metadata", () => {
    const node = createWorkflowNode(
      {
        id: "utility.log",
        name: "Log",
        category: "Utility",
        description: "",
        inputs: {},
        outputs: {},
        configSchema: {
          type: "object",
          properties: {
            message: { type: "string", default: "hello" },
            count: { type: "integer", default: 3 }
          }
        }
      },
      { x: 10, y: 20 }
    );
    expect(node.type).toBe("utility.log");
    expect(node.config).toEqual({ message: "hello", count: 3 });
  });
});
```

- [x] **Step 2: Run helper tests and verify failure**

Run:

```powershell
pnpm test:web
```

Expected: FAIL because `workflow.ts` does not exist.

- [x] **Step 3: Implement workflow helpers**

Create `apps/web/src/lib/workflow.ts`:

```ts
import type { NodeType, WorkflowDocument, WorkflowNode } from "../types";

export function createEmptyWorkflow(): WorkflowDocument {
  return {
    id: `wf_${crypto.randomUUID().replaceAll("-", "")}`,
    name: "Untitled Workflow",
    version: 1,
    nodes: [],
    edges: []
  };
}

export function createWorkflowNode(nodeType: NodeType, position: { x: number; y: number }): WorkflowNode {
  return {
    id: `node_${crypto.randomUUID().replaceAll("-", "")}`,
    type: nodeType.id,
    position,
    config: defaultsFromSchema(nodeType.configSchema),
    subflows: nodeType.id === "control.foreach" || nodeType.id === "control.while" ? { body: { nodes: [], edges: [] } } : undefined
  };
}

export function defaultsFromSchema(schema: NodeType["configSchema"]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, property] of Object.entries(schema.properties ?? {})) {
    if ("default" in property) {
      result[key] = property.default;
    } else if (property.enum?.length) {
      result[key] = property.enum[0];
    } else if (property.type === "boolean") {
      result[key] = false;
    } else if (property.type === "number" || property.type === "integer") {
      result[key] = property.minimum ?? 0;
    } else {
      result[key] = "";
    }
  }
  return result;
}
```

- [x] **Step 4: Implement palette, canvas, config panel, and run panel**

Create `apps/web/src/components/NodePalette.tsx`:

```tsx
import type { NodeType } from "../types";

type Props = {
  nodeTypes: NodeType[];
  onAddNode: (nodeType: NodeType) => void;
};

export function NodePalette({ nodeTypes, onAddNode }: Props) {
  const grouped = nodeTypes.reduce((groups, nodeType) => {
    const existing = groups.get(nodeType.category) ?? [];
    groups.set(nodeType.category, [...existing, nodeType]);
    return groups;
  }, new Map<string, NodeType[]>());
  return (
    <aside className="panel node-palette">
      <h2>Nodes</h2>
      {[...grouped.entries()].map(([category, items]) => (
        <section key={category} className="palette-group">
          <h3>{category}</h3>
          {items.map((nodeType) => (
            <button key={nodeType.id} className="node-type-button" onClick={() => onAddNode(nodeType)}>
              <span>{nodeType.name}</span>
              <small>{nodeType.description}</small>
            </button>
          ))}
        </section>
      ))}
    </aside>
  );
}
```

Create `apps/web/src/components/FlowCanvas.tsx`:

```tsx
import { useMemo } from "react";
import ReactFlow, { Background, Controls, type Edge, Handle, MarkerType, Position, type Node, type NodeProps } from "reactflow";
import type { NodeType, WorkflowDocument } from "../types";

type Props = {
  workflow: WorkflowDocument;
  nodeTypes: NodeType[];
  selectedNodeId?: string;
  onSelectNode: (id: string | undefined) => void;
  onChangeWorkflow: (workflow: WorkflowDocument) => void;
};

function WorkflowNodeView({ data }: NodeProps<{ label: string; inputs: string[]; outputs: string[] }>) {
  return (
    <div className="workflow-node">
      {data.inputs.map((name) => (
        <Handle key={name} type="target" id={name} position={Position.Left} />
      ))}
      <div className="workflow-node-title">{data.label}</div>
      {data.outputs.map((name) => (
        <Handle key={name} type="source" id={name} position={Position.Right} />
      ))}
    </div>
  );
}

const nodeTypesMap = { workflow: WorkflowNodeView };

export function FlowCanvas({ workflow, nodeTypes, selectedNodeId, onSelectNode, onChangeWorkflow }: Props) {
  const typeById = useMemo(() => new Map(nodeTypes.map((nodeType) => [nodeType.id, nodeType])), [nodeTypes]);
  const nodes: Node[] = workflow.nodes.map((node) => {
    const nodeType = typeById.get(node.type);
    return {
      id: node.id,
      type: "workflow",
      position: node.position,
      selected: node.id === selectedNodeId,
      data: {
        label: nodeType?.name ?? node.type,
        inputs: Object.keys(nodeType?.inputs ?? {}),
        outputs: Object.keys(nodeType?.outputs ?? {})
      }
    };
  });
  const edges: Edge[] = workflow.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    sourceHandle: edge.sourceHandle,
    target: edge.target,
    targetHandle: edge.targetHandle,
    markerEnd: { type: MarkerType.ArrowClosed }
  }));

  return (
    <div className="canvas-shell">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypesMap}
        fitView
        onNodeClick={(_, node) => onSelectNode(node.id)}
        onPaneClick={() => onSelectNode(undefined)}
        onNodesChange={(changes) => {
          const nextNodes = workflow.nodes.map((workflowNode) => {
            const positionChange = changes.find((change) => change.type === "position" && change.id === workflowNode.id);
            return positionChange && "position" in positionChange && positionChange.position
              ? { ...workflowNode, position: positionChange.position }
              : workflowNode;
          });
          onChangeWorkflow({ ...workflow, nodes: nextNodes });
        }}
        onConnect={(connection) => {
          if (!connection.source || !connection.target || !connection.sourceHandle || !connection.targetHandle) {
            return;
          }
          onChangeWorkflow({
            ...workflow,
            edges: [
              ...workflow.edges,
              {
                id: `edge_${crypto.randomUUID().replaceAll("-", "")}`,
                source: connection.source,
                sourceHandle: connection.sourceHandle,
                target: connection.target,
                targetHandle: connection.targetHandle
              }
            ]
          });
        }}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
```

Create `apps/web/src/components/ConfigPanel.tsx`:

```tsx
import type { JsonSchema, NodeType, WorkflowNode } from "../types";

type Props = {
  node?: WorkflowNode;
  nodeType?: NodeType;
  onChange: (node: WorkflowNode) => void;
};

export function ConfigPanel({ node, nodeType, onChange }: Props) {
  if (!node || !nodeType) {
    return (
      <aside className="panel">
        <h2>Config</h2>
        <p className="empty-state">Select a node to edit its configuration.</p>
      </aside>
    );
  }
  return (
    <aside className="panel config-panel">
      <h2>{nodeType.name}</h2>
      {Object.entries(nodeType.configSchema.properties ?? {}).map(([key, schema]) => (
        <SchemaField
          key={key}
          name={key}
          schema={schema}
          value={node.config[key]}
          onChange={(value) => onChange({ ...node, config: { ...node.config, [key]: value } })}
        />
      ))}
    </aside>
  );
}

function SchemaField({
  name,
  schema,
  value,
  onChange
}: {
  name: string;
  schema: JsonSchema;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const label = schema.title ?? name;
  if (schema.enum) {
    return (
      <label className="field">
        <span>{label}</span>
        <select value={String(value ?? "")} onChange={(event) => onChange(event.target.value)}>
          {schema.enum.map((option) => (
            <option key={String(option)} value={String(option)}>
              {String(option)}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (schema.type === "boolean") {
    return (
      <label className="field inline-field">
        <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
        <span>{label}</span>
      </label>
    );
  }
  if (schema.type === "number" || schema.type === "integer") {
    return (
      <label className="field">
        <span>{label}</span>
        <input type="number" value={Number(value ?? 0)} onChange={(event) => onChange(Number(event.target.value))} />
      </label>
    );
  }
  return (
    <label className="field">
      <span>{label}</span>
      <input value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
```

Create `apps/web/src/components/RunPanel.tsx`:

```tsx
import type { RunEvent, RunRecord } from "../types";

export function RunPanel({ run, events }: { run?: RunRecord; events: RunEvent[] }) {
  return (
    <section className="run-panel">
      <div className="run-panel-header">
        <strong>Run Log</strong>
        <span>{run?.status ?? "idle"}</span>
      </div>
      <div className="event-list">
        {events.map((event) => (
          <div key={event.id ?? `${event.timestamp}-${event.type}`} className="event-row">
            <span>{event.type}</span>
            <span>{event.node_id ?? "run"}</span>
            <small>{event.scope.join(" / ")}</small>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [x] **Step 5: Wire editor into App**

Modify `apps/web/src/App.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import { apiClient } from "./api/client";
import { ConfigPanel } from "./components/ConfigPanel";
import { FlowCanvas } from "./components/FlowCanvas";
import { NodePalette } from "./components/NodePalette";
import { RunPanel } from "./components/RunPanel";
import { createEmptyWorkflow, createWorkflowNode } from "./lib/workflow";
import type { NodeType, RunEvent, RunRecord, WorkflowDocument, WorkflowNode } from "./types";

export function App() {
  const [nodeTypes, setNodeTypes] = useState<NodeType[]>([]);
  const [workflow, setWorkflow] = useState<WorkflowDocument>(() => createEmptyWorkflow());
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>();
  const [run, setRun] = useState<RunRecord | undefined>();
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [message, setMessage] = useState<string>("");
  const selectedNode = workflow.nodes.find((node) => node.id === selectedNodeId);
  const selectedNodeType = useMemo(
    () => nodeTypes.find((nodeType) => nodeType.id === selectedNode?.type),
    [nodeTypes, selectedNode?.type]
  );

  useEffect(() => {
    apiClient.listNodeTypes().then(setNodeTypes).catch((error) => setMessage(String(error)));
  }, []);

  async function saveWorkflow() {
    const saved = await apiClient.saveWorkflow(workflow);
    setWorkflow(saved);
    setMessage(`Saved version ${saved.version}`);
  }

  async function validateWorkflow() {
    const result = await apiClient.validateWorkflow(workflow);
    setMessage(result.valid ? "Workflow is valid" : result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
  }

  async function runWorkflow() {
    const saved = await apiClient.saveWorkflow(workflow);
    setWorkflow(saved);
    const createdRun = await apiClient.createRun(saved.id);
    setRun(createdRun);
    setEvents([]);
    const interval = window.setInterval(async () => {
      const nextRun = await apiClient.getRun(createdRun.id);
      const nextEvents = await apiClient.getRunEvents(createdRun.id);
      setRun(nextRun);
      setEvents(nextEvents);
      if (["succeeded", "failed", "cancelled"].includes(nextRun.status)) {
        window.clearInterval(interval);
      }
    }, 750);
  }

  function updateNode(nextNode: WorkflowNode) {
    setWorkflow({
      ...workflow,
      nodes: workflow.nodes.map((node) => (node.id === nextNode.id ? nextNode : node))
    });
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <strong>Node Flow</strong>
          <input className="workflow-name" value={workflow.name} onChange={(event) => setWorkflow({ ...workflow, name: event.target.value })} />
        </div>
        <div className="actions">
          <button onClick={validateWorkflow}>Validate</button>
          <button onClick={saveWorkflow}>Save</button>
          <button onClick={runWorkflow}>Run</button>
        </div>
      </header>
      {message && <pre className="message">{message}</pre>}
      <section className="workspace">
        <NodePalette
          nodeTypes={nodeTypes}
          onAddNode={(nodeType) => {
            const node = createWorkflowNode(nodeType, { x: 100 + workflow.nodes.length * 40, y: 100 + workflow.nodes.length * 20 });
            setWorkflow({ ...workflow, nodes: [...workflow.nodes, node] });
          }}
        />
        <FlowCanvas workflow={workflow} nodeTypes={nodeTypes} selectedNodeId={selectedNodeId} onSelectNode={setSelectedNodeId} onChangeWorkflow={setWorkflow} />
        <ConfigPanel node={selectedNode} nodeType={selectedNodeType} onChange={updateNode} />
      </section>
      <RunPanel run={run} events={events} />
    </main>
  );
}
```

- [x] **Step 6: Extend CSS for editor**

Append to `apps/web/src/styles.css`:

```css
h2,
h3 {
  margin: 0 0 10px;
}

h2 {
  font-size: 14px;
}

h3 {
  color: #607080;
  font-size: 12px;
  text-transform: uppercase;
}

.workflow-name {
  width: 260px;
  margin-left: 12px;
  border: 1px solid #c7d0d9;
  border-radius: 6px;
  padding: 6px 8px;
}

.actions {
  display: flex;
  gap: 8px;
}

.actions button,
.node-type-button {
  border: 1px solid #b9c5cf;
  border-radius: 6px;
  background: #ffffff;
  cursor: pointer;
}

.actions button {
  padding: 6px 10px;
}

.message {
  position: absolute;
  z-index: 5;
  top: 56px;
  left: 280px;
  right: 340px;
  max-height: 120px;
  overflow: auto;
  margin: 0;
  padding: 8px;
  border: 1px solid #c7d0d9;
  border-radius: 6px;
  background: #ffffff;
  white-space: pre-wrap;
}

.palette-group {
  margin-bottom: 16px;
}

.node-type-button {
  display: block;
  width: 100%;
  text-align: left;
  margin-bottom: 8px;
  padding: 8px;
}

.node-type-button span {
  display: block;
  font-weight: 600;
}

.node-type-button small {
  display: block;
  color: #697783;
  margin-top: 4px;
}

.workflow-node {
  min-width: 160px;
  border: 1px solid #6f7f8f;
  border-radius: 6px;
  background: #ffffff;
  box-shadow: 0 2px 8px rgba(23, 32, 42, 0.08);
}

.workflow-node-title {
  padding: 10px 12px;
  font-size: 13px;
  font-weight: 700;
}

.field {
  display: grid;
  gap: 4px;
  margin-bottom: 12px;
  font-size: 13px;
}

.field input,
.field select {
  border: 1px solid #c7d0d9;
  border-radius: 6px;
  padding: 6px 8px;
}

.inline-field {
  grid-template-columns: auto 1fr;
  align-items: center;
}

.empty-state {
  color: #697783;
  font-size: 13px;
}

.run-panel {
  position: fixed;
  left: 260px;
  right: 320px;
  bottom: 0;
  height: 180px;
  border-top: 1px solid #c7d0d9;
  background: #ffffff;
}

.run-panel-header {
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  border-bottom: 1px solid #e0e6eb;
}

.event-list {
  height: 148px;
  overflow: auto;
}

.event-row {
  display: grid;
  grid-template-columns: 160px 180px 1fr;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid #edf1f5;
  font-size: 12px;
}
```

- [x] **Step 7: Run frontend tests and build**

Run:

```powershell
pnpm test:web
pnpm build:web
```

Expected: both commands pass.

- [x] **Step 8: Commit editor**

Run:

```powershell
git add apps/web/src
git commit -m "feat: add workflow editor"
```

Expected: commit succeeds.

---

## Task 11: Subflow Editing In Frontend

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/ConfigPanel.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/lib/workflow.test.ts`

- [x] **Step 1: Add subflow helper test**

Append to `apps/web/src/lib/workflow.test.ts`:

```ts
import { getEditableWorkflow, updateEditableWorkflow } from "./workflow";

describe("subflow helpers", () => {
  it("returns the body subflow when editing inside a control node", () => {
    const root = createEmptyWorkflow();
    const control = {
      id: "each",
      type: "control.foreach",
      position: { x: 0, y: 0 },
      config: {},
      subflows: { body: { nodes: [], edges: [] } }
    };
    const workflow = { ...root, nodes: [control] };
    const editable = getEditableWorkflow(workflow, { nodeId: "each", subflowName: "body" });
    expect(editable.nodes).toEqual([]);
  });

  it("updates a body subflow", () => {
    const root = createEmptyWorkflow();
    const workflow = {
      ...root,
      nodes: [
        {
          id: "each",
          type: "control.foreach",
          position: { x: 0, y: 0 },
          config: {},
          subflows: { body: { nodes: [], edges: [] } }
        }
      ]
    };
    const updated = updateEditableWorkflow(workflow, { nodeId: "each", subflowName: "body" }, { nodes: [], edges: [] });
    expect(updated.nodes[0].subflows?.body.nodes).toEqual([]);
  });
});
```

- [x] **Step 2: Run frontend tests and verify failure**

Run:

```powershell
pnpm test:web
```

Expected: FAIL because `getEditableWorkflow` and `updateEditableWorkflow` do not exist.

- [x] **Step 3: Implement subflow helpers**

Append to `apps/web/src/lib/workflow.ts`:

```ts
export type EditScope = { nodeId: string; subflowName: string } | undefined;

export function getEditableWorkflow(workflow: WorkflowDocument, scope: EditScope): { nodes: WorkflowNode[]; edges: WorkflowDocument["edges"] } {
  if (!scope) {
    return { nodes: workflow.nodes, edges: workflow.edges };
  }
  const node = workflow.nodes.find((item) => item.id === scope.nodeId);
  return node?.subflows?.[scope.subflowName] ?? { nodes: [], edges: [] };
}

export function updateEditableWorkflow(
  workflow: WorkflowDocument,
  scope: EditScope,
  next: { nodes: WorkflowNode[]; edges: WorkflowDocument["edges"] }
): WorkflowDocument {
  if (!scope) {
    return { ...workflow, nodes: next.nodes, edges: next.edges };
  }
  return {
    ...workflow,
    nodes: workflow.nodes.map((node) =>
      node.id === scope.nodeId
        ? {
            ...node,
            subflows: {
              ...node.subflows,
              [scope.subflowName]: next
            }
          }
        : node
    )
  };
}
```

- [x] **Step 4: Add subflow controls to config panel**

Modify `apps/web/src/components/ConfigPanel.tsx` props and footer:

```tsx
type Props = {
  node?: WorkflowNode;
  nodeType?: NodeType;
  onChange: (node: WorkflowNode) => void;
  onOpenSubflow?: (nodeId: string, subflowName: string) => void;
};
```

Inside the selected-node return block, after schema fields, add:

```tsx
      {(node.type === "control.foreach" || node.type === "control.while") && (
        <button className="open-subflow-button" onClick={() => onOpenSubflow?.(node.id, "body")}>
          Open Body
        </button>
      )}
```

- [x] **Step 5: Wire edit scope into App**

Modify `apps/web/src/App.tsx` to import helpers:

```tsx
import { createEmptyWorkflow, createWorkflowNode, getEditableWorkflow, updateEditableWorkflow, type EditScope } from "./lib/workflow";
```

Add state:

```tsx
  const [editScope, setEditScope] = useState<EditScope>();
  const editableWorkflow = getEditableWorkflow(workflow, editScope);
```

Pass a scoped workflow to `FlowCanvas`:

```tsx
        <FlowCanvas
          workflow={{ ...workflow, nodes: editableWorkflow.nodes, edges: editableWorkflow.edges }}
          nodeTypes={nodeTypes}
          selectedNodeId={selectedNodeId}
          onSelectNode={setSelectedNodeId}
          onChangeWorkflow={(next) => setWorkflow(updateEditableWorkflow(workflow, editScope, { nodes: next.nodes, edges: next.edges }))}
        />
```

Add breadcrumbs inside the topbar before actions:

```tsx
        <div className="breadcrumbs">
          <button onClick={() => setEditScope(undefined)}>Main</button>
          {editScope && <span>/ {editScope.nodeId}.{editScope.subflowName}</span>}
        </div>
```

Pass `onOpenSubflow` into `ConfigPanel`:

```tsx
        <ConfigPanel
          node={selectedNode}
          nodeType={selectedNodeType}
          onChange={updateNode}
          onOpenSubflow={(nodeId, subflowName) => {
            setEditScope({ nodeId, subflowName });
            setSelectedNodeId(undefined);
          }}
        />
```

- [x] **Step 6: Add subflow CSS**

Append to `apps/web/src/styles.css`:

```css
.breadcrumbs {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}

.breadcrumbs button,
.open-subflow-button {
  border: 1px solid #b9c5cf;
  border-radius: 6px;
  background: #ffffff;
  padding: 6px 8px;
  cursor: pointer;
}

.open-subflow-button {
  width: 100%;
  margin-top: 8px;
}
```

- [x] **Step 7: Run frontend tests and build**

Run:

```powershell
pnpm test:web
pnpm build:web
```

Expected: both commands pass.

- [x] **Step 8: Commit subflow editing**

Run:

```powershell
git add apps/web/src
git commit -m "feat: edit structured loop subflows"
```

Expected: commit succeeds.

---

## Task 12: End-To-End Smoke Verification

**Files:**
- Create: `tests/api/test_api_workflow_run.py`
- Modify: `README.md`

- [x] **Step 1: Write API workflow run smoke test**

Create `tests/api/test_api_workflow_run.py`:

```python
import asyncio

from fastapi.testclient import TestClient

from apps.api.nodeflow_api.main import create_app


def test_save_and_run_workflow_through_api():
    client = TestClient(create_app(database_path=":memory:"))
    workflow = {
        "id": "wf_smoke",
        "name": "Smoke",
        "version": 1,
        "nodes": [
            {"id": "start", "type": "manual.trigger", "position": {"x": 0, "y": 0}, "config": {"payload": {"ok": True}}},
            {"id": "log", "type": "utility.log", "position": {"x": 200, "y": 0}, "config": {"message": "done"}}
        ],
        "edges": [
            {"id": "e1", "source": "start", "sourceHandle": "success", "target": "log", "targetHandle": "input"}
        ]
    }
    save_response = client.post("/api/workflows", json=workflow)
    assert save_response.status_code == 200
    run_response = client.post("/api/workflows/wf_smoke/runs")
    assert run_response.status_code == 200
    run_id = run_response.json()["id"]
    for _ in range(20):
        run = client.get(f"/api/runs/{run_id}").json()
        if run["status"] in {"succeeded", "failed", "cancelled"}:
            break
        asyncio.run(asyncio.sleep(0.05))
    assert run["status"] == "succeeded"
    events = client.get(f"/api/runs/{run_id}/events").json()
    assert any(event["node_id"] == "log" and event["type"] == "node_succeeded" for event in events)
```

- [x] **Step 2: Run smoke test and fix background task behavior if needed**

Run:

```powershell
pytest tests/api/test_api_workflow_run.py -q
```

Expected: PASS. If it fails because `asyncio.create_task` does not advance under `TestClient`, change the endpoint to use FastAPI `BackgroundTasks`:

```python
from fastapi import BackgroundTasks, FastAPI, HTTPException
```

Change the route signature:

```python
    @app.post("/api/workflows/{workflow_id}/runs")
    async def create_run(workflow_id: str, background_tasks: BackgroundTasks):
```

Replace:

```python
        asyncio.create_task(executor.execute(run.id, workflow))
```

with:

```python
        background_tasks.add_task(executor.execute, run.id, workflow)
```

- [x] **Step 3: Update README with MVP workflow**

Append to `README.md`:

```markdown
## MVP Workflow

1. Start the API with `pnpm dev:api`.
2. Start the web editor with `pnpm dev:web`.
3. Open `http://127.0.0.1:5173`.
4. Add `Manual Trigger` and `Log` nodes.
5. Connect `Manual Trigger.success` to `Log.input`.
6. Click `Validate`.
7. Click `Run`.
8. Inspect run events in the run log panel.

Python node files live under `nodes/`. A node becomes available in the editor when it is registered with `@node(...)` and discovered by the API.
```

- [x] **Step 4: Run full verification**

Run:

```powershell
pytest tests/api -q
pnpm test:web
pnpm build:web
```

Expected: all commands pass.

- [x] **Step 5: Check working tree**

Run:

```powershell
git status --short
```

Expected: only planned changes are shown.

- [x] **Step 6: Commit smoke verification**

Run:

```powershell
git add README.md tests/api/test_api_workflow_run.py apps/api/nodeflow_api/main.py
git commit -m "test: add workflow run smoke coverage"
```

Expected: commit succeeds.

---

## Phase 4 Completion Record

Date: 2026-06-18

Completed after the MVP baseline:

- Added cooperative run cancellation with `POST /api/runs/{run_id}/cancel`, cancellation request persistence, executor cancellation checks, and `cancelled` run status handling.
- Added workflow-level timeout through `WorkflowDocument.settings.timeout_seconds`, defaulting to 600 seconds.
- Added complete frontend node runtime states: `pending`, `running`, `succeeded`, `failed`, `skipped`, and `cancelled`.
- Added palette-to-canvas drag/drop while preserving click-to-add.
- Added Chinese cancel controls, runtime state badges, run event labels, and runtime detail labels.
- Added basic `{{ ... }}` expression syntax validation with field-path issue reporting.
- Updated README with Chinese usage notes for drag/drop, cancellation, run details, CSV-driven loops, assertions, and report-writing.

Verification completed:

- `pytest tests/api -q`
- `pnpm --filter @node-flow/web test`
- `pnpm build:web`

Known exclusions still intentional:

- No online Python editing.
- No multi-user authentication or permissions.
- No distributed worker or external queue.
- No production-grade secret management.
- No publish/rollback UI.

## Self-Review

Spec coverage:

- Independent workflow editor: covered by Tasks 8 through 11.
- React Flow canvas: covered by Task 10.
- FastAPI backend: covered by Tasks 4 through 6.
- SQLite persistence: covered by Task 4.
- Decorator and class Python nodes: covered by Tasks 2 and 3.
- Node discovery: covered by Task 3.
- JSON Schema generated config forms: covered by Tasks 2, 3, and 10.
- Workflow save and validation: covered by Tasks 4 and 5.
- Backend execution: covered by Task 6.
- Run records and events: covered by Tasks 4, 6, and 12.
- `If`: covered by Tasks 3 and 6.
- `ForEach` and `While`: covered by Tasks 3, 7, and 11.
- Loop safeguards: covered by Task 7 for `max_items`, `max_iterations`, and `asyncio.timeout` enforcement.

Placeholder scan:

- No unresolved placeholder markers.
- No unchecked vague "write tests" steps without concrete test code.
- No references to unnamed files.

Type consistency:

- Backend `WorkflowDocument`, `WorkflowNode`, `WorkflowEdge`, and `WorkflowSubflow` match frontend `WorkflowDocument`, `WorkflowNode`, `WorkflowEdge`, and `WorkflowSubflow`.
- Python node IDs match frontend and tests: `manual.trigger`, `http.request`, `logic.if`, `control.foreach`, `control.while`, `utility.log`.
- Run statuses match design: `queued`, `running`, `succeeded`, `failed`, `cancelled`.
