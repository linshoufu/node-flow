# Testing Workflow Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the sixth-phase testing workflow closure: pre-run configuration checks, template guidance, report filtering/location, and clearer CSV runtime details.

**Architecture:** Keep the checks and report behavior in focused frontend modules. `preRunChecks.ts` owns deterministic workflow validation, `PreRunIssueList.tsx` renders actionable issues, `App.tsx` orchestrates blocking run creation and node selection, while `TestReportView` and `ConfigPanel` receive small targeted enhancements.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, React Flow, existing FastAPI backend tests for regression safety.

---

## Current Implementation Reconciliation

Status as of 2026-07-03:

- Task 1 is implemented with broader coverage than the original plan. `buildPreRunIssues(workflow, nodeTypes)` now checks common test-node configuration, nested subflows, invalid connections, required input ports, and schema-level field issues.
- Task 2 is implemented through the unified `WorkflowIssuePanel` / `WorkflowIssueList` problem center. `PreRunIssueList` remains as a compatibility wrapper, but App intentionally renders the unified issue panel instead of a separate pre-run-only list.
- Task 3 is implemented. Test report cases can be filtered by status and clicked to open node runtime details through the shared runtime-navigation target.
- Task 4 is implemented. CSV and loop guidance is shown in the config panel, while CSV/ForEach runtime summaries live in `runtimeDisplay.ts` and are rendered by `NodeRuntimePanel`.
- The original status-code assertion pre-run design has been reconciled with the current backend node model: `assert.status_code.actual` is not a config field. The actual status code comes from the required `input` port, and `expected` defaults to `200`.
- The single-API template now includes a local smoke URL (`http://127.0.0.1:8150/api/health`). Browser smoke should clear that URL before verifying the missing-URL pre-run issue.
- Verification evidence from this pass:
  - `pnpm --filter @node-flow/web test -- src/lib/preRunChecks.test.ts src/components/PreRunIssueList.test.tsx src/components/WorkflowIssuePanel.test.tsx src/components/TestReportView.test.tsx src/components/RunPanel.test.tsx src/components/ConfigPanel.test.tsx src/lib/runtimeDisplay.test.ts`: 7 files / 100 tests passed.
  - `pytest tests/api -q`: 139 tests passed, 1 external deprecation warning.
  - Browser smoke on `http://127.0.0.1:5273/`: applying the single API template selects HTTP Request; clearing URL via keyboard and clicking Run shows the Chinese pre-run issue and does not enter the running state.

The detailed checkbox plan below is preserved as the original implementation script. Some commit-only steps remain unchecked because this workspace currently contains multiple uncommitted phase changes and this pass did not create commits.

---

## File Structure

- Create `apps/web/src/lib/preRunChecks.ts`
  - Pure functions for test-workflow-specific pre-run issues.
- Create `apps/web/src/lib/preRunChecks.test.ts`
  - Unit tests for each supported node type and complete configuration.
- Create `apps/web/src/components/PreRunIssueList.tsx`
  - Actionable Chinese issue list.
- Create `apps/web/src/components/PreRunIssueList.test.tsx`
  - Rendering and click-to-select tests.
- Modify `apps/web/src/App.tsx`
  - Run pre-checks before save/run.
  - Store pre-run issues.
  - Select first actionable template node after applying templates.
  - Pass case-click behavior into `RunPanel`.
- Modify `apps/web/src/App.test.tsx`
  - Integration tests for blocking run, issue click, and template auto-selection.
- Modify `apps/web/src/components/RunPanel.tsx`
  - Pass `onSelectNode` through to `TestReportView`.
- Modify `apps/web/src/components/RunPanel.test.tsx`
  - Verify report case click selects source node.
- Modify `apps/web/src/components/TestReportView.tsx`
  - Add status filters and clickable case rows.
- Modify `apps/web/src/components/TestReportView.test.tsx`
  - Filter, source node click, failed/unknown visibility tests.
- Modify `apps/web/src/components/ConfigPanel.tsx`
  - Add CSV/ForEach guidance and runtime summaries.
- Modify `apps/web/src/components/ConfigPanel.test.tsx`
  - Guidance and runtime summary tests.
- Modify `apps/web/src/styles.css`
  - Local styles for issue list, report filters, clickable cases, runtime summaries.
- Modify `README.md`
  - Add minimal CSV example and phase-six usage notes.

---

### Task 1: Pre-Run Check Library

**Files:**
- Create: `apps/web/src/lib/preRunChecks.ts`
- Create: `apps/web/src/lib/preRunChecks.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests covering missing and complete configuration:

```ts
import { describe, expect, it } from "vitest";
import type { WorkflowDocument } from "../types";
import { buildPreRunIssues } from "./preRunChecks";

describe("buildPreRunIssues", () => {
  it("reports missing HTTP request URL", () => {
    const workflow = workflowWithNode("request", "http.request", { method: "GET", url: "" });

    expect(buildPreRunIssues(workflow)).toEqual([
      expect.objectContaining({
        nodeId: "request",
        nodeType: "http.request",
        severity: "error",
        title: "HTTP 请求配置不完整",
        message: "HTTP 请求缺少 URL。",
        field: "url",
      }),
    ]);
  });

  it("reports missing CSV file path", () => {
    const workflow = workflowWithNode("csv", "data.csv_read", { path: "" });

    expect(buildPreRunIssues(workflow)).toEqual([
      expect.objectContaining({
        nodeId: "csv",
        nodeType: "data.csv_read",
        message: "读取 CSV 缺少文件路径。",
        field: "path",
      }),
    ]);
  });

  it("reports missing status code assertion inputs", () => {
    const workflow = workflowWithNode("assert_status", "assert.status_code", { actual: "", expected: "" });

    expect(buildPreRunIssues(workflow).map((issue) => issue.message)).toEqual([
      "状态码断言缺少实际状态码来源。",
      "状态码断言缺少期望状态码。",
    ]);
  });

  it("reports missing report output path", () => {
    const workflow = workflowWithNode("write_report", "test.write_report", { path: "" });

    expect(buildPreRunIssues(workflow)[0]).toMatchObject({
      nodeId: "write_report",
      message: "写入测试报告缺少输出路径。",
      field: "path",
    });
  });

  it("reports missing foreach items expression", () => {
    const workflow = workflowWithNode("each", "control.foreach", { items_expression: "" });

    expect(buildPreRunIssues(workflow)[0]).toMatchObject({
      nodeId: "each",
      message: "遍历循环缺少循环数据来源。",
      field: "items_expression",
    });
  });

  it("returns no blocking issues when supported nodes are configured", () => {
    const workflow: WorkflowDocument = {
      id: "wf",
      name: "Configured",
      version: 1,
      nodes: [
        node("request", "http.request", { method: "GET", url: "https://example.test" }),
        node("csv", "data.csv_read", { path: "data/users.csv" }),
        node("assert_status", "assert.status_code", {
          actual: "{{ nodes.request.outputs.success.status_code }}",
          expected: 200,
        }),
        node("write_report", "test.write_report", { path: "reports/out.json" }),
        node("each", "control.foreach", { items_expression: "{{ nodes.csv.outputs.success.rows }}" }),
      ],
      edges: [],
    };

    expect(buildPreRunIssues(workflow)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
pnpm --filter @node-flow/web test -- lib/preRunChecks.test.ts
```

Expected: fails because `preRunChecks.ts` does not exist.

- [ ] **Step 3: Implement `preRunChecks.ts`**

Create:

```ts
import type { WorkflowDocument, WorkflowNode } from "../types";

export type PreRunIssueSeverity = "error" | "warning";

export type PreRunIssue = {
  id: string;
  nodeId: string;
  nodeType: string;
  severity: PreRunIssueSeverity;
  title: string;
  message: string;
  field?: string;
};

export function buildPreRunIssues(workflow: WorkflowDocument): PreRunIssue[] {
  return workflow.nodes.flatMap((node) => issuesForNode(node));
}

function issuesForNode(node: WorkflowNode): PreRunIssue[] {
  switch (node.type) {
    case "http.request":
      return [
        requiredIssue(node, "method", "HTTP 请求配置不完整", "HTTP 请求缺少请求方法。"),
        requiredIssue(node, "url", "HTTP 请求配置不完整", "HTTP 请求缺少 URL。"),
      ].filter(Boolean) as PreRunIssue[];
    case "data.csv_read":
      return [requiredIssue(node, "path", "CSV 读取配置不完整", "读取 CSV 缺少文件路径。")].filter(
        Boolean
      ) as PreRunIssue[];
    case "assert.status_code":
      return [
        requiredAnyIssue(node, ["actual", "actual_expression", "status_code", "status_expression"], "状态码断言配置不完整", "状态码断言缺少实际状态码来源。", "actual"),
        requiredIssue(node, "expected", "状态码断言配置不完整", "状态码断言缺少期望状态码。"),
      ].filter(Boolean) as PreRunIssue[];
    case "test.write_report":
      return [requiredIssue(node, "path", "测试报告配置不完整", "写入测试报告缺少输出路径。")].filter(
        Boolean
      ) as PreRunIssue[];
    case "control.foreach":
      return [
        requiredIssue(node, "items_expression", "遍历循环配置不完整", "遍历循环缺少循环数据来源。"),
      ].filter(Boolean) as PreRunIssue[];
    default:
      return [];
  }
}
```

Use small helper functions:

```ts
function requiredIssue(node: WorkflowNode, field: string, title: string, message: string): PreRunIssue | null {
  return isBlank(node.config[field]) ? issue(node, field, title, message) : null;
}

function requiredAnyIssue(
  node: WorkflowNode,
  fields: string[],
  title: string,
  message: string,
  displayField: string
): PreRunIssue | null {
  return fields.some((field) => !isBlank(node.config[field])) ? null : issue(node, displayField, title, message);
}

function issue(node: WorkflowNode, field: string, title: string, message: string): PreRunIssue {
  return {
    id: `${node.id}:${field}`,
    nodeId: node.id,
    nodeType: node.type,
    severity: "error",
    title,
    message,
    field,
  };
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}
```

- [ ] **Step 4: Run tests and verify pass**

Run:

```powershell
pnpm --filter @node-flow/web test -- lib/preRunChecks.test.ts
```

Expected: all new tests pass.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/src/lib/preRunChecks.ts apps/web/src/lib/preRunChecks.test.ts
git commit -m "feat: add pre-run workflow checks"
```

---

### Task 2: Pre-Run Issue UI And App Integration

**Files:**
- Create: `apps/web/src/components/PreRunIssueList.tsx`
- Create: `apps/web/src/components/PreRunIssueList.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Write component tests**

Create tests for rendering and click behavior:

```ts
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PreRunIssue } from "../lib/preRunChecks";
import { PreRunIssueList } from "./PreRunIssueList";

describe("PreRunIssueList", () => {
  afterEach(cleanup);

  it("renders Chinese pre-run issues", () => {
    render(<PreRunIssueList issues={[issue("request", "HTTP 请求缺少 URL。")]} onSelectNode={vi.fn()} />);

    expect(screen.getByText("运行前检查")).toBeInTheDocument();
    expect(screen.getByText("HTTP 请求缺少 URL。")).toBeInTheDocument();
  });

  it("selects the issue node when clicked", () => {
    const onSelectNode = vi.fn();
    render(<PreRunIssueList issues={[issue("request", "HTTP 请求缺少 URL。")]} onSelectNode={onSelectNode} />);

    fireEvent.click(screen.getByRole("button", { name: "HTTP 请求缺少 URL。" }));

    expect(onSelectNode).toHaveBeenCalledWith("request");
  });
});
```

- [ ] **Step 2: Write App integration tests**

Add tests proving runs are blocked and template application selects the first configuration node:

```ts
it("blocks run creation when pre-run checks find missing configuration", async () => {
  // Arrange node types for http.request and create a workflow with missing url.
  // Click template, then run.
  // Assert save/create run was not called and Chinese issue is visible.
});

it("selects the HTTP request node after applying the single API template", async () => {
  // Click template, assert config panel shows HTTP 请求 and guidance.
});

it("selects the CSV node after applying the CSV template", async () => {
  // Click template, assert config panel shows 读取 CSV and CSV guidance.
});
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```powershell
pnpm --filter @node-flow/web test -- PreRunIssueList App
```

Expected: fails because component and App integration do not exist.

- [ ] **Step 4: Implement `PreRunIssueList.tsx`**

Create:

```tsx
import type { PreRunIssue } from "../lib/preRunChecks";

type PreRunIssueListProps = {
  issues: PreRunIssue[];
  onSelectNode: (nodeId: string) => void;
};

export function PreRunIssueList({ issues, onSelectNode }: PreRunIssueListProps) {
  if (issues.length === 0) {
    return null;
  }

  return (
    <section className="pre-run-issues" aria-label="运行前检查">
      <div className="pre-run-issues-header">
        <strong>运行前检查</strong>
        <span>{issues.length} 个问题</span>
      </div>
      <div className="pre-run-issue-list">
        {issues.map((issue) => (
          <button key={issue.id} type="button" onClick={() => onSelectNode(issue.nodeId)}>
            <strong>{issue.title}</strong>
            <span>{issue.message}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Integrate checks into `App.tsx`**

Add state and imports:

```ts
import { buildPreRunIssues, type PreRunIssue } from "./lib/preRunChecks";
import { PreRunIssueList } from "./components/PreRunIssueList";

const [preRunIssues, setPreRunIssues] = useState<PreRunIssue[]>([]);
```

In `runWorkflow()` before setting `isBusy`:

```ts
const issues = buildPreRunIssues(workflow);
if (issues.length > 0) {
  setPreRunIssues(issues);
  setSelectedNodeId(issues[0].nodeId);
  setMessage(`运行前检查发现 ${issues.length} 个问题，请先补齐配置。`);
  return;
}
setPreRunIssues([]);
```

Render `PreRunIssueList` near the status message or above the run panel:

```tsx
<PreRunIssueList issues={preRunIssues} onSelectNode={setSelectedNodeId} />
```

Clear issues when workflow changes intentionally:

```ts
setPreRunIssues([]);
```

Do this in `startNewWorkflow`, `loadWorkflow`, `applyTemplate`, and after successful run start.

- [ ] **Step 6: Select template configuration nodes**

In `applyTemplate(templateId)`:

```ts
setSelectedNodeId(firstTemplateConfigurationNodeId(templateId));
```

Add helper:

```ts
function firstTemplateConfigurationNodeId(templateId: string): string | null {
  switch (templateId) {
    case "single-api-status-code":
      return "request";
    case "csv-parameterized-api":
      return "csv";
    default:
      return null;
  }
}
```

- [ ] **Step 7: Add local styles**

Append focused styles:

```css
.pre-run-issues {
  grid-column: 2 / 5;
  border: 1px solid #f2c94c;
  background: #fff8df;
  border-radius: 8px;
  padding: 12px;
}

.pre-run-issues-header,
.pre-run-issue-list button {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
```

- [ ] **Step 8: Run tests and verify pass**

Run:

```powershell
pnpm --filter @node-flow/web test -- PreRunIssueList App
```

Expected: related tests pass.

- [ ] **Step 9: Commit**

```powershell
git add apps/web/src/components/PreRunIssueList.tsx apps/web/src/components/PreRunIssueList.test.tsx apps/web/src/App.tsx apps/web/src/App.test.tsx apps/web/src/styles.css
git commit -m "feat: block incomplete test workflows before run"
```

---

### Task 3: Test Report Filtering And Case Location

**Files:**
- Modify: `apps/web/src/components/TestReportView.tsx`
- Modify: `apps/web/src/components/TestReportView.test.tsx`
- Modify: `apps/web/src/components/RunPanel.tsx`
- Modify: `apps/web/src/components/RunPanel.test.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Write failing tests**

Add tests:

```ts
it("filters cases by failed status", () => {
  // Render passed + failed + unknown cases.
  // Click 失败 filter.
  // Assert failed visible and passed hidden.
});

it("selects the source node when a case is clicked", () => {
  // Render case with sourceNodeId.
  // Click case row.
  // Assert onSelectNode called with sourceNodeId.
});

it("RunPanel forwards test case clicks to node selection", () => {
  // Render RunPanel with record_result event.
  // Click case row in report tab.
  // Assert onSelectNode called.
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
pnpm --filter @node-flow/web test -- TestReportView RunPanel
```

Expected: fails because filters and click handlers are missing.

- [ ] **Step 3: Add filter state and props**

Change props:

```ts
type TestReportViewProps = {
  events?: RunEvent[];
  report?: TestReport;
  onSelectNode?: (nodeId: string) => void;
};
```

Add filter state:

```ts
const [statusFilter, setStatusFilter] = useState<"all" | TestCaseReport["status"]>("all");
const visibleCases = statusFilter === "all"
  ? resolvedReport.cases
  : resolvedReport.cases.filter((testCase) => testCase.status === statusFilter);
```

Render filter buttons:

```tsx
<div className="test-report-filters" aria-label="测试结果筛选">
  <button aria-pressed={statusFilter === "all"} type="button" onClick={() => setStatusFilter("all")}>全部</button>
  <button aria-pressed={statusFilter === "failed"} type="button" onClick={() => setStatusFilter("failed")}>失败</button>
  <button aria-pressed={statusFilter === "unknown"} type="button" onClick={() => setStatusFilter("unknown")}>未知</button>
  <button aria-pressed={statusFilter === "passed"} type="button" onClick={() => setStatusFilter("passed")}>通过</button>
</div>
```

- [ ] **Step 4: Make case rows actionable**

Render buttons when `sourceNodeId` exists:

```tsx
<TestCaseRow
  key={`${testCase.id}-${index}`}
  testCase={testCase}
  onSelectNode={testCase.sourceNodeId ? onSelectNode : undefined}
/>
```

Inside `TestCaseRow`, use:

```tsx
const content = (...);
return testCase.sourceNodeId && onSelectNode ? (
  <button className="test-case-row test-case-button" type="button" onClick={() => onSelectNode(testCase.sourceNodeId!)}>
    {content}
  </button>
) : (
  <article className="test-case-row">{content}</article>
);
```

- [ ] **Step 5: Wire through `RunPanel`**

Pass:

```tsx
<TestReportView report={report} onSelectNode={onSelectNode} />
```

- [ ] **Step 6: Run tests and verify pass**

Run:

```powershell
pnpm --filter @node-flow/web test -- TestReportView RunPanel
```

Expected: tests pass.

- [ ] **Step 7: Commit**

```powershell
git add apps/web/src/components/TestReportView.tsx apps/web/src/components/TestReportView.test.tsx apps/web/src/components/RunPanel.tsx apps/web/src/components/RunPanel.test.tsx apps/web/src/styles.css
git commit -m "feat: filter and locate test report cases"
```

---

### Task 4: CSV And Loop Runtime Details

**Files:**
- Modify: `apps/web/src/components/ConfigPanel.tsx`
- Modify: `apps/web/src/components/ConfigPanel.test.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `README.md`

- [ ] **Step 1: Write failing tests**

Add tests:

```ts
it("shows CSV loop expression guidance for foreach nodes", () => {
  // Render control.foreach config and expect "{{ loop.item.column_name }}" guidance.
});

it("summarizes CSV runtime output", () => {
  // Runtime outputs success.headers, success.rows, success.columns.
  // Switch to runtime tab and expect headers and row count summary.
});

it("summarizes foreach runtime output", () => {
  // Runtime outputs success.iterations or success.count.
  // Switch to runtime tab and expect iteration count summary.
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
pnpm --filter @node-flow/web test -- ConfigPanel
```

Expected: new tests fail.

- [ ] **Step 3: Enhance guidance**

Extend `CONFIG_GUIDANCE_BY_NODE_TYPE`:

```ts
"control.foreach": "填写循环数据来源。循环体内可以用 {{ loop.item.column_name }} 引用当前 CSV 行字段。",
"data.csv_read": "填写 CSV 文件路径，确认分隔符和表头设置。运行后可在运行详情查看表头和行数。",
```

- [ ] **Step 4: Add runtime summaries**

Pass `nodeType` into runtime details:

```tsx
<RuntimeDetails nodeTypeId={nodeType.id} runtimeState={runtimeState} />
```

Before raw blocks, render:

```tsx
<RuntimeSummaryCard nodeTypeId={nodeTypeId} outputs={runtimeState.outputs} />
```

Implement:

```ts
function RuntimeSummaryCard({ nodeTypeId, outputs }: { nodeTypeId: string; outputs: unknown }) {
  const success = readSuccess(outputs);
  if (nodeTypeId === "data.csv_read" && success) {
    return <CsvRuntimeSummary value={success} />;
  }
  if (nodeTypeId === "control.foreach" && success) {
    return <LoopRuntimeSummary value={success} />;
  }
  return null;
}
```

Keep summary defensive: only read object properties when values are records/arrays.

- [ ] **Step 5: Update README**

Add a minimal CSV example:

```csv
name,url,expected_status
health,https://api.example.com/health,200
profile,https://api.example.com/profile,200
```

Explain that loop body can use:

```text
{{ loop.item.url }}
{{ loop.item.expected_status }}
```

- [ ] **Step 6: Run tests and verify pass**

Run:

```powershell
pnpm --filter @node-flow/web test -- ConfigPanel
```

Expected: tests pass.

- [ ] **Step 7: Commit**

```powershell
git add apps/web/src/components/ConfigPanel.tsx apps/web/src/components/ConfigPanel.test.tsx apps/web/src/styles.css README.md
git commit -m "feat: clarify csv and loop runtime details"
```

---

### Task 5: Integration Verification And Product Smoke

**Files:**
- Modify only if verification finds bugs.

- [ ] **Step 1: Run full frontend tests**

Run:

```powershell
pnpm --filter @node-flow/web test
```

Expected: all tests pass.

- [ ] **Step 2: Run web build**

Run:

```powershell
pnpm build:web
```

Expected: `tsc && vite build` passes.

- [ ] **Step 3: Run backend tests with local temp override**

Run:

```powershell
New-Item -ItemType Directory -Force .tmp | Out-Null
$env:TEMP = (Resolve-Path .tmp)
$env:TMP = (Resolve-Path .tmp)
pytest tests/api -q
```

Expected: all backend API tests pass.

- [ ] **Step 4: Browser smoke**

Use the local app and verify:

1. Apply single API template.
2. Confirm HTTP request node is selected.
3. Clear the template URL, then click Run.
4. Confirm Chinese pre-run issue appears and run API is not created.
5. Apply CSV template.
6. Confirm CSV node is selected.
7. Check report filters render.

- [ ] **Step 5: Commit fixes if needed**

If verification required fixes:

```powershell
git add <changed-files>
git commit -m "fix: polish testing workflow closure"
```

If no fixes were required, do not create an empty commit.

---

## Self-Review

- Spec coverage: pre-run checks, template guidance, report filtering/location, CSV runtime details, README update, and verification are each mapped to a task.
- Placeholder scan: no `TBD`, `TODO`, or unspecified implementation steps remain.
- Type consistency: `PreRunIssue`, `buildPreRunIssues`, `PreRunIssueList`, `onSelectNode`, and `TestReportView` props are named consistently across tasks.
