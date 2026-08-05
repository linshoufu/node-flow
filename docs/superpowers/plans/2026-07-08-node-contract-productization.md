# Node Contract Productization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Node Flow toward a general workflow node editor by making Python node port contracts a shared product/API/frontend contract, inspired by n8n's node type descriptions.

**Architecture:** Python node scripts remain the source of truth. The SDK exposes richer `Input` and `Output` metadata, the registry serializes that metadata unchanged to `/api/node-types`, and the frontend uses the same contract for node cards, port tooltips, and connection validation copy.

**Tech Stack:** Python, Pydantic, FastAPI, pytest, React, TypeScript, React Flow, Vitest.

## Global Constraints

- The first built-in node set can remain testing-focused, but the contract must be generic enough for HTTP, data, logic, AI, database, and utility nodes.
- UI text remains Chinese for users; source identifiers remain English.
- Python scripts remain node implementations; do not add online Python editing in this phase.
- Keep existing workflow JSON compatible.
- Do not introduce authentication, distributed workers, or new production secret management in this phase.
- Do not commit unless the user explicitly asks for a commit.

---

### Task 1: SDK And Registry Port Metadata

**Files:**
- Modify: `nodeflow_sdk/core.py`
- Modify: `apps/api/nodeflow_api/node_registry.py`
- Test: `tests/api/test_sdk.py`
- Test: `tests/api/test_node_registry.py`

**Interfaces:**
- Consumes: existing `Input.to_dict()`, `Output.to_dict()`, `NodeRegistry._register()`.
- Produces: port dictionaries may include `displayName`, `category`, `filter`, and `maxConnections`.

- [x] **Step 1: Write failing SDK tests**

Add tests proving `Input` and `Output` serialize product metadata:

```python
def test_input_serializes_product_metadata():
    input_port = Input(
        required=False,
        description="Raw user payload",
        display_name="请求体",
        category="data",
        filter={"nodes": ["http.request"]},
        max_connections=None,
    )

    assert input_port.to_dict() == {
        "required": False,
        "description": "Raw user payload",
        "displayName": "请求体",
        "category": "data",
        "filter": {"nodes": ["http.request"]},
        "maxConnections": None,
    }
```

- [x] **Step 2: Run SDK tests to verify red**

Run: `pytest tests/api/test_sdk.py -q`

Expected: fail because `Input.__init__` and `Output.__init__` do not accept the new metadata fields.

- [x] **Step 3: Implement SDK metadata**

Extend `Input` and `Output` dataclasses with optional `display_name`, `category`, `filter`, and output-side `max_connections`. Serialize these fields as camelCase for API compatibility.

- [x] **Step 4: Add registry/API coverage**

Add a node class in `tests/api/test_node_registry.py` with rich port metadata, scan it, and assert `RegisteredNodeType.to_api_dict()` includes the new fields under `inputs` and `outputs`.

- [x] **Step 5: Run backend target tests**

Run: `pytest tests/api/test_sdk.py tests/api/test_node_registry.py -q`

Expected: all selected tests pass.

### Task 2: Frontend Contract Consumption

**Files:**
- Modify: `apps/web/src/types.ts`
- Modify: `apps/web/src/lib/schemaDisplay.ts`
- Modify: `apps/web/src/lib/connectionValidation.ts`
- Test: `apps/web/src/lib/schemaDisplay.test.ts`
- Test: `apps/web/src/lib/connectionValidation.test.ts`

**Interfaces:**
- Consumes: `NodePort.displayName`, `NodePort.category`, `NodePort.filter`, `NodePort.maxConnections`.
- Produces: Chinese tooltip and validation copy that uses display names when present.

- [x] **Step 1: Write failing frontend tests**

Add tests proving port tooltip and connection validation messages prefer `displayName` over internal handle ids:

```ts
expect(portTooltip({
  direction: "input",
  name: "body",
  port: { displayName: "请求体", required: true, schema: { type: "object" } },
})).toContain("请求体");
```

- [x] **Step 2: Run frontend target tests to verify red**

Run: `pnpm --filter @node-flow/web test -- src/lib/schemaDisplay.test.ts src/lib/connectionValidation.test.ts`

Expected: fail because `NodePort` lacks `displayName` and current copy uses raw handle ids.

- [x] **Step 3: Implement frontend contract fields**

Extend `NodePort` type and update tooltip/copy helpers to format `displayName || handleName`.

- [x] **Step 4: Run frontend target tests**

Run: `pnpm --filter @node-flow/web test -- src/lib/schemaDisplay.test.ts src/lib/connectionValidation.test.ts`

Expected: all selected tests pass.

### Task 3: Product Surface Polish

**Files:**
- Modify: `apps/web/src/lib/nodePortSummary.ts`
- Modify: `apps/web/src/components/FlowCanvas.tsx`
- Test: `apps/web/src/lib/nodePortSummary.test.ts`
- Test: `apps/web/src/components/FlowCanvas.test.tsx`

**Interfaces:**
- Consumes: Task 1 and Task 2 contract fields.
- Produces: port summaries and handle titles that expose human labels and connection constraints.

- [x] **Step 1: Add tests for display-name summaries**

Assert that summaries and handle titles can show user-facing port names without leaking internal ids as the primary label.

- [x] **Step 2: Implement minimal UI polish**

Use display names in port titles and keep raw ids only as secondary technical detail when useful.

- [x] **Step 3: Run target tests**

Run: `pnpm --filter @node-flow/web test -- src/lib/nodePortSummary.test.ts src/components/FlowCanvas.test.tsx`

Expected: all selected tests pass.

### Task 4: Verification

**Files:**
- No production edits unless verification exposes a defect.

- [x] **Step 1: Run backend tests**

Run: `pytest tests/api -q`

Expected: all backend tests pass.

- [x] **Step 2: Run frontend tests**

Run: `pnpm --filter @node-flow/web test`

Expected: all frontend tests pass.

- [x] **Step 3: Run frontend build**

Run: `pnpm build:web`

Expected: TypeScript and Vite build pass.

## Self-Review

- Spec coverage: The plan addresses the generic-node requirement by improving shared SDK/API/frontend node contracts rather than adding more testing-only nodes.
- Placeholder scan: No placeholder tasks remain; each task names files, interfaces, and commands.
- Type consistency: The same camelCase API fields are used across backend serialization and frontend TypeScript types.
