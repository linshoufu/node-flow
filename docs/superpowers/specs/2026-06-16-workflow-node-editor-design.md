# Workflow Node Editor Design

Date: 2026-06-16

## Goal

Build an independent workflow automation platform with a node editor, a Python backend executor, and a Python-script-as-node plugin model.

The first version should let a developer create workflows visually, configure Python-backed nodes, save workflow definitions, run them on the backend, and inspect execution results. The system is designed for one developer-user at first, so developer experience is more important than multi-user governance.

## Product Scope

The first version includes:

- Workflow list and workflow editor.
- React Flow based node canvas.
- Node palette populated from backend node metadata.
- Node configuration panel generated from Python/Pydantic schemas.
- Workflow graph save and validation.
- Backend execution through FastAPI.
- Python node scripts discovered from the filesystem.
- Execution logs with node inputs, outputs, errors, duration, and loop iterations.
- Branching with `If`.
- Structured loops with `ForEach` and `While`.

The first version excludes:

- Multi-user authentication and permissions.
- Online Python script editing.
- Arbitrary graph back-edges.
- Distributed workers or queue-based execution.
- Human approval pauses.
- Production-grade secret management beyond a simple local abstraction.
- Complex publish, rollback, and deployment workflows.

## Architecture

The system has three layers:

1. Frontend editor: React, TypeScript, and React Flow.
2. Backend platform: FastAPI, SQLite, workflow validation, node registry, and executor.
3. Node scripts: Python files registered through decorators and classes.

Core principle:

> A workflow is graph data. Python nodes are plugins. The executor is an interpreter.

Suggested repository layout:

```text
node-flow/
  apps/
    web/
    api/
  nodeflow_sdk/
  nodes/
    network/
    logic/
    debug/
  workflows/
  docs/
```

## Frontend Experience

The editor layout should be practical and work-focused:

- Left panel: node palette grouped by category.
- Center: React Flow canvas.
- Right panel: selected node configuration.
- Bottom or side panel: run logs and node inspection.
- Top bar: workflow name, save, validate, run, and run status.

Core interactions:

- Drag a node from the palette into the canvas.
- Render node handles from backend-declared inputs and outputs.
- Click a node to edit its configuration.
- Generate configuration forms from backend JSON Schema.
- Validate the graph through the backend before running.
- Run a workflow and poll execution status.
- Color nodes by runtime state: pending, running, succeeded, failed, skipped, or cancelled.
- Inspect each node's runtime input, output, logs, error, and duration.
- Open `ForEach` and `While` nodes into a nested subflow editor.
- Show breadcrumbs for main flow and nested loop body editing.

The first UI should behave like a real tool, not a landing page. It should prioritize dense but readable panels, predictable controls, and clear inspection of workflow state.

## Python Node API

Nodes should use decorators and Python classes. This matches the desired "script as component" style, similar to Unity C# scripts.

Example:

```python
from typing import Literal
from pydantic import BaseModel, Field
from nodeflow_sdk import BaseNode, Input, NodeContext, Output, node


class HttpRequestConfig(BaseModel):
    method: Literal["GET", "POST", "PUT", "DELETE"] = "GET"
    url: str = Field(..., title="URL")
    timeout_seconds: int = Field(default=30, ge=1, le=300)


@node(
    id="http.request",
    name="HTTP Request",
    category="Network",
    description="Send an HTTP request and return the response.",
)
class HttpRequestNode(BaseNode[HttpRequestConfig]):
    inputs = {
        "body": Input(required=False),
        "headers": Input(required=False),
    }

    outputs = {
        "success": Output(description="Response data"),
        "error": Output(description="Request error"),
    }

    async def execute(self, ctx: NodeContext, inputs: dict):
        config = self.config
        ctx.log.info("sending request")
        ...
```

The SDK should provide:

- `@node(...)` for registration metadata.
- `BaseNode[TConfig]` for lifecycle and typed config.
- `Input` and `Output` declarations for canvas handles.
- `NodeContext` for run metadata, logging, cancellation, progress, and local secret lookup.
- Pydantic-based configuration validation.
- JSON Schema generation for frontend forms.

Example `NodeContext` capabilities:

```python
ctx.log.info("message")
ctx.emit_progress(0.5)
ctx.get_secret("api_key")
ctx.run_id
ctx.node_id
ctx.cancelled
```

Initial built-in nodes:

- `Manual Trigger`
- `HTTP Request`
- `If`
- `ForEach`
- `While`
- `Set Variable`
- `Transform`
- `Log`
- `Delay`

## Node Discovery

The backend scans the `nodes/` directory at startup. In development, it can support manual reload or file-watch reload later.

Example structure:

```text
nodes/
  network/
    http_request.py
  logic/
    transform.py
  debug/
    log.py
```

The registry endpoint exposes discovered node types:

```http
GET /api/node-types
```

Each node type response includes:

- ID, name, category, description.
- Input handle definitions.
- Output handle definitions.
- Generated config JSON Schema.
- Optional UI hints.

## Workflow Graph Model

Workflows are saved as JSON graph data.

```ts
type Workflow = {
  id: string
  name: string
  version: number
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

type WorkflowNode = {
  id: string
  type: string
  position: { x: number; y: number }
  config: Record<string, unknown>
  subflows?: Record<string, WorkflowSubflow>
}

type WorkflowEdge = {
  id: string
  source: string
  sourceHandle: string
  target: string
  targetHandle: string
}

type WorkflowSubflow = {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}
```

`type` maps to the Python node ID declared by `@node(id="...")`.

The executor stores node outputs in the run context so downstream nodes can reference values:

```text
{{ inputs.payload.user_id }}
{{ nodes.http_1.outputs.success.body }}
{{ loop.item }}
{{ loop.index }}
```

## Control Flow

The first version supports branching and structured loops.

### If

`If` is a built-in control node with `true` and `false` output handles. It evaluates a condition expression against the current run context.

If the expression fails to parse or evaluate, the node fails.

### ForEach

`ForEach` is a structured loop node. It evaluates a list expression, then runs its `body` subflow once per item.

The node has a nested `body` subflow and external `done` and `error` output handles. When all iterations complete, execution continues through `done`. If the loop fails and the `error` handle is connected, execution continues through `error`; otherwise the workflow fails.

Each iteration injects:

```text
loop.item
loop.index
```

Configuration includes:

- List expression.
- Optional concurrency mode, defaulting to sequential execution in v1.
- `continue_on_error`.
- `max_items`.
- `timeout_seconds`.

### While

`While` is a structured loop node. It evaluates a condition expression before each iteration and runs its `body` subflow while the condition is true.

The node has a nested `body` subflow and external `done`, `max_reached`, and `error` output handles. When the condition becomes false, execution continues through `done`. If `max_iterations` is reached, execution continues through `max_reached` when connected; otherwise the workflow fails.

Configuration includes:

- Condition expression.
- `max_iterations`, required.
- `timeout_seconds`, required.

### No Arbitrary Back-Edges

The editor should not support arbitrary graph back-edges in v1. Loops must be represented through structured control nodes with explicit subflows. This keeps validation, runtime logs, cancellation, and failure behavior understandable.

## Execution Model

The first backend executor should be a single-process async executor hosted by FastAPI.

Run flow:

1. Client calls `POST /api/workflows/{id}/runs`.
2. Backend creates a run record with `queued` status.
3. Backend starts execution in a background task.
4. Executor loads the workflow version.
5. Executor validates graph structure, node types, node config, and edges.
6. Executor runs nodes according to graph and control-flow semantics.
7. Executor appends run events.
8. Client polls or subscribes to run updates.

Suggested run endpoints:

```http
POST /api/workflows/{id}/runs
GET /api/runs/{run_id}
GET /api/runs/{run_id}/events
POST /api/runs/{run_id}/cancel
```

Polling is enough for the first version. Server-Sent Events can be added once the basic execution path is stable.

## Runtime State

Run statuses:

```text
queued
running
succeeded
failed
cancelled
```

Node statuses:

```text
pending
running
succeeded
failed
skipped
cancelled
```

Run events should be append-only:

```json
{
  "type": "node_succeeded",
  "runId": "run_42",
  "nodeId": "http_1",
  "timestamp": "2026-06-16T08:00:00Z",
  "durationMs": 324,
  "outputs": {}
}
```

Loop events should include a path or scope so the frontend can display nested execution:

```json
{
  "type": "node_started",
  "nodeId": "send_webhook",
  "scope": ["foreach_orders", "iteration:1"],
  "timestamp": "2026-06-16T08:00:00Z"
}
```

## Error Handling

Default behavior should be simple and explicit:

- A normal node failure fails the workflow.
- If a node has an `error` output and that output is connected, execution follows the error branch instead.
- An `If` expression failure fails the node.
- A `ForEach` iteration failure fails the loop unless `continue_on_error` is enabled.
- A `While` loop must stop at `max_iterations` or `timeout_seconds`.
- Workflow-level timeout prevents runaway runs.
- Cancellation sets the run and active nodes to `cancelled`.

Errors should keep enough detail for a developer-user:

- Error message.
- Error type.
- Stack trace for Python node errors.
- Node ID and node type.
- Loop scope or iteration.
- Inputs used for the failed execution.

## Persistence

SQLite is enough for the first version. The schema should be easy to move to Postgres later.

Suggested tables:

- `workflows`: workflow identity and current draft metadata.
- `workflow_versions`: saved graph snapshots.
- `runs`: run status, workflow version, started/completed timestamps.
- `run_events`: append-only execution events.

The first version can save every workflow save as a new version internally, while keeping the UI simple. Full publish, rollback, and environment management can come later.

## Validation

Backend validation should check:

- Every node type exists in the registry.
- Every node config matches its Pydantic schema.
- Every edge references existing nodes and handles.
- Required input handles are connected unless explicitly optional.
- Normal graph areas do not contain cycles.
- Structured loop subflows are valid.
- `While` nodes have `max_iterations` and `timeout_seconds`.
- Expressions parse before execution when possible.

Frontend validation can provide immediate feedback, but backend validation is authoritative.

## Milestones

### Milestone 1: Project Skeleton

- React + TypeScript frontend.
- FastAPI backend.
- SQLite database.
- Basic dev scripts.
- Health check endpoint.
- Empty editor shell.

### Milestone 2: Node Plugin System

- `nodeflow_sdk` package.
- `@node`, `BaseNode`, `Input`, `Output`, and `NodeContext`.
- Filesystem node scanning.
- Node registry.
- `GET /api/node-types`.
- Initial built-in nodes.

### Milestone 3: Canvas Editing And Save

- Node palette.
- Drag nodes onto canvas.
- Render input/output handles.
- Connect nodes.
- JSON Schema based config forms.
- Save workflow graph.
- Validate workflow graph.

### Milestone 4: Execution MVP

- Run workflow endpoint.
- Single-process async executor.
- Run and node statuses.
- Append-only run events.
- Manual Trigger, HTTP Request, If, Set Variable, Transform, Log, and Delay execution.
- Error output branch behavior.
- Frontend run log panel.

### Milestone 5: Structured Loops

- `ForEach` node with body subflow.
- `While` node with body subflow.
- Subflow editor navigation.
- Loop iteration logs.
- Loop timeout and max-iteration safeguards.
- `continue_on_error` behavior for `ForEach`.

## Open Design Decisions

These decisions can wait until implementation planning:

- Whether frontend and backend live in a monorepo workspace manager such as pnpm.
- Whether JSON Schema forms use an existing renderer or a small custom renderer.
- Whether run events are delivered through polling first or SSE immediately.
- Whether workflow JSON is stored only in SQLite or mirrored to `workflows/` during development.
- How much expression language is custom versus based on an existing safe evaluator.

## Success Criteria

The first version is successful when:

- A developer can create a workflow from discovered Python nodes.
- Adding a new Python node file makes it available in the editor without writing frontend code.
- Node configuration is validated through Pydantic and rendered in the frontend.
- A saved workflow can run on the backend.
- Branching works through `If`.
- List and conditional loops work through `ForEach` and `While`.
- Run logs clearly show node state, inputs, outputs, errors, and loop iterations.
- Runaway loops are prevented by required limits.
