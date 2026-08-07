import { cleanup, fireEvent, render as testingRender, screen, waitFor, within } from "@testing-library/react";
import { StrictMode, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { NodeFlowMantineProvider } from "./components/NodeFlowMantineProvider";
import type { WorkflowDocument } from "./types";

class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

describe("App", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
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
    window.history.replaceState(null, "", "/");
    vi.unstubAllGlobals();
  });

  it("renders the editor shell", async () => {
    render(<App />);

    expect(screen.getByText("节点流")).toBeInTheDocument();
    // 初始加载阶段画布先展示骨架屏，目录加载完成后才渲染真实画布
    expect(await screen.findByLabelText("画布工作区")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "验证" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "运行" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "展开运行结果" })).toHaveAttribute("aria-expanded", "false");
  });

  it("loads a workflow and selected node from a direct editor URL", async () => {
    window.history.replaceState(null, "", "/workflow/wf_route/node_1");
    const routedWorkflow = workflowDocument({
      id: "wf_route",
      name: "路由恢复工作流",
      nodes: [{
        id: "node_1",
        type: "trigger.manual",
        position: { x: 0, y: 0 },
        config: {},
      }],
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/workflows/wf_route")) {
        return jsonResponse(routedWorkflow);
      }
      if (url.endsWith("/api/workflows/wf_route/publication")) {
        return jsonResponse(workflowPublication("wf_route", 1));
      }
      if (url.endsWith("/api/node-packages")) {
        return jsonResponse({ packages: [], diagnostics: [], legacyNodeCount: 0 });
      }
      return jsonResponse([]);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <StrictMode>
        <App />
      </StrictMode>
    );

    await waitFor(() => expect(screen.getByLabelText("工作流名称")).toHaveValue("路由恢复工作流"));
    expect(window.location.pathname).toBe("/workflow/wf_route/node_1");
    expect(fetchMock.mock.calls.some(([input]) =>
      String(input) === "http://127.0.0.1:8150/api/workflows/wf_route"
    )).toBe(true);
  });

  it("starts and stops a scoped Webhook test listener from the selected node", async () => {
    window.history.replaceState(null, "", "/workflow/wf_webhook/node_webhook");
    const webhookWorkflow = workflowDocument({
      id: "wf_webhook",
      name: "Webhook 调试",
      nodes: [{
        id: "node_webhook",
        type: "webhook.trigger",
        position: { x: 0, y: 0 },
        config: { method: "POST", path: "/orders" },
      }],
    });
    const webhookNodeType = {
      id: "webhook.trigger",
      name: "Webhook Trigger",
      category: "trigger",
      description: "Receive an HTTP request",
      inputs: {},
      outputs: { success: { description: "Request data" } },
      configSchema: {
        type: "object",
        properties: {
          method: { type: "string", title: "Method" },
          path: { type: "string", title: "Path" },
        },
      },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([webhookNodeType]);
      }
      if (url.endsWith("/api/node-packages")) {
        return jsonResponse({ packages: [], diagnostics: [], legacyNodeCount: 0 });
      }
      if (url.endsWith("/api/workflows/wf_webhook/webhook-test/listen") && init?.method === "POST") {
        return jsonResponse({
          active: true,
          expires_at: "2099-08-01T00:00:00Z",
          node_id: "node_webhook",
          workflow_id: "wf_webhook",
        });
      }
      if (
        url.endsWith("/api/workflows/wf_webhook/webhook-test/listen/node_webhook")
        && init?.method === "DELETE"
      ) {
        return jsonResponse({
          active: false,
          node_id: "node_webhook",
          workflow_id: "wf_webhook",
        });
      }
      if (url.endsWith("/api/workflows/wf_webhook/publication")) {
        return jsonResponse(workflowPublication("wf_webhook", 1));
      }
      if (url.endsWith("/api/workflows/wf_webhook/runs?limit=5")) {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows/wf_webhook")) {
        return jsonResponse(webhookWorkflow);
      }
      if (url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true")) {
        return jsonResponse([{ id: "wf_webhook", name: "Webhook 调试", version: 1, node_count: 1 }]);
      }
      return jsonResponse([]);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    const startButton = await screen.findByRole("button", { name: "开始监听" });
    fireEvent.click(startButton);
    expect(await screen.findByText("正在监听调试 Webhook，等待一条请求。")).toBeInTheDocument();
    expect(screen.getByText("监听中：下一条请求会启动调试运行，随后自动结束。")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "停止监听" }));
    expect(await screen.findByText("已停止调试 Webhook 监听。")).toBeInTheDocument();
    expect(screen.getByText("未监听：调试地址不会接收请求。")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8150/api/workflows/wf_webhook/webhook-test/listen",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8150/api/workflows/wf_webhook/webhook-test/listen/node_webhook",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("restores a historical execution and selected node from a direct URL", async () => {
    window.history.replaceState(null, "", "/workflow/wf_exec/executions/run_exec/node_1");
    const currentWorkflow = workflowDocument({
      id: "wf_exec",
      name: "运行详情深链接",
      version: 2,
      nodes: [{ id: "node_1", type: "trigger.manual", position: { x: 0, y: 0 }, config: {} }],
    });
    const executedWorkflow = {
      ...currentWorkflow,
      version: 1,
      nodes: [{ ...currentWorkflow.nodes[0], label: "执行时节点" }],
    };
    const historicalRun = {
      id: "run_exec",
      workflow_id: "wf_exec",
      workflow_version: 1,
      status: "succeeded" as const,
      created_at: "2026-08-01T00:00:00Z",
      started_at: "2026-08-01T00:00:01Z",
      completed_at: "2026-08-01T00:00:02Z",
      error: null,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/workflows/wf_exec/versions/1")) {
        return jsonResponse(executedWorkflow);
      }
      if (url.endsWith("/api/workflows/wf_exec/publication")) {
        return jsonResponse(workflowPublication("wf_exec", 2));
      }
      if (url.endsWith("/api/workflows/wf_exec/runs?limit=5")) {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows/wf_exec")) {
        return jsonResponse(currentWorkflow);
      }
      if (url.endsWith("/api/runs/run_exec/events")) {
        return jsonResponse([{
          id: 1,
          run_id: "run_exec",
          type: "node_succeeded",
          timestamp: "2026-08-01T00:00:02Z",
          node_id: "node_1",
          scope: [],
          payload: { outputs: { success: { ok: true } }, duration_ms: 10 },
        }]);
      }
      if (url.endsWith("/api/runs/run_exec")) {
        return jsonResponse(historicalRun);
      }
      if (url.endsWith("/api/node-packages")) {
        return jsonResponse({ packages: [], diagnostics: [], legacyNodeCount: 0 });
      }
      return jsonResponse([]);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    const runPanel = await screen.findByLabelText("运行结果");
    expect(await within(runPanel).findByText("历史运行")).toBeInTheDocument();
    expect(within(runPanel).getByText("版本 v1")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/workflow/wf_exec/executions/run_exec/node_1");
    expect(screen.getByLabelText("执行时节点 当前节点详情")).toBeInTheDocument();
  });

  it("rejects an execution URL whose run belongs to another workflow", async () => {
    window.history.replaceState(null, "", "/workflow/wf_expected/executions/run_other");
    const expectedWorkflow = workflowDocument({ id: "wf_expected", name: "预期工作流" });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/workflows/wf_expected/publication")) {
        return jsonResponse(workflowPublication("wf_expected", 1));
      }
      if (url.endsWith("/api/workflows/wf_expected/runs?limit=5")) {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows/wf_expected")) {
        return jsonResponse(expectedWorkflow);
      }
      if (url.endsWith("/api/runs/run_other")) {
        return jsonResponse({
          id: "run_other",
          workflow_id: "wf_actual",
          workflow_version: 1,
          status: "failed",
          created_at: "2026-08-01T00:00:00Z",
          error: "boom",
        });
      }
      if (url.endsWith("/api/node-packages")) {
        return jsonResponse({ packages: [], diagnostics: [], legacyNodeCount: 0 });
      }
      return jsonResponse([]);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByText("运行记录与当前工作流不匹配，已停止打开。")).toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe("/workflow/wf_expected"));
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/api/runs/run_other/events"))).toBe(false);
  });

  it("moves a newly saved workflow to its durable editor URL", async () => {
    const savedWorkflow = workflowDocument({ id: "wf_saved_route", name: "可恢复地址", version: 1 });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/workflows?draft=true") && init?.method === "POST") {
        return jsonResponse(savedWorkflow);
      }
      if (url.endsWith("/api/workflows/wf_saved_route/publication")) {
        return jsonResponse(workflowPublication("wf_saved_route", 1));
      }
      if (url.endsWith("/api/node-packages")) {
        return jsonResponse({ packages: [], diagnostics: [], legacyNodeCount: 0 });
      }
      return jsonResponse([]);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    await waitFor(() => expect(window.location.pathname).toBe("/workflow/new"));

    fireEvent.change(screen.getByLabelText("工作流名称"), { target: { value: "可恢复地址" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(window.location.pathname).toBe("/workflow/wf_saved_route"));
    expect(screen.getByLabelText("工作流名称")).toHaveValue("可恢复地址");
  });

  it("restores the current URL when browser navigation would discard local changes", async () => {
    window.history.replaceState(null, "", "/workflow/wf_current");
    const currentWorkflow = workflowDocument({ id: "wf_current", name: "当前工作流" });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/workflows/wf_current")) {
        return jsonResponse(currentWorkflow);
      }
      if (url.endsWith("/api/workflows/wf_current/publication")) {
        return jsonResponse(workflowPublication("wf_current", 1));
      }
      if (url.endsWith("/api/node-packages")) {
        return jsonResponse({ packages: [], diagnostics: [], legacyNodeCount: 0 });
      }
      return jsonResponse([]);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    await waitFor(() => expect(screen.getByLabelText("工作流名称")).toHaveValue("当前工作流"));
    fireEvent.change(screen.getByLabelText("工作流名称"), { target: { value: "尚未保存" } });

    window.history.pushState(null, "", "/workflow/wf_other");
    fireEvent.popState(window);

    // 统一确认弹窗替换 window.confirm：拒绝丢弃后导航被还原
    const discardDialog = await screen.findByRole("dialog", { name: "丢弃未保存修改？" });
    fireEvent.click(within(discardDialog).getByRole("button", { name: "取消" }));

    await waitFor(() => expect(window.location.pathname).toBe("/workflow/wf_current"));
    expect(screen.queryByRole("dialog", { name: "丢弃未保存修改？" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("工作流名称")).toHaveValue("尚未保存");
    expect(fetchMock.mock.calls.some(([input]) =>
      String(input) === "http://127.0.0.1:8150/api/workflows/wf_other"
    )).toBe(false);
  });

  it("loads package status on startup and reports recovered package transactions", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/node-packages")) {
        return jsonResponse({
          packages: [
            {
              id: "nodeflow.builtin",
              name: "内置节点",
              version: "1.0.0",
              status: "loaded",
              nodeIds: [],
              credentialTypeIds: [],
              engines: {},
              pythonDependencies: [],
              compatibility: { status: "compatible" },
            },
          ],
          diagnostics: [],
          legacyNodeCount: 0,
          recoveries: [
            {
              transactionId: "tx_123",
              packageId: "example.tools",
              operation: "activate",
              action: "rolled_back",
              recoveredAt: "2026-07-31T12:00:00Z",
            },
          ],
        });
      }
      return jsonResponse([]);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(
      await screen.findByText("已加载 0 个节点，并恢复 1 个中断的节点包事务。"),
    ).toBeInTheDocument();
    expect(screen.getByText("已恢复中断的节点包事务")).toBeInTheDocument();
  });

  it("opens workspace managers from one resource entry without stacking dialogs", async () => {
    render(<App />);

    const resourceTrigger = screen.getByRole("button", { name: "资源" });
    fireEvent.click(resourceTrigger);
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "资源管理" })).getByRole("button", {
        name: /^凭据 /,
      }),
    );
    const credentialDialog = await screen.findByRole("dialog", { name: "凭据管理" });
    expect(credentialDialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(window.location.pathname).toBe("/resources/credentials");

    // 资源页面按 Escape 返回工作流，页面内容随之卸载
    fireEvent.keyDown(document, { key: "Escape" });
    expect(await screen.findByRole("button", { name: "资源" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "凭据管理" })).not.toBeInTheDocument();
    fireEvent.click(resourceTrigger);
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "资源管理" })).getByRole("button", {
        name: /^项目变量 /,
      }),
    );

    expect(await screen.findByRole("dialog", { name: "项目变量管理" })).toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(window.location.pathname).toBe("/resources/variables");
  });

  it("opens the command palette with Ctrl+K and dispatches resource commands", async () => {
    render(<App />);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const palette = screen.getByRole("dialog", { name: "命令面板" });
    const search = within(palette).getByRole("combobox", { name: "搜索命令" });
    fireEvent.change(search, { target: { value: "项目变量" } });
    fireEvent.keyDown(search, { key: "Enter" });

    expect(screen.queryByRole("dialog", { name: "命令面板" })).not.toBeInTheDocument();
    expect(await screen.findByRole("dialog", { name: "项目变量管理" })).toBeInTheDocument();
  });

  it("starts a run with one-time JSON input without changing the workflow definition", async () => {
    const savedWorkflow = workflowDocument({ id: "wf_manual_input", name: "临时输入", version: 1 });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true")) && init?.method !== "POST") {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows?draft=true") && init?.method === "POST") {
        return jsonResponse(savedWorkflow);
      }
      if (url.endsWith("/api/workflows/wf_manual_input/runs") && init?.method === "POST") {
        return jsonResponse({
          id: "run_manual_input",
          workflow_id: "wf_manual_input",
          workflow_version: 1,
          status: "succeeded",
          created_at: "2026-07-23T00:00:00Z",
          started_at: "2026-07-23T00:00:00Z",
          completed_at: "2026-07-23T00:00:00Z",
          error: null,
        });
      }
      if (url.endsWith("/api/runs/run_manual_input/events")) {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/runs/run_manual_input/queue")) {
        return jsonResponse(null);
      }
      if (url.endsWith("/api/workflows/wf_manual_input/runs?limit=5")) {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "设置本次运行输入" }));
    const dialog = screen.getByRole("dialog", { name: "本次运行输入" });
    fireEvent.change(within(dialog).getByLabelText("运行输入 JSON"), { target: { value: '{"case_id":17}' } });
    fireEvent.click(within(dialog).getByRole("button", { name: "带输入运行" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:8150/api/workflows/wf_manual_input/runs",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ initial_input: { case_id: 17 } }),
        })
      )
    );
    expect(screen.queryByRole("dialog", { name: "本次运行输入" })).not.toBeInTheDocument();
  });

  it("previews and applies saved workflow node upgrades", async () => {
    const savedWorkflow = { id: "wf_versioned", name: "版本迁移", version: 1, nodes: [], edges: [] };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([
          {
            id: "http.request",
            name: "HTTP Request",
            displayName: "HTTP 请求",
            category: "Network",
            description: "Request",
            inputs: {},
            outputs: {},
            configSchema: {},
          },
        ]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true")) && init?.method !== "POST") {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows?draft=true") && init?.method === "POST") {
        return jsonResponse(savedWorkflow);
      }
      if (url.endsWith("/api/workflows/wf_versioned/upgrades/preview")) {
        return jsonResponse({
          workflow: savedWorkflow,
          upgrades: [
            {
              nodeId: "request",
              path: "nodes.request",
              nodeType: "http.request",
              fromVersion: 1,
              toVersion: 2,
              configChanges: [
                { path: "config.message", kind: "changed", before: "old", after: "new" },
                { path: "config.legacy", kind: "removed", before: "deprecated", after: null },
              ],
              migrationNotes: ["v1 到 v2：修改 config.message；删除 config.legacy"],
            },
          ],
        });
      }
      if (url.endsWith("/api/workflows/wf_versioned/upgrades/apply")) {
        return jsonResponse({ ...savedWorkflow, version: 2 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    const checkButton = await screen.findByRole("button", { name: "检查节点升级" });
    fireEvent.click(checkButton);

    expect(await screen.findByRole("region", { name: "节点升级" })).toBeInTheDocument();
    expect(screen.getByText("HTTP 请求：v1 升级到 v2")).toBeInTheDocument();
    expect(screen.getByText("修改 config.message：old -> new")).toBeInTheDocument();
    expect(screen.getByText("删除 config.legacy：deprecated")).toBeInTheDocument();
    expect(screen.getByText("v1 到 v2：修改 config.message；删除 config.legacy")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "应用升级" }));

    await waitFor(() => {
      expect(screen.queryByRole("region", { name: "节点升级" })).not.toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/workflows\/wf_versioned\/upgrades\/apply$/),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("reloads Python node types from the node library", async () => {
    const initialNodeTypes = [
      {
        id: "manual.trigger",
        name: "Manual Trigger",
        displayName: "手动触发",
        category: "Triggers",
        description: "Start manually.",
        inputs: {},
        outputs: { success: { description: "Initial payload" } },
        configSchema: { type: "object", properties: {} },
      },
    ];
    const reloadedNodeTypes = [
      ...initialNodeTypes,
      {
        id: "demo.reload",
        name: "Reload Demo",
        displayName: "刷新发现的节点",
        category: "Demo",
        description: "Loaded after reload.",
        inputs: {},
        outputs: { success: { description: "Done" } },
        configSchema: { type: "object", properties: {} },
      },
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types/reload") && init?.method === "POST") {
        return jsonResponse(reloadedNodeTypes);
      }
      if (url.endsWith("/api/node-packages")) {
        return jsonResponse({ packages: [], diagnostics: [], legacyNodeCount: 0 });
      }
      if (url.endsWith("/api/node-types")) {
        return jsonResponse(initialNodeTypes);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true")) && init?.method !== "POST") {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByRole("button", { name: "手动触发" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "刷新发现的节点" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "刷新节点" }));

    expect(await screen.findByRole("button", { name: "刷新发现的节点" })).toBeInTheDocument();
    expect(screen.getByText("已重新加载 2 个节点类型。")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/node-types\/reload$/),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("keeps reloaded nodes usable and shows package diagnostics", async () => {
    const initialNodeTypes = [
      {
        id: "manual.trigger",
        name: "Manual Trigger",
        category: "Triggers",
        description: "Start manually.",
        inputs: {},
        outputs: { success: { description: "Initial payload" } },
        configSchema: { type: "object", properties: {} },
      },
    ];
    const reloadedNodeTypes = [
      ...initialNodeTypes,
      {
        id: "example.node",
        name: "Example Node",
        displayName: "示例节点",
        category: "Demo",
        description: "Loaded after reload.",
        inputs: {},
        outputs: { success: { description: "Done" } },
        configSchema: { type: "object", properties: {} },
        package: { id: "example.tools", name: "工具集", version: "1.0.0" },
      },
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types/reload") && init?.method === "POST") {
        return jsonResponse(reloadedNodeTypes);
      }
      if (url.endsWith("/api/node-packages")) {
        return jsonResponse({
          packages: [
            {
              id: "example.tools",
              name: "工具集",
              version: "1.0.0",
              status: "partial",
              nodeIds: ["example.node"],
              credentialTypeIds: [],
              engines: {
                nodeflow: ">=0.1.0,<0.2.0",
                python: ">=3.11",
              },
              pythonDependencies: [],
              compatibility: {
                status: "incompatible",
                nodeflowVersion: "0.1.0",
                pythonVersion: "3.12.0",
              },
            },
          ],
          diagnostics: [
            {
              code: "package_entrypoint_missing",
              level: "error",
              message: "节点包入口文件不存在：missing.py",
              packageId: "example.tools",
              entrypoint: "missing.py",
            },
          ],
          legacyNodeCount: 0,
        });
      }
      if (url.endsWith("/api/node-types")) {
        return jsonResponse(initialNodeTypes);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true")) && init?.method !== "POST") {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "刷新节点" }));

    expect(await screen.findByRole("button", { name: "示例节点" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^资源/ }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "资源管理" })).getByRole("button", { name: /^节点包/ }));
    const packageIssuePanel = screen.getByRole("dialog", { name: "节点包管理" });
    expect(packageIssuePanel).toBeInTheDocument();
    expect(within(packageIssuePanel).getByText("工具集")).toBeInTheDocument();
    expect(within(packageIssuePanel).getByText("v1.0.0")).toBeInTheDocument();
    expect(screen.getByText("已加载 2 个节点，发现 1 个节点包问题。")) .toBeInTheDocument();
  });

  it("opens the node asset manager and bridges source files to the system editor", async () => {
    const initialNodeTypes = [
      {
        id: "local.demo",
        name: "Local Demo",
        displayName: "本地节点",
        category: "Demo",
        description: "Local script node.",
        inputs: {},
        outputs: { success: { description: "Done" } },
        configSchema: { type: "object", properties: {} },
        sourcePath: "local/demo.py",
      },
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-assets/open-source") && init?.method === "POST") {
        return jsonResponse({ opened: true, sourcePath: "local/demo.py" });
      }
      if (url.endsWith("/api/node-packages")) {
        return jsonResponse({ packages: [], diagnostics: [], legacyNodeCount: 1 });
      }
      if (url.endsWith("/api/node-types")) {
        return jsonResponse(initialNodeTypes);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true")) && init?.method !== "POST") {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    expect(await screen.findByRole("button", { name: "本地节点" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^资源/ }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "资源管理" })).getByRole("button", { name: /^节点资产/ }),
    );
    const assetWorkspace = screen.getByRole("region", { name: "节点资产管理" });
    expect(assetWorkspace).toBeInTheDocument();
    expect(within(assetWorkspace).getByRole("region", { name: "本地脚本" })).toBeInTheDocument();

    fireEvent.click(within(assetWorkspace).getByRole("button", { name: "打开源文件" }));
    expect(await screen.findByText("已用系统默认程序打开源文件“local/demo.py”。")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/node-assets\/open-source$/),
      expect.objectContaining({ method: "POST" }),
    );

    fireEvent.click(within(assetWorkspace).getByRole("button", { name: "关闭节点资产管理" }));
    expect(screen.queryByRole("region", { name: "节点资产管理" })).not.toBeInTheDocument();
  });

  it("disables a managed node package and refreshes the usable node library", async () => {
    const triggerNode = {
      id: "manual.trigger",
      name: "Manual Trigger",
      displayName: "手动触发",
      category: "Triggers",
      description: "Start manually.",
      inputs: {},
      outputs: { success: { description: "Initial payload" } },
      configSchema: { type: "object", properties: {} },
    };
    const packageNode = {
      id: "example.node",
      name: "Example Node",
      displayName: "扩展节点",
      category: "Demo",
      description: "Package node.",
      inputs: {},
      outputs: { success: { description: "Done" } },
      configSchema: { type: "object", properties: {} },
      package: { id: "example.tools", name: "工具集", version: "1.0.0" },
    };
    const packageSummary = {
      id: "example.tools",
      name: "工具集",
      version: "1.0.0",
      status: "loaded",
      nodeIds: ["example.node"],
      credentialTypeIds: [],
      engines: { nodeflow: ">=0.1.0,<0.2.0", python: ">=3.11" },
      pythonDependencies: [],
      compatibility: {
        status: "compatible",
        nodeflowVersion: "0.1.0",
        pythonVersion: "3.12.0",
      },
      lifecycle: {
        managed: true,
        enabled: true,
        lockedVersion: null,
        versionStatus: "unlocked",
      },
    };
    let disabled = false;
    let updateAttempts = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types/reload") && init?.method === "POST") {
        return jsonResponse([triggerNode, packageNode]);
      }
      if (url.endsWith("/api/node-packages")) {
        return jsonResponse({
          packages: [packageSummary],
          diagnostics: [],
          legacyNodeCount: 0,
        });
      }
      if (
        url.endsWith("/api/node-packages/example.tools/settings")
        && init?.method === "PUT"
      ) {
        updateAttempts += 1;
        if (updateAttempts === 1) {
          return errorResponse(
            409,
            JSON.stringify({
              detail: {
                message: "仍有工作流使用该节点包，请先移除相关节点。",
                references: [],
              },
            }),
          );
        }
        disabled = true;
        return jsonResponse({
          packages: [
            {
              ...packageSummary,
              status: "disabled",
              nodeIds: [],
              lifecycle: { ...packageSummary.lifecycle, enabled: false },
            },
          ],
          diagnostics: [],
          legacyNodeCount: 0,
        });
      }
      if (url.endsWith("/api/node-types")) {
        return jsonResponse(disabled ? [triggerNode] : [triggerNode, packageNode]);
      }
      if (
        (url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true"))
        && init?.method !== "POST"
      ) {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "刷新节点" }));
    fireEvent.click(screen.getByRole("button", { name: /^资源/ }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "资源管理" })).getByRole("button", { name: /^节点包/ }));
    const packagePanel = await screen.findByRole("dialog", { name: "节点包管理" });
    fireEvent.click(within(packagePanel).getByRole("checkbox", { name: "启用 工具集" }));

    expect(
      await screen.findByText(
        "更新节点包失败：仍有工作流使用该节点包，请先移除相关节点。",
      ),
    ).toBeInTheDocument();
    fireEvent.click(within(packagePanel).getByRole("checkbox", { name: "启用 工具集" }));

    expect(await screen.findByText("已停用节点包“工具集”。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "扩展节点" })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8150/api/node-packages/example.tools/settings",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ enabled: false, locked_version: null }),
      }),
    );
  });

  it("imports and uninstalls an installer-managed ZIP package", async () => {
    const triggerNode = {
      id: "manual.trigger",
      name: "Manual Trigger",
      displayName: "手动触发",
      category: "Triggers",
      description: "Start manually.",
      inputs: {},
      outputs: { success: { description: "Initial payload" } },
      configSchema: { type: "object", properties: {} },
    };
    const installedNode = {
      id: "example.installed.node",
      name: "Installed Node",
      displayName: "导入节点",
      category: "Demo",
      description: "Installed package node.",
      inputs: {},
      outputs: { success: { description: "Done" } },
      configSchema: { type: "object", properties: {} },
      package: { id: "example.installed", name: "导入工具", version: "1.0.0" },
    };
    const builtinPackage = {
      id: "nodeflow.builtin",
      name: "内置节点",
      version: "1.0.0",
      status: "loaded",
      nodeIds: ["manual.trigger"],
      compatibility: {
        status: "compatible",
        nodeflowVersion: "0.1.0",
        pythonVersion: "3.12.0",
      },
      lifecycle: {
        managed: false,
        enabled: true,
        lockedVersion: null,
        versionStatus: "unlocked",
        installManaged: false,
      },
    };
    const installedPackage = {
      id: "example.installed",
      name: "导入工具",
      version: "1.0.0",
      status: "loaded",
      nodeIds: ["example.installed.node"],
      compatibility: {
        status: "compatible",
        nodeflowVersion: "0.1.0",
        pythonVersion: "3.12.0",
      },
      lifecycle: {
        managed: true,
        enabled: true,
        lockedVersion: null,
        versionStatus: "unlocked",
        installManaged: true,
      },
    };
    let installed = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types/reload") && init?.method === "POST") {
        return jsonResponse([triggerNode]);
      }
      if (url.endsWith("/api/node-packages") && !init?.method) {
        return jsonResponse({
          packages: [builtinPackage],
          diagnostics: [],
          legacyNodeCount: 0,
        });
      }
      if (
        url.includes("/api/node-packages/install?filename=tools.zip")
        && init?.method === "POST"
      ) {
        installed = true;
        return jsonResponse({
          action: "installed",
          package: installedPackage,
          scan: {
            packages: [builtinPackage, installedPackage],
            diagnostics: [],
            legacyNodeCount: 0,
          },
        });
      }
      if (
        url.endsWith("/api/node-packages/example.installed")
        && init?.method === "DELETE"
      ) {
        installed = false;
        return jsonResponse({
          packages: [builtinPackage],
          diagnostics: [],
          legacyNodeCount: 0,
        });
      }
      if (url.endsWith("/api/node-types")) {
        return jsonResponse(installed ? [triggerNode, installedNode] : [triggerNode]);
      }
      if (
        (url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true"))
        && init?.method !== "POST"
      ) {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "刷新节点" }));
    fireEvent.click(screen.getByRole("button", { name: /^资源/ }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "资源管理" })).getByRole("button", { name: /^节点包/ }));
    const file = new File(["zip"], "tools.zip", { type: "application/zip" });
    fireEvent.change(await screen.findByLabelText("选择节点包 ZIP"), {
      target: { files: [file] },
    });

    // 导入前弹出统一确认弹窗，确认后才执行安装
    const installConfirm = await screen.findByRole("dialog", { name: "节点包操作确认" });
    expect(installConfirm).toHaveTextContent("请只导入你信任的文件");
    fireEvent.click(within(installConfirm).getByRole("button", { name: "执行操作" }));

    expect(
      await screen.findByText("已安装节点包“导入工具” v1.0.0，当前可用节点 2 个。"),
    ).toBeInTheDocument();

    // 返回工作流后，新导入的节点出现在节点库
    fireEvent.click(screen.getByRole("button", { name: /返回工作流/ }));
    expect(await screen.findByRole("button", { name: "导入节点" })).toBeInTheDocument();

    // 重新进入资源页执行卸载
    fireEvent.click(screen.getByRole("button", { name: /^资源/ }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "资源管理" })).getByRole("button", { name: /^节点包/ }));
    const packagePanel = await screen.findByRole("dialog", { name: "节点包管理" });
    fireEvent.click(within(packagePanel).getByRole("button", { name: "卸载" }));

    // 卸载前再次弹出统一确认弹窗，两次破坏性操作各确认一次
    const uninstallConfirm = await screen.findByRole("dialog", { name: "节点包操作确认" });
    expect(uninstallConfirm).toHaveTextContent("确认卸载节点包“导入工具”吗？");
    fireEvent.click(within(uninstallConfirm).getByRole("button", { name: "执行操作" }));

    expect(await screen.findByText("已卸载节点包“导入工具”。")).toBeInTheDocument();

    // 返回工作流后确认节点已从节点库移除
    fireEvent.click(screen.getByRole("button", { name: /返回工作流/ }));
    await screen.findByRole("button", { name: /^资源/ });
    expect(screen.queryByRole("button", { name: "导入节点" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "节点包操作确认" })).not.toBeInTheDocument();
  });

  it("loads package history and restores a previous installed version", async () => {
    const packageNode = {
      id: "example.installed.node",
      name: "Installed Node",
      displayName: "历史节点",
      category: "Demo",
      description: "Installed package node.",
      inputs: {},
      outputs: { success: { description: "Done" } },
      configSchema: { type: "object", properties: {} },
      package: { id: "example.installed", name: "历史工具", version: "2.0.0" },
    };
    const packageSummary = {
      id: "example.installed",
      name: "历史工具",
      version: "2.0.0",
      status: "loaded",
      nodeIds: ["example.installed.node"],
      compatibility: {
        status: "compatible",
        nodeflowVersion: "0.1.0",
        pythonVersion: "3.12.0",
      },
      lifecycle: {
        managed: true,
        enabled: true,
        lockedVersion: null,
        versionStatus: "unlocked",
        installManaged: true,
      },
    };
    const oldRevision = {
      revisionId: "rev_123",
      packageId: "example.installed",
      version: "1.0.0",
      sourceFilename: "tools-v1.zip",
      installedAt: "2026-07-31T08:00:00Z",
      archivedAt: "2026-07-31T09:00:00Z",
      checksum: "abc",
    };
    let restored = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types/reload") && init?.method === "POST") {
        return jsonResponse([packageNode]);
      }
      if (url.endsWith("/api/node-packages") && !init?.method) {
        return jsonResponse({
          packages: [packageSummary],
          diagnostics: [],
          legacyNodeCount: 0,
        });
      }
      if (
        url.endsWith("/api/node-packages/example.installed/revisions")
        && !init?.method
      ) {
        return jsonResponse(
          restored
            ? [{ ...oldRevision, revisionId: "rev_456", version: "2.0.0" }]
            : [oldRevision],
        );
      }
      if (
        url.endsWith(
          "/api/node-packages/example.installed/revisions/rev_123/activate",
        )
        && init?.method === "POST"
      ) {
        restored = true;
        return jsonResponse({
          action: "rolled_back",
          package: { ...packageSummary, version: "1.0.0" },
          scan: {
            packages: [{ ...packageSummary, version: "1.0.0" }],
            diagnostics: [],
            legacyNodeCount: 0,
          },
        });
      }
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([
          restored
            ? { ...packageNode, package: { ...packageNode.package, version: "1.0.0" } }
            : packageNode,
        ]);
      }
      if (
        (url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true"))
        && init?.method !== "POST"
      ) {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "刷新节点" }));
    fireEvent.click(screen.getByRole("button", { name: /^资源/ }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "资源管理" })).getByRole("button", { name: /^节点包/ }));
    const packagePanel = await screen.findByRole("dialog", { name: "节点包管理" });
    fireEvent.click(within(packagePanel).getByRole("button", { name: "历史版本" }));
    fireEvent.click(
      await within(packagePanel).findByRole("button", { name: "恢复 v1.0.0" }),
    );

    // 恢复历史版本前弹出统一确认弹窗，展示与旧 window.confirm 等价的文案
    const restoreConfirm = await screen.findByRole("dialog", { name: "节点包操作确认" });
    expect(restoreConfirm).toHaveTextContent(
      "确认将节点包“历史工具”恢复到 v1.0.0吗？当前版本会保留到历史记录。",
    );
    fireEvent.click(within(restoreConfirm).getByRole("button", { name: "执行操作" }));

    expect(
      await screen.findByText("已将节点包“历史工具”恢复到 v1.0.0。"),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8150/api/node-packages/example.installed/revisions/rev_123/activate",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("shows backend validation issues as friendly Chinese locations", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true")) && init?.method !== "POST") {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows/validate") && init?.method === "POST") {
        return jsonResponse({
          valid: false,
          issues: [{ path: "nodes.request.config.url", message: "Field required" }],
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "验证" }));

    expect(await screen.findByText("工作流有 1 个问题：节点 request 的配置 URL：必填项不能为空")).toBeInTheDocument();
    expect(screen.queryByText(/nodes\.request\.config\.url/)).not.toBeInTheDocument();
  });

  it("shows actionable backend validation issues and selects the target node", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([
          {
            id: "http.request",
            name: "HTTP Request",
            category: "Network",
            description: "Makes an HTTP request.",
            inputs: {},
            outputs: { success: { description: "Response" } },
            configSchema: {
              type: "object",
              properties: {
                url: { title: "URL", type: "string", default: "" },
              },
            },
          },
        ]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true")) && init?.method !== "POST") {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows/validate") && init?.method === "POST") {
        const workflow = JSON.parse(String(init.body)) as import("./types").WorkflowDocument;
        const nodeId = workflow.nodes[0]?.id ?? "missing";
        return jsonResponse({
          valid: false,
          issues: [{ path: `nodes.${nodeId}.config.url`, message: "Field required" }],
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "HTTP 请求" }));
    fireEvent.click(screen.getByRole("button", { name: "验证" }));

    expect(await screen.findByRole("heading", { name: "问题中心" })).toBeInTheDocument();
    expect(screen.getByText("验证 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /节点 node_/ }));

    expect(within(screen.getByLabelText("配置面板")).getByText("HTTP 请求")).toBeInTheDocument();
    expect(within(screen.getByLabelText("配置字段")).getByLabelText("URL")).toHaveFocus();
  });

  it("clears backend validation issues after a successful validation", async () => {
    let validationAttempt = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true")) && init?.method !== "POST") {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows/validate") && init?.method === "POST") {
        validationAttempt += 1;
        return jsonResponse(
          validationAttempt === 1
            ? { valid: false, issues: [{ path: "settings.timeout_seconds", message: "Input should be greater than 0" }] }
            : { valid: true, issues: [] }
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "验证" }));
    expect(await screen.findByRole("heading", { name: "问题中心" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "验证" }));

    expect(await screen.findByText("工作流验证通过。")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "问题中心" })).not.toBeInTheDocument();
  });

  it("shows Chinese node labels without exposing script ids in the node palette", async () => {
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
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true"))) {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByRole("button", { name: "手动触发" })).toBeInTheDocument();
    expect(screen.queryByText("manual.trigger")).not.toBeInTheDocument();
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
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true"))) {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByRole("button", { name: "读取 CSV" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "状态码断言" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "写入测试报告" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "数据" })).toBeInTheDocument();
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
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true"))) {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "手动触发" }));
    const canvas = screen.getByLabelText("画布工作区");

    expect(within(canvas).getByText("手动触发")).toBeInTheDocument();
    expect(within(canvas).queryByText(/^node_/)).not.toBeInTheDocument();
  });

  it("undoes and redoes a node added from the library", async () => {
    const nodeTypes = [
      {
        id: "manual.trigger",
        name: "Manual Trigger",
        displayName: "手动触发",
        category: "Triggers",
        description: "Start manually.",
        inputs: {},
        outputs: { success: { description: "Initial payload" } },
        configSchema: { type: "object", properties: {} },
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/node-types")) {
          return jsonResponse(nodeTypes);
        }
        if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true"))) {
          return jsonResponse([]);
        }
        throw new Error(`Unexpected request: ${url}`);
      })
    );

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "手动触发" }));

    const canvas = within(screen.getByLabelText("画布工作区"));
    expect(canvas.getByText("手动触发")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(canvas.queryByText("手动触发")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重做" }));
    expect(canvas.getByText("手动触发")).toBeInTheDocument();
  });

  it("duplicates the selected canvas node with Ctrl+D and keeps the action undoable", async () => {
    const nodeTypes = [
      {
        id: "manual.trigger",
        name: "Manual Trigger",
        displayName: "手动触发",
        category: "Triggers",
        description: "Start manually.",
        inputs: {},
        outputs: { success: { description: "Initial payload" } },
        configSchema: { type: "object", properties: {} },
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/node-types")) {
          return jsonResponse(nodeTypes);
        }
        if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true"))) {
          return jsonResponse([]);
        }
        throw new Error(`Unexpected request: ${url}`);
      })
    );

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "手动触发" }));
    const canvas = within(screen.getByLabelText("画布工作区"));
    expect(canvas.getAllByText("手动触发")).toHaveLength(1);

    fireEvent.keyDown(window, { ctrlKey: true, key: "d" });
    expect(canvas.getAllByText("手动触发")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(canvas.getAllByText("手动触发")).toHaveLength(1);
  });

  it("copies and pastes selected canvas nodes with Ctrl+C and Ctrl+V", async () => {
    const nodeTypes = [
      {
        id: "manual.trigger",
        name: "Manual Trigger",
        displayName: "手动触发",
        category: "Triggers",
        description: "Start manually.",
        inputs: {},
        outputs: { success: { description: "Initial payload" } },
        configSchema: { type: "object", properties: {} },
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/node-types")) {
          return jsonResponse(nodeTypes);
        }
        if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true"))) {
          return jsonResponse([]);
        }
        throw new Error(`Unexpected request: ${url}`);
      })
    );

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "手动触发" }));
    const canvas = within(screen.getByLabelText("画布工作区"));

    fireEvent.keyDown(window, { ctrlKey: true, key: "c" });
    fireEvent.keyDown(window, { ctrlKey: true, key: "v" });

    expect(canvas.getAllByText("手动触发")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(canvas.getAllByText("手动触发")).toHaveLength(1);
  });

  it("supports canvas history shortcuts without taking over text input undo", async () => {
    const nodeTypes = [
      {
        id: "manual.trigger",
        name: "Manual Trigger",
        displayName: "手动触发",
        category: "Triggers",
        description: "Start manually.",
        inputs: {},
        outputs: { success: { description: "Initial payload" } },
        configSchema: { type: "object", properties: {} },
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/node-types")) {
          return jsonResponse(nodeTypes);
        }
        if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true"))) {
          return jsonResponse([]);
        }
        throw new Error(`Unexpected request: ${url}`);
      })
    );

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "手动触发" }));
    const canvas = within(screen.getByLabelText("画布工作区"));

    fireEvent.keyDown(window, { ctrlKey: true, key: "z" });
    expect(canvas.queryByText("手动触发")).not.toBeInTheDocument();

    fireEvent.keyDown(window, { ctrlKey: true, key: "y" });
    expect(canvas.getByText("手动触发")).toBeInTheDocument();

    const shortcutEvent = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ctrlKey: true, key: "z" });
    screen.getByLabelText("工作流名称").dispatchEvent(shortcutEvent);
    expect(shortcutEvent.defaultPrevented).toBe(false);
    expect(canvas.getByText("手动触发")).toBeInTheDocument();
  });

  it("undoes and redoes a node configuration edit", async () => {
    const nodeTypes = [
      {
        id: "manual.trigger",
        name: "Manual Trigger",
        displayName: "手动触发",
        category: "Triggers",
        description: "Start manually.",
        inputs: {},
        outputs: { success: { description: "Initial payload" } },
        configSchema: { type: "object", properties: {} },
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/node-types")) {
          return jsonResponse(nodeTypes);
        }
        if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true"))) {
          return jsonResponse([]);
        }
        throw new Error(`Unexpected request: ${url}`);
      })
    );

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "手动触发" }));
    fireEvent.change(screen.getByLabelText("节点备注"), { target: { value: "只调用测试环境" } });
    expect(screen.getByLabelText("节点备注")).toHaveValue("只调用测试环境");

    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(screen.getByLabelText("节点备注")).toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: "重做" }));
    expect(screen.getByLabelText("节点备注")).toHaveValue("只调用测试环境");
  });

  it("adds canvas annotations as editable workflow metadata and restores them from history", async () => {
    const nodeTypes = [
      {
        id: "manual.trigger",
        name: "Manual Trigger",
        displayName: "手动触发",
        category: "Triggers",
        description: "Start manually.",
        inputs: {},
        outputs: { success: { description: "Initial payload" } },
        configSchema: { type: "object", properties: {} },
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/node-types")) {
          return jsonResponse(nodeTypes);
        }
        if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true"))) {
          return jsonResponse([]);
        }
        throw new Error(`Unexpected request: ${url}`);
      })
    );

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "手动触发" }));
    fireEvent.click(screen.getByRole("button", { name: "添加画布说明" }));

    expect(screen.getByLabelText("画布说明内容")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(screen.queryByLabelText("画布说明内容")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重做" }));
    expect(screen.getByLabelText("画布说明内容")).toBeInTheDocument();
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
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true"))) {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    const templateCard = await screen.findByRole("article", { name: "单接口状态码断言" });
    fireEvent.click(within(templateCard).getByRole("button", { name: "使用模板" }));

    // 模板应用前会经过异步丢弃确认（未脏时直接放行），等待画布渲染模板节点
    const canvas = screen.getByLabelText("画布工作区");
    expect(await within(canvas).findByText("HTTP 请求")).toBeInTheDocument();
    expect(within(canvas).getByText("状态码断言")).toBeInTheDocument();
    expect(screen.getByLabelText("工作流名称")).toHaveValue("单接口状态码断言");
    expect(screen.getByText("未保存")).toBeInTheDocument();
    expect(screen.getByText("填写请求方法和 URL。")).toBeInTheDocument();
  });

  it("applies the CSV parameterized API template and selects the CSV node", async () => {
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
            outputs: { success: { description: "Started" } },
            configSchema: { type: "object", properties: {} },
          },
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
            id: "control.foreach",
            name: "For Each",
            category: "Control",
            description: "Runs body nodes for each item.",
            inputs: { input: { description: "Rows" } },
            outputs: { done: { description: "Done" } },
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
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true"))) {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    const templateCard = await screen.findByRole("article", { name: "CSV 参数化接口测试" });
    fireEvent.click(within(templateCard).getByRole("button", { name: "使用模板" }));

    await waitFor(() => expect(screen.getByLabelText("工作流名称")).toHaveValue("CSV 参数化接口测试"));
    expect(within(screen.getByLabelText("配置面板")).getByText("读取 CSV")).toBeInTheDocument();
    expect(screen.getByText("填写 CSV 文件路径，确认分隔符和表头设置。运行后可在运行详情查看表头和行数。")).toBeInTheDocument();
  });

  it("applies the general branch template and selects its condition node", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([
          {
            id: "manual.trigger",
            name: "Manual Trigger",
            displayName: "手动触发",
            category: "Triggers",
            description: "Starts a workflow manually.",
            inputs: {},
            outputs: { success: { displayName: "初始数据" } },
            configSchema: { type: "object", properties: {} },
          },
          {
            id: "logic.if",
            name: "If",
            displayName: "条件判断",
            category: "Logic",
            description: "Routes execution by a condition.",
            inputs: { input: { displayName: "输入" } },
            outputs: { true: { displayName: "为真" }, false: { displayName: "为假" } },
            configSchema: { type: "object", properties: { condition: { title: "分支条件", type: "string" } } },
          },
          {
            id: "utility.log",
            name: "Log",
            displayName: "写入日志",
            category: "Utility",
            description: "Writes a log entry.",
            inputs: { input: { displayName: "输入" } },
            outputs: {},
            configSchema: { type: "object", properties: { message: { title: "日志内容", type: "string" } } },
          },
        ]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true"))) {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    const templateCard = await screen.findByRole("article", { name: "条件分支路由" });
    fireEvent.click(within(templateCard).getByRole("button", { name: "使用模板" }));

    await waitFor(() => expect(screen.getByLabelText("工作流名称")).toHaveValue("条件分支路由"));
    expect(within(screen.getByLabelText("配置面板")).getByText("条件判断")).toBeInTheDocument();
    expect(screen.getByDisplayValue("{{ inputs.input.approved }}")).toBeInTheDocument();
  });

  it("blocks an incomplete HTTP workflow before creating a run and selects the issue node", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([
          {
            id: "http.request",
            name: "HTTP Request",
            category: "Network",
            description: "Send an HTTP request.",
            inputs: {},
            outputs: { success: { description: "Response" } },
            configSchema: {
              type: "object",
              properties: {
                method: { title: "Method", type: "string", default: "GET" },
                url: { title: "URL", type: "string" },
              },
            },
          },
        ]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true")) && init?.method !== "POST") {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows?draft=true") && init?.method === "POST") {
        throw new Error("saveWorkflow should not be called");
      }
      if (url.includes("/runs")) {
        throw new Error("createRun should not be called");
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "HTTP 请求" }));
    fireEvent.click(screen.getByRole("button", { name: "运行" }));

    expect(await screen.findByText("运行前检查发现 1 个问题，请先补齐配置。")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "问题中心" })).toBeInTheDocument();
    expect(screen.getByText("本地检查 1")).toBeInTheDocument();
    expect(within(screen.getByLabelText("画布工作区")).getByText("1 个问题")).toBeInTheDocument();

    fireEvent.click(
      within(screen.getByLabelText("画布工作区")).getByRole("button", {
        name: "查看节点问题：HTTP 请求，1 个问题",
      })
    );
    await waitFor(() => expect(screen.getByLabelText("URL")).toHaveFocus());

    fireEvent.click(screen.getByRole("button", { name: /HTTP 请求缺少 URL。/ }));

    expect(screen.getByText("填写请求方法和 URL。")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "http://127.0.0.1:8150/api/workflows",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringMatching(/\/runs$/), expect.anything());
  });

  it("removes pre-run issues after the missing HTTP URL is filled", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([
          {
            id: "http.request",
            name: "HTTP Request",
            category: "Network",
            description: "Send an HTTP request.",
            inputs: {},
            outputs: { success: { description: "Response" } },
            configSchema: {
              type: "object",
              properties: {
                method: { title: "Method", type: "string", default: "GET" },
                url: { title: "URL", type: "string" },
              },
            },
          },
        ]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true")) && init?.method !== "POST") {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "HTTP 请求" }));
    fireEvent.click(screen.getByRole("button", { name: "运行" }));

    expect(await screen.findByRole("button", { name: /HTTP 请求缺少 URL。/ })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("URL"), { target: { value: "https://api.example.com/health" } });

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "问题中心" })).not.toBeInTheDocument();
    });
  });

  it("cleans stale config keys from a loaded workflow", async () => {
    const savedWorkflow = workflowDocument({
      id: "wf_stale",
      name: "Stale Config",
      version: 2,
      nodes: [
        {
          id: "api",
          type: "custom.api",
          position: { x: 80, y: 80 },
          config: {
            endpoint: "/users",
            legacy_token: "old",
          },
        },
      ],
      edges: [],
    });
    let savedPayload: import("./types").WorkflowDocument | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([
          {
            id: "custom.api",
            name: "Custom API",
            displayName: "自定义接口",
            category: "Custom",
            description: "Send a custom API request.",
            inputs: {},
            outputs: { success: { description: "Response" } },
            configSchema: {
              type: "object",
              additionalProperties: false,
              properties: {
                endpoint: { title: "Endpoint", type: "string" },
              },
            },
          },
        ]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true"))) {
        if (init?.method === "POST") {
          savedPayload = JSON.parse(String(init.body));
          return jsonResponse({ ...savedPayload, id: "wf_stale", version: 3 });
        }
        return jsonResponse([{ id: "wf_stale", name: "Stale Config", version: 2 }]);
      }
      if (url.endsWith("/api/workflows/wf_stale")) {
        return jsonResponse(savedWorkflow);
      }
      if (url.endsWith("/api/workflows/wf_stale/runs?limit=5")) {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await openSavedWorkflow("Stale Config");
    await screen.findByText("已加载 Stale Config v2。");

    fireEvent.click(within(screen.getByLabelText("画布工作区")).getByText("自定义接口"));
    fireEvent.click(screen.getByRole("button", { name: "清理 legacy_token" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(savedPayload).toBeDefined();
    });
    expect(savedPayload?.nodes[0].config).toEqual({ endpoint: "/users" });
  });

  it("persists a node failure policy when the workflow is saved", async () => {
    let savedPayload: import("./types").WorkflowDocument | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([
          {
            id: "manual.trigger",
            name: "Manual Trigger",
            displayName: "手动触发",
            category: "Triggers",
            description: "Start manually.",
            inputs: {},
            outputs: { success: { description: "Initial payload" } },
            configSchema: { type: "object", properties: {} },
          },
        ]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true"))) {
        if (init?.method === "POST") {
          savedPayload = JSON.parse(String(init.body));
          return jsonResponse({ ...savedPayload, id: "wf_policy", version: 1 });
        }
        return jsonResponse([]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "手动触发" }));
    fireEvent.click(screen.getByRole("radio", { name: "失败后继续" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(savedPayload).toBeDefined());
    expect(savedPayload?.nodes[0].execution).toEqual({
      onError: "continue",
      retry: { maxAttempts: 1, delaySeconds: 0 },
    });
  });

  it("deletes invalid edge issues from the issue center before saving", async () => {
    const savedWorkflow = workflowDocument({
      id: "wf_edge",
      name: "Invalid Edge",
      version: 2,
      nodes: [
        { id: "source", type: "test.source", position: { x: 80, y: 80 }, config: {} },
        { id: "sink", type: "test.sink", position: { x: 320, y: 80 }, config: {} },
      ],
      edges: [
        {
          id: "edge_old_input",
          source: "source",
          sourceHandle: "success",
          target: "sink",
          targetHandle: "old_input",
        },
      ],
    });
    let savedPayload: import("./types").WorkflowDocument | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([
          {
            id: "test.source",
            name: "Source",
            category: "Test",
            description: "Source node.",
            inputs: {},
            outputs: { success: { displayName: "成功", description: "Done" } },
            configSchema: { type: "object", properties: {} },
          },
          {
            id: "test.sink",
            name: "Sink",
            category: "Test",
            description: "Sink node.",
            inputs: { input: { displayName: "输入", required: false } },
            outputs: {},
            configSchema: { type: "object", properties: {} },
          },
        ]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true"))) {
        if (init?.method === "POST") {
          savedPayload = JSON.parse(String(init.body));
          return jsonResponse({ ...savedPayload, id: "wf_edge", version: 3 });
        }
        return jsonResponse([{ id: "wf_edge", name: "Invalid Edge", version: 2 }]);
      }
      if (url.endsWith("/api/workflows/wf_edge")) {
        return jsonResponse(savedWorkflow);
      }
      if (url.endsWith("/api/workflows/wf_edge/runs?limit=5")) {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await openSavedWorkflow("Invalid Edge");
    await screen.findByText("已加载 Invalid Edge v2。");

    fireEvent.click(screen.getByRole("button", { name: "运行" }));
    expect(await screen.findByRole("button", { name: "删除连线 edge_old_input" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /连线无效/ }));
    expect(screen.getByText("已在画布中选中连线 edge_old_input，可直接删除或重新连接。")).toBeInTheDocument();
    const canvas = screen.getByLabelText("画布工作区");
    expect(within(canvas).getByRole("region", { name: "连线问题" })).toHaveTextContent("目标节点没有输入端口 old_input。");

    fireEvent.click(within(canvas).getByRole("button", { name: "删除连线 edge_old_input" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(savedPayload).toBeDefined();
    });
    expect(savedPayload?.edges).toEqual([]);
  });

  it("bulk deletes invalid edge issues from the issue center with a clear status message", async () => {
    const savedWorkflow = workflowDocument({
      id: "wf_edge_bulk_delete",
      name: "Bulk Invalid Edges",
      version: 2,
      nodes: [
        { id: "source", type: "test.source", position: { x: 80, y: 80 }, config: {} },
        { id: "sink", type: "test.sink", position: { x: 320, y: 80 }, config: {} },
      ],
      edges: [
        {
          id: "edge_old_input",
          source: "source",
          sourceHandle: "success",
          target: "sink",
          targetHandle: "old_input",
        },
        {
          id: "edge_missing_input",
          source: "source",
          sourceHandle: "success",
          target: "sink",
          targetHandle: "missing_input",
        },
      ],
    });
    let savedPayload: import("./types").WorkflowDocument | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([
          {
            id: "test.source",
            name: "Source",
            category: "Test",
            description: "Source node.",
            inputs: {},
            outputs: { success: { displayName: "成功", description: "Done" } },
            configSchema: { type: "object", properties: {} },
          },
          {
            id: "test.sink",
            name: "Sink",
            category: "Test",
            description: "Sink node.",
            inputs: { input: { displayName: "输入", required: false } },
            outputs: {},
            configSchema: { type: "object", properties: {} },
          },
        ]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true"))) {
        if (init?.method === "POST") {
          savedPayload = JSON.parse(String(init.body));
          return jsonResponse({ ...savedPayload, id: "wf_edge_bulk_delete", version: 3 });
        }
        return jsonResponse([{ id: "wf_edge_bulk_delete", name: "Bulk Invalid Edges", version: 2 }]);
      }
      if (url.endsWith("/api/workflows/wf_edge_bulk_delete")) {
        return jsonResponse(savedWorkflow);
      }
      if (url.endsWith("/api/workflows/wf_edge_bulk_delete/runs?limit=5")) {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await openSavedWorkflow("Bulk Invalid Edges");
    await screen.findByText("已加载 Bulk Invalid Edges v2。");

    fireEvent.click(screen.getByRole("button", { name: "运行" }));
    fireEvent.click(await screen.findByRole("button", { name: "删除全部无效连线，共 2 条" }));

    expect(screen.getByText("已删除 2 条无效连线。")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(savedPayload).toBeDefined();
    });
    expect(savedPayload?.edges).toEqual([]);
  });

  it("undoes bulk deleted edge issues from the status bar", async () => {
    const savedWorkflow = workflowDocument({
      id: "wf_edge_bulk_undo",
      name: "Undo Invalid Edges",
      version: 2,
      nodes: [
        { id: "source", type: "test.source", position: { x: 80, y: 80 }, config: {} },
        { id: "sink", type: "test.sink", position: { x: 320, y: 80 }, config: {} },
      ],
      edges: [
        {
          id: "edge_old_input",
          source: "source",
          sourceHandle: "success",
          target: "sink",
          targetHandle: "old_input",
        },
        {
          id: "edge_missing_input",
          source: "source",
          sourceHandle: "success",
          target: "sink",
          targetHandle: "missing_input",
        },
      ],
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([
          {
            id: "test.source",
            name: "Source",
            category: "Test",
            description: "Source node.",
            inputs: {},
            outputs: { success: { displayName: "成功", description: "Done" } },
            configSchema: { type: "object", properties: {} },
          },
          {
            id: "test.sink",
            name: "Sink",
            category: "Test",
            description: "Sink node.",
            inputs: { input: { displayName: "输入", required: false } },
            outputs: {},
            configSchema: { type: "object", properties: {} },
          },
        ]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true"))) {
        return jsonResponse([{ id: "wf_edge_bulk_undo", name: "Undo Invalid Edges", version: 2 }]);
      }
      if (url.endsWith("/api/workflows/wf_edge_bulk_undo")) {
        return jsonResponse(savedWorkflow);
      }
      if (url.endsWith("/api/workflows/wf_edge_bulk_undo/runs?limit=5")) {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await openSavedWorkflow("Undo Invalid Edges");
    await screen.findByText("已加载 Undo Invalid Edges v2。");

    fireEvent.click(screen.getByRole("button", { name: "运行" }));
    fireEvent.click(await screen.findByRole("button", { name: "删除全部无效连线，共 2 条" }));

    expect(screen.getByText("已删除 2 条无效连线。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /删除连线 edge_old_input/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "撤销删除" }));

    expect(screen.getByText("已恢复 2 条连线。")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "删除全部无效连线，共 2 条" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /删除连线 edge_old_input/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /删除连线 edge_missing_input/ })).toBeInTheDocument();
    expect(screen.getByText("已保存")).toBeInTheDocument();
  });

  it("does not restore a stale focused edge after deleting and undoing it", async () => {
    const savedWorkflow = workflowDocument({
      id: "wf_edge_focus_undo",
      name: "Focused Edge Undo",
      version: 2,
      nodes: [
        { id: "source", type: "test.source", position: { x: 80, y: 80 }, config: {} },
        { id: "sink", type: "test.sink", position: { x: 320, y: 80 }, config: {} },
      ],
      edges: [
        {
          id: "edge_old_input",
          source: "source",
          sourceHandle: "success",
          target: "sink",
          targetHandle: "old_input",
        },
      ],
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([
          {
            id: "test.source",
            name: "Source",
            category: "Test",
            description: "Source node.",
            inputs: {},
            outputs: { success: { displayName: "成功", description: "Done" } },
            configSchema: { type: "object", properties: {} },
          },
          {
            id: "test.sink",
            name: "Sink",
            category: "Test",
            description: "Sink node.",
            inputs: { input: { displayName: "输入", required: false } },
            outputs: {},
            configSchema: { type: "object", properties: {} },
          },
        ]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true"))) {
        return jsonResponse([{ id: "wf_edge_focus_undo", name: "Focused Edge Undo", version: 2 }]);
      }
      if (url.endsWith("/api/workflows/wf_edge_focus_undo")) {
        return jsonResponse(savedWorkflow);
      }
      if (url.endsWith("/api/workflows/wf_edge_focus_undo/runs?limit=5")) {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await openSavedWorkflow("Focused Edge Undo");
    await screen.findByText("已加载 Focused Edge Undo v2。");

    fireEvent.click(screen.getByRole("button", { name: "运行" }));
    fireEvent.click(await screen.findByRole("button", { name: /连线无效/ }));

    const canvas = screen.getByLabelText("画布工作区");
    expect(within(canvas).getByRole("region", { name: "连线问题" })).toBeInTheDocument();

    fireEvent.click(within(canvas).getByRole("button", { name: "删除连线 edge_old_input" }));
    expect(within(canvas).queryByRole("region", { name: "连线问题" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "撤销删除" }));

    expect(screen.getByText("已恢复 1 条连线。")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "删除连线 edge_old_input" })).toHaveLength(1);
    expect(within(canvas).queryByRole("region", { name: "连线问题" })).not.toBeInTheDocument();
  });

  it("locks deleted-edge undo while saving", async () => {
    const saveWorkflow = deferred<Response>();
    let savedPayload: import("./types").WorkflowDocument | undefined;
    const savedWorkflow = workflowDocument({
      id: "wf_edge_bulk_undo_lock",
      name: "Undo Lock Invalid Edges",
      version: 2,
      nodes: [
        { id: "source", type: "test.source", position: { x: 80, y: 80 }, config: {} },
        { id: "sink", type: "test.sink", position: { x: 320, y: 80 }, config: {} },
      ],
      edges: [
        {
          id: "edge_old_input",
          source: "source",
          sourceHandle: "success",
          target: "sink",
          targetHandle: "old_input",
        },
      ],
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([
          {
            id: "test.source",
            name: "Source",
            category: "Test",
            description: "Source node.",
            inputs: {},
            outputs: { success: { displayName: "成功", description: "Done" } },
            configSchema: { type: "object", properties: {} },
          },
          {
            id: "test.sink",
            name: "Sink",
            category: "Test",
            description: "Sink node.",
            inputs: { input: { displayName: "输入", required: false } },
            outputs: {},
            configSchema: { type: "object", properties: {} },
          },
        ]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true")) && init?.method !== "POST") {
        return jsonResponse([{ id: "wf_edge_bulk_undo_lock", name: "Undo Lock Invalid Edges", version: 2 }]);
      }
      if (url.endsWith("/api/workflows/wf_edge_bulk_undo_lock")) {
        return jsonResponse(savedWorkflow);
      }
      if (url.endsWith("/api/workflows/wf_edge_bulk_undo_lock/runs?limit=5")) {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows?draft=true") && init?.method === "POST") {
        savedPayload = JSON.parse(String(init.body));
        return saveWorkflow.promise;
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await openSavedWorkflow("Undo Lock Invalid Edges");
    await screen.findByText("已加载 Undo Lock Invalid Edges v2。");

    fireEvent.click(screen.getByRole("button", { name: "运行" }));
    fireEvent.click(await screen.findByRole("button", { name: "删除连线 edge_old_input" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "撤销删除" })).toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "撤销删除" }));
    expect(screen.queryByText("已恢复 1 条连线。")).not.toBeInTheDocument();

    saveWorkflow.resolve(jsonResponse({ ...savedPayload, id: "wf_edge_bulk_undo_lock", version: 3 }));

    await screen.findByText("已保存 v3。");
    expect(screen.getByRole("button", { name: "撤销删除" })).toBeEnabled();
  });

  it("clears deleted edge undo when another workflow is loaded", async () => {
    const invalidWorkflow = workflowDocument({
      id: "wf_edge_undo_scope",
      name: "Undo Scope Source",
      version: 2,
      nodes: [
        { id: "source", type: "test.source", position: { x: 80, y: 80 }, config: {} },
        { id: "sink", type: "test.sink", position: { x: 320, y: 80 }, config: {} },
      ],
      edges: [
        {
          id: "edge_old_input",
          source: "source",
          sourceHandle: "success",
          target: "sink",
          targetHandle: "old_input",
        },
        {
          id: "edge_missing_input",
          source: "source",
          sourceHandle: "success",
          target: "sink",
          targetHandle: "missing_input",
        },
      ],
    });
    const cleanWorkflow = workflowDocument({
      id: "wf_clean_after_delete",
      name: "Clean After Delete",
      version: 4,
      nodes: [{ id: "source", type: "test.source", position: { x: 80, y: 80 }, config: {} }],
      edges: [],
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([
          {
            id: "test.source",
            name: "Source",
            category: "Test",
            description: "Source node.",
            inputs: {},
            outputs: { success: { displayName: "成功", description: "Done" } },
            configSchema: { type: "object", properties: {} },
          },
          {
            id: "test.sink",
            name: "Sink",
            category: "Test",
            description: "Sink node.",
            inputs: { input: { displayName: "输入", required: false } },
            outputs: {},
            configSchema: { type: "object", properties: {} },
          },
        ]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true"))) {
        return jsonResponse([
          { id: "wf_edge_undo_scope", name: "Undo Scope Source", version: 2 },
          { id: "wf_clean_after_delete", name: "Clean After Delete", version: 4 },
        ]);
      }
      if (url.endsWith("/api/workflows/wf_edge_undo_scope")) {
        return jsonResponse(invalidWorkflow);
      }
      if (url.endsWith("/api/workflows/wf_clean_after_delete")) {
        return jsonResponse(cleanWorkflow);
      }
      if (url.endsWith("/api/workflows/wf_edge_undo_scope/runs?limit=5")) {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows/wf_clean_after_delete/runs?limit=5")) {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await openSavedWorkflow("Undo Scope Source");
    await screen.findByText("已加载 Undo Scope Source v2。");

    fireEvent.click(screen.getByRole("button", { name: "运行" }));
    fireEvent.click(await screen.findByRole("button", { name: "删除全部无效连线，共 2 条" }));

    expect(screen.getByRole("button", { name: "撤销删除" })).toBeInTheDocument();

    await openSavedWorkflow("Clean After Delete");
    // 当前文档因删除连线变脏：切换前弹出统一确认弹窗，确认后继续加载
    const discardDialog = await screen.findByRole("dialog", { name: "丢弃未保存修改？" });
    fireEvent.click(within(discardDialog).getByRole("button", { name: "丢弃并继续" }));
    await screen.findByText("已加载 Clean After Delete v4。");

    expect(screen.queryByRole("button", { name: "撤销删除" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删除全部无效连线，共 2 条" })).not.toBeInTheDocument();
  });

  it("repairs invalid edge issues directly from the issue center before saving", async () => {
    const savedWorkflow = workflowDocument({
      id: "wf_edge_repair",
      name: "Repair Invalid Edge",
      version: 2,
      nodes: [
        { id: "source", type: "test.source", position: { x: 80, y: 80 }, config: {} },
        { id: "sink", type: "test.sink", position: { x: 320, y: 80 }, config: {} },
      ],
      edges: [
        {
          id: "edge_old_input",
          source: "source",
          sourceHandle: "success",
          target: "sink",
          targetHandle: "old_input",
        },
      ],
    });
    let savedPayload: import("./types").WorkflowDocument | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([
          {
            id: "test.source",
            name: "Source",
            category: "Test",
            description: "Source node.",
            inputs: {},
            outputs: { success: { displayName: "成功", description: "Done", schema: { type: "object" } } },
            configSchema: { type: "object", properties: {} },
          },
          {
            id: "test.sink",
            name: "Sink",
            category: "Test",
            description: "Sink node.",
            inputs: { input: { displayName: "输入", required: false, schema: { type: "object" } } },
            outputs: {},
            configSchema: { type: "object", properties: {} },
          },
        ]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true"))) {
        if (init?.method === "POST") {
          savedPayload = JSON.parse(String(init.body));
          return jsonResponse({ ...savedPayload, id: "wf_edge_repair", version: 3 });
        }
        return jsonResponse([{ id: "wf_edge_repair", name: "Repair Invalid Edge", version: 2 }]);
      }
      if (url.endsWith("/api/workflows/wf_edge_repair")) {
        return jsonResponse(savedWorkflow);
      }
      if (url.endsWith("/api/workflows/wf_edge_repair/runs?limit=5")) {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await openSavedWorkflow("Repair Invalid Edge");
    await screen.findByText("已加载 Repair Invalid Edge v2。");

    fireEvent.click(screen.getByRole("button", { name: "运行" }));
    fireEvent.click(await screen.findByRole("button", { name: "改接连线 edge_old_input 到输入端口 输入" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(savedPayload).toBeDefined();
    });
    expect(savedPayload?.edges).toEqual([
      {
        id: "edge_old_input",
        source: "source",
        sourceHandle: "success",
        target: "sink",
        targetHandle: "input",
      },
    ]);
  });

  it("blocks a saved workflow when an edited HTTP URL is cleared before running", async () => {
    const savedWorkflow = workflowDocument({
      id: "wf_saved",
      name: "Saved HTTP check",
      version: 3,
      nodes: [
        {
          id: "request",
          type: "http.request",
          position: { x: 80, y: 80 },
          config: { method: "GET", url: "http://127.0.0.1:8150/api/health" },
        },
      ],
      edges: [],
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([
          {
            id: "http.request",
            name: "HTTP Request",
            category: "Network",
            description: "Send an HTTP request.",
            inputs: {},
            outputs: { success: { description: "Response" } },
            configSchema: {
              type: "object",
              properties: {
                method: { title: "Method", type: "string", default: "GET" },
                url: { title: "URL", type: "string" },
              },
            },
          },
        ]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true")) && init?.method !== "POST") {
        return jsonResponse([{ id: "wf_saved", name: "Saved HTTP check", version: 3 }]);
      }
      if (url.endsWith("/api/workflows/wf_saved")) {
        return jsonResponse(savedWorkflow);
      }
      if (url.endsWith("/api/workflows?draft=true") && init?.method === "POST") {
        throw new Error("saveWorkflow should not be called for invalid edited workflow");
      }
      if (url.includes("/runs")) {
        throw new Error("createRun should not be called for invalid edited workflow");
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await openSavedWorkflow("Saved HTTP check");
    await screen.findByText("已加载 Saved HTTP check v3。");
    fireEvent.click(await within(screen.getByLabelText("画布工作区")).findByText("HTTP 请求"));
    fireEvent.change(screen.getByLabelText("URL"), { target: { value: "" } });

    expect(screen.getByText("未保存")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "运行" }));

    expect(await screen.findByText("运行前检查发现 1 个问题，请先补齐配置。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /HTTP 请求缺少 URL。/ })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "http://127.0.0.1:8150/api/workflows",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringMatching(/\/runs$/), expect.anything());
  });

  it("shows a message when selecting a pre-run issue inside an unopened subflow", async () => {
    const nestedWorkflow = workflowDocument({
      id: "wf_nested",
      name: "Nested HTTP check",
      nodes: [
        {
          id: "each_row",
          type: "control.foreach",
          position: { x: 80, y: 80 },
          config: { items_expression: "{{ rows }}" },
          subflows: {
            body: {
              nodes: [
                {
                  id: "request",
                  type: "http.request",
                  position: { x: 80, y: 80 },
                  config: { method: "GET", url: "" },
                },
              ],
              edges: [],
            },
          },
        },
      ],
      edges: [],
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([
          {
            id: "control.foreach",
            name: "For Each",
            category: "Control",
            description: "Runs body nodes for each item.",
            inputs: {},
            outputs: { done: { description: "Done" } },
            configSchema: {
              type: "object",
              properties: {
                items_expression: { title: "Items Expression", type: "string" },
              },
            },
          },
          {
            id: "http.request",
            name: "HTTP Request",
            category: "Network",
            description: "Send an HTTP request.",
            inputs: {},
            outputs: { success: { description: "Response" } },
            configSchema: {
              type: "object",
              properties: {
                method: { title: "Method", type: "string", default: "GET" },
                url: { title: "URL", type: "string" },
              },
            },
          },
        ]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true"))) {
        return jsonResponse([{ id: "wf_nested", name: "Nested HTTP check", version: 1 }]);
      }
      if (url.endsWith("/api/workflows/wf_nested")) {
        return jsonResponse(nestedWorkflow);
      }
      if (url.endsWith("/api/workflows?draft=true") && init?.method === "POST") {
        throw new Error("saveWorkflow should not be called");
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await openSavedWorkflow("Nested HTTP check");
    await screen.findByText("已加载 Nested HTTP check v1。");
    fireEvent.click(screen.getByRole("button", { name: "运行" }));
    fireEvent.click(await screen.findByRole("button", { name: /HTTP 请求缺少 URL。/ }));

    expect(screen.getByText("这个运行前问题属于未打开的子流程，请先进入对应循环体查看。")).toBeInTheDocument();
  });

  it("does not select a root node with the same id as an unopened subflow pre-run issue", async () => {
    const duplicateIdWorkflow = workflowDocument({
      id: "wf_duplicate",
      name: "Duplicate ids",
      nodes: [
        {
          id: "request",
          type: "http.request",
          position: { x: 80, y: 80 },
          config: { method: "GET", url: "https://api.example.com/root" },
        },
        {
          id: "each_row",
          type: "control.foreach",
          position: { x: 320, y: 80 },
          config: { items_expression: "{{ rows }}" },
          subflows: {
            body: {
              nodes: [
                {
                  id: "request",
                  type: "http.request",
                  position: { x: 80, y: 80 },
                  config: { method: "GET", url: "" },
                },
              ],
              edges: [],
            },
          },
        },
      ],
      edges: [],
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([
          {
            id: "control.foreach",
            name: "For Each",
            category: "Control",
            description: "Runs body nodes for each item.",
            inputs: {},
            outputs: { done: { description: "Done" } },
            configSchema: {
              type: "object",
              properties: {
                items_expression: { title: "Items Expression", type: "string" },
              },
            },
          },
          {
            id: "http.request",
            name: "HTTP Request",
            category: "Network",
            description: "Send an HTTP request.",
            inputs: {},
            outputs: { success: { description: "Response" } },
            configSchema: {
              type: "object",
              properties: {
                method: { title: "Method", type: "string", default: "GET" },
                url: { title: "URL", type: "string" },
              },
            },
          },
        ]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true"))) {
        return jsonResponse([{ id: "wf_duplicate", name: "Duplicate ids", version: 1 }]);
      }
      if (url.endsWith("/api/workflows/wf_duplicate")) {
        return jsonResponse(duplicateIdWorkflow);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await openSavedWorkflow("Duplicate ids");
    await screen.findByText("已加载 Duplicate ids v1。");
    fireEvent.click(screen.getByRole("button", { name: "运行" }));
    fireEvent.click(await screen.findByRole("button", { name: /HTTP 请求缺少 URL。/ }));

    expect(screen.getByText("这个运行前问题属于未打开的子流程，请先进入对应循环体查看。")).toBeInTheDocument();
    expect(within(screen.getByLabelText("配置面板")).getByText("选择一个节点后，在这里编辑它的参数。")).toBeInTheDocument();
  });

  it("does not select a root node with the same id as an unopened subflow report case", async () => {
    const duplicateIdWorkflow = workflowDocument({
      id: "wf_report_duplicate",
      name: "Report duplicate ids",
      nodes: [
        {
          id: "record_result",
          type: "test.record_result",
          position: { x: 80, y: 80 },
          config: { name: "Root record" },
        },
        {
          id: "each_row",
          type: "control.foreach",
          position: { x: 320, y: 80 },
          config: { items_expression: "{{ rows }}" },
          subflows: {
            body: {
              nodes: [
                {
                  id: "record_result",
                  type: "test.record_result",
                  position: { x: 80, y: 80 },
                  config: { name: "Subflow record" },
                },
              ],
              edges: [],
            },
          },
        },
      ],
      edges: [],
    });
    const run = {
      id: "run_1",
      workflow_id: "wf_report_duplicate",
      workflow_version: 1,
      status: "succeeded",
      created_at: "2026-06-18T00:00:00Z",
      started_at: "2026-06-18T00:00:01Z",
      completed_at: "2026-06-18T00:00:02Z",
      error: null,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([
          {
            id: "control.foreach",
            name: "For Each",
            category: "Control",
            description: "Runs body nodes for each item.",
            inputs: {},
            outputs: { done: { description: "Done" } },
            configSchema: {
              type: "object",
              properties: {
                items_expression: { title: "Items Expression", type: "string" },
              },
            },
          },
          {
            id: "test.record_result",
            name: "Record Result",
            category: "Testing",
            description: "Records a test result.",
            inputs: { input: { required: false, description: "Assertion" } },
            outputs: { success: { description: "Recorded" } },
            configSchema: {
              type: "object",
              properties: {
                name: { title: "Name", type: "string", default: "Assertion" },
              },
            },
          },
        ]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true")) && init?.method !== "POST") {
        return jsonResponse([{ id: "wf_report_duplicate", name: "Report duplicate ids", version: 1 }]);
      }
      if (url.endsWith("/api/workflows/wf_report_duplicate")) {
        return jsonResponse(duplicateIdWorkflow);
      }
      if (url.endsWith("/api/workflows?draft=true") && init?.method === "POST") {
        return jsonResponse({ ...duplicateIdWorkflow, version: 1 });
      }
      if (url.endsWith("/api/workflows/wf_report_duplicate/runs") && init?.method === "POST") {
        return jsonResponse(run);
      }
      if (url.endsWith("/api/runs/run_1/events")) {
        return jsonResponse([
          {
            id: 1,
            run_id: "run_1",
            type: "node_succeeded",
            timestamp: "2026-06-18T00:00:02Z",
            node_id: "record_result",
            scope: ["each_row", "iteration:0"],
            payload: {
              node_type: "test.record_result",
              outputs: {
                success: {
                  case: {
                    name: "Subflow report case",
                    status: "passed",
                  },
                },
              },
            },
          },
        ]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await openSavedWorkflow("Report duplicate ids");
    await screen.findByText("已加载 Report duplicate ids v1。");
    fireEvent.click(screen.getByRole("button", { name: "运行" }));
    await screen.findByText("运行成功。");
    fireEvent.click(await screen.findByRole("button", { name: /Subflow report case/ }));

    expect(screen.getByText("这个运行事件属于未打开的子流程，请先进入对应循环体查看。")).toBeInTheDocument();
    expect(within(screen.getByLabelText("配置面板")).getByText("选择一个节点后，在这里编辑它的参数。")).toBeInTheDocument();
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
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true")) && init?.method !== "POST") {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows?draft=true") && init?.method === "POST") {
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

    await screen.findByText("运行成功。");
    await waitFor(() => expect(templateButton).toBeEnabled());
  });

  it("locks workflow-level fields while saving and restores them after save settles", async () => {
    const saveWorkflow = deferred<Response>();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true")) && init?.method !== "POST") {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows?draft=true") && init?.method === "POST") {
        return saveWorkflow.promise;
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    const nameInput = await screen.findByLabelText("工作流名称");
    // 超时输入位于工作流设置弹层的执行设置分区，先打开弹层
    fireEvent.click(screen.getByRole("button", { name: "工作流设置" }));
    const timeoutInput = screen.getByLabelText("运行超时（秒）");
    fireEvent.change(nameInput, { target: { value: "保存中的工作流" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(nameInput).toBeDisabled();
      expect(timeoutInput).toBeDisabled();
    });

    fireEvent.change(nameInput, { target: { value: "保存中不应变更" } });
    expect(nameInput).toHaveValue("保存中的工作流");

    saveWorkflow.resolve(jsonResponse({ id: "wf_1", name: "保存中的工作流", version: 2, nodes: [], edges: [] }));

    await screen.findByText("已保存 v2。");
    expect(nameInput).toBeEnabled();
    expect(timeoutInput).toBeEnabled();
  });

  it("locks selected node config fields while saving and restores them after save settles", async () => {
    const saveWorkflow = deferred<Response>();
    let savedPayload: import("./types").WorkflowDocument | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([
          {
            id: "http.request",
            name: "HTTP Request",
            category: "Network",
            description: "Makes an HTTP request.",
            inputs: {},
            outputs: { success: { description: "Response" } },
            configSchema: {
              type: "object",
              properties: {
                url: { title: "URL", type: "string", default: "" },
              },
            },
          },
        ]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true")) && init?.method !== "POST") {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows?draft=true") && init?.method === "POST") {
        savedPayload = JSON.parse(String(init.body));
        return saveWorkflow.promise;
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "HTTP 请求" }));
    const urlInput = screen.getByLabelText("URL");
    fireEvent.change(urlInput, { target: { value: "https://api.example.com/health" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(urlInput).toBeDisabled());

    fireEvent.change(urlInput, { target: { value: "https://changed.example.com" } });
    expect(urlInput).toHaveValue("https://api.example.com/health");

    saveWorkflow.resolve(jsonResponse({ ...savedPayload, id: "wf_1", version: 2 }));

    await screen.findByText("已保存 v2。");
    expect(urlInput).toBeEnabled();
  });

  it("locks workflow settings variables while saving and restores them after save settles", async () => {
    const saveWorkflow = deferred<Response>();
    let savedPayload: import("./types").WorkflowDocument | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true")) && init?.method !== "POST") {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows?draft=true") && init?.method === "POST") {
        savedPayload = JSON.parse(String(init.body));
        return saveWorkflow.promise;
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "工作流设置" }));
    fireEvent.click(screen.getByRole("button", { name: "添加变量" }));
    fireEvent.change(screen.getByLabelText("变量名 variable_1"), { target: { value: "baseUrl" } });
    fireEvent.change(screen.getByLabelText("变量值 baseUrl"), { target: { value: "https://api.example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    const settingsDialog = screen.getByRole("dialog", { name: "工作流设置" });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "工作流设置" })).toBeDisabled();
      expect(within(settingsDialog).getByRole("button", { name: "添加变量" })).toBeDisabled();
      expect(within(settingsDialog).getByLabelText("变量名 baseUrl")).toBeDisabled();
      expect(within(settingsDialog).getByLabelText("变量值 baseUrl")).toBeDisabled();
      expect(within(settingsDialog).getByRole("button", { name: "删除" })).toBeDisabled();
    });

    fireEvent.change(within(settingsDialog).getByLabelText("变量值 baseUrl"), {
      target: { value: "https://changed.example.com" },
    });

    saveWorkflow.resolve(jsonResponse({ ...savedPayload, id: "wf_1", version: 2 }));

    await screen.findByText("已保存 v2。");
    expect(screen.getByRole("button", { name: "工作流设置" })).toBeEnabled();
    expect(within(settingsDialog).getByLabelText("变量值 baseUrl")).toBeEnabled();
  });

  it("loads the saved workflow list on startup", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true"))) {
        return jsonResponse([{ id: "wf_saved", name: "Saved Import", version: 4 }]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    const panel = await openWorkflowManager();
    expect(within(panel).getByText("Saved Import")).toBeInTheDocument();
    expect(within(panel).getByText("v4")).toBeInTheDocument();
    expect(within(panel).queryByText("wf_saved")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8150/api/workflows",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("shows duplicate saved workflow names without exposing internal ids in the workflow manager", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true"))) {
        return jsonResponse([
          { id: "wf_csv_alpha", name: "CSV 参数化接口测试", version: 1 },
          { id: "wf_csv_alpine", name: "CSV 参数化接口测试", version: 1 },
          { id: "wf_status", name: "单接口状态码断言", version: 2 },
        ]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    const panel = await openWorkflowManager();

    expect(within(panel).getAllByText("CSV 参数化接口测试")).toHaveLength(2);
    expect(within(panel).getAllByText("v1")).toHaveLength(2);
    expect(within(panel).queryByText("wf_csv_alpha")).not.toBeInTheDocument();
    expect(within(panel).queryByText("wf_csv_alpine")).not.toBeInTheDocument();
    expect(within(panel).getByText("单接口状态码断言")).toBeInTheDocument();
  });

  it("loads a selected saved workflow into the editor", async () => {
    const savedWorkflow = workflowDocument({ id: "wf_saved", name: "Customer Intake", version: 3 });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true"))) {
        return jsonResponse([{ id: "wf_saved", name: "Customer Intake", version: 3 }]);
      }
      if (url.endsWith("/api/workflows/wf_saved")) {
        return jsonResponse(savedWorkflow);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await openSavedWorkflow("Customer Intake");

    await screen.findByText("已加载 Customer Intake v3。");
    expect(screen.getByLabelText("工作流名称")).toHaveValue("Customer Intake");
  });

  it("keeps the current draft selected when loading a saved workflow fails", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true"))) {
        return jsonResponse([{ id: "wf_missing", name: "Broken Workflow", version: 7 }]);
      }
      if (url.endsWith("/api/workflows/wf_missing")) {
        return errorResponse(404, "Workflow not found");
      }
      if (url.endsWith("/api/workflows/wf_missing/runs?limit=5")) {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await openSavedWorkflow("Broken Workflow");

    expect(await screen.findByText("工作流加载失败：API 404: Workflow not found")).toBeInTheDocument();
    expect(screen.getByLabelText("工作流名称")).toHaveValue("未命名工作流");
    expect(screen.getByText("草稿")).toBeInTheDocument();
    expect(screen.queryByText("已保存")).not.toBeInTheDocument();
  });

  it("keeps current workflow issues when duplicating another workflow fails", async () => {
    const currentWorkflow = workflowDocument({
      id: "wf_current",
      name: "Current With Issue",
      version: 2,
      nodes: [
        {
          id: "request",
          type: "http.request",
          position: { x: 80, y: 80 },
          config: { method: "GET", url: "" },
        },
      ],
      edges: [],
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([
          {
            id: "http.request",
            name: "HTTP Request",
            category: "Network",
            description: "Send an HTTP request.",
            inputs: {},
            outputs: { success: { description: "Response" } },
            configSchema: {
              type: "object",
              properties: {
                method: { title: "Method", type: "string", default: "GET" },
                url: { title: "URL", type: "string" },
              },
            },
          },
        ]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true"))) {
        return jsonResponse([
          { id: "wf_current", name: "Current With Issue", version: 2 },
          { id: "wf_broken_copy", name: "Broken Copy Source", version: 1 },
        ]);
      }
      if (url.endsWith("/api/workflows/wf_current")) {
        return jsonResponse(currentWorkflow);
      }
      if (url.endsWith("/api/workflows/wf_broken_copy")) {
        return errorResponse(404, "Workflow not found");
      }
      if (url.endsWith("/api/workflows/wf_current/runs?limit=5")) {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await openSavedWorkflow("Current With Issue");
    await screen.findByText("已加载 Current With Issue v2。");

    fireEvent.click(screen.getByRole("button", { name: "运行" }));
    expect(await screen.findByRole("heading", { name: "问题中心" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /HTTP 请求缺少 URL。/ })).toBeInTheDocument();

    const panel = await openWorkflowManager();
    fireEvent.click(within(panel).getByRole("button", { name: "复制 Broken Copy Source" }));

    expect(await screen.findByText("复制工作流失败：API 404: Workflow not found")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "问题中心" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /HTTP 请求缺少 URL。/ })).toBeInTheDocument();
    expect(screen.getByLabelText("工作流名称")).toHaveValue("Current With Issue");
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
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true"))) {
        return jsonResponse([{ id: "wf_saved", name: "Customer Intake", version: 3 }]);
      }
      if (url.endsWith("/api/workflows/wf_saved")) {
        return jsonResponse(savedWorkflow);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await openSavedWorkflow("Customer Intake");
    await screen.findByText("已加载 Customer Intake v3。");
    const canvas = within(screen.getByLabelText("画布工作区"));
    expect(await canvas.findByText("手动触发")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "新建" }));

    await waitFor(() => expect(screen.getByLabelText("工作流名称")).toHaveValue("未命名工作流"));
    expect(canvas.queryByText("手动触发")).not.toBeInTheDocument();
    expect(screen.getByText("已新建工作流。")).toBeInTheDocument();
  });

  it("updates the saved workflow selector after saving", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true")) && init?.method !== "POST") {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows?draft=true") && init?.method === "POST") {
        return jsonResponse({
          ...(JSON.parse(String(init.body)) as object),
          id: "wf_saved",
          version: 2,
          nodes: [
            {
              id: "node_1",
              type: "manual.trigger",
              position: { x: 80, y: 80 },
              config: {},
            },
          ],
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.change(screen.getByLabelText("工作流名称"), { target: { value: "Saved From Editor" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await screen.findByText("已保存 v2。");
    const panel = await openWorkflowManager();
    expect(within(panel).getByText("Saved From Editor")).toBeInTheDocument();
    expect(within(panel).getByText("v2")).toBeInTheDocument();
    expect(within(panel).queryByText("wf_saved")).not.toBeInTheDocument();
    expect(within(panel).getByText("1 个节点 · 未知时间")).toBeInTheDocument();
  });

  it("shows draft, unsaved, and saved workflow states in the topbar", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true")) && init?.method !== "POST") {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows?draft=true") && init?.method === "POST") {
        return jsonResponse({
          ...(JSON.parse(String(init.body)) as object),
          id: "wf_saved",
          version: 2,
          nodes: [
            {
              id: "node_1",
              type: "manual.trigger",
              position: { x: 80, y: 80 },
              config: {},
            },
          ],
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(screen.getByText("草稿")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("工作流名称"), { target: { value: "Dirty Workflow" } });
    expect(screen.getByText("未保存")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await screen.findByText("已保存 v2。");
    expect(screen.getByText("已保存")).toBeInTheDocument();
  });

  it("edits the workflow run timeout and saves it with workflow settings", async () => {
    const savedWorkflows: import("./types").WorkflowDocument[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true")) && init?.method !== "POST") {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows?draft=true") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as import("./types").WorkflowDocument;
        savedWorkflows.push(body);
        return jsonResponse({ ...body, id: "wf_settings", version: 2 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await screen.findByLabelText("工作流名称");
    // 超时输入位于工作流设置弹层的执行设置分区，先打开弹层
    fireEvent.click(screen.getByRole("button", { name: "工作流设置" }));
    const timeoutInput = screen.getByLabelText("运行超时（秒）");
    expect(timeoutInput).toHaveValue(600);

    fireEvent.change(timeoutInput, { target: { value: "45" } });
    expect(screen.getByText("未保存")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await screen.findByText("已保存 v2。");
    expect(savedWorkflows.at(-1)?.settings?.timeout_seconds).toBe(45);
  });

  it("blocks a loaded workflow with an invalid timeout and opens workflow settings from the issue", async () => {
    const invalidWorkflow = workflowDocument({
      id: "wf_invalid_timeout",
      name: "非法超时工作流",
      version: 3,
      settings: { timeout_seconds: 86401 },
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true")) && init?.method !== "POST") {
        return jsonResponse([{ id: invalidWorkflow.id, name: invalidWorkflow.name, version: invalidWorkflow.version }]);
      }
      if (url.endsWith(`/api/workflows/${invalidWorkflow.id}`)) {
        return jsonResponse(invalidWorkflow);
      }
      if (url.endsWith("/api/workflows?draft=true") && init?.method === "POST") {
        throw new Error("saveWorkflow should not be called for an invalid timeout");
      }
      if (url.includes("/runs")) {
        throw new Error("createRun should not be called for an invalid timeout");
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await openSavedWorkflow("非法超时工作流");
    await screen.findByText("已加载 非法超时工作流 v3。");
    fireEvent.click(screen.getByRole("button", { name: "运行" }));

    expect(await screen.findByText("运行前检查发现 1 个问题，请先补齐配置。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /超时时间必须在 1 到 86400 秒之间。/ }));

    expect(screen.getByRole("dialog", { name: "工作流设置" })).toBeInTheDocument();
    expect(screen.getByLabelText("运行超时（秒）")).toHaveFocus();
    expect(screen.getByText("已打开工作流设置，请修正对应配置。")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "http://127.0.0.1:8150/api/workflows",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringMatching(/\/runs$/), expect.anything());
  });

  it("blocks saving a dirty workflow with an invalid timeout before calling the API", async () => {
    const invalidWorkflow = workflowDocument({
      id: "wf_invalid_timeout",
      name: "非法超时工作流",
      version: 3,
      settings: { timeout_seconds: 86401 },
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true")) && init?.method !== "POST") {
        return jsonResponse([{ id: invalidWorkflow.id, name: invalidWorkflow.name, version: invalidWorkflow.version }]);
      }
      if (url.endsWith(`/api/workflows/${invalidWorkflow.id}`)) {
        return jsonResponse(invalidWorkflow);
      }
      if (url.endsWith("/api/workflows?draft=true") && init?.method === "POST") {
        throw new Error("saveWorkflow should not be called for invalid workflow settings");
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await openSavedWorkflow("非法超时工作流");
    await screen.findByText("已加载 非法超时工作流 v3。");
    fireEvent.change(screen.getByLabelText("工作流名称"), { target: { value: "非法超时工作流 - 改名" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByText("保存前检查发现 1 个问题，请先补齐配置。")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "问题中心" })).toBeInTheDocument();
    expect(screen.getByText("本地检查 1")).toBeInTheDocument();
    expect(screen.queryByText("运行前 1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /超时时间必须在 1 到 86400 秒之间。/ }));

    expect(screen.getByLabelText("运行超时（秒）")).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "http://127.0.0.1:8150/api/workflows",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("shows invalid workflow variable names in the issue center before running", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true")) && init?.method !== "POST") {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows?draft=true") && init?.method === "POST") {
        throw new Error("saveWorkflow should not be called for invalid variables");
      }
      if (url.includes("/runs")) {
        throw new Error("createRun should not be called for invalid variables");
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "工作流设置" }));
    fireEvent.click(screen.getByRole("button", { name: "添加变量" }));
    fireEvent.change(screen.getByLabelText("变量名 variable_1"), { target: { value: "bad-name" } });
    fireEvent.click(screen.getByRole("button", { name: "运行" }));

    expect(await screen.findByText("运行前检查发现 1 个问题，请先补齐配置。")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "问题中心" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /变量 bad-name：变量名只能包含字母、数字和下划线/ }));

    expect(screen.getByRole("dialog", { name: "工作流设置" })).toBeInTheDocument();
    expect(screen.getByLabelText("变量名 bad-name")).toHaveFocus();
    expect(screen.getByText("已打开工作流设置，请修正对应配置。")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "http://127.0.0.1:8150/api/workflows",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringMatching(/\/runs$/), expect.anything());
  });

  it("edits workflow variables and saves them with workflow settings", async () => {
    const savedWorkflows: import("./types").WorkflowDocument[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true")) && init?.method !== "POST") {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows?draft=true") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as import("./types").WorkflowDocument;
        savedWorkflows.push(body);
        return jsonResponse({ ...body, id: "wf_variables", version: 2 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "工作流设置" }));
    fireEvent.click(screen.getByRole("button", { name: "添加变量" }));
    fireEvent.change(screen.getByLabelText("变量名 variable_1"), { target: { value: "baseUrl" } });
    fireEvent.change(screen.getByLabelText("变量值 baseUrl"), { target: { value: "https://api.example.com" } });
    expect(screen.getByText("未保存")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await screen.findByText("已保存 v2。");
    expect(savedWorkflows.at(-1)?.settings?.variables).toEqual({
      baseUrl: "https://api.example.com",
    });
  });

  it("offers workflow variables as insertable expressions in node config fields", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([
          {
            id: "utility.transform",
            name: "Transform",
            category: "Utility",
            description: "Return a selected expression value.",
            inputs: { input: { required: false, description: "Input" } },
            outputs: { success: { description: "Transformed value" } },
            configSchema: {
              type: "object",
              properties: {
                value: { title: "Value expression", type: "string", default: "" },
              },
            },
          },
        ]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true"))) {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "工作流设置" }));
    fireEvent.click(screen.getByRole("button", { name: "添加变量" }));
    fireEvent.change(screen.getByLabelText("变量名 variable_1"), { target: { value: "baseUrl" } });
    fireEvent.change(screen.getByLabelText("变量值 baseUrl"), { target: { value: "https://api.example.com" } });

    fireEvent.click(await screen.findByRole("button", { name: "转换" }));
    const valueField = await screen.findByLabelText("值表达式");
    fireEvent.focus(valueField);
    fireEvent.click(screen.getByRole("button", { name: "插入 {{ vars.baseUrl }}" }));

    expect(valueField).toHaveValue("{{ vars.baseUrl }}");
  });

  it("blocks saving workflow variables with names that cannot be used in expressions", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true")) && init?.method !== "POST") {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows?draft=true") && init?.method === "POST") {
        throw new Error("invalid workflow variable names should block saving");
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "工作流设置" }));
    fireEvent.click(screen.getByRole("button", { name: "添加变量" }));
    fireEvent.change(screen.getByLabelText("变量名 variable_1"), { target: { value: "bad-name" } });

    expect(screen.getByText("变量名只能包含字母、数字和下划线，且不能以数字开头。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(fetchMock).not.toHaveBeenCalledWith(
      "http://127.0.0.1:8150/api/workflows",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("keeps unsaved changes when discarding the draft is cancelled", async () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText("工作流名称"), { target: { value: "Dirty Workflow" } });
    fireEvent.click(screen.getByRole("button", { name: "新建" }));

    // 统一确认弹窗替换 window.confirm：点击取消后保留未保存修改
    const discardDialog = await screen.findByRole("dialog", { name: "丢弃未保存修改？" });
    expect(discardDialog).toHaveTextContent("当前工作流有未保存变更，继续会丢弃这些修改。是否继续？");
    fireEvent.click(within(discardDialog).getByRole("button", { name: "取消" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "丢弃未保存修改？" })).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText("工作流名称")).toHaveValue("Dirty Workflow");
    expect(screen.getByText("未保存")).toBeInTheDocument();
  });

  it("warns before closing the page when the workflow has unsaved changes", () => {
    render(<App />);

    const cleanClose = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(cleanClose);
    expect(cleanClose.defaultPrevented).toBe(false);

    fireEvent.change(screen.getByLabelText("工作流名称"), { target: { value: "Dirty Workflow" } });

    const dirtyClose = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirtyClose);

    expect(dirtyClose.defaultPrevented).toBe(true);
  });

  it("saves the workflow with the keyboard shortcut", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true")) && init?.method !== "POST") {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows?draft=true") && init?.method === "POST") {
        return jsonResponse({
          ...(JSON.parse(String(init.body)) as object),
          id: "wf_saved",
          version: 2,
          nodes: [
            {
              id: "node_1",
              type: "manual.trigger",
              position: { x: 80, y: 80 },
              config: {},
            },
          ],
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.change(screen.getByLabelText("工作流名称"), { target: { value: "Shortcut Saved" } });
    const shortcut = new KeyboardEvent("keydown", { cancelable: true, ctrlKey: true, key: "s" });
    window.dispatchEvent(shortcut);

    expect(shortcut.defaultPrevented).toBe(true);
    await screen.findByText("已保存 v2。");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8150/api/workflows?draft=true",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("normalizes saved workflow responses before later edits are saved again", async () => {
    const savedPayloads: import("./types").WorkflowDocument[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true")) && init?.method !== "POST") {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows?draft=true") && init?.method === "POST") {
        const payload = JSON.parse(String(init.body)) as import("./types").WorkflowDocument;
        savedPayloads.push(payload);
        return jsonResponse({
          id: "wf_saved",
          name: payload.name,
          version: savedPayloads.length + 1,
          nodes: payload.nodes,
          edges: payload.edges,
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.change(screen.getByLabelText("工作流名称"), { target: { value: "第一次保存" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await screen.findByText("已保存 v2。");
    expect(savedPayloads).toHaveLength(1);

    fireEvent.change(screen.getByLabelText("工作流名称"), { target: { value: "第二次保存" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await screen.findByText("已保存 v3。");
    expect(savedPayloads).toHaveLength(2);
    expect(savedPayloads[1].settings).toEqual({
      timeout_seconds: 600,
      variables: {},
      error_workflow_id: null,
      max_concurrent_runs: null,
      environment_id: "default",
    });
  });

  it("does not create a new version when the save shortcut handles an unchanged saved workflow", async () => {
    const savedWorkflow = workflowDocument({ id: "wf_saved", name: "Clean Workflow", version: 3 });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true")) && init?.method !== "POST") {
        return jsonResponse([{ id: "wf_saved", name: "Clean Workflow", version: 3 }]);
      }
      if (url.endsWith("/api/workflows/wf_saved")) {
        return jsonResponse(savedWorkflow);
      }
      if (url.endsWith("/api/workflows/wf_saved/runs?limit=5")) {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows?draft=true") && init?.method === "POST") {
        throw new Error("unchanged workflow should not be saved again");
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await openSavedWorkflow("Clean Workflow");
    await screen.findByText("已加载 Clean Workflow v3。");
    await waitFor(() => expect(screen.getByRole("button", { name: "保存" })).toBeDisabled());
    const shortcut = new KeyboardEvent("keydown", { cancelable: true, ctrlKey: true, key: "s" });
    window.dispatchEvent(shortcut);

    expect(shortcut.defaultPrevented).toBe(true);
    expect(await screen.findByText("没有需要保存的修改。")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "http://127.0.0.1:8150/api/workflows",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("keeps a stale workflow dirty and explains a version conflict in Chinese", async () => {
    const savedWorkflow = workflowDocument({ id: "wf_conflict", name: "并发保存", version: 3 });
    let conflictDetected = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true")) && init?.method !== "POST") {
        return jsonResponse([{ id: "wf_conflict", name: "并发保存", version: 3 }]);
      }
      if (url.endsWith("/api/workflows/wf_conflict") && !init?.method) {
        return jsonResponse(
          conflictDetected
            ? { ...savedWorkflow, name: "服务器最新版本", version: 4 }
            : savedWorkflow,
        );
      }
      if (url.endsWith("/api/workflows/wf_conflict/runs?limit=5")) {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows/wf_conflict/publication")) {
        return jsonResponse({
          workflow_id: "wf_conflict",
          draft_version: 3,
          published_version: null,
          active: false,
          has_unpublished_changes: false,
        });
      }
      if (url.endsWith("/api/workflows?draft=true") && init?.method === "POST") {
        conflictDetected = true;
        return errorResponse(409, JSON.stringify({
          detail: {
            code: "workflow_version_conflict",
            message: "工作流已被其他操作更新，请重新加载后再保存。",
            expected_version: 3,
            current_version: 4,
          },
        }));
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await openSavedWorkflow("并发保存");
    await screen.findByText("已加载 并发保存 v3。");
    fireEvent.change(screen.getByLabelText("工作流名称"), { target: { value: "我的未保存修改" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByRole("dialog", { name: "处理工作流版本冲突" })).toBeInTheDocument();
    expect(screen.getByText("检测到工作流版本冲突，当前页面修改仍然保留。")).toBeInTheDocument();
    expect(screen.getByText("v3")).toBeInTheDocument();
    expect(screen.getByText("v4")).toBeInTheDocument();
    expect(screen.getByLabelText("工作流名称")).toHaveValue("我的未保存修改");
    expect(screen.getByLabelText("保存状态")).toHaveTextContent("保存冲突");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8150/api/workflows?draft=true",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "X-Workflow-Expected-Version": "3" }),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    await waitFor(() => expect(screen.getByLabelText("工作流名称")).toHaveValue("服务器最新版本"));
    expect(screen.getByLabelText("保存状态")).toHaveTextContent("已保存");
    expect(screen.queryByRole("dialog", { name: "处理工作流版本冲突" })).not.toBeInTheDocument();
  });

  it("preserves a conflicted canvas by saving it as a new draft copy", async () => {
    const savedWorkflow = workflowDocument({ id: "wf_conflict_copy", name: "冲突副本", version: 2 });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true")) && init?.method !== "POST") {
        return jsonResponse([{ id: savedWorkflow.id, name: savedWorkflow.name, version: 2 }]);
      }
      if (url.endsWith(`/api/workflows/${savedWorkflow.id}`) && !init?.method) {
        return jsonResponse(savedWorkflow);
      }
      if (url.endsWith(`/api/workflows/${savedWorkflow.id}/runs?limit=5`)) {
        return jsonResponse([]);
      }
      if (url.endsWith(`/api/workflows/${savedWorkflow.id}/publication`)) {
        return jsonResponse({
          workflow_id: savedWorkflow.id,
          draft_version: 2,
          published_version: null,
          active: false,
          has_unpublished_changes: false,
        });
      }
      if (url.endsWith("/api/workflows?draft=true") && init?.method === "POST") {
        const request = JSON.parse(String(init.body)) as WorkflowDocument;
        if (request.id === savedWorkflow.id) {
          return errorResponse(409, JSON.stringify({
            detail: {
              code: "workflow_version_conflict",
              message: "工作流已更新。",
              expected_version: 2,
              current_version: 3,
            },
          }));
        }
        return jsonResponse({ ...request, version: 1 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await openSavedWorkflow("冲突副本");
    await screen.findByText("已加载 冲突副本 v2。");
    fireEvent.change(screen.getByLabelText("工作流名称"), { target: { value: "需要保留" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByRole("dialog", { name: "处理工作流版本冲突" });
    fireEvent.click(screen.getByRole("button", { name: "另存为副本" }));

    await screen.findByText(/已保留当前修改，并另存为“需要保留 副本” v1。/);
    expect(screen.getByLabelText("工作流名称")).toHaveValue("需要保留 副本");
    expect(screen.getByLabelText("保存状态")).toHaveTextContent("已保存");
    const saveRequests = fetchMock.mock.calls.filter(([input, init]) =>
      String(input).endsWith("/api/workflows?draft=true") && init?.method === "POST"
    );
    expect(saveRequests).toHaveLength(2);
    expect((saveRequests[1]?.[1]?.headers as Record<string, string>)["X-Workflow-Expected-Version"]).toBeUndefined();
  });

  it("automatically saves a quiet dirty workflow with its expected version", async () => {
    const savedWorkflow = workflowDocument({ id: "wf_auto_save", name: "自动保存", version: 1 });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true")) && init?.method !== "POST") {
        return jsonResponse([{ id: savedWorkflow.id, name: savedWorkflow.name, version: 1 }]);
      }
      if (url.endsWith(`/api/workflows/${savedWorkflow.id}`) && !init?.method) {
        return jsonResponse(savedWorkflow);
      }
      if (url.endsWith(`/api/workflows/${savedWorkflow.id}/runs?limit=5`)) {
        return jsonResponse([]);
      }
      if (url.endsWith(`/api/workflows/${savedWorkflow.id}/publication`)) {
        return jsonResponse({
          workflow_id: savedWorkflow.id,
          draft_version: 1,
          published_version: null,
          active: false,
          has_unpublished_changes: false,
        });
      }
      if (url.endsWith("/api/workflows?draft=true") && init?.method === "POST") {
        const request = JSON.parse(String(init.body)) as WorkflowDocument;
        return jsonResponse({ ...request, version: 2 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await openSavedWorkflow("自动保存");
    await screen.findByText("已加载 自动保存 v1。");
    fireEvent.change(screen.getByLabelText("工作流名称"), {
      target: { value: "自动保存后的名称" },
    });

    expect(screen.getByLabelText("保存状态")).toHaveTextContent("未保存");
    await waitFor(
      () => expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:8150/api/workflows?draft=true",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ "X-Workflow-Expected-Version": "1" }),
        }),
      ),
      { timeout: 4_000 },
    );
    await waitFor(() => expect(screen.getByLabelText("保存状态")).toHaveTextContent("已保存"));
    expect(screen.getByLabelText("工作流名称")).toHaveValue("自动保存后的名称");
  });

  it("keeps edits made during an automatic save and queues the newer document", async () => {
    const savedWorkflow = workflowDocument({ id: "wf_auto_rebase", name: "保存中编辑", version: 1 });
    const pendingSave = deferred<Response>();
    let requestedWorkflow: WorkflowDocument | null = null;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true")) && init?.method !== "POST") {
        return jsonResponse([{ id: savedWorkflow.id, name: savedWorkflow.name, version: 1 }]);
      }
      if (url.endsWith(`/api/workflows/${savedWorkflow.id}`) && !init?.method) {
        return jsonResponse(savedWorkflow);
      }
      if (url.endsWith(`/api/workflows/${savedWorkflow.id}/runs?limit=5`)) {
        return jsonResponse([]);
      }
      if (url.endsWith(`/api/workflows/${savedWorkflow.id}/publication`)) {
        return jsonResponse({
          workflow_id: savedWorkflow.id,
          draft_version: 1,
          published_version: null,
          active: false,
          has_unpublished_changes: false,
        });
      }
      if (url.endsWith("/api/workflows?draft=true") && init?.method === "POST") {
        requestedWorkflow = JSON.parse(String(init.body)) as WorkflowDocument;
        return pendingSave.promise;
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await openSavedWorkflow("保存中编辑");
    await screen.findByText("已加载 保存中编辑 v1。");
    const nameInput = screen.getByLabelText("工作流名称");
    fireEvent.change(nameInput, { target: { value: "第一轮修改" } });
    await waitFor(() => expect(requestedWorkflow).toMatchObject({ name: "第一轮修改" }), {
      timeout: 4_000,
    });
    expect(nameInput).toBeEnabled();
    expect(screen.getByLabelText("保存状态")).toHaveTextContent("自动保存中");

    fireEvent.change(nameInput, { target: { value: "保存期间的新修改" } });
    pendingSave.resolve(jsonResponse({ ...requestedWorkflow!, version: 2 }));

    await waitFor(() => expect(nameInput).toHaveValue("保存期间的新修改"));
    await waitFor(() => expect(screen.getByLabelText("保存状态")).toHaveTextContent("未保存"));
  });

  it("disables the save button until a saved workflow changes", async () => {
    const savedWorkflow = workflowDocument({ id: "wf_saved", name: "Clean Workflow", version: 3 });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true"))) {
        return jsonResponse([{ id: "wf_saved", name: "Clean Workflow", version: 3 }]);
      }
      if (url.endsWith("/api/workflows/wf_saved")) {
        return jsonResponse(savedWorkflow);
      }
      if (url.endsWith("/api/workflows/wf_saved/runs?limit=5")) {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await openSavedWorkflow("Clean Workflow");
    await screen.findByText("已加载 Clean Workflow v3。");
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存" })).toHaveAttribute("title", "当前版本没有未保存变更");

    fireEvent.change(screen.getByLabelText("工作流名称"), { target: { value: "Changed Workflow" } });

    expect(screen.getByText("未保存")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "保存" })).toHaveAttribute("title", "保存当前工作流");
  });

  it("disables the workflow manager save action until a saved workflow changes", async () => {
    const savedWorkflow = workflowDocument({ id: "wf_saved", name: "Clean Workflow", version: 3 });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true"))) {
        return jsonResponse([{ id: "wf_saved", name: "Clean Workflow", version: 3 }]);
      }
      if (url.endsWith("/api/workflows/wf_saved")) {
        return jsonResponse(savedWorkflow);
      }
      if (url.endsWith("/api/workflows/wf_saved/runs?limit=5")) {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await openSavedWorkflow("Clean Workflow");
    await screen.findByText("已加载 Clean Workflow v3。");
    let panel = await openWorkflowManager();
    expect(within(panel).getByRole("button", { name: "保存当前" })).toBeDisabled();
    expect(within(panel).getByRole("button", { name: "保存当前" })).toHaveAttribute(
      "title",
      "当前版本没有未保存变更"
    );
    fireEvent.click(within(panel).getByRole("button", { name: "关闭工作流管理" }));

    fireEvent.change(screen.getByLabelText("工作流名称"), { target: { value: "Changed Workflow" } });
    panel = await openWorkflowManager();

    expect(within(panel).getByRole("button", { name: "保存当前" })).toBeEnabled();
    expect(within(panel).getByRole("button", { name: "保存当前" })).toHaveAttribute("title", "保存当前工作流");
  });

  it("runs an unchanged saved workflow without creating a new version", async () => {
    const savedWorkflow = workflowDocument({
      id: "wf_saved",
      name: "Runnable Clean Workflow",
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
      workflow_id: "wf_saved",
      workflow_version: 3,
      status: "succeeded",
      created_at: "2026-06-16T00:00:00Z",
      started_at: "2026-06-16T00:00:01Z",
      completed_at: "2026-06-16T00:00:02Z",
      error: null,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([nodeType]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true")) && init?.method !== "POST") {
        return jsonResponse([{ id: "wf_saved", name: "Runnable Clean Workflow", version: 3 }]);
      }
      if (url.endsWith("/api/workflows/wf_saved")) {
        return jsonResponse(savedWorkflow);
      }
      if (url.endsWith("/api/workflows/wf_saved/runs") && init?.method === "POST") {
        return jsonResponse(run);
      }
      if (url.endsWith("/api/workflows/wf_saved/runs?limit=5")) {
        return jsonResponse([run]);
      }
      if (url.endsWith("/api/runs/run_1/events")) {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows?draft=true") && init?.method === "POST") {
        throw new Error("unchanged workflow should not be saved before running");
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await openSavedWorkflow("Runnable Clean Workflow");
    await screen.findByText("已加载 Runnable Clean Workflow v3。");
    fireEvent.click(screen.getByRole("button", { name: "运行" }));

    await screen.findByText("运行成功。");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8150/api/workflows/wf_saved/runs",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      "http://127.0.0.1:8150/api/workflows",
      expect.objectContaining({ method: "POST" })
    );
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
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true")) && init?.method !== "POST") {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows?draft=true") && init?.method === "POST") {
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

    fireEvent.click(await screen.findByRole("button", { name: "手动触发" }));
    fireEvent.click(screen.getByRole("button", { name: "运行" }));

    await screen.findByText("运行成功。");
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:8150/api/runs/run_1/events",
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      )
    );
    const runPanel = screen.getByLabelText("运行结果");
    fireEvent.click(within(runPanel).getByRole("tab", { name: "运行事件" }));
    expect(await within(runPanel).findByText("工作流完成")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "运行" })).toBeEnabled());
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8150/api/workflows/wf_1/runs",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8150/api/runs/run_1/events",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(window.location.pathname).toMatch(/^\/workflow\/wf_1\/executions\/run_1(?:\/[^/]+)?$/);
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
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true")) && init?.method !== "POST") {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows?draft=true") && init?.method === "POST") {
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

    fireEvent.click(await screen.findByRole("button", { name: "手动触发" }));
    fireEvent.click(screen.getByRole("button", { name: "运行" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "取消" })).toBeEnabled());
    const cancelButton = screen.getByRole("button", { name: "取消" });

    fireEvent.click(cancelButton);

    await screen.findByText("运行已取消。");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8150/api/runs/run_1/cancel",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8150/api/runs/run_1",
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
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true")) && init?.method !== "POST") {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows?draft=true") && init?.method === "POST") {
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

    fireEvent.click(await screen.findByRole("button", { name: "手动触发" }));
    fireEvent.click(screen.getByRole("button", { name: "运行" }));

    await screen.findByText("运行成功。");
    fireEvent.click(screen.getByRole("tab", { name: "运行事件" }));
    const eventButton = await screen.findByRole("button", { name: /节点成功/ });
    fireEvent.click(eventButton);

    expect(screen.getByText("已从运行事件打开节点运行详情。")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "运行详情" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("来源：运行事件")).toBeInTheDocument();
    expect(screen.getByText("状态：成功")).toBeInTheDocument();
    expect(screen.getByText("耗时：4 ms")).toBeInTheDocument();
    expect(screen.getAllByText(/Alice/).length).toBeGreaterThan(0);
  });

  it("opens runtime details from the canvas run summary", async () => {
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
      workflow_version: 1,
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
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true")) && init?.method !== "POST") {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows?draft=true") && init?.method === "POST") {
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

    fireEvent.click(await screen.findByRole("button", { name: "手动触发" }));
    fireEvent.click(screen.getByRole("button", { name: "运行" }));

    await screen.findByText("运行成功。");
    fireEvent.click(await screen.findByRole("button", { name: /查看运行数据：手动触发/ }));

    expect(screen.getByText("已从画布节点打开节点运行详情。")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "运行详情" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("来源：画布节点")).toBeInTheDocument();
    expect(screen.getByText("范围：主流程")).toBeInTheDocument();
    expect(screen.getAllByText(/Alice/).length).toBeGreaterThan(0);
  });
  it("shows runtime output fields as insertable expression references", async () => {
    const nodeType = {
      id: "manual.trigger",
      name: "Manual Trigger",
      category: "Triggers",
      description: "Starts a workflow manually.",
      inputs: {},
      outputs: { success: { description: "Initial payload" } },
      configSchema: {
        type: "object",
        properties: {
          payload: { title: "Payload", type: "object" },
        },
      },
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
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true")) && init?.method !== "POST") {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows?draft=true") && init?.method === "POST") {
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
              outputs: {
                success: {
                  body: { token: "abc", user: { id: 42 } },
                  status_code: 200,
                },
              },
              duration_ms: 4,
            },
          },
        ]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "手动触发" }));
    fireEvent.click(screen.getByRole("button", { name: "运行" }));

    await screen.findByText("运行成功。");
    fireEvent.focus(screen.getByLabelText("载荷"));

    expect(await screen.findByText(`{{ nodes.${savedNodeId}.outputs.success.body.token }}`)).toBeInTheDocument();
    expect(screen.getByText(`{{ nodes.${savedNodeId}.outputs.success.body.user.id }}`)).toBeInTheDocument();
    expect(screen.getByText(`{{ nodes.${savedNodeId}.outputs.success.status_code }}`)).toBeInTheDocument();
  });

  it("loads recent runs for the selected workflow into the workflow manager", async () => {
    const workflow = workflowDocument({ id: "wf_history", name: "运行历史演示", version: 2 });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true"))) {
        return jsonResponse([{ id: "wf_history", name: "运行历史演示", version: 2 }]);
      }
      if (url.endsWith("/api/workflows/wf_history")) {
        return jsonResponse(workflow);
      }
      if (url.endsWith("/api/workflows/wf_history/runs?limit=5")) {
        return jsonResponse([
          {
            id: "run_recent",
            workflow_id: "wf_history",
            workflow_version: 2,
            status: "succeeded",
            created_at: "2026-06-24T02:00:00Z",
            started_at: "2026-06-24T02:00:01Z",
            completed_at: "2026-06-24T02:00:03Z",
            error: null,
          },
        ]);
      }
      throw new Error("Unexpected request: " + url);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await openSavedWorkflow("运行历史演示");
    await screen.findByText("已加载 运行历史演示 v2。");
    const panel = await openWorkflowManager();

    expect(within(panel).getByText("当前工作流最近运行")).toBeInTheDocument();
    expect(within(panel).getByText(/运行记录 1/)).toBeInTheDocument();
    expect(within(panel).getByText("成功", { selector: ".workflow-manager-status" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8150/api/workflows/wf_history/runs?limit=5",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("loads older workflow runs into the existing history list", async () => {
    const workflow = workflowDocument({ id: "wf_history_more", name: "更多运行历史", version: 1 });
    const page = Array.from({ length: 5 }, (_, index) => ({
      id: `run_page_${index}`,
      workflow_id: "wf_history_more",
      workflow_version: 1,
      status: "succeeded",
      created_at: `2026-07-${String(23 - index).padStart(2, "0")}T00:00:00Z`,
      started_at: "2026-07-23T00:00:00Z",
      completed_at: "2026-07-23T00:00:01Z",
      error: null,
    }));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true"))) {
        return jsonResponse([{ id: "wf_history_more", name: "更多运行历史", version: 1 }]);
      }
      if (url.endsWith("/api/workflows/wf_history_more")) {
        return jsonResponse(workflow);
      }
      if (url.endsWith("/api/workflows/wf_history_more/runs?limit=5")) {
        return jsonResponse(page);
      }
      if (url.endsWith("/api/workflows/wf_history_more/runs?limit=5&offset=5")) {
        return jsonResponse([
          {
            ...page[0],
            id: "run_page_5",
            created_at: "2026-07-18T00:00:00Z",
          },
        ]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await openSavedWorkflow("更多运行历史");
    const manager = await openWorkflowManager();
    const history = within(manager).getByRole("region", { name: "当前工作流最近运行" });
    expect(within(history).getAllByRole("listitem")).toHaveLength(5);

    fireEvent.click(within(history).getByRole("button", { name: "加载更多运行记录" }));

    await waitFor(() => expect(within(history).getAllByRole("listitem")).toHaveLength(6));
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8150/api/workflows/wf_history_more/runs?limit=5&offset=5",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("filters a workflow history from the first page", async () => {
    const workflow = workflowDocument({ id: "wf_history_filter", name: "筛选运行历史", version: 1 });
    const failedRun = {
      id: "run_failed",
      workflow_id: "wf_history_filter",
      workflow_version: 1,
      status: "failed",
      created_at: "2026-07-23T00:00:00Z",
      started_at: "2026-07-23T00:00:00Z",
      completed_at: "2026-07-23T00:00:01Z",
      error: "断言失败",
    };
    const succeededRun = { ...failedRun, id: "run_succeeded", status: "succeeded", error: null };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true"))) {
        return jsonResponse([{ id: "wf_history_filter", name: "筛选运行历史", version: 1 }]);
      }
      if (url.endsWith("/api/workflows/wf_history_filter")) {
        return jsonResponse(workflow);
      }
      if (url.endsWith("/api/workflows/wf_history_filter/runs?limit=5")) {
        return jsonResponse([succeededRun, failedRun]);
      }
      if (url.endsWith("/api/workflows/wf_history_filter/runs?limit=5&status=failed")) {
        return jsonResponse([failedRun]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await openSavedWorkflow("筛选运行历史");
    const manager = await openWorkflowManager();
    const history = within(manager).getByRole("region", { name: "当前工作流最近运行" });
    expect(within(history).getAllByRole("listitem")).toHaveLength(2);

    fireEvent.click(within(history).getByRole("button", { name: "筛选失败运行" }));

    await waitFor(() => expect(within(history).getAllByRole("listitem")).toHaveLength(1));
    expect(within(history).getByText("断言失败")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8150/api/workflows/wf_history_filter/runs?limit=5&status=failed",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("shows a run history load error inside the workflow manager", async () => {
    const workflow = workflowDocument({ id: "wf_history_error", name: "历史失败演示", version: 2 });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true"))) {
        return jsonResponse([{ id: "wf_history_error", name: "历史失败演示", version: 2 }]);
      }
      if (url.endsWith("/api/workflows/wf_history_error")) {
        return jsonResponse(workflow);
      }
      if (url.endsWith("/api/workflows/wf_history_error/runs?limit=5")) {
        return errorResponse(500, "Run history unavailable");
      }
      throw new Error("Unexpected request: " + url);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await openSavedWorkflow("历史失败演示");
    await screen.findByText("已加载 历史失败演示 v2。");
    const panel = await openWorkflowManager();

    expect(within(panel).getByText("运行历史加载失败：服务暂时不可用，请稍后重试（API 500: Run history unavailable）")).toBeInTheDocument();
    expect(within(panel).queryByText("暂无运行记录")).not.toBeInTheDocument();
  });

  it("retries run history loading from the workflow manager error state", async () => {
    const workflow = workflowDocument({ id: "wf_history_retry", name: "历史重试演示", version: 2 });
    const recoveredRun = {
      id: "run_recovered",
      workflow_id: "wf_history_retry",
      workflow_version: 2,
      status: "succeeded",
      created_at: "2026-06-24T02:00:00Z",
      started_at: "2026-06-24T02:00:01Z",
      completed_at: "2026-06-24T02:00:03Z",
      error: null,
    };
    let historyRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true"))) {
        return jsonResponse([{ id: "wf_history_retry", name: "历史重试演示", version: 2 }]);
      }
      if (url.endsWith("/api/workflows/wf_history_retry")) {
        return jsonResponse(workflow);
      }
      if (url.endsWith("/api/workflows/wf_history_retry/runs?limit=5")) {
        historyRequests += 1;
        return historyRequests === 1 ? errorResponse(500, "Run history unavailable") : jsonResponse([recoveredRun]);
      }
      throw new Error("Unexpected request: " + url);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await openSavedWorkflow("历史重试演示");
    await screen.findByText("已加载 历史重试演示 v2。");
    const panel = await openWorkflowManager();
    expect(within(panel).getByText("运行历史加载失败：服务暂时不可用，请稍后重试（API 500: Run history unavailable）")).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole("button", { name: "重试运行历史加载" }));

    expect(await within(panel).findByText(/运行记录 1/)).toBeInTheDocument();
    expect(within(panel).queryByText("运行历史加载失败：服务暂时不可用，请稍后重试（API 500: Run history unavailable）")).not.toBeInTheDocument();
    expect(historyRequests).toBe(2);
  });

  it("refreshes run history manually from the workflow manager", async () => {
    const workflow = workflowDocument({ id: "wf_history_refresh", name: "历史刷新演示", version: 2 });
    const refreshedRun = {
      id: "run_refreshed",
      workflow_id: "wf_history_refresh",
      workflow_version: 2,
      status: "succeeded",
      created_at: "2026-06-24T02:00:00Z",
      started_at: "2026-06-24T02:00:01Z",
      completed_at: "2026-06-24T02:00:03Z",
      error: null,
    };
    let historyRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true"))) {
        return jsonResponse([{ id: "wf_history_refresh", name: "历史刷新演示", version: 2 }]);
      }
      if (url.endsWith("/api/workflows/wf_history_refresh")) {
        return jsonResponse(workflow);
      }
      if (url.endsWith("/api/workflows/wf_history_refresh/runs?limit=5")) {
        historyRequests += 1;
        return jsonResponse(historyRequests === 1 ? [] : [refreshedRun]);
      }
      throw new Error("Unexpected request: " + url);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await openSavedWorkflow("历史刷新演示");
    await screen.findByText("已加载 历史刷新演示 v2。");
    const panel = await openWorkflowManager();
    expect(within(panel).getByText("暂无运行记录")).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole("button", { name: "刷新运行历史" }));

    expect(await within(panel).findByText(/运行记录 1/)).toBeInTheDocument();
    expect(historyRequests).toBe(2);
  });

  it("ignores a stale manual run history refresh after another workflow is loaded", async () => {
    const firstWorkflow = workflowDocument({ id: "wf_first", name: "第一个工作流", version: 1 });
    const secondWorkflow = workflowDocument({ id: "wf_second", name: "第二个工作流", version: 1 });
    const staleFirstRun = {
      id: "run_first_stale",
      workflow_id: "wf_first",
      workflow_version: 1,
      status: "succeeded",
      created_at: "2026-06-24T02:00:00Z",
      started_at: "2026-06-24T02:00:01Z",
      completed_at: "2026-06-24T02:00:03Z",
      error: null,
    };
    let firstHistoryRequests = 0;
    let resolveFirstRefresh: (response: Response) => void = () => undefined;
    const firstRefreshResponse = new Promise<Response>((resolve) => {
      resolveFirstRefresh = resolve;
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true"))) {
        return jsonResponse([
          { id: "wf_first", name: "第一个工作流", version: 1 },
          { id: "wf_second", name: "第二个工作流", version: 1 },
        ]);
      }
      if (url.endsWith("/api/workflows/wf_first")) {
        return jsonResponse(firstWorkflow);
      }
      if (url.endsWith("/api/workflows/wf_second")) {
        return jsonResponse(secondWorkflow);
      }
      if (url.endsWith("/api/workflows/wf_first/runs?limit=5")) {
        firstHistoryRequests += 1;
        return firstHistoryRequests === 1 ? jsonResponse([]) : firstRefreshResponse;
      }
      if (url.endsWith("/api/workflows/wf_second/runs?limit=5")) {
        return jsonResponse([]);
      }
      throw new Error("Unexpected request: " + url);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await openSavedWorkflow("第一个工作流");
    await screen.findByText("已加载 第一个工作流 v1。");
    const panel = await openWorkflowManager();
    fireEvent.click(within(panel).getByRole("button", { name: "刷新运行历史" }));

    fireEvent.click(within(panel).getByRole("button", { name: "打开 第二个工作流" }));
    await screen.findByText("已加载 第二个工作流 v1。");

    resolveFirstRefresh(jsonResponse([staleFirstRun]));
    const refreshedPanel = await openWorkflowManager();

    await waitFor(() => {
      expect(within(refreshedPanel).queryByText("run_first_stale")).not.toBeInTheDocument();
    });
    expect(within(refreshedPanel).getByText("暂无运行记录")).toBeInTheDocument();
    expect(firstHistoryRequests).toBe(2);
  });

  it("keeps loaded run history when a later refresh fails", async () => {
    const workflow = workflowDocument({
      id: "wf_history",
      name: "运行历史演示",
      version: 2,
      nodes: [
        {
          id: "trigger",
          type: "manual.trigger",
          position: { x: 0, y: 0 },
          config: {},
        },
      ],
    });
    const historicalRun = {
      id: "run_recent",
      workflow_id: "wf_history",
      workflow_version: 2,
      status: "succeeded",
      created_at: "2026-06-24T02:00:00Z",
      started_at: "2026-06-24T02:00:01Z",
      completed_at: "2026-06-24T02:00:03Z",
      error: null,
    };
    const currentRun = {
      id: "run_new",
      workflow_id: "wf_history",
      workflow_version: 2,
      status: "succeeded",
      created_at: "2026-06-24T03:00:00Z",
      started_at: "2026-06-24T03:00:01Z",
      completed_at: "2026-06-24T03:00:02Z",
      error: null,
    };
    let runHistoryRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true"))) {
        return jsonResponse([{ id: "wf_history", name: "运行历史演示", version: 2 }]);
      }
      if (url.endsWith("/api/workflows/wf_history")) {
        return jsonResponse(workflow);
      }
      if (url.endsWith("/api/workflows/wf_history/runs?limit=5")) {
        runHistoryRequests += 1;
        return runHistoryRequests === 1
          ? jsonResponse([historicalRun])
          : errorResponse(500, "Run history unavailable");
      }
      if (url.endsWith("/api/workflows/wf_history/runs") && init?.method === "POST") {
        return jsonResponse(currentRun);
      }
      if (url.endsWith("/api/runs/run_new/events")) {
        return jsonResponse([]);
      }
      throw new Error("Unexpected request: " + url);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await openSavedWorkflow("运行历史演示");
    await screen.findByText("已加载 运行历史演示 v2。");
    const panel = await openWorkflowManager();
    expect(within(panel).getByText(/运行记录 1/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "运行" }));

    await screen.findByText("运行成功。");
    expect(runHistoryRequests).toBe(2);
    expect(within(panel).getByText(/运行记录 1/)).toBeInTheDocument();
  });

  it("clears stale run history while loading another workflow history", async () => {
    const firstWorkflow = workflowDocument({ id: "wf_first", name: "第一个工作流", version: 1 });
    const secondWorkflow = workflowDocument({ id: "wf_second", name: "第二个工作流", version: 1 });
    const firstRun = {
      id: "run_first",
      workflow_id: "wf_first",
      workflow_version: 1,
      status: "succeeded",
      created_at: "2026-06-24T02:00:00Z",
      started_at: "2026-06-24T02:00:01Z",
      completed_at: "2026-06-24T02:00:03Z",
      error: null,
    };
    let resolveSecondHistory: (response: Response) => void = () => undefined;
    const secondHistoryResponse = new Promise<Response>((resolve) => {
      resolveSecondHistory = resolve;
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true"))) {
        return jsonResponse([
          { id: "wf_first", name: "第一个工作流", version: 1 },
          { id: "wf_second", name: "第二个工作流", version: 1 },
        ]);
      }
      if (url.endsWith("/api/workflows/wf_first")) {
        return jsonResponse(firstWorkflow);
      }
      if (url.endsWith("/api/workflows/wf_second")) {
        return jsonResponse(secondWorkflow);
      }
      if (url.endsWith("/api/workflows/wf_first/runs?limit=5")) {
        return jsonResponse([firstRun]);
      }
      if (url.endsWith("/api/workflows/wf_second/runs?limit=5")) {
        return secondHistoryResponse;
      }
      throw new Error("Unexpected request: " + url);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await openSavedWorkflow("第一个工作流");
    await screen.findByText("已加载 第一个工作流 v1。");
    const panel = await openWorkflowManager();
    expect(within(panel).getByText(/运行记录 1/)).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole("button", { name: "打开 第二个工作流" }));
    await screen.findByText("已加载 第二个工作流 v1。");

    const refreshedPanel = await openWorkflowManager();
    expect(within(refreshedPanel).queryByText("run_first")).not.toBeInTheDocument();
    expect(within(refreshedPanel).getByText("正在加载运行记录")).toBeInTheDocument();

    resolveSecondHistory(jsonResponse([]));
    await waitFor(() => expect(within(refreshedPanel).getByText("暂无运行记录")).toBeInTheDocument());
  });

  it("opens a historical run from the workflow manager", async () => {
    const workflow = workflowDocument({
      id: "wf_history",
      name: "运行历史演示",
      version: 2,
      nodes: [
        {
          id: "trigger",
          type: "manual.trigger",
          position: { x: 0, y: 0 },
          config: {},
        },
      ],
    });
    const historicalRun = {
      id: "run_recent",
      workflow_id: "wf_history",
      workflow_version: 1,
      status: "succeeded",
      created_at: "2026-06-24T02:00:00Z",
      started_at: "2026-06-24T02:00:01Z",
      completed_at: "2026-06-24T02:00:03Z",
      error: null,
    };
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
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true"))) {
        return jsonResponse([{ id: "wf_history", name: "运行历史演示", version: 2 }]);
      }
      if (url.endsWith("/api/workflows/wf_history")) {
        return jsonResponse(workflow);
      }
      if (url.endsWith("/api/workflows/wf_history/versions/1")) {
        return jsonResponse({
          ...workflow,
          version: 1,
          nodes: [{ ...workflow.nodes[0], label: "旧版手动触发" }],
        });
      }
      if (url.endsWith("/api/workflows/wf_history/runs?limit=5")) {
        return jsonResponse([historicalRun]);
      }
      if (url.endsWith("/api/runs/run_recent/events")) {
        return jsonResponse([
          {
            id: 1,
            run_id: "run_recent",
            type: "node_succeeded",
            timestamp: "2026-06-24T02:00:03Z",
            node_id: "trigger",
            scope: [],
            payload: { outputs: { success: { source: "history" } }, duration_ms: 5 },
          },
        ]);
      }
      throw new Error("Unexpected request: " + url);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await openSavedWorkflow("运行历史演示");
    await screen.findByText("已加载 运行历史演示 v2。");
    const panel = await openWorkflowManager();
    fireEvent.click(within(panel).getByRole("button", { name: "查看第 1 次运行日志" }));

    await screen.findByText("已打开历史运行。");
    expect(window.location.pathname).toBe("/workflow/wf_history/executions/run_recent");
    const runPanel = screen.getByLabelText("运行结果");
    expect(within(runPanel).getByText("历史运行")).toBeInTheDocument();
    expect(within(runPanel).getByText("版本 v1")).toBeInTheDocument();
    expect(within(runPanel).getByText("耗时 2 秒")).toBeInTheDocument();

    fireEvent.click(within(runPanel).getByRole("tab", { name: "运行事件" }));
    expect(await within(runPanel).findByRole("button", { name: /节点成功.*旧版手动触发/ })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8150/api/runs/run_recent/events",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );

    fireEvent.click(within(runPanel).getByRole("button", { name: "清除历史视图" }));

    expect(await screen.findByText("已清除历史运行视图。"));
    expect(screen.queryByText("历史运行")).not.toBeInTheDocument();
    expect(window.location.pathname).toBe("/workflow/wf_history");
  });

  it("compares a historical run with another recent run", async () => {
    const workflow = workflowDocument({
      id: "wf_compare",
      name: "运行对比演示",
      version: 2,
      nodes: [{ id: "assert", type: "manual.trigger", position: { x: 0, y: 0 }, config: {} }],
    });
    const runBase = {
      workflow_id: "wf_compare",
      workflow_version: 2,
      created_at: "2026-07-23T00:00:00Z",
      started_at: "2026-07-23T00:00:00Z",
      completed_at: "2026-07-23T00:00:01Z",
      error: null,
    };
    const currentRun = { ...runBase, id: "run_current", status: "succeeded" };
    const baselineRun = { ...runBase, id: "run_baseline", status: "failed" };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([
          {
            id: "manual.trigger",
            name: "Manual Trigger",
            category: "Triggers",
            description: "Starts manually.",
            inputs: {},
            outputs: { success: { description: "Done" } },
            configSchema: { type: "object", properties: {} },
          },
        ]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true"))) {
        return jsonResponse([{ id: "wf_compare", name: "运行对比演示", version: 2 }]);
      }
      if (url.endsWith("/api/workflows/wf_compare")) {
        return jsonResponse(workflow);
      }
      if (url.endsWith("/api/workflows/wf_compare/runs?limit=5")) {
        return jsonResponse([currentRun, baselineRun]);
      }
      if (url.endsWith("/api/runs/run_current/events")) {
        return jsonResponse([
          {
            run_id: "run_current",
            type: "node_succeeded",
            timestamp: "2026-07-23T00:00:02Z",
            node_id: "assert",
            scope: [],
            payload: { outputs: { success: { passed: true } } },
          },
        ]);
      }
      if (url.endsWith("/api/runs/run_baseline/events")) {
        return jsonResponse([
          {
            run_id: "run_baseline",
            type: "node_failed",
            timestamp: "2026-07-23T00:00:01Z",
            node_id: "assert",
            scope: [],
            payload: { error: { message: "状态码不匹配" } },
          },
        ]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await openSavedWorkflow("运行对比演示");
    const manager = await openWorkflowManager();
    fireEvent.click(within(manager).getByRole("button", { name: "查看第 1 次运行日志" }));
    await screen.findByText("已打开历史运行。");

    const runPanel = screen.getByLabelText("运行结果");
    fireEvent.change(within(runPanel).getByRole("combobox", { name: "选择对比运行" }), {
      target: { value: "run_baseline" },
    });

    expect(await within(runPanel).findByText("失败 -> 成功")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8150/api/runs/run_baseline/events",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("uses the executed version for historical events inside a loop body", async () => {
    const loopNode = {
      id: "loop",
      type: "control.foreach",
      label: "遍历用户",
      position: { x: 0, y: 0 },
      config: { items_expression: "[]", max_items: 10, timeout_seconds: 30, continue_on_error: false },
      subflows: {
        body: {
          nodes: [
            {
              id: "log",
              type: "utility.log",
              label: "当前日志",
              position: { x: 0, y: 0 },
              config: { message: "current" },
            },
          ],
          edges: [],
        },
      },
    };
    const workflow = workflowDocument({ id: "wf_loop_history", name: "循环历史", version: 2, nodes: [loopNode] });
    const historicalRun = {
      id: "run_loop_history",
      workflow_id: "wf_loop_history",
      workflow_version: 1,
      status: "succeeded",
      created_at: "2026-06-24T02:00:00Z",
      started_at: "2026-06-24T02:00:01Z",
      completed_at: "2026-06-24T02:00:03Z",
      error: null,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([
          {
            id: "control.foreach",
            name: "For Each",
            category: "Control",
            description: "Run a body for every item.",
            inputs: { input: {} },
            outputs: { done: {}, error: {} },
            configSchema: { type: "object", properties: {} },
          },
          {
            id: "utility.log",
            name: "Log",
            category: "Utility",
            description: "Write a log entry.",
            inputs: { input: {} },
            outputs: { success: {} },
            configSchema: { type: "object", properties: {} },
          },
        ]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true"))) {
        return jsonResponse([{ id: "wf_loop_history", name: "循环历史", version: 2 }]);
      }
      if (url.endsWith("/api/workflows/wf_loop_history")) {
        return jsonResponse(workflow);
      }
      if (url.endsWith("/api/workflows/wf_loop_history/versions/1")) {
        return jsonResponse({
          ...workflow,
          version: 1,
          nodes: [
            {
              ...loopNode,
              subflows: {
                body: {
                  nodes: [{ ...loopNode.subflows.body.nodes[0], label: "历史日志" }],
                  edges: [],
                },
              },
            },
          ],
        });
      }
      if (url.endsWith("/api/workflows/wf_loop_history/runs?limit=5")) {
        return jsonResponse([historicalRun]);
      }
      if (url.endsWith("/api/runs/run_loop_history/events")) {
        return jsonResponse([
          {
            id: 1,
            run_id: "run_loop_history",
            type: "node_succeeded",
            timestamp: "2026-06-24T02:00:02Z",
            node_id: "log",
            scope: ["loop", "iteration:0"],
            payload: { outputs: { success: {} }, duration_ms: 2 },
          },
        ]);
      }
      throw new Error("Unexpected request: " + url);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await openSavedWorkflow("循环历史");
    const manager = await openWorkflowManager();
    fireEvent.click(within(manager).getByRole("button", { name: "查看第 1 次运行日志" }));
    await screen.findByText("已打开历史运行。");

    fireEvent.click(within(screen.getByLabelText("画布工作区")).getByText("遍历用户"));
    fireEvent.click(screen.getByRole("button", { name: "编辑循环体" }));
    const runPanel = screen.getByLabelText("运行结果");
    fireEvent.click(within(runPanel).getByRole("tab", { name: "运行事件" }));

    expect(await within(runPanel).findByRole("button", { name: /节点成功.*历史日志/ })).toBeInTheDocument();
  });

  it("loads the executed child workflow version when opening a child run", async () => {
    const parentWorkflow = workflowDocument({
      id: "wf_parent",
      name: "父工作流",
      version: 2,
      nodes: [
        {
          id: "call_child",
          type: "workflow.execute",
          position: { x: 0, y: 0 },
          config: { workflow_id: "wf_child" },
        },
      ],
    });
    const childRun = {
      id: "run_child",
      workflow_id: "wf_child",
      workflow_version: 3,
      status: "succeeded",
      created_at: "2026-06-24T02:00:01Z",
      started_at: "2026-06-24T02:00:01Z",
      completed_at: "2026-06-24T02:00:02Z",
      error: null,
      parent_run_id: "run_parent",
      parent_node_id: "call_child",
    };
    const parentRun = {
      id: "run_parent",
      workflow_id: "wf_parent",
      workflow_version: 2,
      status: "succeeded",
      created_at: "2026-06-24T02:00:00Z",
      started_at: "2026-06-24T02:00:00Z",
      completed_at: "2026-06-24T02:00:03Z",
      error: null,
    };
    const childWorkflow = workflowDocument({
      id: "wf_child",
      name: "子工作流",
      version: 3,
      nodes: [
        {
          id: "child_start",
          type: "manual.trigger",
          label: "子流程入口",
          position: { x: 0, y: 0 },
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
            outputs: { success: { description: "Initial payload" } },
            configSchema: { type: "object", properties: {} },
          },
          {
            id: "workflow.execute",
            name: "Execute Workflow",
            category: "Workflow",
            description: "Runs a child workflow.",
            inputs: {},
            outputs: { success: { description: "Child result" } },
            configSchema: { type: "object", properties: {} },
          },
        ]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true"))) {
        return jsonResponse([{ id: "wf_parent", name: "父工作流", version: 2 }]);
      }
      if (url.endsWith("/api/workflows/wf_parent")) {
        return jsonResponse(parentWorkflow);
      }
      if (url.endsWith("/api/workflows/wf_parent/runs?limit=5")) {
        return jsonResponse([parentRun]);
      }
      if (url.endsWith("/api/runs/run_parent/events")) {
        return jsonResponse([
          {
            id: 1,
            run_id: "run_parent",
            type: "child_run_succeeded",
            timestamp: "2026-06-24T02:00:02Z",
            node_id: "call_child",
            scope: [],
            payload: { child_run_id: "run_child" },
          },
        ]);
      }
      if (url.endsWith("/api/runs/run_child")) {
        return jsonResponse(childRun);
      }
      if (url.endsWith("/api/runs/run_child/events")) {
        return jsonResponse([
          {
            id: 2,
            run_id: "run_child",
            type: "node_succeeded",
            timestamp: "2026-06-24T02:00:02Z",
            node_id: "child_start",
            scope: [],
            payload: { outputs: { success: {} }, duration_ms: 2 },
          },
        ]);
      }
      if (url.endsWith("/api/workflows/wf_child/versions/3")) {
        return jsonResponse(childWorkflow);
      }
      throw new Error("Unexpected request: " + url);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await openSavedWorkflow("父工作流");
    const manager = await openWorkflowManager();
    fireEvent.click(within(manager).getByRole("button", { name: "查看第 1 次运行日志" }));

    const runPanel = await screen.findByLabelText("运行结果");
    fireEvent.click(within(runPanel).getByRole("tab", { name: "运行事件" }));
    fireEvent.click(await within(runPanel).findByRole("button", { name: "查看子运行" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:8150/api/workflows/wf_child/versions/3",
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      )
    );
    fireEvent.click(within(runPanel).getByRole("tab", { name: "运行事件" }));
    expect(await within(runPanel).findByRole("button", { name: /节点成功.*子流程入口/ })).toBeInTheDocument();
  });

  it("keeps the previous run view when creating a new run fails", async () => {
    const workflow = workflowDocument({
      id: "wf_history",
      name: "运行历史演示",
      version: 2,
      nodes: [
        {
          id: "trigger",
          type: "manual.trigger",
          position: { x: 0, y: 0 },
          config: {},
        },
      ],
    });
    const historicalRun = {
      id: "run_recent",
      workflow_id: "wf_history",
      workflow_version: 2,
      status: "succeeded",
      created_at: "2026-06-24T02:00:00Z",
      started_at: "2026-06-24T02:00:01Z",
      completed_at: "2026-06-24T02:00:03Z",
      error: null,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true"))) {
        return jsonResponse([{ id: "wf_history", name: "运行历史演示", version: 2 }]);
      }
      if (url.endsWith("/api/workflows/wf_history")) {
        return jsonResponse(workflow);
      }
      if (url.endsWith("/api/workflows/wf_history/runs?limit=5")) {
        return jsonResponse([historicalRun]);
      }
      if (url.endsWith("/api/runs/run_recent/events")) {
        return jsonResponse([
          {
            id: 1,
            run_id: "run_recent",
            type: "node_succeeded",
            timestamp: "2026-06-24T02:00:03Z",
            node_id: "trigger",
            scope: [],
            payload: { outputs: { success: { source: "history" } }, duration_ms: 5 },
          },
        ]);
      }
      if (url.endsWith("/api/workflows/wf_history/runs") && init?.method === "POST") {
        return errorResponse(500, "Run queue unavailable");
      }
      throw new Error("Unexpected request: " + url);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await openSavedWorkflow("运行历史演示");
    await screen.findByText("已加载 运行历史演示 v2。");
    const panel = await openWorkflowManager();
    fireEvent.click(within(panel).getByRole("button", { name: "查看第 1 次运行日志" }));

    await screen.findByText("已打开历史运行。");
    const runPanel = screen.getByLabelText("运行结果");
    expect(within(runPanel).getByText("历史运行")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "运行" }));

    expect(await screen.findByText("运行失败：服务暂时不可用，请稍后重试（API 500: Run queue unavailable）")).toBeInTheDocument();
    expect(within(runPanel).getByText("历史运行")).toBeInTheDocument();
    expect(within(runPanel).getByText("查看本次运行的测试报告、执行数据和运行事件")).toBeInTheDocument();
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
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true")) && init?.method !== "POST") {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows?draft=true") && init?.method === "POST") {
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

    fireEvent.click(await screen.findByRole("button", { name: "遍历循环" }));
    const canvas = screen.getByLabelText("画布工作区");
    expect(within(canvas).getByText("遍历循环")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "编辑循环体" }));

    expect(screen.getByText("/ 遍历循环.循环体")).toBeInTheDocument();
    expect(within(canvas).queryByText("遍历循环")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "记录日志" }));
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
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true")) && init?.method !== "POST") {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows?draft=true") && init?.method === "POST") {
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

    fireEvent.click(await screen.findByRole("button", { name: "遍历循环" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑循环体" }));
    expect(screen.getByText("/ 遍历循环.循环体")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "条件循环" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑循环体" }));
    expect(screen.getByText("/ 遍历循环.循环体 / 条件循环.循环体")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "记录日志" }));
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

  it("imports a JSON workflow as a new unsaved draft from the workflow manager", async () => {
    render(<App />);

    const panel = await openWorkflowManager();
    const file = new File(["{}"], "imported-workflow.json", { type: "application/json" });
    Object.defineProperty(file, "text", {
      value: () =>
        Promise.resolve(
          JSON.stringify({
            id: "wf_imported",
            name: "导入流程",
            version: 4,
            nodes: [],
            edges: [],
          })
        ),
    });

    fireEvent.change(within(panel).getByLabelText("选择工作流 JSON 文件"), { target: { files: [file] } });

    await waitFor(() => expect(screen.getByLabelText("工作流名称")).toHaveValue("导入流程 副本"));
    expect(screen.getByText("已导入 导入流程 副本，请验证并保存为新的工作流。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
  });

  it("exports the current workflow as a JSON download from the workflow manager", async () => {
    const createObjectURL = vi.fn(() => "blob:workflow-export");
    const revokeObjectURL = vi.fn();
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

    render(<App />);

    const panel = await openWorkflowManager();
    fireEvent.click(within(panel).getByRole("button", { name: "导出当前工作流" }));

    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(anchorClick).toHaveBeenCalledOnce();
    expect(screen.getByText("已导出 未命名工作流。")).toBeInTheDocument();
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith("blob:workflow-export"));

    anchorClick.mockRestore();
  });

  it("edits and persists workflow description and tags from workflow settings", async () => {
    let savedPayload: import("./types").WorkflowDocument | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types") || ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true")) && init?.method !== "POST")) {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows?draft=true") && init?.method === "POST") {
        savedPayload = JSON.parse(String(init.body));
        return jsonResponse({ ...savedPayload, version: 1 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "工作流设置" }));
    const dialog = screen.getByRole("dialog", { name: "工作流设置" });
    fireEvent.change(within(dialog).getByLabelText("工作流描述"), { target: { value: "每天处理待办事项" } });
    fireEvent.change(within(dialog).getByLabelText("添加工作流标签"), { target: { value: "自动化" } });
    fireEvent.keyDown(within(dialog).getByLabelText("添加工作流标签"), { key: "Enter" });

    expect(within(dialog).getByLabelText("工作流标签")).toHaveTextContent("自动化");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(savedPayload).toMatchObject({ description: "每天处理待办事项", tags: ["自动化"] }));
  });

  it("enables a saved workflow without preventing manual editing", async () => {
    const inactiveWorkflow = workflowDocument({ id: "wf_inactive", name: "Webhook 发布", active: false, version: 1 });
    let published = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true")) && init?.method !== "POST") {
        return jsonResponse([
          { id: "wf_inactive", name: "Webhook 发布", active: false, version: 1, node_count: 0, last_run_status: null },
        ]);
      }
      if (url.endsWith("/api/workflows/wf_inactive") && !init?.method) {
        return jsonResponse(inactiveWorkflow);
      }
      if (url.endsWith("/api/workflows/wf_inactive/runs")) {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows/wf_inactive/publication")) {
        return jsonResponse({
          workflow_id: "wf_inactive",
          draft_version: published ? 2 : 1,
          published_version: published ? 2 : null,
          active: published,
          has_unpublished_changes: false,
        });
      }
      if (url.endsWith("/api/workflows/wf_inactive/activation") && init?.method === "POST") {
        published = true;
        return jsonResponse({ ...inactiveWorkflow, active: true, version: 2 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await openSavedWorkflow("Webhook 发布");

    const activationButton = await screen.findByRole("button", { name: "发布工作流" });
    expect(activationButton).toBeEnabled();
    fireEvent.click(activationButton);

    await screen.findByText("已发布工作流 v2。");
    expect(screen.getByRole("button", { name: "停用工作流" })).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/workflows\/wf_inactive\/activation$/),
      expect.objectContaining({ method: "POST", body: JSON.stringify({ active: true }) })
    );
  });

  it("restores a saved workflow version from workflow settings", async () => {
    const currentWorkflow = workflowDocument({ id: "wf_versions", name: "当前流程", active: false, version: 2 });
    const restoredWorkflow = workflowDocument({ id: "wf_versions", name: "初始流程", active: false, version: 3 });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) return jsonResponse([]);
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true")) && !init?.method) {
        return jsonResponse([{ id: "wf_versions", name: "当前流程", active: false, version: 2, node_count: 0, last_run_status: null }]);
      }
      if (url.endsWith("/api/workflows/wf_versions") && !init?.method) return jsonResponse(currentWorkflow);
      if (url.endsWith("/api/workflows/wf_versions/runs")) return jsonResponse([]);
      if (url.endsWith("/api/workflows/wf_versions/versions") && !init?.method) {
        return jsonResponse([
          { version: 2, created_at: "2026-07-17T00:00:00Z", name: "当前流程", active: false, node_count: 0 },
          { version: 1, created_at: "2026-07-16T00:00:00Z", name: "初始流程", active: false, node_count: 0 },
        ]);
      }
      if (url.endsWith("/api/workflows/wf_versions/versions/1/restore") && init?.method === "POST") {
        return jsonResponse(restoredWorkflow);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await openSavedWorkflow("当前流程");
    await screen.findByText("已加载 当前流程 v2。");
    fireEvent.click(screen.getByRole("button", { name: "工作流设置" }));
    const dialog = screen.getByRole("dialog", { name: "工作流设置" });
    fireEvent.click(within(dialog).getByRole("button", { name: "查看历史" }));

    await within(dialog).findByText("v1");
    const restoreButton = within(dialog).getAllByRole("button", { name: "恢复" }).find((button) => !button.hasAttribute("disabled"));
    expect(restoreButton).toBeDefined();
    fireEvent.click(restoreButton!);

    await screen.findByText("已恢复 v1，并保存为草稿 v3。");
    expect(screen.getByLabelText("工作流名称")).toHaveValue("初始流程");
  });

  it("confirms and rolls a historical version back to production", async () => {
    const currentWorkflow = workflowDocument({ id: "wf_rollback", name: "当前草稿", active: true, version: 3 });
    const rolledBackWorkflow = workflowDocument({ id: "wf_rollback", name: "首个发布版", active: true, version: 4 });
    let rolledBack = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) return jsonResponse([]);
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true")) && !init?.method) {
        return jsonResponse([{ id: "wf_rollback", name: "当前草稿", active: true, version: 3, node_count: 0, last_run_status: null }]);
      }
      if (url.endsWith("/api/workflows/wf_rollback") && !init?.method) return jsonResponse(currentWorkflow);
      if (url.endsWith("/api/workflows/wf_rollback/runs")) return jsonResponse([]);
      if (url.endsWith("/api/workflows/wf_rollback/publication")) {
        return jsonResponse({
          workflow_id: "wf_rollback",
          draft_version: rolledBack ? 4 : 3,
          published_version: rolledBack ? 4 : 2,
          active: true,
          has_unpublished_changes: !rolledBack,
        });
      }
      if (url.endsWith("/api/workflows/wf_rollback/versions") && !init?.method) {
        return jsonResponse([
          { version: rolledBack ? 4 : 3, created_at: "2026-07-18T00:00:00Z", name: rolledBack ? "首个发布版" : "当前草稿", active: rolledBack, node_count: 0, action: rolledBack ? "rollback" : "save", source_version: rolledBack ? 1 : null },
          { version: 2, created_at: "2026-07-17T00:00:00Z", name: "第二个发布版", active: !rolledBack, node_count: 0, action: "save", source_version: null },
          { version: 1, created_at: "2026-07-16T00:00:00Z", name: "首个发布版", active: false, node_count: 0, action: "save", source_version: null },
        ]);
      }
      if (url.endsWith("/api/workflows/wf_rollback/versions/1/rollback") && init?.method === "POST") {
        rolledBack = true;
        return jsonResponse(rolledBackWorkflow);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await openSavedWorkflow("当前草稿");
    await screen.findByText("已加载 当前草稿 v3。");
    await screen.findByText("生产 v2，草稿 v3");
    fireEvent.click(screen.getByRole("button", { name: "工作流设置" }));
    const dialog = screen.getByRole("dialog", { name: "工作流设置" });
    fireEvent.click(within(dialog).getByRole("button", { name: "查看历史" }));

    await within(dialog).findByText("首个发布版");
    const rollbackButton = within(dialog).getAllByRole("button", { name: "回滚生产" }).find((button) => !button.hasAttribute("disabled"));
    expect(rollbackButton).toBeDefined();
    fireEvent.click(rollbackButton!);
    const confirmation = within(dialog).getByRole("alertdialog", { name: "确认回滚生产版本" });
    expect(confirmation).toHaveTextContent("v1");
    fireEvent.click(within(confirmation).getByRole("button", { name: "确认回滚生产" }));

    await screen.findByText("已将生产版本回滚到 v1，并创建 v4。");
    expect(screen.getByLabelText("工作流名称")).toHaveValue("首个发布版");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8150/api/workflows/wf_rollback/versions/1/rollback",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("shows a saved version diff before restoring it", async () => {
    const currentWorkflow = workflowDocument({
      id: "wf_version_diff",
      name: "版本差异",
      active: false,
      version: 2,
      nodes: [
        {
          id: "request",
          type: "http.request",
          position: { x: 240, y: 160 },
          config: { url: "https://example.test/current" },
        },
      ],
    });
    const historicalWorkflow = workflowDocument({
      id: "wf_version_diff",
      name: "版本差异",
      active: false,
      version: 1,
      nodes: [
        {
          id: "request",
          type: "http.request",
          position: { x: 120, y: 120 },
          config: { url: "https://example.test/previous" },
        },
      ],
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([
          {
            id: "http.request",
            name: "HTTP Request",
            displayName: "HTTP 请求",
            category: "Network",
            description: "Request",
            inputs: {},
            outputs: {},
            configSchema: { type: "object", properties: {} },
          },
        ]);
      }
      if ((url.endsWith("/api/workflows") || url.endsWith("/api/workflows?draft=true")) && !init?.method) {
        return jsonResponse([{ id: "wf_version_diff", name: "版本差异", active: false, version: 2, node_count: 1, last_run_status: null }]);
      }
      if (url.endsWith("/api/workflows/wf_version_diff") && !init?.method) return jsonResponse(currentWorkflow);
      if (url.endsWith("/api/workflows/wf_version_diff/runs")) return jsonResponse([]);
      if (url.endsWith("/api/workflows/wf_version_diff/versions") && !init?.method) {
        return jsonResponse([
          { version: 2, created_at: "2026-07-17T00:00:00Z", name: "版本差异", active: false, node_count: 1 },
          { version: 1, created_at: "2026-07-16T00:00:00Z", name: "版本差异", active: false, node_count: 1 },
        ]);
      }
      if (url.endsWith("/api/workflows/wf_version_diff/versions/1") && !init?.method) return jsonResponse(historicalWorkflow);
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await openSavedWorkflow("版本差异");
    await screen.findByText("已加载 版本差异 v2。");
    fireEvent.click(screen.getByRole("button", { name: "工作流设置" }));
    const dialog = screen.getByRole("dialog", { name: "工作流设置" });
    fireEvent.click(within(dialog).getByRole("button", { name: "查看历史" }));

    await within(dialog).findByText("v1");
    const compareButton = within(dialog).getAllByRole("button", { name: "查看变更" }).find((button) => !button.hasAttribute("disabled"));
    expect(compareButton).toBeDefined();
    fireEvent.click(compareButton!);

    expect(await within(dialog).findByRole("region", { name: "版本差异" })).toHaveTextContent("v1 与当前 v2 的差异");
    expect(within(dialog).getByText("节点内容：HTTP 请求")).toBeInTheDocument();
    expect(within(dialog).getByText("节点位置：HTTP 请求")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8150/api/workflows/wf_version_diff/versions/1",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });
});

async function openWorkflowManager() {
  fireEvent.click(await screen.findByRole("button", { name: /工作流 \d+$/ }));
  return screen.findByRole("dialog", { name: "工作流管理" });
}

function render(ui: ReactElement) {
  return testingRender(<NodeFlowMantineProvider>{ui}</NodeFlowMantineProvider>);
}

async function openSavedWorkflow(name: string) {
  const panel = await openWorkflowManager();
  fireEvent.click(within(panel).getByRole("button", { name: `打开 ${name}` }));
}

function jsonResponse(body: unknown) {
  return {
    ok: true,
    json: () => Promise.resolve(body),
  } as Response;
}

function errorResponse(status: number, body: string) {
  return {
    ok: false,
    status,
    text: () => Promise.resolve(body),
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

function workflowPublication(workflowId: string, version: number) {
  return {
    workflow_id: workflowId,
    draft_version: version,
    published_version: null,
    active: false,
    has_unpublished_changes: false,
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
