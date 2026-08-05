# Execution Policy And Run Lineage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every workflow node a consistent failure policy and retry behavior, while persisting parent-run lineage for future cross-workflow execution.

**Architecture:** Add a pure backend `execution_policy` module for defaults, validation, and safe error serialization. Make `WorkflowExecutor` perform attempts through one policy wrapper while keeping graph routing and Python node contracts intact. Extend existing schemas, storage, API types, configuration UI, and run-inspector models with narrowly scoped compatibility defaults.

**Tech Stack:** Python 3.14, FastAPI, Pydantic v2, SQLite, pytest, React 19, TypeScript, Vitest, Testing Library, React Flow, Vite.

## Global Constraints

- All user-facing UI copy is Chinese; source identifiers and API field names remain English/camelCase.
- A node without `execution` must behave exactly as today: one attempt and a failed run on an unhandled exception.
- Only thrown execution/config/expression/output-validation exceptions enter the new policy. A node that returns its own declared `error` output keeps its current behavior.
- Cancellation and workflow timeout always terminate the run; a policy must not convert either into a handled node error.
- `errorOutput` requires a declared `error` output and at least one valid outgoing edge from that output.
- Keep Python scripts as node implementations; do not add online Python editing, triggers, queues, credentials, or an Execute Workflow node.
- `parentRunId` and `parentNodeId` are optional forward-compatible lineage fields. This phase does not create child runs.
- Preserve existing workflow JSON and SQLite databases with defaults and additive migrations.
- The worktree already contains unrelated uncommitted changes. Do not stage, commit, reset, checkout, or clean files in this phase.

---

## File Structure

- Create `apps/api/nodeflow_api/execution_policy.py`: policy models, legacy normalization, policy validation, and redacted node-error serialization.
- Create `tests/api/test_execution_policy.py`: unit tests for the pure policy module.
- Modify `apps/api/nodeflow_api/schemas.py`: persist `WorkflowNode.execution` and run lineage fields.
- Modify `apps/api/nodeflow_api/validation.py`: validate policy at root and nested subflow paths.
- Modify `apps/api/nodeflow_api/storage.py`: migrate and persist `parent_run_id`/`parent_node_id`.
- Modify `tests/api/test_validation.py`, `tests/api/test_storage.py`, and `tests/api/test_api_basics.py`: validate policy and lineage API contracts.
- Modify `apps/api/nodeflow_api/executor.py`: use one node-attempt wrapper, fixed-delay retries, handled errors, and deterministic event payloads.
- Modify `tests/api/test_executor.py`: cover stop, continue, error-output, retry, cancellation, and loop compatibility.
- Modify `apps/web/src/types.ts` and `apps/web/src/lib/workflow.ts`: frontend document types and legacy normalizers.
- Create `apps/web/src/lib/executionPolicy.ts` and `apps/web/src/lib/executionPolicy.test.ts`: UI policy defaults, editable values, labels, and validation helpers.
- Modify `apps/web/src/components/ConfigPanel.tsx` and its test: add the Chinese failure-policy editor.
- Modify `apps/web/src/lib/runState.ts`, `apps/web/src/lib/runtimeDisplay.ts`, and their tests: recognize retries and handled failures.
- Modify `apps/web/src/components/NodeRuntimePanel.tsx`, `apps/web/src/components/RunPanel.tsx`, and their tests: expose attempts, handled error diagnostics, and parent-run navigation.
- Modify `apps/web/src/App.tsx` and `apps/web/src/App.test.tsx`: wire policy edits and parent-run navigation into existing workflow/run state.
- Modify `apps/web/src/styles.css`: compact policy editor, handled status, and lineage control styles.
- Modify `README.md`: document author/runtime semantics and the current lineage limitation.

## Task 1: Policy Contract And Document Compatibility

**Files:**
- Create: `apps/api/nodeflow_api/execution_policy.py`
- Create: `tests/api/test_execution_policy.py`
- Modify: `apps/api/nodeflow_api/schemas.py`
- Modify: `apps/api/nodeflow_api/validation.py`
- Modify: `tests/api/test_validation.py`

**Interfaces:**

```python
DEFAULT_NODE_EXECUTION_POLICY = {"onError": "stop", "retry": {"maxAttempts": 1, "delaySeconds": 0}}

class RetryPolicy(BaseModel):
    maxAttempts: int = Field(default=1, ge=1, le=5)
    delaySeconds: float = Field(default=0, ge=0, le=60)

class NodeExecutionPolicy(BaseModel):
    onError: Literal["stop", "continue", "errorOutput"] = "stop"
    retry: RetryPolicy = Field(default_factory=RetryPolicy)

class NodeExecutionError(BaseModel):
    message: str
    type: str
    attempt: int
    nodeId: str
    scope: list[str]
    timestamp: str

def normalize_node_execution_policy(value: NodeExecutionPolicy | None) -> NodeExecutionPolicy: ...
def execution_policy_issues(node: WorkflowNode, edges: list[WorkflowEdge], registry: NodeRegistry, path: str) -> list[tuple[str, str]]: ...
def node_execution_error(exc: Exception, *, attempt: int, node_id: str, scope: list[str], timestamp: str) -> NodeExecutionError: ...
```

- [ ] **Step 1: Write the failing pure-policy and validation tests**

```python
def test_legacy_node_gets_stop_policy_defaults():
    policy = normalize_node_execution_policy(None)
    assert policy.model_dump(by_alias=True) == {
        "onError": "stop",
        "retry": {"maxAttempts": 1, "delaySeconds": 0},
    }

def test_error_output_requires_declared_and_connected_error_port(registry):
    node = WorkflowNode(id="fail", type="test.fail", position=Position(x=0, y=0), config={}, execution={"onError": "errorOutput"})
    issues = execution_policy_issues(node, [], registry, "nodes.fail")
    assert issues == [("nodes.fail.execution.onError", "错误端口策略要求节点声明并连接 error 输出端口")]

def test_validation_keeps_nested_policy_path(registry):
    result = validate_workflow(workflow_with_invalid_nested_error_policy(), registry)
    assert any(issue.path == "nodes.each.subflows.body.nodes.fail.execution.onError" for issue in result.issues)
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `pytest tests/api/test_execution_policy.py tests/api/test_validation.py -q`

Expected: FAIL because `execution_policy.py` and `WorkflowNode.execution` do not exist.

- [ ] **Step 3: Implement the minimal policy module and schema field**

```python
# schemas.py
class WorkflowNode(BaseModel):
    # existing fields
    execution: NodeExecutionPolicy | None = None

# execution_policy.py
def execution_policy_issues(node, edges, registry, path):
    policy = normalize_node_execution_policy(node.execution)
    if policy.onError != "errorOutput":
        return []
    has_error_port = registry.has(node.type) and "error" in registry.get(node.type).outputs
    has_error_edge = any(edge.source == node.id and edge.sourceHandle == "error" for edge in edges)
    return [] if has_error_port and has_error_edge else [
        (f"{path}.execution.onError", "错误端口策略要求节点声明并连接 error 输出端口")
    ]
```

Call `execution_policy_issues()` for each document scope from `validate_workflow()` after normal connection validation. Add `node_execution_error()` that receives the timestamp from the executor and returns only JSON-safe fields; do not include a traceback.

- [ ] **Step 4: Run focused tests to verify they pass**

Run: `pytest tests/api/test_execution_policy.py tests/api/test_validation.py -q`

Expected: PASS; legacy nodes have no required serialized `execution` field and policy errors point to root or nested nodes.

## Task 2: Persist And Expose Run Lineage

**Files:**
- Modify: `apps/api/nodeflow_api/schemas.py`
- Modify: `apps/api/nodeflow_api/storage.py`
- Modify: `tests/api/test_storage.py`
- Modify: `tests/api/test_api_basics.py`

**Interfaces:**

```python
class RunRecord(BaseModel):
    # existing fields
    parent_run_id: str | None = None
    parent_node_id: str | None = None

def Storage.create_run(
    self,
    workflow: WorkflowDocument,
    *,
    parent_run_id: str | None = None,
    parent_node_id: str | None = None,
) -> RunRecord: ...
```

- [ ] **Step 1: Write failing storage and API tests**

```python
def test_storage_migrates_and_round_trips_run_lineage(tmp_path):
    storage = Storage(tmp_path / "legacy.sqlite3")
    storage.init_schema()
    run = storage.create_run(saved_workflow, parent_run_id="run_parent", parent_node_id="call_child")
    assert storage.get_run(run.id).parent_run_id == "run_parent"
    assert storage.get_run(run.id).parent_node_id == "call_child"

def test_run_api_serializes_empty_lineage_for_manual_run(client, saved_workflow):
    response = client.post(f"/api/workflows/{saved_workflow.id}/runs")
    assert response.json()["parent_run_id"] is None
    assert response.json()["parent_node_id"] is None
```

- [ ] **Step 2: Run focused tests to verify they fail**

Run: `pytest tests/api/test_storage.py tests/api/test_api_basics.py -q`

Expected: FAIL because `RunRecord` rejects lineage fields and `runs` has no columns.

- [ ] **Step 3: Add additive migration and round-trip fields**

```python
# storage.py inside init_schema()
for column in ("parent_run_id", "parent_node_id"):
    if column not in run_columns:
        self._connection.execute(f"ALTER TABLE runs ADD COLUMN {column} TEXT")

# storage.py in create_run()
if (parent_run_id is None) != (parent_node_id is None):
    raise ValueError("Run lineage requires both parent_run_id and parent_node_id")
```

Include both fields in the `INSERT INTO runs`, `RunRecord` construction, and all `SELECT *` deserialization. Keep the public create-run endpoint unchanged so manual executions always create `None` lineage.

- [ ] **Step 4: Run focused tests to verify they pass**

Run: `pytest tests/api/test_storage.py tests/api/test_api_basics.py -q`

Expected: PASS; an existing database migrates without data loss and manual API runs expose null lineage.

## Task 3: Make The Executor Apply Policy Per Attempt

**Files:**
- Modify: `apps/api/nodeflow_api/executor.py`
- Modify: `tests/api/test_executor.py`

**Interfaces:**

```python
async def _run_node_attempt(
    self, run_id: str, node: WorkflowNode, context: dict[str, Any], scope: list[str], inputs: dict[str, Any]
) -> tuple[dict[str, Any], list[dict[str, Any]]]: ...

async def _execute_node_with_policy(
    self, run_id: str, node: WorkflowNode, context: dict[str, Any], scope: list[str], inputs: dict[str, Any]
) -> dict[str, Any]: ...
```

- [ ] **Step 1: Extend the temporary node registry and write failing executor tests**

Add a `test.flaky` node whose class-level `attempts_by_node_id` counter raises until `config.failures_before_success` has been exceeded, plus a `test.error_capable_fail` node declaring both `success` and `error` outputs.

```python
@pytest.mark.asyncio
async def test_continue_policy_marks_failure_handled_and_allows_other_branch(tmp_path):
    await execute(workflow_with_failed_continue_branch_and_independent_log(tmp_path))
    assert run.status == "succeeded"
    assert event_types_for("fail") == ["node_started", "node_failed", "node_error_handled"]
    assert no_event_for("blocked_downstream", "node_started")
    assert has_event_for("independent_log", "node_succeeded")

@pytest.mark.asyncio
async def test_error_output_policy_routes_standard_error_object(tmp_path):
    await execute(workflow_with_error_output_handler(tmp_path))
    handled = event("fail", "node_error_handled")
    assert handled.payload["mode"] == "errorOutput"
    assert handled.payload["outputs"]["error"] == {
        "message": "boom", "type": "RuntimeError", "attempt": 1,
        "nodeId": "fail", "scope": [], "timestamp": ANY,
    }
    assert has_event_for("handler", "node_succeeded")

@pytest.mark.asyncio
async def test_retry_emits_schedule_event_then_succeeds(tmp_path):
    await execute(workflow_with_flaky_node(tmp_path, max_attempts=3, failures_before_success=1))
    assert event_types_for("flaky") == ["node_started", "node_retry_scheduled", "node_started", "node_succeeded"]
    assert event("flaky", "node_succeeded").payload["attempt"] == 2
```

Add cases for exhausted retries ending in a failed run, cancellation while patched `asyncio.sleep()` is waiting, output-validation failure entering policy, and a loop body retaining `continue_on_error` semantics.

- [ ] **Step 2: Run executor tests to verify they fail**

Run: `pytest tests/api/test_executor.py -q`

Expected: FAIL because exceptions are currently emitted directly from several special-node branches and no retry/handled events exist.

- [ ] **Step 3: Refactor to one attempt path and policy wrapper**

```python
async def _execute_node_with_policy(self, run_id, node, context, scope, inputs):
    policy = normalize_node_execution_policy(node.execution)
    started_at = time.perf_counter()
    for attempt in range(1, policy.retry.maxAttempts + 1):
        self._check_cancelled(run_id, context)
        self._event(run_id, "node_started", node_id=node.id, scope=scope, payload={"inputs": inputs, "attempt": attempt})
        try:
            outputs, logs = await self._run_node_attempt(run_id, node, context, scope, inputs)
        except WorkflowCancelled:
            raise
        except Exception as exc:
            error = node_execution_error(exc, attempt=attempt, node_id=node.id, scope=scope, timestamp=utc_now())
            if attempt < policy.retry.maxAttempts:
                self._event(run_id, "node_retry_scheduled", node_id=node.id, scope=scope,
                    payload={"error": error.model_dump(), "attempt": attempt, "next_attempt": attempt + 1, "delay_ms": policy.retry.delaySeconds * 1000})
                await self._sleep_with_cancellation(run_id, context, policy.retry.delaySeconds)
                continue
            return self._handle_node_error(run_id, node, scope, error, logs, started_at, policy)
        self._event(run_id, "node_succeeded", node_id=node.id, scope=scope,
            payload={"outputs": outputs, "logs": logs, "attempt": attempt, "duration_ms": self._duration_ms(started_at)})
        return outputs
```

Move the existing `logic.if`, `logic.set_variable`, `utility.transform`, control, test and normal-node branch logic into `_run_node_attempt()`. It must not emit lifecycle events. `_handle_node_error()` emits `node_failed` exactly once; it raises on `stop`, returns `{}` after `node_error_handled` on `continue`, and returns `{"error": error.model_dump()}` after `node_error_handled` on `errorOutput`. Never convert `WorkflowCancelled` into a policy error; the outer `execute()` timeout context remains the sole owner of workflow-level timeout status, while a node-local exception can use its configured policy.

- [ ] **Step 4: Run executor tests to verify they pass**

Run: `pytest tests/api/test_executor.py -q`

Expected: PASS; event ordering, branch routing, retry attempts, cancellation, output validation and legacy stop behavior all remain deterministic.

## Task 4: Frontend Policy Types, Normalization, And Config Editor

**Files:**
- Modify: `apps/web/src/types.ts`
- Modify: `apps/web/src/lib/workflow.ts`
- Create: `apps/web/src/lib/executionPolicy.ts`
- Create: `apps/web/src/lib/executionPolicy.test.ts`
- Modify: `apps/web/src/lib/workflow.test.ts`
- Modify: `apps/web/src/components/ConfigPanel.tsx`
- Modify: `apps/web/src/components/ConfigPanel.test.tsx`

**Interfaces:**

```ts
export type NodeErrorMode = "stop" | "continue" | "errorOutput";
export type NodeExecutionPolicy = { onError: NodeErrorMode; retry: { maxAttempts: number; delaySeconds: number } };

export function nodeExecutionPolicy(node: WorkflowNode): NodeExecutionPolicy;
export function updateNodeExecutionPolicy(node: WorkflowNode, policy: NodeExecutionPolicy): WorkflowNode;
export function policyModeLabel(mode: NodeErrorMode): string;

type ConfigPanelProps = {
  // existing props
  onExecutionPolicyChange?: (nodeId: string, policy: NodeExecutionPolicy) => void;
};
```

- [ ] **Step 1: Write the failing pure-UI and component tests**

```tsx
it("does not materialize execution for a legacy node until the policy changes", () => {
  expect(updateNodeExecutionPolicy(legacyNode, defaultNodeExecutionPolicy())).toEqual(legacyNode);
  expect(updateNodeExecutionPolicy(legacyNode, { onError: "continue", retry: { maxAttempts: 1, delaySeconds: 0 } }).execution?.onError).toBe("continue");
});

it("renders Chinese failure controls and disables error output without a port", () => {
  render(<ConfigPanel node={nodeWithoutErrorPort} nodeType={nodeTypeWithoutErrorPort} />);
  expect(screen.getByRole("radiogroup", { name: "失败处理" })).toBeInTheDocument();
  expect(screen.getByRole("radio", { name: "走错误端口" })).toBeDisabled();
  expect(screen.getByText("该节点没有 error 输出端口，不能路由执行异常。"))).toBeInTheDocument();
});
```

- [ ] **Step 2: Run focused frontend tests to verify they fail**

Run: `pnpm --filter @node-flow/web test -- src/lib/executionPolicy.test.ts src/lib/workflow.test.ts src/components/ConfigPanel.test.tsx`

Expected: FAIL because `WorkflowNode.execution` and policy controls do not exist.

- [ ] **Step 3: Add frontend types, minimal-diff helpers, and panel controls**

```ts
export const DEFAULT_NODE_EXECUTION_POLICY: NodeExecutionPolicy = {
  onError: "stop",
  retry: { maxAttempts: 1, delaySeconds: 0 },
};

export function updateNodeExecutionPolicy(node: WorkflowNode, policy: NodeExecutionPolicy): WorkflowNode {
  return policiesEqual(policy, DEFAULT_NODE_EXECUTION_POLICY)
    ? omitExecution(node)
    : { ...node, execution: policy };
}
```

Place a collapsible `fieldset` named `失败处理` below node configuration fields. Use radio inputs for the three modes and number inputs with `min/max/step` from the specification. `走错误端口` is disabled only when the node type lacks `outputs.error`; leave connection existence to the issue center because the panel does not own graph edges. Call `onExecutionPolicyChange` only with a complete normalized policy.

- [ ] **Step 4: Run focused frontend tests to verify they pass**

Run: `pnpm --filter @node-flow/web test -- src/lib/executionPolicy.test.ts src/lib/workflow.test.ts src/components/ConfigPanel.test.tsx`

Expected: PASS; default documents stay minimal, changed policies serialize, and all UI copy is Chinese.

## Task 5: Wire Policy Editing And Run Lineage Into App State

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/types.ts`

**Interfaces:**

```ts
export type RunRecord = {
  // existing fields
  parent_run_id: string | null;
  parent_node_id: string | null;
};

function updateSelectedNodeExecutionPolicy(policy: NodeExecutionPolicy): void;
function openParentRun(parentRunId: string): Promise<void>;
```

- [ ] **Step 1: Write failing App integration tests**

```tsx
it("stores a non-default node failure policy and saves it", async () => {
  render(<App />);
  selectNode("request");
  await user.click(screen.getByRole("radio", { name: "失败后继续" }));
  await user.click(screen.getByRole("button", { name: "保存工作流" }));
  expect(api.saveWorkflow).toHaveBeenCalledWith(expect.objectContaining({
    nodes: expect.arrayContaining([expect.objectContaining({ execution: expect.objectContaining({ onError: "continue" }) })]),
  }));
});

it("opens the parent run from the result drawer", async () => {
  api.getRun.mockResolvedValue(parentRun);
  api.getRunEvents.mockResolvedValue(parentEvents);
  render(<App initialRun={childRunWithParent} />);
  await user.click(screen.getByRole("button", { name: "返回父运行" }));
  expect(api.getRun).toHaveBeenCalledWith("run_parent");
});
```

- [ ] **Step 2: Run App tests to verify they fail**

Run: `pnpm --filter @node-flow/web test -- src/App.test.tsx`

Expected: FAIL because the application has neither a policy update callback nor a parent-run action.

- [ ] **Step 3: Connect existing immutable document updates and historical-run loader**

```ts
function updateSelectedNodeExecutionPolicy(policy: NodeExecutionPolicy) {
  if (!selectedNodeId) return;
  setWorkflow((current) => updateWorkflowNode(current, selectedNodeId, (node) => updateNodeExecutionPolicy(node, policy)));
}

async function openParentRun(parentRunId: string) {
  const [parentRun, parentEvents] = await Promise.all([api.getRun(parentRunId), api.getRunEvents(parentRunId)]);
  setRunView(historicalRunView(parentRun, parentEvents));
}
```

Pass the callback to `ConfigPanel` and the parent-navigation callback through `RunDrawer`/`RunPanel`. Reuse existing error display and stale-request guards used for historical runs; do not add a second polling loop.

- [ ] **Step 4: Run App tests to verify they pass**

Run: `pnpm --filter @node-flow/web test -- src/App.test.tsx`

Expected: PASS; policy changes survive save and parent runs use the established historical-run flow.

## Task 6: Expose Retries And Handled Errors In Runtime Views

**Files:**
- Modify: `apps/web/src/lib/executionData.ts`
- Modify: `apps/web/src/lib/runState.ts`
- Modify: `apps/web/src/lib/runtimeDisplay.ts`
- Modify: `apps/web/src/lib/canvasNodeRuntimeSummary.ts`
- Modify: `apps/web/src/components/NodeRuntimePanel.tsx`
- Modify: `apps/web/src/components/RunPanel.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: corresponding `*.test.ts` files for each module/component

**Interfaces:**

```ts
export type NodeRunStatus = "pending" | "running" | "succeeded" | "failed" | "handled" | "skipped" | "cancelled";

export type NodeRuntimeEvent = {
  type: string;
  timestamp: string;
  scope: string[];
  attempt?: number;
  nextAttempt?: number;
  delayMs?: number;
  mode?: NodeErrorMode;
  // existing diagnostic fields
};
```

- [ ] **Step 1: Write failing runtime state and UI tests**

```ts
it("marks the node handled after a final node_error_handled event", () => {
  const state = buildNodeRunStates([node], [started(1), failed(1), handled("continue")]).node;
  expect(state.status).toBe("handled");
  expect(state.executions?.[0].attemptCount).toBe(1);
});

it("shows retries and a handled failure without pretending it succeeded", () => {
  render(<NodeRuntimePanel nodeTypeId="test.fail" runtimeState={retryHandledState} />);
  expect(screen.getByText("失败已处理")).toBeInTheDocument();
  expect(screen.getByText("第 2 次尝试")).toBeInTheDocument();
  expect(screen.getByText("等待重试")).toBeInTheDocument();
});
```

Add a RunPanel test that a `RunRecord` with `parent_run_id` renders only one `返回父运行` control and invokes its callback; verify no control is shown for manual runs.

- [ ] **Step 2: Run focused runtime tests to verify they fail**

Run: `pnpm --filter @node-flow/web test -- src/lib/executionData.test.ts src/lib/runState.test.ts src/lib/runtimeDisplay.test.ts src/lib/canvasNodeRuntimeSummary.test.ts src/components/NodeRuntimePanel.test.tsx src/components/RunPanel.test.tsx`

Expected: FAIL because retry/handled event payloads and lineage controls are ignored.

- [ ] **Step 3: Consume lifecycle payloads and render compact diagnostics**

```ts
case "node_error_handled":
  execution.status = "handled";
  execution.error = event.payload.error;
  break;
case "node_retry_scheduled":
  execution.events.push(event);
  break;
```

Expose `attempt`, `next_attempt`, `delay_ms`, and `mode` through normalized runtime events. Add Chinese labels `失败已处理` and `等待重试`; use a dedicated `status-handled` class with restrained orange border/text, not a success color. Canvas summaries should count handled failures as errors while retaining the nonterminal status. In `RunPanel`, render `返回父运行` beside historical context only when `parent_run_id` and the callback exist.

- [ ] **Step 4: Run focused runtime tests to verify they pass**

Run: `pnpm --filter @node-flow/web test -- src/lib/executionData.test.ts src/lib/runState.test.ts src/lib/runtimeDisplay.test.ts src/lib/canvasNodeRuntimeSummary.test.ts src/components/NodeRuntimePanel.test.tsx src/components/RunPanel.test.tsx`

Expected: PASS; retries are searchable and visible, handled failures remain distinguishable, and parent navigation is conditional.

## Task 7: Documentation, Full Verification, And Browser Smoke

**Files:**
- Modify: `README.md`
- Modify only if validation exposes a defect: `apps/api/nodeflow_api/**`, `apps/web/src/**`, tests.

- [ ] **Step 1: Add concise author and user documentation**

Document the policy table, retry limits, `errorOutput` port/connection requirement, standard error payload, and the fact that lineage fields are persisted now but actual sub-workflow execution is the next phase. Keep Python author guidance explicit:

```python
async def execute(self, ctx: NodeContext, inputs: dict) -> dict[str, Any]:
    # Return declared business outputs; raise exceptions for execution failures.
    response = await call_service(inputs)
    return {"success": response}
```

- [ ] **Step 2: Run backend and frontend suites**

Run: `pytest tests/api -q`

Expected: PASS; no unexpected test failures. The existing Starlette/TestClient deprecation warning may remain.

Run: `pnpm --filter @node-flow/web test`

Expected: PASS; existing and new Vitest files pass.

- [ ] **Step 3: Run production build and whitespace checks**

Run: `pnpm build:web`

Expected: PASS. Record the existing chunk-size warning if the main bundle remains above Vite's 500 kB warning threshold.

Run: `git diff --check`

Expected: exit code `0`. Do not stage or commit any files.

- [ ] **Step 4: Browser smoke test the four user paths**

Start the existing development services on web port `5273` and API port `8150` only if they are not already running. In the browser, verify:

1. A legacy node shows `失败即停止` and does not acquire an `execution` field until changed.
2. A node with an `error` output can select `走错误端口`; remove that edge and confirm the issue center blocks the run with a Chinese explanation.
3. A configured retry produces `等待重试` and `第 N 次尝试` in node runtime details; a handled failure uses the orange `失败已处理` state while the run can succeed.
4. A run record seeded with parent lineage shows `返回父运行`, and opening it switches to the existing historical run view.

## Self-Review

- Spec coverage: Task 1 implements default policy, validation, and standard error data; Task 2 implements lineage storage/API; Task 3 implements unified executor policy; Task 4 and Task 5 implement editable policy and data wiring; Task 6 implements runtime observation and lineage navigation; Task 7 documents and verifies all specified behavior.
- Placeholder scan: every task names exact files, interfaces, test commands, expected results, and implementation behavior. The plan contains no deferred implementation markers.
- Type consistency: `NodeExecutionPolicy`, `RetryPolicy`, `NodeExecutionError`, `parent_run_id`, `parent_node_id`, `node_retry_scheduled`, and `node_error_handled` keep the same spelling across backend, frontend, events, tests, and UI.

## Completion Record (2026-07-17)

- Completed policy defaults, nested validation, error-object serialization, additive run-lineage storage, retries, cooperative cancellation compatibility, and workflow timeout compatibility.
- Added the Chinese policy editor, runtime attempts/retry diagnostics, handled-error status, lineage entry point, and compact product styles.
- Preserved legacy workflow documents by omitting default policy fields. The node-upgrade preview also omits an absent `execution` field without hiding meaningful migration `null` values.
- Verified with `pytest tests/api -q` (175 passed), `pnpm --filter @node-flow/web test` (480 passed), `pnpm build:web`, `git diff --check`, and a local-browser smoke test on `http://127.0.0.1:5273/`.
- The Vite build retains its existing size warning: the main JavaScript bundle is 529.43 kB after minification. Actual child-run creation remains intentionally deferred until an Execute Workflow node is added.
