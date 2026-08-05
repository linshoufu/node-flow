# Subworkflow Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Node Flow a composable workflow platform by adding explicit child-workflow invocation, input, return, lifecycle events, cancellation propagation, and lineage navigation.

**Architecture:** Add three built-in generic nodes: `workflow.trigger` defines a child workflow input boundary, `workflow.execute` creates a linked child run and waits for it, and `workflow.return` defines the data returned to the caller. Keep orchestration inside `WorkflowExecutor`, not the SDK node class, so storage access, run ownership, cancellation, timeouts, event emission, and error policy retain one authority. Child runs inherit an absolute execution deadline and ancestor cancellation IDs.

**Tech Stack:** Python 3.14, FastAPI, Pydantic v2, SQLite, pytest, React 19, TypeScript, Vitest, React Flow.

## Global Constraints

- All user-facing UI copy is Chinese; Python/TypeScript identifiers and persisted JSON handles remain English.
- The existing dirty worktree must not be staged, committed, reset, checked out, or cleaned.
- A child workflow must begin with exactly one `workflow.trigger` node to receive the caller input; manual runs receive `{}`.
- A child workflow returns parent data only through `workflow.return`; no return node means the parent receives an empty object.
- `workflow.execute` is synchronous in this phase: the parent waits for a terminal child run and receives the result through `success`.
- A child workflow ID cannot repeat any ancestor workflow ID. Reject direct and indirect recursion before creating the child run.
- Parent cancellation is observed by the child on its next cooperative cancellation check. Parent and child share an absolute deadline; a child may not exceed the caller's remaining time.
- Child failure produces a normal node failure, allowing the caller node's `execution` policy to stop, continue, retry, or route to its declared `error` port.
- Existing manual runs, existing workflow JSON, ordinary nodes, control subflows, and API endpoints retain their current behavior.

---

## File Structure

- Create `nodes/builtin/workflow.py`: trigger, execute metadata/config, and return node contracts.
- Modify `apps/api/nodeflow_api/executor.py`: child-run orchestration, inherited execution context, child workflow validation at run time, lifecycle events, and special-node dispatch.
- Modify `apps/api/nodeflow_api/workflow_node_validation.py`: enforce trigger/return placement rules that only apply to `workflow.execute` targets at execution time; regular workflow validation keeps child workflows independently editable.
- Modify `apps/api/nodeflow_api/storage.py`: add `get_workflows_by_ids()` only if a batched ancestor lookup is needed; otherwise keep the current lineage schema unchanged.
- Modify `apps/api/nodeflow_api/main.py`: create an API endpoint that lists saved workflows as selectable `workflow.execute` targets if the existing summary endpoint lacks the required fields.
- Modify `nodes/builtin/__init__.py` or the registry load path if required for discovery.
- Modify `apps/web/src/lib/display.ts`: localize the three new generic node types and lifecycle event labels.
- Modify `apps/web/src/lib/workflow.ts` and `apps/web/src/lib/preRunChecks.ts`: expose selected target workflow names and report missing/recursive target issues before a run.
- Modify `apps/web/src/components/ConfigPanel.tsx`: show a saved-workflow selector for `workflow.execute` instead of a raw ID editor.
- Modify `apps/web/src/App.tsx`: load workflow summaries for the selector and keep the selected workflow out of its own target list.
- Modify `apps/web/src/components/RunPanel.tsx`, `RunEventList.tsx`, and styles: render child-run lifecycle rows as Chinese links that open the child run.
- Modify `README.md` and `docs/node-contracts.md`: document child workflow authoring, boundaries, recursion, and cancellation semantics.
- Add focused pytest/Vitest tests adjacent to every changed backend/frontend module.

## Task 1: Define Child Workflow Node Contracts

**Files:**
- Create: `nodes/builtin/workflow.py`
- Test: `tests/api/test_node_registry.py`
- Test: `tests/api/test_sdk.py`

**Interfaces:**

```python
class ExecuteWorkflowConfig(NodeConfig):
    workflow_id: str = Field(min_length=1)

@node(id="workflow.trigger", name="Workflow Trigger", category="Workflow", group="trigger", icon="git-branch")
class WorkflowTriggerNode(BaseNode[NodeConfig]):
    outputs = {"success": Output(display_name="输入", schema=ANY_JSON_SCHEMA)}

@node(id="workflow.execute", name="Execute Workflow", category="Workflow", group="action", icon="workflow")
class ExecuteWorkflowNode(BaseNode[ExecuteWorkflowConfig]):
    inputs = {"input": Input(display_name="输入", required=False, schema=ANY_JSON_SCHEMA)}
    outputs = {
        "success": Output(display_name="结果", schema=ANY_JSON_SCHEMA),
        "error": Output(display_name="错误", category="error", schema=ERROR_SCHEMA),
    }

@node(id="workflow.return", name="Workflow Return", category="Workflow", group="action", icon="corner-down-left")
class WorkflowReturnNode(BaseNode[NodeConfig]):
    inputs = {"input": Input(display_name="结果", required=False, schema=ANY_JSON_SCHEMA)}
    outputs = {"success": Output(display_name="已返回", schema=ANY_JSON_SCHEMA)}
```

- [ ] **Step 1: Add failing registry tests**

```python
def test_registry_exposes_workflow_composition_nodes():
    registry = make_registry()
    execute = registry.get("workflow.execute")
    assert execute.inputs["input"].display_name == "输入"
    assert set(execute.outputs) == {"success", "error"}
    assert registry.get("workflow.trigger").meta.group == "trigger"
```

- [ ] **Step 2: Run the focused test**

Run: `pytest tests/api/test_node_registry.py -q`

Expected: FAIL because `workflow.execute` is unknown.

- [ ] **Step 3: Add the three contracts and make them discoverable**

```python
class WorkflowReturnNode(BaseNode[NodeConfig]):
    async def execute(self, ctx: NodeContext, inputs: dict) -> dict:
        return {"success": inputs.get("input", {})}
```

Keep their ordinary `execute()` implementations safe for direct SDK tests. The executor owns their special runtime behavior.

- [ ] **Step 4: Re-run focused registry and SDK tests**

Run: `pytest tests/api/test_node_registry.py tests/api/test_sdk.py -q`

Expected: PASS.

## Task 2: Add Inherited Execution Context And Child Run Orchestration

**Files:**
- Modify: `apps/api/nodeflow_api/executor.py`
- Test: `tests/api/test_executor.py`

**Interfaces:**

```python
@dataclass(frozen=True)
class ExecutionContext:
    deadline: float
    ancestor_run_ids: tuple[str, ...]
    ancestor_workflow_ids: tuple[str, ...]
    initial_input: dict[str, Any]

async def execute(
    self, run_id: str, workflow: WorkflowDocument, *, execution_context: ExecutionContext | None = None
) -> dict[str, Any]: ...

async def _execute_workflow_node(
    self, run_id: str, node: WorkflowNode, context: dict[str, Any], scope: list[str], inputs: dict[str, Any]
) -> dict[str, Any]: ...
```

- [ ] **Step 1: Add failing synchronous child-run tests**

```python
@pytest.mark.asyncio
async def test_execute_workflow_creates_linked_child_run_and_returns_explicit_value(tmp_path):
    parent, child = saved_parent_and_child_workflows(tmp_path)
    parent_run = storage.create_run(parent)
    await executor.execute(parent_run.id, parent)
    child_run = only_child_run(storage, parent_run.id)
    assert child_run.parent_node_id == "call_child"
    assert storage.get_run(parent_run.id).status == "succeeded"
    assert output_for(storage, parent_run.id, "call_child") == {"success": {"answer": 42}}
```

```python
@pytest.mark.asyncio
async def test_parent_cancellation_stops_child_at_next_check(tmp_path):
    parent, child = parent_calling_delay_child(tmp_path)
    parent_run = storage.create_run(parent)
    task = asyncio.create_task(executor.execute(parent_run.id, parent))
    await wait_for_child_running(storage, parent_run.id)
    storage.request_run_cancellation(parent_run.id)
    await task
    assert both_runs_are_cancelled(storage, parent_run.id)
```

- [ ] **Step 2: Run the focused tests**

Run: `pytest tests/api/test_executor.py -q`

Expected: FAIL because child workflow types are not dispatched and no child run is created.

- [ ] **Step 3: Introduce the internal execution context and special dispatch**

```python
if node.type == "workflow.trigger":
    return {"success": context["workflow_input"]}

if node.type == "workflow.return":
    value = inputs.get("input", {})
    context["workflow_return"] = value
    return {"success": value}
```

For `workflow.execute`, load the saved child workflow, reject an unknown ID or `child.id in execution_context.ancestor_workflow_ids`, create a run with both lineage fields, emit `child_run_started`, await the child using a context whose deadline and ancestors include the caller, then emit `child_run_succeeded` and return `{"success": child_return}`. If the child is failed or cancelled, raise `WorkflowExecutionError` with the child run ID so the existing node policy wrapper handles it.

`_check_cancelled()` must inspect the current run and every `ancestor_run_ids` entry. If cancellation is detected, append one `run_cancel_requested` event to the current run before raising `WorkflowCancelled`.

- [ ] **Step 4: Add recursion, missing-boundary, failure-policy, and deadline tests**

```python
@pytest.mark.asyncio
async def test_execute_workflow_rejects_recursive_target_before_creating_child_run(tmp_path):
    workflow = saved_self_referencing_workflow(tmp_path)
    run = storage.create_run(workflow)
    await executor.execute(run.id, workflow)
    assert storage.get_run(run.id).status == "failed"
    assert storage.list_workflow_runs(workflow.id) == [storage.get_run(run.id)]

@pytest.mark.asyncio
async def test_child_failure_uses_calling_node_error_output_policy(tmp_path):
    parent, child = parent_with_error_output_handler(tmp_path)
    await execute(parent)
    assert handler_received_standard_error(storage, parent)
```

- [ ] **Step 5: Run executor tests**

Run: `pytest tests/api/test_executor.py -q`

Expected: PASS, including existing cancellation, loop, output-validation, and retry tests.

## Task 3: Validate Child Workflow Boundaries Before Running

**Files:**
- Create: `apps/api/nodeflow_api/workflow_execution_validation.py`
- Modify: `apps/api/nodeflow_api/validation.py`
- Test: `tests/api/test_validation.py`

**Interfaces:**

```python
def executable_child_workflow_issues(workflow: WorkflowDocument) -> list[tuple[str, str]]: ...
```

- [ ] **Step 1: Add failing validation tests**

```python
def test_execute_workflow_target_requires_exactly_one_trigger():
    result = validate_workflow(parent_referencing_child_without_trigger(), registry())
    assert any(issue.path == "nodes.call_child.config.workflow_id" for issue in result.issues)
    assert any("工作流触发" in issue.message for issue in result.issues)
```

The test fixture may use `Storage` because the target is a saved workflow, not embedded JSON.

- [ ] **Step 2: Run focused validation tests**

Run: `pytest tests/api/test_validation.py -q`

Expected: FAIL because workflow-target lookup is absent.

- [ ] **Step 3: Add runtime target validation at the invocation boundary**

Do not make ordinary saved child workflows invalid merely because they are manually editable. Validate target existence, one root `workflow.trigger`, and a non-recursive ancestry chain in `_execute_workflow_node()` immediately before `create_run()`. Surface the same problem from the frontend pre-run check using available workflow summaries; the backend remains authoritative.

- [ ] **Step 4: Re-run validation and API tests**

Run: `pytest tests/api/test_validation.py tests/api/test_api_workflow_run.py -q`

Expected: PASS.

## Task 4: Productize Child Workflow Selection And Run Navigation

**Files:**
- Modify: `apps/web/src/types.ts`
- Modify: `apps/web/src/lib/display.ts`
- Modify: `apps/web/src/lib/preRunChecks.ts`
- Modify: `apps/web/src/components/ConfigPanel.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/RunPanel.tsx`
- Modify: `apps/web/src/components/RunEventList.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/components/ConfigPanel.test.tsx`
- Test: `apps/web/src/components/RunPanel.test.tsx`
- Test: `apps/web/src/App.test.tsx`

**Interfaces:**

```ts
type ConfigPanelProps = {
  workflowOptions?: WorkflowSummary[];
  currentWorkflowId?: string;
};

type ChildRunEventPayload = { child_run_id: string; child_workflow_id: string };
```

- [ ] **Step 1: Add failing component tests**

```tsx
it("uses saved workflow names instead of raw ids for Execute Workflow", () => {
  render(<ConfigPanel node={executeNode} nodeType={executeType} workflowOptions={[childSummary]} />);
  expect(screen.getByLabelText("目标工作流")).toHaveDisplayValue("登录回归");
  expect(screen.queryByText("workflow_child")).not.toBeInTheDocument();
});

it("opens the child run from a child-run lifecycle event", () => {
  render(<RunPanel events={[childRunStarted("run_child")]} onOpenChildRun={onOpenChildRun} />);
  fireEvent.click(screen.getByRole("button", { name: "查看子运行" }));
  expect(onOpenChildRun).toHaveBeenCalledWith("run_child");
});
```

- [ ] **Step 2: Run focused frontend tests**

Run: `pnpm --filter @node-flow/web test -- src/components/ConfigPanel.test.tsx src/components/RunPanel.test.tsx src/App.test.tsx`

Expected: FAIL because the selector and child-run navigation do not exist.

- [ ] **Step 3: Add localized metadata and selector UX**

Render a required native select labelled `目标工作流`; options contain saved workflow names, version labels, and only non-current workflows. Preserve `workflow_id` in JSON. Show an inline Chinese empty state when no other workflow is available. Reuse `openParentRun()` loading logic for `openChildRun()`.

- [ ] **Step 4: Show child lifecycle events as run navigation controls**

Map `child_run_started`, `child_run_succeeded`, and `child_run_failed` to Chinese labels. In event rows, expose a single `查看子运行` button for payloads containing `child_run_id`; use the existing run drawer and historical run view rather than adding a second inspector.

- [ ] **Step 5: Run focused frontend tests**

Run: `pnpm --filter @node-flow/web test -- src/components/ConfigPanel.test.tsx src/components/RunPanel.test.tsx src/App.test.tsx`

Expected: PASS.

## Task 5: Documentation, Full Verification, And Browser Smoke

**Files:**
- Modify: `README.md`
- Modify: `docs/node-contracts.md`

- [ ] **Step 1: Document the child workflow protocol**

Document a child workflow as `工作流触发 -> ... -> 工作流返回`; document input and output boundaries, synchronous behavior, recursion rejection, inherited cancellation/timeout, and parent-child run navigation. State that asynchronous background invocation remains outside this phase.

- [ ] **Step 2: Run all verification commands**

Run: `pytest tests/api -q`

Expected: PASS.

Run: `pnpm --filter @node-flow/web test`

Expected: PASS.

Run: `pnpm build:web`

Expected: PASS; record any Vite chunk-size warning.

Run: `git diff --check`

Expected: exit code `0`; do not stage or commit the dirty worktree.

- [ ] **Step 3: Browser smoke test**

On `http://127.0.0.1:5273/`, create a child workflow with `工作流触发` and `工作流返回`, save it, create a parent workflow with `执行工作流`, select the child by Chinese name, connect its input and success output, and run it. Verify the parent event has `查看子运行`, the child view has `查看父运行`, the returned value reaches the parent downstream node, and cancelling a delayed child makes both runs terminal as cancelled.

## Self-Review

- Coverage: Tasks 1-2 establish the node protocol and authoritative runtime path; Task 3 protects the execution boundary; Task 4 productizes selection and lineage navigation; Task 5 documents and verifies the full feature.
- Scope: asynchronous invocation, credentials, distributed workers, online code editing, multi-user behavior, and workflow publishing are explicitly excluded.
- Compatibility: all additions are new node types or optional runtime data; manual runs and legacy documents remain valid.
- Dirty-worktree rule: no plan step stages, commits, resets, checks out, or cleans files.
