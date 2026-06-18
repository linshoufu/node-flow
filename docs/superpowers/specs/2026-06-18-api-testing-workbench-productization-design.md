# API Testing Workbench Productization Design

Date: 2026-06-18

## Goal

Move Node Flow from a developer-facing node editor MVP toward a product-like interface that test teammates can use for API automation without first understanding the Python node system.

The fifth phase focuses on two visible product improvements:

- Start from API testing templates instead of an empty canvas.
- Show test reports as the default run result instead of raw run events.

The existing node editor remains the underlying advanced surface. This phase adds a testing workbench layer on top of it rather than replacing the graph model.

## Target User

The target user is a teammate in a testing team.

They should be able to:

- Open the app and understand how to start.
- Create a common API testing workflow from a template.
- Edit only the key testing parameters at first.
- Run the workflow.
- Read pass/fail results in a report-oriented view.
- Fall back to node details and raw events when debugging is needed.

## Product Principles

- Template first, graph second.
- Report first, event log second.
- Keep developer power available, but do not make it the first thing a tester must understand.
- Reuse the existing workflow graph, run events, node registry, and executor.
- Avoid large platform concepts such as projects, users, environments, and suites in this phase.

## Scope

### In Scope

- Empty-canvas workbench entry with testing templates.
- Two initial API testing templates:
  - Single API status-code assertion.
  - CSV parameterized API test with report output.
- Frontend template generation for workflow graphs.
- Test report extraction from existing run events.
- Run panel tabs:
  - Test Report.
  - Run Events.
- Report summary:
  - Total cases.
  - Passed cases.
  - Failed cases.
  - Pass rate.
- Report case table:
  - Status.
  - Case name or iteration label.
  - Assertion type.
  - Expected value.
  - Actual value.
  - Failure message.
  - Node id and loop scope.
- Friendly empty states and Chinese guidance.
- README updates for tester-facing usage.

### Out Of Scope

- Multi-user authentication and permissions.
- Project management.
- Environment variable management UI.
- Online Python node editing.
- Full test suite and test case domain model.
- Distributed workers.
- Backend report API or report database tables.
- A specialized full HTTP request builder UI.

## User Experience

### Empty Workflow

When the current editable workflow has no nodes, the canvas shows a workbench empty state:

- Title: "从接口测试模板开始"
- Template action: "单接口状态码断言"
- Template action: "CSV 参数化接口测试"
- Secondary copy that explains the advanced node editor is still available from the node library.

The node library remains visible. Clicking a node still adds it to the canvas.

### Template Application

When the user clicks a template:

1. The app creates a new `WorkflowDocument`.
2. The template populates nodes, edges, configs, and subflows.
3. Existing run state is cleared.
4. The most important configuration node is selected.
5. The message bar explains the next action in Chinese.

Template application does not automatically save. The user can inspect and adjust before saving or running.

### Single API Status-Code Assertion Template

Generated flow:

```text
Manual Trigger
  -> HTTP Request
  -> Assert Status Code
  -> Record Test Result
  -> Test Summary
  -> Write Test Report
```

Default configuration:

- HTTP method: `GET`
- URL: `https://example.com`
- Expected status: `200`
- Report path: `reports/single-api-report.json`

Primary selected node after creation:

- `http.request`

### CSV Parameterized API Test Template

Generated root flow:

```text
Manual Trigger
  -> Read CSV
  -> For Each
  -> Test Summary
  -> Write Test Report
```

Generated `For Each.body` subflow:

```text
HTTP Request
  -> Assert Status Code
  -> Record Test Result
```

Default configuration:

- CSV path: `examples/api-cases.csv`
- CSV delimiter: `,`
- CSV has header: `true`
- ForEach `items_expression`: `{{ nodes.csv.outputs.success.rows }}`
- HTTP `url`: `{{ loop.item.url }}`
- HTTP `method`: `GET`
- Status assertion `expected`: `200`
- Report path: `reports/csv-api-report.json`

The first template version keeps `expected` as a fixed status-code field because the current status-code assertion node expects an integer config value. Per-row expected status can be added later by improving the assertion node or adding a transform step.

Primary selected node after creation:

- `data.csv_read`

## Technical Design

### Template Module

Add a frontend module such as `apps/web/src/lib/workflowTemplates.ts`.

Suggested shape:

```ts
type WorkflowTemplate = {
  id: string;
  name: string;
  description: string;
  category: "api-testing";
  primaryNodeType: string;
  requiredNodeTypes: string[];
  createWorkflow: (nodeTypes: NodeType[]) => WorkflowDocument;
};
```

Responsibilities:

- Define product-facing template metadata.
- Check required node type availability.
- Create nodes with stable positions and default config values.
- Create root edges and subflow edges.
- Return a valid `WorkflowDocument`.

If required node types are missing, the UI disables the template action and shows the missing node ids.

Templates should use explicit node ids in generated examples where later expressions reference prior nodes. For example, the CSV template should use a stable csv node id such as `csv` so `{{ nodes.csv.outputs.success.rows }}` remains readable.

### Report Extraction Module

Add a frontend module such as `apps/web/src/lib/testReport.ts`.

Suggested report model:

```ts
type TestReportSummary = {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
};

type TestReportCase = {
  id: string;
  name: string;
  status: "passed" | "failed";
  scope: string[];
  assertionType?: string;
  expected?: unknown;
  actual?: unknown;
  message?: string;
  nodeId?: string;
};

type TestReport = {
  summary: TestReportSummary;
  cases: TestReportCase[];
  hasResults: boolean;
};
```

Extraction priority:

1. Parse `node_succeeded` events for `test.record_result`.
2. Parse `node_succeeded` events for `test.summary`.
3. Use loop `scope` to derive case labels such as `iteration:3`.
4. If a known output shape is incomplete, keep a safe raw-value summary instead of failing the report view.

This phase does not require a backend report endpoint. Existing run events remain the source of truth.

### Run Panel

Change `RunPanel` from a single event list to a tabbed run result panel:

- `测试报告`
- `运行事件`

Default behavior:

- Default to `测试报告`.
- Preserve the selected tab while a run is active.
- Show report empty state when there are no extracted test cases.
- Keep event list behavior intact, including click-to-select-node.

### Test Report View

Add a component such as `TestReportView`.

It renders:

- Run status pill.
- Summary metrics.
- Failure summary if any failures exist.
- Case result table.
- Empty state for workflows without `test.record_result` or `test.summary`.

The view should be compact and work-focused, matching the editor style.

### Guidance Copy

Add product guidance without hiding advanced controls:

- Template creation success message:
  - "已创建单接口状态码断言，请先配置请求 URL 和期望状态码。"
  - "已创建 CSV 参数化接口测试，请先配置 CSV 路径和请求 URL。"
- Config panel suggestions for template-related nodes:
  - HTTP Request: configure method and URL.
  - Read CSV: configure CSV file path.
  - Assert Status Code: configure expected status code.
  - Write Test Report: configure output path.

Guidance should be Chinese and concise.

## Error Handling

- Missing template dependencies:
  - Disable the template action.
  - Show "缺少节点：..." in the empty state.
- No test results:
  - Report tab shows "这次运行还没有测试结果。请加入记录测试结果或测试汇总节点。"
- Run failed with partial results:
  - Report tab still shows extracted cases.
  - Top of report shows run failure message.
  - Event tab preserves raw debugging details.
- Unrecognized report payload:
  - Show the case row with raw message when possible.
  - Do not crash the report view.

## Testing Strategy

Frontend unit tests:

- Template dependency detection.
- Single API template creates expected nodes and edges.
- CSV template creates root graph and `ForEach.body` subflow.
- Template application selects the primary configuration node.
- Report extraction builds total, passed, failed, and pass rate.
- Report extraction handles loop scopes.
- Report extraction returns empty report when no test events exist.
- Run panel defaults to report tab.
- Run panel can switch to event tab.
- Report empty state is shown in Chinese.

Existing backend tests should remain unchanged. Backend tests are only needed if node output shapes must be adjusted later.

Verification commands:

```powershell
pnpm --filter @node-flow/web test
pnpm build:web
pytest tests/api -q
```

Browser smoke:

1. Open an empty workflow.
2. Create the single API status-code assertion template.
3. Confirm nodes and edges appear.
4. Run the workflow.
5. Confirm the Test Report tab is shown by default.
6. Switch to Run Events.
7. Create the CSV parameterized API test template.
8. Confirm the `ForEach` body subflow exists.
9. Confirm report empty states and result states are Chinese.

## Implementation Slices

### Slice 1: Template Infrastructure

- Add template model and template module.
- Add empty-canvas template entry.
- Implement both API testing templates.
- Disable templates with missing dependencies.
- Preserve click-to-add node behavior.

### Slice 2: Test Report Extraction

- Add report model and extraction helper.
- Parse `test.record_result` and `test.summary` events.
- Support loop scope labels.
- Add focused unit tests.

### Slice 3: Run Panel Productization

- Add report/events tabs.
- Add `TestReportView`.
- Keep event list and click-to-select behavior.
- Add empty and partial-result states.

### Slice 4: Guidance And Documentation

- Add template success messages.
- Add next-step suggestions for key testing nodes.
- Update README with tester-facing workflow.

### Slice 5: Product Smoke And Polish

- Run full verification.
- Perform browser smoke.
- Fix copy, spacing, and confusing states found during smoke.

## Success Criteria

The phase is successful when a testing teammate can:

- Start from an API testing template without manually building a graph.
- Understand the next required configuration step.
- Run the generated workflow.
- Read test results from the report tab without inspecting raw events.
- Use raw events only when debugging is needed.

The editor should feel like an API testing workbench with an advanced node editor inside it, not like a bare node demo.
