# API Testing Workbench Productization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a productized API testing workbench layer with workflow templates and a test report-first run panel.

**Architecture:** Keep the existing workflow graph, node registry, executor, and run event model. Add frontend-only template generation and frontend-only report extraction from existing run events. The editor remains the advanced surface; the new workbench UX appears when the current canvas is empty and when a run has test-oriented results.

**Tech Stack:** React, TypeScript, React Flow, Vitest, FastAPI/Python only for existing verification.

---

## File Map

Create these files:

- `apps/web/src/lib/workflowTemplates.ts`: product-facing workflow template definitions and dependency checks.
- `apps/web/src/lib/workflowTemplates.test.ts`: template unit tests.
- `apps/web/src/lib/testReport.ts`: report model and run-event extraction helpers.
- `apps/web/src/lib/testReport.test.ts`: report extraction unit tests.
- `apps/web/src/components/CanvasEmptyState.tsx`: empty-canvas template entry.
- `apps/web/src/components/CanvasEmptyState.test.tsx`: empty state unit tests.
- `apps/web/src/components/TestReportView.tsx`: compact test report view.
- `apps/web/src/components/TestReportView.test.tsx`: report view unit tests.

Modify these files:

- `apps/web/src/App.tsx`: apply templates, select primary config node, and reset run state.
- `apps/web/src/App.test.tsx`: app-level template creation tests.
- `apps/web/src/components/FlowCanvas.tsx`: render empty-canvas content without interfering with React Flow.
- `apps/web/src/components/FlowCanvas.test.tsx`: verify empty-canvas slot behavior.
- `apps/web/src/components/RunPanel.tsx`: add report/events tabs and preserve event selection behavior.
- `apps/web/src/components/RunPanel.test.tsx`: tab and empty-state tests.
- `apps/web/src/components/ConfigPanel.tsx`: add next-step guidance for key testing nodes.
- `apps/web/src/components/ConfigPanel.test.tsx`: guidance tests.
- `apps/web/src/styles.css`: workbench empty state, report tabs, summary metrics, report table.
- `README.md`: tester-facing workflow.

Do not modify backend code in this phase. If report extraction exposes a backend limitation, keep the frontend behavior graceful and document the limitation for a future backend phase.

---

## Task 1: Workflow Template Infrastructure

**Files:**
- Create: `apps/web/src/lib/workflowTemplates.ts`
- Create: `apps/web/src/lib/workflowTemplates.test.ts`

- [ ] **Step 1: Write template tests**

Create `apps/web/src/lib/workflowTemplates.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { NodeType } from "../types";
import { API_TESTING_TEMPLATES, createWorkflowFromTemplate, templateAvailability } from "./workflowTemplates";

const nodeTypes: NodeType[] = [
  nodeType("manual.trigger"),
  nodeType("http.request"),
  nodeType("assert.status_code"),
  nodeType("test.record_result"),
  nodeType("test.summary"),
  nodeType("test.write_report"),
  nodeType("data.csv_read"),
  nodeType("control.foreach"),
];

describe("workflowTemplates", () => {
  it("declares the initial API testing templates", () => {
    expect(API_TESTING_TEMPLATES.map((template) => template.id)).toEqual([
      "single-api-status-code",
      "csv-parameterized-api",
    ]);
  });

  it("reports missing dependencies", () => {
    const availability = templateAvailability(API_TESTING_TEMPLATES[1], [nodeType("manual.trigger")]);

    expect(availability.available).toBe(false);
    expect(availability.missingNodeTypes).toContain("data.csv_read");
    expect(availability.missingNodeTypes).toContain("control.foreach");
  });

  it("creates the single API status-code workflow", () => {
    const workflow = createWorkflowFromTemplate(API_TESTING_TEMPLATES[0], nodeTypes);

    expect(workflow.name).toBe("单接口状态码断言");
    expect(workflow.nodes.map((node) => node.id)).toEqual([
      "start",
      "request",
      "assert_status",
      "record_result",
      "summary",
      "write_report",
    ]);
    expect(workflow.nodes.find((node) => node.id === "request")?.config).toMatchObject({
      method: "GET",
      url: "https://example.com",
    });
    expect(workflow.nodes.find((node) => node.id === "assert_status")?.config).toMatchObject({ expected: 200 });
    expect(workflow.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "request", sourceHandle: "success", target: "assert_status" }),
        expect.objectContaining({ source: "assert_status", sourceHandle: "passed", target: "record_result" }),
      ])
    );
  });

  it("creates the CSV parameterized API workflow with a foreach body", () => {
    const workflow = createWorkflowFromTemplate(API_TESTING_TEMPLATES[1], nodeTypes);
    const foreachNode = workflow.nodes.find((node) => node.id === "each_row");

    expect(workflow.name).toBe("CSV 参数化接口测试");
    expect(workflow.nodes.find((node) => node.id === "csv")?.config).toMatchObject({
      path: "examples/api-cases.csv",
      delimiter: ",",
      has_header: true,
    });
    expect(foreachNode?.config).toMatchObject({
      items_expression: "{{ nodes.csv.outputs.success.rows }}",
    });
    expect(foreachNode?.subflows?.body?.nodes.map((node) => node.id)).toEqual([
      "request",
      "assert_status",
      "record_result",
    ]);
    expect(foreachNode?.subflows?.body?.nodes.find((node) => node.id === "request")?.config).toMatchObject({
      method: "GET",
      url: "{{ loop.item.url }}",
    });
  });
});

function nodeType(id: string): NodeType {
  return {
    id,
    name: id,
    category: "Testing",
    description: id,
    inputs: {},
    outputs: {},
    configSchema: { type: "object", properties: {} },
  };
}
```

- [ ] **Step 2: Run template tests and verify failure**

Run:

```powershell
pnpm --filter @node-flow/web test -- lib/workflowTemplates.test.ts
```

Expected: FAIL because `workflowTemplates.ts` does not exist.

- [ ] **Step 3: Implement template module**

Create `apps/web/src/lib/workflowTemplates.ts`:

```ts
import type { NodeType, WorkflowDocument, WorkflowEdge, WorkflowNode } from "../types";

export type WorkflowTemplate = {
  id: "single-api-status-code" | "csv-parameterized-api";
  name: string;
  description: string;
  category: "api-testing";
  primaryNodeId: string;
  requiredNodeTypes: string[];
  createWorkflow: () => WorkflowDocument;
};

export type TemplateAvailability = {
  available: boolean;
  missingNodeTypes: string[];
};

const DEFAULT_SETTINGS = { timeout_seconds: 600 };

export const API_TESTING_TEMPLATES: WorkflowTemplate[] = [
  {
    id: "single-api-status-code",
    name: "单接口状态码断言",
    description: "发送一次 HTTP 请求，校验响应状态码，并写出测试报告。",
    category: "api-testing",
    primaryNodeId: "request",
    requiredNodeTypes: [
      "manual.trigger",
      "http.request",
      "assert.status_code",
      "test.record_result",
      "test.summary",
      "test.write_report",
    ],
    createWorkflow: createSingleApiStatusCodeWorkflow,
  },
  {
    id: "csv-parameterized-api",
    name: "CSV 参数化接口测试",
    description: "读取 CSV，每一行执行一次接口请求和状态码断言。",
    category: "api-testing",
    primaryNodeId: "csv",
    requiredNodeTypes: [
      "manual.trigger",
      "data.csv_read",
      "control.foreach",
      "http.request",
      "assert.status_code",
      "test.record_result",
      "test.summary",
      "test.write_report",
    ],
    createWorkflow: createCsvParameterizedApiWorkflow,
  },
];

export function templateAvailability(template: WorkflowTemplate, nodeTypes: NodeType[]): TemplateAvailability {
  const availableNodeTypes = new Set(nodeTypes.map((nodeType) => nodeType.id));
  const missingNodeTypes = template.requiredNodeTypes.filter((nodeTypeId) => !availableNodeTypes.has(nodeTypeId));
  return {
    available: missingNodeTypes.length === 0,
    missingNodeTypes,
  };
}

export function createWorkflowFromTemplate(template: WorkflowTemplate, nodeTypes: NodeType[]): WorkflowDocument {
  const availability = templateAvailability(template, nodeTypes);
  if (!availability.available) {
    throw new Error(`模板缺少节点：${availability.missingNodeTypes.join(", ")}`);
  }

  return template.createWorkflow();
}

function createSingleApiStatusCodeWorkflow(): WorkflowDocument {
  return workflow("单接口状态码断言", [
    node("start", "manual.trigger", 80, 120, { payload: {} }),
    node("request", "http.request", 320, 120, {
      method: "GET",
      url: "https://example.com",
      headers: {},
      body: null,
      timeout_seconds: 30,
    }),
    node("assert_status", "assert.status_code", 560, 120, { expected: 200 }),
    node("record_result", "test.record_result", 800, 120, { name: "状态码断言" }),
    node("summary", "test.summary", 1040, 120, { fail_run_on_failed: false }),
    node("write_report", "test.write_report", 1280, 120, { path: "reports/single-api-report.json" }),
  ], [
    edge("start", "success", "request", "input"),
    edge("request", "success", "assert_status", "input"),
    edge("assert_status", "passed", "record_result", "input"),
    edge("assert_status", "failed", "record_result", "input"),
    edge("record_result", "success", "summary", "input"),
    edge("summary", "success", "write_report", "input"),
  ]);
}

function createCsvParameterizedApiWorkflow(): WorkflowDocument {
  const foreachBody = {
    nodes: [
      node("request", "http.request", 80, 120, {
        method: "GET",
        url: "{{ loop.item.url }}",
        headers: {},
        body: null,
        timeout_seconds: 30,
      }),
      node("assert_status", "assert.status_code", 320, 120, { expected: 200 }),
      node("record_result", "test.record_result", 560, 120, { name: "CSV 行状态码断言" }),
    ],
    edges: [
      edge("request", "success", "assert_status", "input"),
      edge("assert_status", "passed", "record_result", "input"),
      edge("assert_status", "failed", "record_result", "input"),
    ],
  };

  return workflow("CSV 参数化接口测试", [
    node("start", "manual.trigger", 80, 120, { payload: {} }),
    node("csv", "data.csv_read", 320, 120, {
      path: "examples/api-cases.csv",
      delimiter: ",",
      encoding: "utf-8",
      has_header: true,
    }),
    {
      ...node("each_row", "control.foreach", 560, 120, {
        items_expression: "{{ nodes.csv.outputs.success.rows }}",
        max_items: 100,
        continue_on_error: true,
        timeout_seconds: 300,
      }),
      subflows: { body: foreachBody },
    },
    node("summary", "test.summary", 800, 120, { fail_run_on_failed: false }),
    node("write_report", "test.write_report", 1040, 120, { path: "reports/csv-api-report.json" }),
  ], [
    edge("start", "success", "csv", "input"),
    edge("csv", "success", "each_row", "input"),
    edge("each_row", "done", "summary", "input"),
    edge("summary", "success", "write_report", "input"),
  ]);
}

function workflow(name: string, nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowDocument {
  return {
    id: `wf_${crypto.randomUUID().replaceAll("-", "")}`,
    name,
    version: 1,
    nodes,
    edges,
    settings: DEFAULT_SETTINGS,
  };
}

function node(id: string, type: string, x: number, y: number, config: Record<string, unknown>): WorkflowNode {
  return {
    id,
    type,
    position: { x, y },
    config,
  };
}

function edge(source: string, sourceHandle: string, target: string, targetHandle: string): WorkflowEdge {
  return {
    id: `edge_${source}_${sourceHandle}_${target}_${targetHandle}`,
    source,
    sourceHandle,
    target,
    targetHandle,
  };
}
```

- [ ] **Step 4: Run template tests and verify pass**

Run:

```powershell
pnpm --filter @node-flow/web test -- lib/workflowTemplates.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit template infrastructure**

Run:

```powershell
git add apps/web/src/lib/workflowTemplates.ts apps/web/src/lib/workflowTemplates.test.ts
git commit -m "feat: add api testing workflow templates"
```

Expected: commit succeeds.

---

## Task 2: Empty Canvas Template Entry

**Files:**
- Create: `apps/web/src/components/CanvasEmptyState.tsx`
- Create: `apps/web/src/components/CanvasEmptyState.test.tsx`
- Modify: `apps/web/src/components/FlowCanvas.tsx`
- Modify: `apps/web/src/components/FlowCanvas.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Write CanvasEmptyState tests**

Create `apps/web/src/components/CanvasEmptyState.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkflowTemplate } from "../lib/workflowTemplates";
import { CanvasEmptyState } from "./CanvasEmptyState";

const templates: WorkflowTemplate[] = [
  template("single-api-status-code", "单接口状态码断言"),
  template("csv-parameterized-api", "CSV 参数化接口测试"),
];

describe("CanvasEmptyState", () => {
  afterEach(cleanup);

  it("shows template actions and applies available templates", () => {
    const onApplyTemplate = vi.fn();

    render(
      <CanvasEmptyState
        templates={templates.map((item) => ({ template: item, available: true, missingNodeTypes: [] }))}
        onApplyTemplate={onApplyTemplate}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "单接口状态码断言" }));

    expect(screen.getByText("从接口测试模板开始")).toBeInTheDocument();
    expect(onApplyTemplate).toHaveBeenCalledWith(templates[0]);
  });

  it("disables templates with missing node dependencies", () => {
    render(
      <CanvasEmptyState
        templates={[
          {
            template: templates[1],
            available: false,
            missingNodeTypes: ["data.csv_read", "control.foreach"],
          },
        ]}
        onApplyTemplate={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "CSV 参数化接口测试" })).toBeDisabled();
    expect(screen.getByText("缺少节点：data.csv_read, control.foreach")).toBeInTheDocument();
  });
});

function template(id: WorkflowTemplate["id"], name: string): WorkflowTemplate {
  return {
    id,
    name,
    description: `${name} description`,
    category: "api-testing",
    primaryNodeId: "request",
    requiredNodeTypes: [],
    createWorkflow: () => ({
      id: "wf_test",
      name,
      version: 1,
      nodes: [],
      edges: [],
      settings: { timeout_seconds: 600 },
    }),
  };
}
```

- [ ] **Step 2: Run CanvasEmptyState tests and verify failure**

Run:

```powershell
pnpm --filter @node-flow/web test -- components/CanvasEmptyState.test.tsx
```

Expected: FAIL because `CanvasEmptyState.tsx` does not exist.

- [ ] **Step 3: Implement CanvasEmptyState**

Create `apps/web/src/components/CanvasEmptyState.tsx`:

```tsx
import type { WorkflowTemplate } from "../lib/workflowTemplates";

export type TemplateCard = {
  template: WorkflowTemplate;
  available: boolean;
  missingNodeTypes: string[];
};

type CanvasEmptyStateProps = {
  templates: TemplateCard[];
  onApplyTemplate: (template: WorkflowTemplate) => void;
};

export function CanvasEmptyState({ templates, onApplyTemplate }: CanvasEmptyStateProps) {
  return (
    <div className="canvas-empty-state">
      <div className="canvas-empty-copy">
        <h2>从接口测试模板开始</h2>
        <p>选择一个模板生成可运行的接口测试流程，也可以继续从左侧节点库手动搭建。</p>
      </div>
      <div className="template-actions">
        {templates.map(({ template, available, missingNodeTypes }) => (
          <div className="template-card" key={template.id}>
            <button disabled={!available} type="button" onClick={() => onApplyTemplate(template)}>
              {template.name}
            </button>
            <p>{template.description}</p>
            {!available ? <small>缺少节点：{missingNodeTypes.join(", ")}</small> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add empty overlay support to FlowCanvas tests**

Append this test to `apps/web/src/components/FlowCanvas.test.tsx`:

```tsx
  it("renders an empty-canvas child when there are no workflow nodes", () => {
    render(
      <FlowCanvas
        nodeTypes={[manualTriggerType]}
        selectedNodeId={null}
        workflow={emptyWorkflow}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      >
        <div>Empty template entry</div>
      </FlowCanvas>
    );

    expect(screen.getByText("Empty template entry")).toBeInTheDocument();
  });
```

Also update the imports at the top:

```tsx
import { act, cleanup, render, screen } from "@testing-library/react";
```

- [ ] **Step 5: Run FlowCanvas test and verify failure**

Run:

```powershell
pnpm --filter @node-flow/web test -- components/FlowCanvas.test.tsx
```

Expected: FAIL because `FlowCanvasProps` does not accept children.

- [ ] **Step 6: Implement FlowCanvas children overlay**

Modify `apps/web/src/components/FlowCanvas.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState, type DragEvent, type ReactNode } from "react";
```

Add `children?: ReactNode` to `FlowCanvasProps`, pass it through `FlowCanvasInner`, and render it after `</ReactFlow>` inside the section:

```tsx
type FlowCanvasProps = {
  workflow: WorkflowDocument;
  nodeTypes: NodeType[];
  nodeRunStates?: Record<string, NodeRuntimeState>;
  selectedNodeId: string | null;
  selectionResetKey?: string;
  children?: ReactNode;
  onAddNodeAt?: (nodeType: NodeType, position: WorkflowNode["position"]) => void;
  onWorkflowChange: (workflow: WorkflowDocument) => void;
  onSelectNode: (nodeId: string | null) => void;
};
```

```tsx
      </ReactFlow>
      {workflow.nodes.length === 0 ? children : null}
    </section>
```

- [ ] **Step 7: Wire templates into App**

Modify `apps/web/src/App.tsx` imports:

```tsx
import { CanvasEmptyState } from "./components/CanvasEmptyState";
import {
  API_TESTING_TEMPLATES,
  createWorkflowFromTemplate,
  templateAvailability,
  type WorkflowTemplate,
} from "./lib/workflowTemplates";
```

Add memoized template cards near the existing derived state:

```tsx
  const templateCards = useMemo(
    () =>
      API_TESTING_TEMPLATES.map((template) => ({
        template,
        ...templateAvailability(template, nodeTypes),
      })),
    [nodeTypes]
  );
```

Add the template apply function:

```tsx
  function applyTemplate(template: WorkflowTemplate) {
    try {
      const nextWorkflow = createWorkflowFromTemplate(template, nodeTypes);
      resetRunState();
      setWorkflow(nextWorkflow);
      setSelectedWorkflowId("");
      setEditScope(undefined);
      setSelectedNodeId(template.primaryNodeId);
      setMessage(
        template.id === "csv-parameterized-api"
          ? "已创建 CSV 参数化接口测试，请先配置 CSV 路径和请求 URL。"
          : "已创建单接口状态码断言，请先配置请求 URL 和期望状态码。"
      );
    } catch (error) {
      setMessage(`模板创建失败：${formatError(error)}`);
    }
  }
```

Pass the empty state into `FlowCanvas`:

```tsx
        <FlowCanvas
          nodeRunStates={nodeRunStates}
          nodeTypes={displayNodeTypes}
          selectedNodeId={selectedNodeId}
          selectionResetKey={editScopeKey}
          workflow={canvasWorkflow}
          onAddNodeAt={addNodeAt}
          onSelectNode={setSelectedNodeId}
          onWorkflowChange={updateCurrentEditableWorkflow}
        >
          {!editScope?.length ? <CanvasEmptyState templates={templateCards} onApplyTemplate={applyTemplate} /> : null}
        </FlowCanvas>
```

- [ ] **Step 8: Add App template test**

Append to `apps/web/src/App.test.tsx`:

```tsx
  it("creates an API testing workflow from the empty canvas template", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([
          nodeType("manual.trigger", "Manual Trigger", "Triggers"),
          nodeType("http.request", "HTTP Request", "Network"),
          nodeType("assert.status_code", "Assert Status Code", "Assertions"),
          nodeType("test.record_result", "Record Test Result", "Testing"),
          nodeType("test.summary", "Test Summary", "Testing"),
          nodeType("test.write_report", "Write Test Report", "Testing"),
          nodeType("data.csv_read", "Read CSV", "Data"),
          nodeType("control.foreach", "For Each", "Control"),
        ]);
      }
      if (url.endsWith("/api/workflows")) {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "单接口状态码断言" }));

    expect(screen.getByText("已创建单接口状态码断言，请先配置请求 URL 和期望状态码。")).toBeInTheDocument();
    expect(within(screen.getByLabelText("画布工作区")).getByText("HTTP 请求")).toBeInTheDocument();
    expect(screen.getByLabelText("工作流名称")).toHaveValue("单接口状态码断言");
  });
```

Add this helper below existing helpers if not already present:

```tsx
function nodeType(id: string, name: string, category: string) {
  return {
    id,
    name,
    category,
    description: name,
    inputs: {},
    outputs: { success: {} },
    configSchema: { type: "object", properties: {} },
  };
}
```

- [ ] **Step 9: Add empty state styles**

Append focused styles to `apps/web/src/styles.css` near `.canvas-shell` styles:

```css
.canvas-empty-state {
  position: absolute;
  top: 56px;
  left: 50%;
  z-index: 5;
  display: grid;
  width: min(560px, calc(100% - 48px));
  gap: 14px;
  transform: translateX(-50%);
  pointer-events: auto;
}

.canvas-empty-copy {
  display: grid;
  gap: 5px;
  border: 1px solid #d6dee7;
  border-radius: 6px;
  background: #ffffff;
  padding: 14px 16px;
  box-shadow: 0 10px 26px rgb(28 38 52 / 10%);
}

.canvas-empty-copy h2,
.canvas-empty-copy p,
.template-card p {
  margin: 0;
}

.canvas-empty-copy h2 {
  color: #1d2734;
  font-size: 16px;
}

.canvas-empty-copy p,
.template-card p,
.template-card small {
  color: #627286;
  font-size: 12px;
  line-height: 1.45;
}

.template-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.template-card {
  display: grid;
  gap: 7px;
  border: 1px solid #d6dee7;
  border-radius: 6px;
  background: #fbfcfd;
  padding: 10px;
}

.template-card button {
  width: 100%;
  border-color: #1d5f88;
  background: #eef7fb;
  color: #174c6d;
}
```

- [ ] **Step 10: Run template entry tests**

Run:

```powershell
pnpm --filter @node-flow/web test -- components/CanvasEmptyState.test.tsx components/FlowCanvas.test.tsx App.test.tsx
```

Expected: PASS.

- [ ] **Step 11: Commit template entry**

Run:

```powershell
git add apps/web/src
git commit -m "feat: add testing template entry"
```

Expected: commit succeeds.

---

## Task 3: Test Report Extraction

**Files:**
- Create: `apps/web/src/lib/testReport.ts`
- Create: `apps/web/src/lib/testReport.test.ts`

- [ ] **Step 1: Write report extraction tests**

Create `apps/web/src/lib/testReport.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { RunEvent } from "../types";
import { buildTestReport } from "./testReport";

describe("buildTestReport", () => {
  it("returns an empty report when no test results exist", () => {
    const report = buildTestReport([]);

    expect(report.hasResults).toBe(false);
    expect(report.summary).toEqual({ total: 0, passed: 0, failed: 0, passRate: 0 });
    expect(report.cases).toEqual([]);
  });

  it("extracts passed and failed cases from record result events", () => {
    const report = buildTestReport([
      recordResultEvent("case_1", { assertion: "status_code", status: "passed", expected: 200, actual: 200, message: "ok" }),
      recordResultEvent("case_2", { assertion: "status_code", status: "failed", expected: 200, actual: 500, message: "Expected status 200, got 500" }),
    ]);

    expect(report.hasResults).toBe(true);
    expect(report.summary).toEqual({ total: 2, passed: 1, failed: 1, passRate: 50 });
    expect(report.cases[1]).toMatchObject({
      id: "case_2",
      status: "failed",
      assertionType: "status_code",
      expected: 200,
      actual: 500,
      message: "Expected status 200, got 500",
    });
  });

  it("uses loop scope to label CSV iteration cases", () => {
    const report = buildTestReport([
      recordResultEvent(
        "case_1",
        { assertion: "status_code", status: "passed", expected: 200, actual: 200, message: "ok" },
        ["each_row", "iteration:3"]
      ),
    ]);

    expect(report.cases[0]).toMatchObject({
      name: "iteration:3",
      scope: ["each_row", "iteration:3"],
    });
  });

  it("uses summary event totals when there are no case events", () => {
    const report = buildTestReport([
      event({
        node_id: "summary",
        payload: {
          outputs: {
            success: {
              summary: { total: 4, passed: 3, failed: 1 },
              results: [],
            },
          },
        },
      }),
    ]);

    expect(report.summary).toEqual({ total: 4, passed: 3, failed: 1, passRate: 75 });
  });
});

function recordResultEvent(nodeId: string, result: Record<string, unknown>, scope: string[] = []): RunEvent {
  return event({
    node_id: nodeId,
    scope,
    payload: {
      outputs: {
        success: result,
      },
    },
  });
}

function event(overrides: Partial<RunEvent>): RunEvent {
  return {
    id: 1,
    run_id: "run_1",
    type: "node_succeeded",
    timestamp: "2026-06-18T00:00:00Z",
    node_id: null,
    scope: [],
    payload: {},
    ...overrides,
  };
}
```

- [ ] **Step 2: Run report tests and verify failure**

Run:

```powershell
pnpm --filter @node-flow/web test -- lib/testReport.test.ts
```

Expected: FAIL because `testReport.ts` does not exist.

- [ ] **Step 3: Implement report extraction**

Create `apps/web/src/lib/testReport.ts`:

```ts
import type { RunEvent } from "../types";

export type TestReportSummary = {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
};

export type TestReportCase = {
  id: string;
  name: string;
  status: "passed" | "failed";
  scope: string[];
  assertionType?: string;
  expected?: unknown;
  actual?: unknown;
  message?: string;
  nodeId?: string | null;
};

export type TestReport = {
  summary: TestReportSummary;
  cases: TestReportCase[];
  hasResults: boolean;
};

export function buildTestReport(events: RunEvent[]): TestReport {
  const cases = events.flatMap(testCaseFromEvent);
  const summaryFromEvent = [...events].reverse().map(summaryFromEventPayload).find(Boolean);
  const summary = cases.length > 0 ? summarizeCases(cases) : summaryFromEvent ?? summarizeCases(cases);

  return {
    summary,
    cases,
    hasResults: cases.length > 0 || summary.total > 0,
  };
}

function testCaseFromEvent(event: RunEvent): TestReportCase[] {
  if (event.type !== "node_succeeded") {
    return [];
  }

  const success = readOutputObject(event.payload, "success");
  if (!success || typeof success.status !== "string") {
    return [];
  }

  const status = success.status === "failed" ? "failed" : "passed";
  return [
    {
      id: `${event.node_id ?? "result"}-${event.id ?? event.timestamp}`,
      name: caseName(event),
      status,
      scope: event.scope,
      assertionType: typeof success.assertion === "string" ? success.assertion : undefined,
      expected: success.expected,
      actual: success.actual,
      message: typeof success.message === "string" ? success.message : undefined,
      nodeId: event.node_id,
    },
  ];
}

function summaryFromEventPayload(event: RunEvent): TestReportSummary | undefined {
  if (event.type !== "node_succeeded") {
    return undefined;
  }

  const success = readOutputObject(event.payload, "success");
  const summary = success?.summary;
  if (!isRecord(summary)) {
    return undefined;
  }

  const total = readNumber(summary.total);
  const passed = readNumber(summary.passed);
  const failed = readNumber(summary.failed);
  if (total === undefined || passed === undefined || failed === undefined) {
    return undefined;
  }

  return {
    total,
    passed,
    failed,
    passRate: passRate(total, passed),
  };
}

function summarizeCases(cases: TestReportCase[]): TestReportSummary {
  const total = cases.length;
  const passed = cases.filter((item) => item.status === "passed").length;
  const failed = cases.filter((item) => item.status === "failed").length;
  return {
    total,
    passed,
    failed,
    passRate: passRate(total, passed),
  };
}

function readOutputObject(payload: Record<string, unknown>, outputName: string): Record<string, unknown> | undefined {
  const outputs = payload.outputs;
  if (!isRecord(outputs)) {
    return undefined;
  }
  const output = outputs[outputName];
  return isRecord(output) ? output : undefined;
}

function caseName(event: RunEvent): string {
  const iteration = [...event.scope].reverse().find((part) => part.startsWith("iteration:"));
  return iteration ?? event.node_id ?? "测试结果";
}

function passRate(total: number, passed: number) {
  return total === 0 ? 0 : Math.round((passed / total) * 100);
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
```

- [ ] **Step 4: Run report extraction tests and verify pass**

Run:

```powershell
pnpm --filter @node-flow/web test -- lib/testReport.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit report extraction**

Run:

```powershell
git add apps/web/src/lib/testReport.ts apps/web/src/lib/testReport.test.ts
git commit -m "feat: extract test reports from run events"
```

Expected: commit succeeds.

---

## Task 4: Productized Run Panel

**Files:**
- Create: `apps/web/src/components/TestReportView.tsx`
- Create: `apps/web/src/components/TestReportView.test.tsx`
- Modify: `apps/web/src/components/RunPanel.tsx`
- Modify: `apps/web/src/components/RunPanel.test.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Write TestReportView tests**

Create `apps/web/src/components/TestReportView.test.tsx`:

```tsx
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TestReport } from "../lib/testReport";
import { TestReportView } from "./TestReportView";

describe("TestReportView", () => {
  afterEach(cleanup);

  it("shows a Chinese empty state when there are no test results", () => {
    render(<TestReportView report={emptyReport()} runError={null} />);

    expect(screen.getByText("这次运行还没有测试结果。")).toBeInTheDocument();
    expect(screen.getByText("请加入记录测试结果或测试汇总节点。")).toBeInTheDocument();
  });

  it("shows summary metrics and failed case details", () => {
    render(
      <TestReportView
        runError="workflow failed"
        report={{
          hasResults: true,
          summary: { total: 2, passed: 1, failed: 1, passRate: 50 },
          cases: [
            { id: "a", name: "iteration:0", status: "passed", scope: [], expected: 200, actual: 200 },
            {
              id: "b",
              name: "iteration:1",
              status: "failed",
              scope: ["each_row", "iteration:1"],
              assertionType: "status_code",
              expected: 200,
              actual: 500,
              message: "Expected status 200, got 500",
              nodeId: "assert_status",
            },
          ],
        }}
      />
    );

    expect(screen.getByText("总数 2")).toBeInTheDocument();
    expect(screen.getByText("通过 1")).toBeInTheDocument();
    expect(screen.getByText("失败 1")).toBeInTheDocument();
    expect(screen.getByText("通过率 50%")).toBeInTheDocument();
    expect(screen.getByText("workflow failed")).toBeInTheDocument();
    expect(screen.getByText("Expected status 200, got 500")).toBeInTheDocument();
  });
});

function emptyReport(): TestReport {
  return {
    hasResults: false,
    summary: { total: 0, passed: 0, failed: 0, passRate: 0 },
    cases: [],
  };
}
```

- [ ] **Step 2: Run TestReportView tests and verify failure**

Run:

```powershell
pnpm --filter @node-flow/web test -- components/TestReportView.test.tsx
```

Expected: FAIL because `TestReportView.tsx` does not exist.

- [ ] **Step 3: Implement TestReportView**

Create `apps/web/src/components/TestReportView.tsx`:

```tsx
import type { TestReport } from "../lib/testReport";

type TestReportViewProps = {
  report: TestReport;
  runError?: string | null;
};

export function TestReportView({ report, runError }: TestReportViewProps) {
  if (!report.hasResults) {
    return (
      <div className="test-report-empty">
        <strong>这次运行还没有测试结果。</strong>
        <span>请加入记录测试结果或测试汇总节点。</span>
      </div>
    );
  }

  return (
    <div className="test-report-view">
      {runError ? <div className="test-report-error">{runError}</div> : null}
      <div className="test-report-summary" aria-label="测试报告汇总">
        <span>总数 {report.summary.total}</span>
        <span>通过 {report.summary.passed}</span>
        <span>失败 {report.summary.failed}</span>
        <span>通过率 {report.summary.passRate}%</span>
      </div>
      <div className="test-report-table" role="table" aria-label="测试结果表">
        <div role="row" className="test-report-row test-report-header">
          <span role="columnheader">状态</span>
          <span role="columnheader">用例</span>
          <span role="columnheader">断言</span>
          <span role="columnheader">期望</span>
          <span role="columnheader">实际</span>
          <span role="columnheader">说明</span>
        </div>
        {report.cases.map((testCase) => (
          <div role="row" className={`test-report-row is-${testCase.status}`} key={testCase.id}>
            <span role="cell">{testCase.status === "passed" ? "通过" : "失败"}</span>
            <span role="cell">{testCase.name}</span>
            <span role="cell">{testCase.assertionType ?? "-"}</span>
            <span role="cell">{formatValue(testCase.expected)}</span>
            <span role="cell">{formatValue(testCase.actual)}</span>
            <span role="cell">{testCase.message ?? testCase.nodeId ?? "-"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatValue(value: unknown): string {
  if (value === undefined) {
    return "-";
  }
  return typeof value === "string" ? value : JSON.stringify(value);
}
```

- [ ] **Step 4: Update RunPanel tests**

Replace `apps/web/src/components/RunPanel.test.tsx` with:

```tsx
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunEvent, RunRecord } from "../types";
import { RunPanel } from "./RunPanel";

describe("RunPanel", () => {
  afterEach(cleanup);

  it("defaults to the test report tab", () => {
    render(<RunPanel events={[]} run={runRecord()} />);

    expect(screen.getByRole("tab", { name: "测试报告" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("这次运行还没有测试结果。")).toBeInTheDocument();
  });

  it("switches to run events and preserves node selection behavior", () => {
    const onSelectNode = vi.fn();
    render(<RunPanel events={[nodeEvent()]} run={runRecord()} onSelectNode={onSelectNode} />);

    fireEvent.click(screen.getByRole("tab", { name: "运行事件" }));
    fireEvent.click(screen.getByRole("button", { name: "节点成功 assert_status" }));

    expect(screen.getByRole("tab", { name: "运行事件" })).toHaveAttribute("aria-selected", "true");
    expect(onSelectNode).toHaveBeenCalledWith("assert_status");
  });

  it("shows report rows from record result events", () => {
    render(<RunPanel events={[recordResultEvent()]} run={runRecord()} />);

    expect(screen.getByText("总数 1")).toBeInTheDocument();
    expect(screen.getByText("通过 1")).toBeInTheDocument();
    expect(screen.getByText("status_code")).toBeInTheDocument();
  });
});

function runRecord(): RunRecord {
  return {
    id: "run_1",
    workflow_id: "wf_1",
    workflow_version: 1,
    status: "succeeded",
    created_at: "2026-06-18T00:00:00Z",
    started_at: "2026-06-18T00:00:01Z",
    completed_at: "2026-06-18T00:00:02Z",
    error: null,
  };
}

function nodeEvent(): RunEvent {
  return {
    id: 1,
    run_id: "run_1",
    type: "node_succeeded",
    timestamp: "2026-06-18T00:00:02Z",
    node_id: "assert_status",
    scope: [],
    payload: { outputs: { success: {} } },
  };
}

function recordResultEvent(): RunEvent {
  return {
    ...nodeEvent(),
    node_id: "record_result",
    payload: {
      outputs: {
        success: {
          assertion: "status_code",
          status: "passed",
          expected: 200,
          actual: 200,
          message: "Status code is 200",
        },
      },
    },
  };
}
```

- [ ] **Step 5: Run RunPanel tests and verify failure**

Run:

```powershell
pnpm --filter @node-flow/web test -- components/TestReportView.test.tsx components/RunPanel.test.tsx
```

Expected: FAIL because `RunPanel` has no tabs yet.

- [ ] **Step 6: Implement RunPanel tabs**

Modify `apps/web/src/components/RunPanel.tsx`:

```tsx
import { useMemo, useState } from "react";
import type { RunEvent, RunRecord } from "../types";
import { translateEventType, translateRunStatus } from "../lib/display";
import { buildTestReport } from "../lib/testReport";
import { TestReportView } from "./TestReportView";
```

Inside `RunPanel`:

```tsx
export function RunPanel({ run, events, onSelectNode }: RunPanelProps) {
  const [activeTab, setActiveTab] = useState<"report" | "events">("report");
  const report = useMemo(() => buildTestReport(events), [events]);

  return (
    <section className="run-panel" aria-label="运行日志">
      <div className="panel-heading">
        <div>
          <h2>运行结果</h2>
          <p>先看测试报告，需要排查时再看运行事件</p>
        </div>
        <span className={run ? `status-pill status-${run.status}` : "status-pill"}>
          {translateRunStatus(run?.status ?? "idle")}
        </span>
      </div>
      <div className="run-tabs" role="tablist" aria-label="运行结果视图">
        <button aria-selected={activeTab === "report"} role="tab" type="button" onClick={() => setActiveTab("report")}>
          测试报告
        </button>
        <button aria-selected={activeTab === "events"} role="tab" type="button" onClick={() => setActiveTab("events")}>
          运行事件
        </button>
      </div>
      {activeTab === "report" ? (
        <TestReportView report={report} runError={run?.error} />
      ) : events.length === 0 ? (
        <p className="empty-state">还没有运行事件。</p>
      ) : (
        <div className="run-events">
          {events.map((event, index) => (
            <RunEventRow event={event} key={event.id ?? `${event.run_id}-${index}`} onSelectNode={onSelectNode} />
          ))}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 7: Add run panel/report styles**

Append to `apps/web/src/styles.css` near run panel styles:

```css
.run-tabs {
  display: flex;
  gap: 6px;
  border-bottom: 1px solid #e7ebf0;
  padding: 8px 12px;
}

.run-tabs button {
  min-height: 30px;
  background: #eef3f7;
}

.run-tabs button[aria-selected="true"] {
  border-color: #1d5f88;
  background: #ffffff;
  color: #174c6d;
}

.test-report-empty,
.test-report-view {
  overflow: auto;
  min-height: 0;
}

.test-report-empty {
  display: grid;
  gap: 5px;
  color: #617085;
  padding: 12px;
  font-size: 13px;
}

.test-report-empty strong {
  color: #354255;
}

.test-report-view {
  display: grid;
  align-content: start;
  gap: 10px;
  padding: 10px 12px;
}

.test-report-error {
  border: 1px solid #d59a9a;
  border-radius: 5px;
  background: #fff4f4;
  color: #8b3030;
  padding: 7px 9px;
  font-size: 12px;
  font-weight: 700;
}

.test-report-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.test-report-summary span {
  border: 1px solid #d6dee7;
  border-radius: 5px;
  background: #ffffff;
  color: #334155;
  padding: 5px 8px;
  font-size: 12px;
  font-weight: 750;
}

.test-report-table {
  display: grid;
  border: 1px solid #e0e6ed;
  border-bottom-width: 0;
  font-size: 12px;
}

.test-report-row {
  display: grid;
  grid-template-columns: 70px 120px 120px 100px 100px minmax(0, 1fr);
  gap: 8px;
  border-bottom: 1px solid #e0e6ed;
  padding: 7px 9px;
}

.test-report-header {
  background: #f4f7fa;
  color: #445266;
  font-weight: 750;
}

.test-report-row.is-passed span:first-child {
  color: #27633f;
  font-weight: 750;
}

.test-report-row.is-failed span:first-child {
  color: #8b3030;
  font-weight: 750;
}
```

- [ ] **Step 8: Run run panel tests and verify pass**

Run:

```powershell
pnpm --filter @node-flow/web test -- components/TestReportView.test.tsx components/RunPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit run panel productization**

Run:

```powershell
git add apps/web/src/components/TestReportView.tsx apps/web/src/components/TestReportView.test.tsx apps/web/src/components/RunPanel.tsx apps/web/src/components/RunPanel.test.tsx apps/web/src/styles.css
git commit -m "feat: show test report run view"
```

Expected: commit succeeds.

---

## Task 5: Configuration Guidance And Documentation

**Files:**
- Modify: `apps/web/src/components/ConfigPanel.tsx`
- Modify: `apps/web/src/components/ConfigPanel.test.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `README.md`

- [ ] **Step 1: Add ConfigPanel guidance test**

Append to `apps/web/src/components/ConfigPanel.test.tsx`:

```tsx
  it("shows next-step guidance for API testing nodes", () => {
    render(
      <ConfigPanel
        node={{ id: "request", type: "http.request", position: { x: 0, y: 0 }, config: {} }}
        nodeType={{
          id: "http.request",
          name: "HTTP 请求",
          category: "网络",
          description: "发送 HTTP 请求。",
          inputs: {},
          outputs: {},
          configSchema: { type: "object", properties: {} },
        }}
        onConfigChange={vi.fn()}
      />
    );

    expect(screen.getByText("下一步：填写请求方法和 URL。")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run ConfigPanel test and verify failure**

Run:

```powershell
pnpm --filter @node-flow/web test -- components/ConfigPanel.test.tsx
```

Expected: FAIL because guidance is not rendered.

- [ ] **Step 3: Implement guidance in ConfigPanel**

Modify `apps/web/src/components/ConfigPanel.tsx` after the selected-node block:

```tsx
          <NodeGuidance nodeTypeId={nodeType.id} />
```

Add this helper below `RuntimeDetails`:

```tsx
function NodeGuidance({ nodeTypeId }: { nodeTypeId: string }) {
  const guidance = guidanceForNode(nodeTypeId);
  if (!guidance) {
    return null;
  }

  return <p className="node-guidance">下一步：{guidance}</p>;
}

function guidanceForNode(nodeTypeId: string): string | null {
  switch (nodeTypeId) {
    case "http.request":
      return "填写请求方法和 URL。";
    case "data.csv_read":
      return "填写 CSV 文件路径，确认分隔符和表头设置。";
    case "assert.status_code":
      return "填写期望状态码。";
    case "test.write_report":
      return "填写测试报告输出路径。";
    default:
      return null;
  }
}
```

- [ ] **Step 4: Add guidance styles**

Append near `.selected-node` styles in `apps/web/src/styles.css`:

```css
.node-guidance {
  margin: 0;
  border-bottom: 1px solid #e7ebf0;
  background: #fffaf1;
  color: #6b4f20;
  padding: 9px 12px;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.4;
}
```

- [ ] **Step 5: Update README tester workflow**

Add this section to `README.md` after "基本使用":

```markdown
## 给测试同事的推荐流程

1. 打开页面后，如果画布为空，优先选择“单接口状态码断言”或“CSV 参数化接口测试”模板。
2. 按右侧配置面板的“下一步”提示填写关键参数。
3. 单接口模板先配置 HTTP 请求 URL 和期望状态码。
4. CSV 模板先配置 CSV 文件路径，再进入循环体检查 HTTP 请求 URL。
5. 点击“运行”后，先看底部“测试报告”页。
6. 只有排查节点执行细节时，再切到“运行事件”。
```

- [ ] **Step 6: Run ConfigPanel tests**

Run:

```powershell
pnpm --filter @node-flow/web test -- components/ConfigPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit guidance and docs**

Run:

```powershell
git add apps/web/src/components/ConfigPanel.tsx apps/web/src/components/ConfigPanel.test.tsx apps/web/src/styles.css README.md
git commit -m "feat: add testing workflow guidance"
```

Expected: commit succeeds.

---

## Task 6: Full Verification And Product Smoke

**Files:**
- Modify only if smoke reveals a concrete bug.

- [ ] **Step 1: Run frontend tests**

Run:

```powershell
pnpm --filter @node-flow/web test
```

Expected: all frontend tests pass.

- [ ] **Step 2: Run frontend build**

Run:

```powershell
pnpm build:web
```

Expected: TypeScript and Vite build pass.

- [ ] **Step 3: Run backend tests**

Run:

```powershell
New-Item -ItemType Directory -Force .tmp | Out-Null
$env:TEMP = (Resolve-Path .tmp)
$env:TMP = (Resolve-Path .tmp)
pytest tests/api -q
```

Expected: `103 passed` or higher. The local `.tmp` override avoids the known Windows Temp permission issue.

- [ ] **Step 4: Browser smoke**

Run the dev servers:

```powershell
$pnpm = 'C:\Users\Administrator\AppData\Roaming\npm\pnpm.cmd'
Start-Process -FilePath $pnpm -ArgumentList 'dev:api' -WorkingDirectory 'D:\learn\node-flow' -WindowStyle Hidden
Start-Process -FilePath $pnpm -ArgumentList 'dev:web' -WorkingDirectory 'D:\learn\node-flow' -WindowStyle Hidden
```

Open:

```text
http://127.0.0.1:5173
```

Smoke checklist:

- Empty canvas shows "从接口测试模板开始".
- "单接口状态码断言" creates a workflow and selects HTTP request.
- Bottom run panel defaults to "测试报告".
- "运行事件" tab still shows raw event rows.
- "CSV 参数化接口测试" creates a `control.foreach` node with a body subflow.
- Config panel guidance appears for HTTP request, CSV read, status-code assertion, and write report nodes.

- [ ] **Step 5: Stop dev servers**

Run:

```powershell
$owners = Get-NetTCPConnection -LocalPort 8000,5173 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
foreach ($id in $owners) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
```

Expected: no listeners remain on ports 8000 or 5173.

- [ ] **Step 6: Check working tree**

Run:

```powershell
git status --short
```

Expected: no tracked file changes. `.tmp/` may remain untracked if dev logs were created.

- [ ] **Step 7: Commit smoke fixes if any**

If smoke required code fixes, commit them:

```powershell
git add apps/web/src README.md
git commit -m "fix: polish api testing workbench"
```

Expected: commit succeeds only if there were real fixes. If no fixes were needed, skip this step.

---

## Self-Review

Spec coverage:

- Empty-canvas workbench entry: Task 2.
- Two templates: Task 1 and Task 2.
- Frontend template generation: Task 1.
- Report extraction: Task 3.
- Report/events tabs: Task 4.
- Report summary and case table: Task 4.
- Friendly empty states and Chinese guidance: Tasks 2, 4, and 5.
- README updates: Task 5.
- Browser smoke: Task 6.

Scope check:

- No backend report API is introduced.
- No project/user/environment/test-suite model is introduced.
- No specialized HTTP request builder UI is introduced.

Type consistency:

- Template ids are `single-api-status-code` and `csv-parameterized-api`.
- Primary node ids are stable ids inside generated workflows.
- CSV `items_expression` uses `{{ nodes.csv.outputs.success.rows }}`.
- Report extraction reads `payload.outputs.success`.
