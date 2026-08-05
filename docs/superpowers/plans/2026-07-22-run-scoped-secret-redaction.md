# Run-Scoped Secret Redaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep decrypted credential values only in the active root workflow execution and prevent one concurrent or later run from changing another run's redaction behavior.

**Architecture:** Introduce a mutable `SecretRedactionScope` carried by `ExecutionContext`. Every root call to `WorkflowExecutor.execute` creates one scope; child workflow executions explicitly reuse that same scope. An async `ContextVar` exposes the scope to event redaction and `NodeContext.register_secret`, then is reset in a `finally` block when the execution returns.

**Tech Stack:** Python 3.11, asyncio, `contextvars`, FastAPI execution engine, pytest.

## Global Constraints

- Keep `NODE_FLOW_SECRET_*` environment variable redaction unchanged.
- Keep secret values out of workflow JSON, API responses, run records and run events.
- Do not retain local credential values on `WorkflowExecutor` instance state after a root execution completes.
- Nested child workflow calls must preserve parent-run redaction for returned child outputs.
- Do not stage, commit, or revert existing worktree changes.

---

### Task 1: Run-Scoped Redaction Context

**Files:**
- Modify: `apps/api/nodeflow_api/executor.py:31-132, 689-710, 1094-1156`
- Test: `tests/api/test_executor.py`

**Interfaces:**
- Produces `SecretRedactionScope(values: set[str])` with `register(value: str) -> None`.
- Extends `ExecutionContext` with `redaction_scope: SecretRedactionScope` using `field(default_factory=SecretRedactionScope)`.
- Uses `_active_redaction_scope: ContextVar[SecretRedactionScope | None]` during `WorkflowExecutor.execute`.
- Keeps `WorkflowExecutor._register_credential_secret(value: str) -> None` as the callback passed into `NodeContext`.

- [x] **Step 1: Write a failing lifetime-isolation test**

Add a test after `test_executor_injects_credential_headers_without_exposing_secret_in_events` that executes two workflows with the same `WorkflowExecutor`: the first uses a Bearer credential with `first-run-secret`; the second has no credential and returns `first-run-secret` from a mocked HTTP response. Assert the first run event contains `***` and the second run event retains `first-run-secret`.

```python
assert "first-run-secret" not in first_run_events
assert "first-run-secret" in second_run_events
```

- [x] **Step 2: Run the test to verify the existing executor fails**

Run: `pytest tests/api/test_executor.py::test_executor_does_not_retain_credential_secrets_after_a_run -q`

Expected: FAIL because `_credential_secret_values` redacts the unrelated second run.

- [x] **Step 3: Replace executor-owned secret accumulation with a scoped context**

In `apps/api/nodeflow_api/executor.py`, add these definitions beside `_active_node_attempt`:

```python
@dataclass
class SecretRedactionScope:
    values: set[str] = field(default_factory=set)

    def register(self, value: str) -> None:
        if value:
            self.values.add(value)


_active_redaction_scope: ContextVar[SecretRedactionScope | None] = ContextVar(
    "active_redaction_scope", default=None
)
```

Add `redaction_scope: SecretRedactionScope = field(default_factory=SecretRedactionScope)` to `ExecutionContext`. At the start of `execute`, set the context variable from `execution_context.redaction_scope`; wrap all status changes, execution, returns, and exception handling in `try/finally`, resetting the token in `finally`. Remove `self._credential_secret_values`. Make `_register_credential_secret` call `scope.register(value)` only when the active scope exists. Make `_redact` read `scope.values` from the context variable alongside `self.secrets.values()`.

- [x] **Step 4: Run the targeted redaction tests**

Run: `pytest tests/api/test_executor.py -k "credential or redact" -q`

Expected: PASS.

### Task 2: Child and Concurrent Execution Boundaries

**Files:**
- Modify: `apps/api/nodeflow_api/executor.py:748-759`
- Test: `tests/api/test_executor.py`

**Interfaces:**
- Consumes `ExecutionContext.redaction_scope` from Task 1.
- Child `ExecutionContext(...)` receives `redaction_scope=execution_context.redaction_scope`.
- Produces isolation between separate `asyncio.gather` root executions on one `WorkflowExecutor`.

- [x] **Step 1: Write failing child-workflow and concurrent-run tests**

Extend the child workflow test with a child HTTP node using a Bearer credential and assert that the parent `child_run_succeeded` event redacts the child secret. Add a second test that starts two root HTTP workflows with `asyncio.gather`, uses two different credential secrets, and has each mocked response echo the other workflow's secret. Assert each run redacts only its own credential value.

```python
assert "child-secret" not in str(parent_event.payload)
assert "second-secret" in str(first_run_events)
assert "first-secret" in str(second_run_events)
```

- [x] **Step 2: Run the two tests to verify the boundary failure**

Run: `pytest tests/api/test_executor.py -k "child and credential or concurrent and credential" -q`

Expected: The child assertion or concurrency-isolation assertion fails before the child context shares the parent scope.

- [x] **Step 3: Propagate the current redaction scope to child executions**

In the `child_context = ExecutionContext(...)` construction inside `_execute_workflow_node`, add:

```python
redaction_scope=execution_context.redaction_scope,
```

Do not pass scopes through global variables or `WorkflowExecutor` fields; the explicit `ExecutionContext` link documents the lineage and keeps concurrent root runs isolated.

- [x] **Step 4: Run the executor suite and full API regression**

Run: `pytest tests/api/test_executor.py -q`

Expected: PASS.

Run: `pytest tests/api -q`

Expected: PASS.

### Task 3: Document and Verify the Security Boundary

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-07-22-run-scoped-secret-redaction.md`

- [x] **Step 1: Document the execution boundary**

Add one paragraph under the local credential vault section stating that decrypted fields are held only while the current root execution and its synchronous child workflows run; they are discarded from the executor context afterward. Keep the existing DPAPI and non-export guarantees unchanged.

- [x] **Step 2: Mark completed plan steps**

Change each completed checkbox in this plan from `- [ ]` to `- [x]`, leaving the instructional header unchanged.

- [x] **Step 3: Run complete verification**

Run: `pytest tests/api -q`

Expected: PASS.

Run: `pnpm --filter @node-flow/web test`

Expected: PASS.

Run: `pnpm build:web`

Expected: PASS.

Run: `git diff --check`

Expected: exit code 0.
