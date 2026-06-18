import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

describe("App", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      })
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders the editor shell", () => {
    render(<App />);

    expect(screen.getByText("节点流")).toBeInTheDocument();
    expect(screen.getByLabelText("画布工作区")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "验证" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "运行" })).toBeInTheDocument();
  });

  it("shows Chinese node labels while keeping script ids visible", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([
          {
            id: "manual.trigger",
            name: "Manual Trigger",
            category: "Triggers",
            description: "Starts a workflow manually.",
            inputs: {},
            outputs: { success: { description: "Initial payload" } },
            configSchema: { type: "object", properties: {} },
          },
        ]);
      }
      if (url.endsWith("/api/workflows")) {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByRole("button", { name: "手动触发 manual.trigger" })).toBeInTheDocument();
  });

  it("shows first-phase testing nodes in Chinese", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([
          {
            id: "data.csv_read",
            name: "Read CSV",
            category: "Data",
            description: "Read CSV rows for data-driven tests.",
            inputs: {},
            outputs: { success: { description: "CSV rows" } },
            configSchema: {
              type: "object",
              properties: {
                path: { title: "CSV file path", type: "string" },
                delimiter: { title: "Delimiter", type: "string", default: "," },
                has_header: { title: "Has Header", type: "boolean", default: true },
              },
            },
          },
          {
            id: "assert.status_code",
            name: "Assert Status Code",
            category: "Assertions",
            description: "Assert an HTTP response status code.",
            inputs: { input: { description: "HTTP response" } },
            outputs: { passed: { description: "Passed" }, failed: { description: "Failed" } },
            configSchema: {
              type: "object",
              properties: {
                expected: { title: "Expected", type: "integer", default: 200 },
              },
            },
          },
          {
            id: "test.write_report",
            name: "Write Test Report",
            category: "Testing",
            description: "Write a test report.",
            inputs: { input: { description: "Report" } },
            outputs: { success: { description: "Written" }, error: { description: "Error" } },
            configSchema: {
              type: "object",
              properties: {
                path: { title: "Report path", type: "string" },
              },
            },
          },
        ]);
      }
      if (url.endsWith("/api/workflows")) {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByRole("button", { name: "读取 CSV data.csv_read" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "状态码断言 assert.status_code" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "写入测试报告 test.write_report" })).toBeInTheDocument();
    expect(screen.getByText("数据")).toBeInTheDocument();
    expect(screen.getByText("断言")).toBeInTheDocument();
    expect(screen.getByText("测试")).toBeInTheDocument();
  });

  it("does not show generated node instance ids on the canvas", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([
          {
            id: "manual.trigger",
            name: "Manual Trigger",
            category: "Triggers",
            description: "Starts a workflow manually.",
            inputs: {},
            outputs: { success: { description: "Initial payload" } },
            configSchema: { type: "object", properties: {} },
          },
        ]);
      }
      if (url.endsWith("/api/workflows")) {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "手动触发 manual.trigger" }));
    const canvas = screen.getByLabelText("画布工作区");

    expect(within(canvas).getByText("手动触发")).toBeInTheDocument();
    expect(within(canvas).queryByText(/^node_/)).not.toBeInTheDocument();
  });

  it("applies the single API status code template from the empty canvas", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([
          {
            id: "control.start",
            name: "Start",
            category: "Control",
            description: "Start the workflow.",
            inputs: {},
            outputs: { success: { description: "Started" } },
            configSchema: { type: "object", properties: {} },
          },
          {
            id: "http.request",
            name: "HTTP Request",
            category: "Network",
            description: "Send an HTTP request.",
            inputs: { body: { description: "Request body" } },
            outputs: { success: { description: "Response" } },
            configSchema: { type: "object", properties: {} },
          },
          {
            id: "assert.status_code",
            name: "Assert Status Code",
            category: "Assertions",
            description: "Assert an HTTP status code.",
            inputs: { input: { description: "Response" } },
            outputs: { passed: { description: "Passed" } },
            configSchema: { type: "object", properties: {} },
          },
          {
            id: "test.record_result",
            name: "Record Test Result",
            category: "Testing",
            description: "Record an assertion result.",
            inputs: { input: { description: "Result" } },
            outputs: { success: { description: "Recorded" } },
            configSchema: { type: "object", properties: {} },
          },
          {
            id: "test.summary",
            name: "Test Summary",
            category: "Testing",
            description: "Summarize test results.",
            inputs: { input: { description: "Results" } },
            outputs: { success: { description: "Summary" } },
            configSchema: { type: "object", properties: {} },
          },
          {
            id: "test.write_report",
            name: "Write Test Report",
            category: "Testing",
            description: "Write a test report.",
            inputs: { input: { description: "Report" } },
            outputs: { success: { description: "Written" } },
            configSchema: { type: "object", properties: {} },
          },
        ]);
      }
      if (url.endsWith("/api/workflows")) {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    const templateCard = await screen.findByRole("article", { name: "单接口状态码断言" });
    fireEvent.click(within(templateCard).getByRole("button", { name: "使用模板" }));

    const canvas = screen.getByLabelText("画布工作区");
    expect(within(canvas).getByText("HTTP 请求")).toBeInTheDocument();
    expect(within(canvas).getByText("状态码断言")).toBeInTheDocument();
    expect(screen.getByLabelText("工作流名称")).toHaveValue("单接口状态码断言");
  });

  it("disables empty canvas templates while a run is in flight and restores them after it settles", async () => {
    const saveWorkflow = deferred<Response>();
    const run = {
      id: "run_1",
      workflow_id: "wf_1",
      workflow_version: 2,
      status: "succeeded",
      created_at: "2026-06-18T00:00:00Z",
      started_at: "2026-06-18T00:00:01Z",
      completed_at: "2026-06-18T00:00:02Z",
      error: null,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows") && init?.method !== "POST") {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows") && init?.method === "POST") {
        return saveWorkflow.promise;
      }
      if (url.endsWith("/api/workflows/wf_1/runs") && init?.method === "POST") {
        return jsonResponse(run);
      }
      if (url.endsWith("/api/runs/run_1/events")) {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    const templateCard = await screen.findByRole("article", { name: "单接口状态码断言" });
    const templateButton = within(templateCard).getByRole("button", { name: "使用模板" });
    fireEvent.click(screen.getByRole("button", { name: "运行" }));

    await waitFor(() => expect(templateButton).toBeDisabled());

    saveWorkflow.resolve(jsonResponse({ id: "wf_1", name: "未命名工作流", version: 2, nodes: [], edges: [] }));

    await screen.findByText("运行 run_1 成功。");
    await waitFor(() => expect(templateButton).toBeEnabled());
  });

  it("loads the saved workflow list on startup", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows")) {
        return jsonResponse([{ id: "wf_saved", name: "Saved Import", version: 4 }]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    const selector = await screen.findByLabelText("已保存工作流");
    expect(selector).toHaveValue("");
    expect(screen.getByRole("option", { name: "Saved Import v4" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/api/workflows",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("loads a selected saved workflow into the editor", async () => {
    const savedWorkflow = workflowDocument({ id: "wf_saved", name: "Customer Intake", version: 3 });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows")) {
        return jsonResponse([{ id: "wf_saved", name: "Customer Intake", version: 3 }]);
      }
      if (url.endsWith("/api/workflows/wf_saved")) {
        return jsonResponse(savedWorkflow);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.change(await screen.findByLabelText("已保存工作流"), { target: { value: "wf_saved" } });

    await screen.findByText("已加载 Customer Intake v3。");
    expect(screen.getByLabelText("工作流名称")).toHaveValue("Customer Intake");
  });

  it("starts a new empty workflow after a saved workflow is loaded", async () => {
    const savedWorkflow = workflowDocument({
      id: "wf_saved",
      name: "Customer Intake",
      version: 3,
      nodes: [
        {
          id: "node_1",
          type: "manual.trigger",
          position: { x: 80, y: 80 },
          config: {},
        },
      ],
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([
          {
            id: "manual.trigger",
            name: "Manual Trigger",
            category: "Triggers",
            description: "Starts a workflow manually.",
            inputs: {},
            outputs: {},
            configSchema: { type: "object", properties: {} },
          },
        ]);
      }
      if (url.endsWith("/api/workflows")) {
        return jsonResponse([{ id: "wf_saved", name: "Customer Intake", version: 3 }]);
      }
      if (url.endsWith("/api/workflows/wf_saved")) {
        return jsonResponse(savedWorkflow);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.change(await screen.findByLabelText("已保存工作流"), { target: { value: "wf_saved" } });
    await screen.findByText("已加载 Customer Intake v3。");
    expect(within(screen.getByLabelText("画布工作区")).getByText("手动触发")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "新建" }));

    expect(screen.getByLabelText("工作流名称")).toHaveValue("未命名工作流");
    expect(screen.getByLabelText("已保存工作流")).toHaveValue("");
    expect(within(screen.getByLabelText("画布工作区")).queryByText("手动触发")).not.toBeInTheDocument();
    expect(screen.getByText("已新建工作流。")).toBeInTheDocument();
  });

  it("updates the saved workflow selector after saving", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows") && init?.method !== "POST") {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows") && init?.method === "POST") {
        return jsonResponse({ ...(JSON.parse(String(init.body)) as object), id: "wf_saved", version: 2 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.change(screen.getByLabelText("工作流名称"), { target: { value: "Saved From Editor" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await screen.findByText("已保存 v2。");
    expect(screen.getByLabelText("已保存工作流")).toHaveValue("wf_saved");
    expect(screen.getByRole("option", { name: "Saved From Editor v2" })).toBeInTheDocument();
  });

  it("saves the workflow, creates a run, and loads initial run events", async () => {
    const nodeType = {
      id: "manual.trigger",
      name: "Manual Trigger",
      category: "Triggers",
      description: "Starts a workflow manually.",
      inputs: {},
      outputs: { success: { description: "Initial payload" } },
      configSchema: { type: "object", properties: {} },
    };
    const run = {
      id: "run_1",
      workflow_id: "wf_1",
      workflow_version: 2,
      status: "succeeded",
      created_at: "2026-06-16T00:00:00Z",
      started_at: "2026-06-16T00:00:01Z",
      completed_at: "2026-06-16T00:00:02Z",
      error: null,
    };
    const event = {
      id: 1,
      run_id: "run_1",
      type: "workflow.completed",
      timestamp: "2026-06-16T00:00:02Z",
      node_id: null,
      scope: [],
      payload: {},
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([nodeType]);
      }
      if (url.endsWith("/api/workflows") && init?.method !== "POST") {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows") && init?.method === "POST") {
        return jsonResponse({ ...(JSON.parse(String(init.body)) as object), id: "wf_1", version: 2 });
      }
      if (url.endsWith("/api/workflows/wf_1/runs") && init?.method === "POST") {
        return jsonResponse(run);
      }
      if (url.endsWith("/api/runs/run_1/events")) {
        return jsonResponse([event]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <StrictMode>
        <App />
      </StrictMode>
    );

    fireEvent.click(await screen.findByRole("button", { name: "手动触发 manual.trigger" }));
    fireEvent.click(screen.getByRole("button", { name: "运行" }));

    await screen.findByText("运行 run_1 成功。");
    fireEvent.click(screen.getByRole("tab", { name: "运行事件" }));
    expect(screen.getByText("工作流完成")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "运行" })).toBeEnabled());
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/api/workflows/wf_1/runs",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/api/runs/run_1/events",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("cancels an in-flight run from the topbar", async () => {
    const nodeType = {
      id: "manual.trigger",
      name: "Manual Trigger",
      category: "Triggers",
      description: "Starts a workflow manually.",
      inputs: {},
      outputs: { success: { description: "Initial payload" } },
      configSchema: { type: "object", properties: {} },
    };
    const runningRun = {
      id: "run_1",
      workflow_id: "wf_1",
      workflow_version: 2,
      status: "running",
      created_at: "2026-06-18T00:00:00Z",
      started_at: "2026-06-18T00:00:01Z",
      completed_at: null,
      error: null,
      cancel_requested_at: null,
    };
    const cancelRequestedRun = {
      ...runningRun,
      cancel_requested_at: "2026-06-18T00:00:02Z",
    };
    const cancelledRun = {
      ...runningRun,
      status: "cancelled",
      completed_at: "2026-06-18T00:00:02Z",
      cancel_requested_at: "2026-06-18T00:00:02Z",
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([nodeType]);
      }
      if (url.endsWith("/api/workflows") && init?.method !== "POST") {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows") && init?.method === "POST") {
        return jsonResponse({ ...(JSON.parse(String(init.body)) as object), id: "wf_1", version: 2 });
      }
      if (url.endsWith("/api/workflows/wf_1/runs") && init?.method === "POST") {
        return jsonResponse(runningRun);
      }
      if (url.endsWith("/api/runs/run_1/events")) {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/runs/run_1/cancel") && init?.method === "POST") {
        return jsonResponse(cancelRequestedRun);
      }
      if (url.endsWith("/api/runs/run_1")) {
        return jsonResponse(cancelledRun);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "手动触发 manual.trigger" }));
    fireEvent.click(screen.getByRole("button", { name: "运行" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "取消" })).toBeEnabled());
    const cancelButton = screen.getByRole("button", { name: "取消" });

    fireEvent.click(cancelButton);

    await screen.findByText("运行 run_1 已取消。");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/api/runs/run_1/cancel",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/api/runs/run_1",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("selects a node from the run log and shows its runtime details", async () => {
    const nodeType = {
      id: "manual.trigger",
      name: "Manual Trigger",
      category: "Triggers",
      description: "Starts a workflow manually.",
      inputs: {},
      outputs: { success: { description: "Initial payload" } },
      configSchema: { type: "object", properties: {} },
    };
    const run = {
      id: "run_1",
      workflow_id: "wf_1",
      workflow_version: 2,
      status: "succeeded",
      created_at: "2026-06-18T00:00:00Z",
      started_at: "2026-06-18T00:00:01Z",
      completed_at: "2026-06-18T00:00:02Z",
      error: null,
    };
    let savedNodeId = "";
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([nodeType]);
      }
      if (url.endsWith("/api/workflows") && init?.method !== "POST") {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as import("./types").WorkflowDocument;
        savedNodeId = body.nodes[0].id;
        return jsonResponse({ ...body, id: "wf_1", version: 2 });
      }
      if (url.endsWith("/api/workflows/wf_1/runs") && init?.method === "POST") {
        return jsonResponse(run);
      }
      if (url.endsWith("/api/runs/run_1/events")) {
        return jsonResponse([
          {
            id: 1,
            run_id: "run_1",
            type: "node_succeeded",
            timestamp: "2026-06-18T00:00:02Z",
            node_id: savedNodeId,
            scope: [],
            payload: {
              outputs: { success: { name: "Alice" } },
              duration_ms: 4,
            },
          },
        ]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "手动触发 manual.trigger" }));
    fireEvent.click(screen.getByRole("button", { name: "运行" }));

    await screen.findByText("运行 run_1 成功。");
    fireEvent.click(screen.getByRole("tab", { name: "运行事件" }));
    fireEvent.click(screen.getByRole("button", { name: /节点成功/ }));
    fireEvent.click(screen.getByRole("tab", { name: "运行详情" }));

    expect(screen.getByText("状态：成功")).toBeInTheDocument();
    expect(screen.getByText("耗时：4 ms")).toBeInTheDocument();
    expect(screen.getAllByText(/Alice/).length).toBeGreaterThan(0);
  });

  it("edits a structured loop body subflow from the frontend", async () => {
    const forEachType = {
      id: "control.foreach",
      name: "For Each",
      category: "Control",
      description: "Runs body nodes for each item.",
      inputs: { items: { description: "Items" } },
      outputs: { done: { description: "Done" } },
      configSchema: {
        type: "object",
        properties: {
          items_path: { title: "Items Path", type: "string", default: "$.items" },
        },
      },
    };
    const logType = {
      id: "action.log",
      name: "Log",
      category: "Actions",
      description: "Writes a log entry.",
      inputs: { input: { description: "Input" } },
      outputs: { done: { description: "Done" } },
      configSchema: {
        type: "object",
        properties: {
          message: { title: "Message", type: "string", default: "hello" },
        },
      },
    };
    const savedWorkflows: unknown[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([forEachType, logType]);
      }
      if (url.endsWith("/api/workflows") && init?.method !== "POST") {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        savedWorkflows.push(body);
        return jsonResponse({ ...body, id: "wf_saved", version: 2 });
      }
      if (url.endsWith("/api/workflows/validate") && init?.method === "POST") {
        return jsonResponse({ valid: true, issues: [] });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "遍历循环 control.foreach" }));
    const canvas = screen.getByLabelText("画布工作区");
    expect(within(canvas).getByText("遍历循环")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "编辑循环体" }));

    expect(screen.getByText("/ 遍历循环.循环体")).toBeInTheDocument();
    expect(within(canvas).queryByText("遍历循环")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "记录日志 action.log" }));
    expect(within(canvas).getByText("记录日志")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "主流程" }));
    expect(within(canvas).getByText("遍历循环")).toBeInTheDocument();
    expect(within(canvas).queryByText("记录日志")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await screen.findByText("已保存 v2。");
    const savedWorkflow = savedWorkflows.at(-1) as {
      nodes: Array<{ type: string; subflows?: { body?: { nodes: Array<{ type: string }> } } }>;
    };
    expect(savedWorkflow.nodes).toHaveLength(1);
    expect(savedWorkflow.nodes[0].type).toBe("control.foreach");
    expect(savedWorkflow.nodes[0].subflows?.body?.nodes).toEqual([expect.objectContaining({ type: "action.log" })]);

    fireEvent.click(screen.getByRole("button", { name: "验证" }));
    await screen.findByText("工作流验证通过。");
  });

  it("edits nested structured loop body subflows from the frontend", async () => {
    const forEachType = {
      id: "control.foreach",
      name: "For Each",
      category: "Control",
      description: "Runs body nodes for each item.",
      inputs: { items: { description: "Items" } },
      outputs: { done: { description: "Done" } },
      configSchema: { type: "object", properties: {} },
    };
    const whileType = {
      id: "control.while",
      name: "While",
      category: "Control",
      description: "Runs body nodes while a condition is true.",
      inputs: { input: { description: "Input" } },
      outputs: { done: { description: "Done" } },
      configSchema: { type: "object", properties: {} },
    };
    const logType = {
      id: "action.log",
      name: "Log",
      category: "Actions",
      description: "Writes a log entry.",
      inputs: { input: { description: "Input" } },
      outputs: { done: { description: "Done" } },
      configSchema: { type: "object", properties: {} },
    };
    const savedWorkflows: unknown[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([forEachType, whileType, logType]);
      }
      if (url.endsWith("/api/workflows") && init?.method !== "POST") {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        savedWorkflows.push(body);
        return jsonResponse({ ...body, id: "wf_saved", version: 2 });
      }
      if (url.endsWith("/api/workflows/validate") && init?.method === "POST") {
        return jsonResponse({ valid: true, issues: [] });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "遍历循环 control.foreach" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑循环体" }));
    expect(screen.getByText("/ 遍历循环.循环体")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "条件循环 control.while" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑循环体" }));
    expect(screen.getByText("/ 遍历循环.循环体 / 条件循环.循环体")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "记录日志 action.log" }));
    const canvas = screen.getByLabelText("画布工作区");
    expect(within(canvas).getByText("记录日志")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "主流程" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await screen.findByText("已保存 v2。");
    const savedWorkflow = savedWorkflows.at(-1) as {
      nodes: Array<{
        type: string;
        subflows?: { body?: { nodes: Array<{ type: string; subflows?: { body?: { nodes: Array<{ type: string }> } } }> } };
      }>;
    };
    const whileNode = savedWorkflow.nodes[0].subflows?.body?.nodes[0];
    expect(savedWorkflow.nodes[0].type).toBe("control.foreach");
    expect(whileNode?.type).toBe("control.while");
    expect(whileNode?.subflows?.body?.nodes).toEqual([expect.objectContaining({ type: "action.log" })]);

    fireEvent.click(screen.getByRole("button", { name: "验证" }));
    await screen.findByText("工作流验证通过。");
  });
});

function jsonResponse(body: unknown) {
  return {
    ok: true,
    json: () => Promise.resolve(body),
  } as Response;
}

function workflowDocument(overrides: Partial<import("./types").WorkflowDocument> = {}): import("./types").WorkflowDocument {
  return {
    id: "wf_1",
    name: "未命名工作流",
    version: 1,
    nodes: [],
    edges: [],
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, reject, resolve };
}
