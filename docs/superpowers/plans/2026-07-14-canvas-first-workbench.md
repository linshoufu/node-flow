# Canvas-First Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the editor a canvas-first workbench with a compact, deterministic run-results drawer, a contextual workflow entry, and automatic viewport fitting after loading a workflow.

**Architecture:** Keep `App.tsx` as the owner of workflow/run state. Put drawer transition rules in a pure frontend module, wrap the existing `RunPanel` in a focused presentation component, and extend `FlowCanvas` with a one-way fit request key. No workflow document, API, executor, or Python node contract changes are allowed.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, React Flow (`@xyflow/react`), Vite.

## Global Constraints

- All user-facing copy is Chinese; source identifiers remain English.
- Preserve workflow JSON, API payloads, executor behavior, port contracts, and existing run-event shapes.
- The drawer state is local UI state and must not be saved in `WorkflowDocument.settings`.
- Desktop remains a three-column editor with the canvas taking remaining height; mobile remains a vertical layout.
- Do not add panel resizing, persisted panel dimensions, authentication, triggers, credentials, or marketplace features.
- Do not create a git commit in this phase: the active worktree contains unrelated uncommitted work from earlier stages.

---

## File Structure

- Create `apps/web/src/lib/workbenchLayout.ts`: pure drawer reducer and summary model.
- Create `apps/web/src/lib/workbenchLayout.test.ts`: reducer and summary regression tests.
- Create `apps/web/src/components/RunDrawer.tsx`: accessible compact/expanded drawer that renders existing run content as children.
- Create `apps/web/src/components/RunDrawer.test.tsx`: drawer interaction and Chinese copy tests.
- Modify `apps/web/src/App.tsx`: own drawer state and `fitRequestKey`, pass contextual data to components.
- Modify `apps/web/src/App.test.tsx`: integration coverage for run drawer and workflow/template fit requests.
- Modify `apps/web/src/components/FlowCanvas.tsx`: consume `fitRequestKey` and fit after the next rendered frame.
- Modify `apps/web/src/components/FlowCanvas.test.tsx`: assert fitting occurs only for explicit requests.
- Modify `apps/web/src/components/WorkflowManager.tsx`: render current-workflow context in the trigger.
- Modify `apps/web/src/components/WorkflowManager.test.tsx`: assert contextual trigger labels.
- Modify `apps/web/src/components/ConfigPanel.tsx`: mark the unselected state for compact styling.
- Modify `apps/web/src/styles.css`: canvas-first grid, drawer, compact inspector, and responsive styles.

## Task 1: Deterministic Run Drawer State

**Files:**
- Create: `apps/web/src/lib/workbenchLayout.ts`
- Create: `apps/web/src/lib/workbenchLayout.test.ts`

**Interfaces:**

```ts
export type RunDrawerState = { expanded: boolean; manuallyPinned: boolean };
export type RunDrawerEvent =
  | { type: "toggle" }
  | { type: "run-updated"; status: RunStatus | null; hasError: boolean }
  | { type: "reset" };

export function reduceRunDrawer(state: RunDrawerState, event: RunDrawerEvent): RunDrawerState;
export function runDrawerSummary(run: RunRecord | null): { statusLabel: string; detail: string };
```

- [ ] **Step 1: Write failing reducer tests**

Create tests that specify the complete state transition contract:

```ts
it("opens for a new queued run until the user chooses a state", () => {
  expect(reduceRunDrawer({ expanded: false, manuallyPinned: false }, {
    type: "run-updated", status: "queued", hasError: false,
  })).toEqual({ expanded: true, manuallyPinned: false });
});

it("does not reopen a manually collapsed running drawer", () => {
  const collapsed = reduceRunDrawer({ expanded: true, manuallyPinned: false }, { type: "toggle" });
  expect(reduceRunDrawer(collapsed, { type: "run-updated", status: "running", hasError: false })).toEqual(collapsed);
});

it("opens for failures and resets when another workflow is selected", () => {
  expect(reduceRunDrawer({ expanded: false, manuallyPinned: false }, {
    type: "run-updated", status: "failed", hasError: false,
  })).toEqual({ expanded: true, manuallyPinned: false });
  expect(reduceRunDrawer({ expanded: true, manuallyPinned: true }, { type: "reset" })).toEqual({
    expanded: false,
    manuallyPinned: false,
  });
});
```

- [ ] **Step 2: Run the new test to prove it is red**

Run: `pnpm --filter @node-flow/web test -- src/lib/workbenchLayout.test.ts`

Expected: Vitest fails because `workbenchLayout.ts` does not exist.

- [ ] **Step 3: Implement the pure state module**

Create `workbenchLayout.ts` with a reducer that only auto-opens when `manuallyPinned` is false. Treat `queued`, `running`, `failed`, `cancelled`, and `hasError` as conditions that open the drawer. `toggle` flips `expanded` and sets `manuallyPinned: true`; `reset` returns `{ expanded: false, manuallyPinned: false }`.

Use the existing `translateRunStatus` helper for `statusLabel`. For an idle run return `{ statusLabel: "空闲", detail: "暂无运行结果" }`; for a non-idle run return its Chinese status and `运行 ID：${run.id}`.

- [ ] **Step 4: Run the focused test to prove it is green**

Run: `pnpm --filter @node-flow/web test -- src/lib/workbenchLayout.test.ts`

Expected: all reducer and summary tests pass.

## Task 2: Accessible Drawer Container

**Files:**
- Create: `apps/web/src/components/RunDrawer.tsx`
- Create: `apps/web/src/components/RunDrawer.test.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**

```tsx
type RunDrawerProps = {
  expanded: boolean;
  summary: { statusLabel: string; detail: string };
  onToggle: () => void;
  children: ReactNode;
};
```

- [ ] **Step 1: Write the failing component tests**

Render the drawer with `expanded={false}` and assert the child run content is absent, the summary includes `空闲` and `暂无运行结果`, and the only control is a button named `展开运行结果`. Click it and assert `onToggle` was called. Render again with `expanded={true}` and assert a button named `收起运行结果` plus its child content are present.

- [ ] **Step 2: Run the component test to prove it is red**

Run: `pnpm --filter @node-flow/web test -- src/components/RunDrawer.test.tsx`

Expected: Vitest fails because `RunDrawer` does not exist.

- [ ] **Step 3: Implement the drawer**

Create a semantic section:

```tsx
export function RunDrawer({ expanded, summary, onToggle, children }: RunDrawerProps) {
  return (
    <section aria-label="运行结果抽屉" className={expanded ? "run-drawer is-expanded" : "run-drawer"}>
      <button aria-expanded={expanded} className="run-drawer-summary" type="button" onClick={onToggle}>
        <span className="run-drawer-title">运行结果</span>
        <span className="run-drawer-status">{summary.statusLabel}</span>
        <span className="run-drawer-detail">{summary.detail}</span>
        <span aria-hidden="true">{expanded ? "⌄" : "⌃"}</span>
      </button>
      {expanded ? <div className="run-drawer-content">{children}</div> : null}
    </section>
  );
}
```

Add styles that give the summary a fixed minimum height, preserve long IDs with ellipsis, use a border rather than a floating card, and cap expanded height with `minmax(260px, 38vh)`. The child `RunPanel` must fill the drawer without adding a second outer border.

- [ ] **Step 4: Run the focused tests to prove they are green**

Run: `pnpm --filter @node-flow/web test -- src/components/RunDrawer.test.tsx src/lib/workbenchLayout.test.ts`

Expected: both test files pass.

## Task 3: Explicit Canvas Fit Requests

**Files:**
- Modify: `apps/web/src/components/FlowCanvas.tsx`
- Modify: `apps/web/src/components/FlowCanvas.test.tsx`

**Interfaces:**

```ts
type FlowCanvasProps = {
  // existing props
  fitRequestKey?: number;
};
```

- [ ] **Step 1: Write failing FlowCanvas tests**

Extend the React Flow mock to expose `fitView`. Render with `fitRequestKey={1}`, flush one animation frame, and expect `fitView` to be called once. Rerender with node-position changes but the same key and expect no additional call. Rerender with `fitRequestKey={2}` and expect a second call. Also assert a zero-node workflow never calls `fitView`.

- [ ] **Step 2: Run the focused test to prove it is red**

Run: `pnpm --filter @node-flow/web test -- src/components/FlowCanvas.test.tsx`

Expected: the new assertions fail because the prop is ignored.

- [ ] **Step 3: Implement fitting after render**

Accept `fitRequestKey = 0` in `FlowCanvasInner` and add an effect after editor nodes are derived:

```ts
useEffect(() => {
  if (fitRequestKey === 0 || nodes.length === 0 || typeof window === "undefined") return;
  const frame = window.requestAnimationFrame(() => fitView({ padding: 0.16, duration: 180 }));
  return () => window.cancelAnimationFrame(frame);
}, [fitRequestKey, fitView, nodes.length]);
```

Keep the existing manual `适应画布` control unchanged. Do not call fitting for ordinary edits because their request key remains stable.

- [ ] **Step 4: Run the focused test to prove it is green**

Run: `pnpm --filter @node-flow/web test -- src/components/FlowCanvas.test.tsx`

Expected: FlowCanvas tests pass, including existing drag/connection coverage.

## Task 4: App Integration and Workflow Context

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/components/WorkflowManager.tsx`
- Modify: `apps/web/src/components/WorkflowManager.test.tsx`

**Interfaces:**

```ts
type WorkflowManagerProps = {
  // existing props
  currentWorkflowName: string;
  currentWorkflowSaved: boolean;
};
```

- [ ] **Step 1: Write failing integration tests**

Add App tests that:

1. Save a workflow named `发布检查`, then assert the manager trigger is named `发布检查，工作流 1`.
2. Load a saved workflow and assert the mock FlowCanvas receives a larger `fitRequestKey` than before loading.
3. Apply a template and assert the mock FlowCanvas receives a larger `fitRequestKey`.
4. Start a run and assert the `运行结果抽屉` is expanded.
5. Collapse the drawer during a running test response, return another `running` poll response, and assert it remains collapsed.
6. Switch to a new workflow and assert the drawer summary returns to `暂无运行结果`.

Add a WorkflowManager component test that renders `currentWorkflowName="发布检查"`, `currentWorkflowSaved`, and checks the trigger accessible name exactly. Add a draft test that expects `工作流 2` rather than a draft name.

- [ ] **Step 2: Run the focused tests to prove they are red**

Run: `pnpm --filter @node-flow/web test -- src/App.test.tsx src/components/WorkflowManager.test.tsx`

Expected: the new context and drawer assertions fail.

- [ ] **Step 3: Integrate state in App**

Add `fitRequestKey` and `runDrawerState` state to `App`. Create helpers:

```ts
function resetWorkbenchView() {
  setRunDrawerState(reduceRunDrawer(currentRunDrawerState, { type: "reset" }));
}

function requestCanvasFit() {
  setFitRequestKey((key) => key + 1);
}
```

Call both in `startNewWorkflow`, `applyTemplate`, and `loadWorkflow`; call only `requestCanvasFit` after opening a root scope. After every `setRunView` that receives a new run record, dispatch `run-updated` using the record status and error. Pass the computed summary and toggle handler into `RunDrawer`, with `RunPanel` as its child. Pass `fitRequestKey` to `FlowCanvas`.

Pass `workflow.name`, `Boolean(selectedWorkflowId)`, and `workflows.length` into `WorkflowManager`. The manager trigger must format saved workflows as `${currentWorkflowName}，工作流 ${workflows.length}` and otherwise format as `工作流 ${workflows.length}`.

- [ ] **Step 4: Run focused integration tests to prove they are green**

Run: `pnpm --filter @node-flow/web test -- src/App.test.tsx src/components/WorkflowManager.test.tsx src/components/RunDrawer.test.tsx`

Expected: all selected App, manager, and drawer tests pass.

## Task 5: Canvas-First CSS and Compact Empty Inspector

**Files:**
- Modify: `apps/web/src/components/ConfigPanel.tsx`
- Modify: `apps/web/src/components/ConfigPanel.test.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Write failing ConfigPanel test**

Render `ConfigPanel` without a node and assert that the panel root has `data-empty="true"`; render with a node and assert `data-empty="false"`. Preserve the existing empty-state Chinese text assertion.

- [ ] **Step 2: Run the focused test to prove it is red**

Run: `pnpm --filter @node-flow/web test -- src/components/ConfigPanel.test.tsx`

Expected: the new data-attribute assertions fail.

- [ ] **Step 3: Implement minimal inspector marker and styles**

Set `data-empty={!node}` on the existing config panel root. Add desktop CSS that changes `.workspace-grid` to a single main row, places the drawer after it, lets `.canvas-shell` consume residual height, and prevents the drawer from forcing the canvas below a useful minimum. Use `.config-panel[data-empty="true"]` to reduce the empty panel heading height and hide only nonessential empty-state copy; do not change its fixed grid width.

At `max-width: 960px`, retain the existing one-column order and make `.run-drawer` part of the normal document flow. At `max-width: 520px`, allow the summary’s detail to wrap while preserving the toggle control.

- [ ] **Step 4: Run focused tests to prove they are green**

Run: `pnpm --filter @node-flow/web test -- src/components/ConfigPanel.test.tsx src/components/RunDrawer.test.tsx`

Expected: all focused tests pass.

## Task 6: Full Verification and Browser Smoke

**Files:**
- Modify only if the following verification exposes a defect.

- [ ] **Step 1: Run frontend suite**

Run: `pnpm --filter @node-flow/web test`

Expected: all Vitest files pass.

- [ ] **Step 2: Run production build**

Run: `pnpm build:web`

Expected: TypeScript and Vite build exit with code 0. Record any chunk-size warning without treating it as a failure.

- [ ] **Step 3: Run backend regression suite**

Run: `pytest tests/api -q`

Expected: all API tests pass; only the known TestClient deprecation warning may remain.

- [ ] **Step 4: Browser smoke on desktop and narrow viewport**

Open `http://127.0.0.1:5273/` and verify:

1. Empty workflow shows the run drawer summary instead of a permanent large run panel.
2. Apply `单接口状态码断言`; all nodes are visible after automatic fitting.
3. Expand and collapse `运行结果抽屉`; selected run-panel tab remains after reopening.
4. Load another workflow; the drawer resets to the idle summary and the canvas fits the loaded graph.
5. Use a narrow viewport; node library, canvas, inspector, and drawer remain vertically ordered with no overlapping text.

- [ ] **Step 5: Check scope and whitespace**

Run: `git diff --check`

Expected: exit code 0. Do not stage or commit because the worktree includes unrelated pending changes.

## Self-Review

- Spec coverage: Task 1 and Task 2 implement the drawer state and presentation; Task 3 implements automatic fitting; Task 4 implements workflow context and application wiring; Task 5 implements canvas-first and responsive layout; Task 6 verifies desktop and mobile behavior.
- Placeholder scan: the plan contains no unresolved markers and every behavior has named files, interfaces, commands, and assertions.
- Type consistency: `RunDrawerState`, `reduceRunDrawer`, `fitRequestKey`, `RunDrawer`, `currentWorkflowName`, and `currentWorkflowSaved` use the same names across all tasks.
