import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunEvent, RunRecord } from "../types";
import { buildRunInspector } from "../lib/runInspector";
import { RunPanel } from "./RunPanel";

describe("RunPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows the test report tab by default", () => {
    render(<RunPanel events={[recordResultEvent("record-login", { name: "登录接口", status: "passed" })]} run={null} />);

    const reportTab = screen.getByRole("tab", { name: "测试报告" });
    const tabPanel = screen.getByRole("tabpanel");

    expect(reportTab).toHaveAttribute("aria-selected", "true");
    expect(reportTab).toHaveAttribute("aria-controls", tabPanel.id);
    expect(tabPanel).toHaveAttribute("aria-labelledby", reportTab.id);
    expect(screen.getByText("登录接口")).toBeInTheDocument();
    expect(screen.queryByText("record-login")).not.toBeInTheDocument();
  });

  it("uses a provided run inspector instead of rebuilding from raw props", () => {
    const inspector = buildRunInspector({
      run: null,
      events: [recordResultEvent("record-login", { name: "登录接口", status: "passed" })],
    });

    render(<RunPanel events={[]} inspector={inspector} run={null} />);

    expect(screen.getByText("登录接口")).toBeInTheDocument();
  });

  it("opens a child run from a child-run lifecycle event", () => {
    const onOpenChildRun = vi.fn();
    render(
      <RunPanel
        events={[
          runEvent({
            id: 1,
            type: "child_run_started",
            node_id: "call_child",
            payload: { child_run_id: "run_child", child_workflow_name: "登录回归" },
          }),
        ]}
        run={runRecord({ id: "run_parent" })}
        onOpenChildRun={onOpenChildRun}
      />
    );

    fireEvent.click(screen.getByRole("tab", { name: "运行事件" }));
    fireEvent.click(screen.getByRole("button", { name: "查看子运行" }));

    expect(onOpenChildRun).toHaveBeenCalledWith("run_child");
  });

  it("shows execution coverage in the run heading", () => {
    render(
      <RunPanel
        events={[
          runEvent({ id: 1, type: "node_started", node_id: "request", payload: { inputs: [{ id: 1 }, { id: 2 }] } }),
          runEvent({ id: 2, type: "node_succeeded", node_id: "request", payload: { outputs: { success: [{ ok: true }, { ok: false }] } } }),
          runEvent({ id: 3, type: "node_started", node_id: "request", scope: ["each", "iteration:1"], payload: { inputs: { id: 3 } } }),
          runEvent({ id: 4, type: "node_failed", node_id: "request", scope: ["each", "iteration:1"], payload: { error: "boom" } }),
        ]}
        run={runRecord({ id: "run_summary" })}
      />
    );

    expect(screen.getByText("1 个节点")).toBeInTheDocument();
    expect(screen.getByText("2 次执行")).toBeInTheDocument();
    expect(screen.getByText("4 条事件")).toBeInTheDocument();
    expect(screen.getByText("1 次失败")).toBeInTheDocument();
    expect(screen.getByText("3 项输入")).toBeInTheDocument();
    expect(screen.getByText("2 项输出")).toBeInTheDocument();
  });
  it("keeps internal run ids out of the run heading", () => {
    render(<RunPanel events={[]} run={runRecord({ id: "run_summary" })} />);

    expect(screen.getByText("查看本次运行的测试报告、执行数据和运行事件")).toBeInTheDocument();
    expect(screen.queryByText(/run_summary/)).not.toBeInTheDocument();
  });

  it("shows the trigger source for a debug webhook run", () => {
    render(<RunPanel events={[]} run={runRecord({ execution_mode: "webhook_test" })} />);

    expect(screen.getByText("调试 Webhook")).toBeInTheDocument();
  });

  it("explains the live queue position for the active queued run", () => {
    render(
      <RunPanel
        events={[]}
        run={runRecord({ id: "run_queued", status: "queued" })}
        queueStatus={{
          run_id: "run_queued",
          state: "queued",
          position: 2,
          active_count: 1,
          concurrency_limit: 4,
        }}
      />
    );

    expect(screen.getByText("正在排队：第 2 位，当前 1 / 4 个运行执行中")).toBeInTheDocument();
  });
  it("explains when the workflow concurrency limit is the reason a run is queued", () => {
    render(
      <RunPanel
        events={[]}
        run={runRecord({ id: "run_workflow_limited", status: "queued" })}
        queueStatus={{
          run_id: "run_workflow_limited",
          state: "queued",
          position: 1,
          active_count: 1,
          concurrency_limit: 4,
          workflow_active_count: 1,
          workflow_concurrency_limit: 1,
        }}
      />
    );

    expect(screen.getByText("\u6b63\u5728\u7b49\u5f85\u6b64\u5de5\u4f5c\u6d41\u7a7a\u95f2\uff1a\u5f53\u524d 1 / 1 \u4e2a\u8fd0\u884c\u6267\u884c\u4e2d")).toBeInTheDocument();
  });
  it("navigates from execution summary to execution data and events", () => {
    render(
      <RunPanel
        events={[
          runEvent({ id: 1, type: "node_started", node_id: "request", payload: { inputs: { row: 1 } } }),
          runEvent({ id: 2, type: "node_succeeded", node_id: "request", payload: { outputs: { success: { ok: true } } } }),
        ]}
        run={runRecord({ id: "run_summary" })}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "1 次执行" }));

    expect(screen.getByRole("tab", { name: "执行数据" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("request")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "2 条事件" }));

    expect(screen.getByRole("tab", { name: "运行事件" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("节点开始")).toBeInTheDocument();
  });

  it("opens failed executions from the run summary", () => {
    render(
      <RunPanel
        events={[
          runEvent({ id: 1, type: "node_succeeded", node_id: "request", payload: { outputs: { success: { ok: true } } } }),
          runEvent({ id: 2, type: "node_failed", node_id: "assert", payload: { error: "status mismatch" } }),
        ]}
        nodeDisplayNames={{ assert: "状态断言", request: "登录请求" }}
        run={runRecord({ id: "run_failed_summary" })}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "1 次失败" }));

    expect(screen.getByRole("tab", { name: "执行数据" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "失败" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("登录请求")).not.toBeInTheDocument();
    expect(screen.getByText("状态断言")).toBeInTheDocument();
  });

  it("shows run events after switching tabs and still selects event nodes", () => {
    const onSelectNode = vi.fn();
    const events: RunEvent[] = [
      runEvent({
        id: 1,
        type: "node_succeeded",
        node_id: "request",
        scope: ["each", "iteration:0"],
        payload: { duration_ms: 8, outputs: { success: { ok: true } } },
      }),
    ];

    render(<RunPanel events={events} run={null} onSelectNode={onSelectNode} />);

    fireEvent.click(screen.getByRole("tab", { name: "运行事件" }));
    fireEvent.click(screen.getByRole("button", { name: /request/ }));

    expect(onSelectNode).toHaveBeenCalledWith({
      nodeId: "request",
      scope: ["each", "iteration:0"],
      source: "run_event",
    });
    expect(screen.getByText("each / 第 1 轮")).toBeInTheDocument();
    expect(screen.queryByText("each / iteration:0")).not.toBeInTheDocument();
  });

  it("filters run events by node display name and payload text", () => {
    const eventsTab = "\u8fd0\u884c\u4e8b\u4ef6";
    const searchLabel = "\u641c\u7d22\u8fd0\u884c\u4e8b\u4ef6";
    const requestName = "\u767b\u5f55\u8bf7\u6c42";
    const assertName = "\u72b6\u6001\u65ad\u8a00";

    render(
      <RunPanel
        events={[
          runEvent({
            id: 1,
            type: "node_succeeded",
            node_id: "request",
            payload: { outputs: { success: { status_code: 200 } } },
          }),
          runEvent({
            id: 2,
            type: "node_failed",
            node_id: "assert",
            payload: { error: { message: "status mismatch" } },
          }),
        ]}
        nodeDisplayNames={{ assert: assertName, request: requestName }}
        run={runRecord({ id: "run_events_search" })}
      />
    );

    fireEvent.click(screen.getByRole("tab", { name: eventsTab }));
    fireEvent.change(screen.getByLabelText(searchLabel), { target: { value: assertName } });

    expect(screen.queryByText(requestName)).not.toBeInTheDocument();
    expect(screen.getByText(assertName)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(searchLabel), { target: { value: "status_code" } });

    expect(screen.getByText(requestName)).toBeInTheDocument();
    expect(screen.queryByText(assertName)).not.toBeInTheDocument();
  });

  it("shows friendly node names in run events while keeping node id selection", () => {
    const onSelectNode = vi.fn();
    const events: RunEvent[] = [
      runEvent({
        id: 1,
        type: "node_succeeded",
        node_id: "request",
        scope: ["each", "iteration:0"],
        payload: { duration_ms: 8, outputs: { success: { ok: true } } },
      }),
    ];

    render(
      <RunPanel
        events={events}
        nodeDisplayNames={{ request: "登录接口请求" }}
        run={null}
        onSelectNode={onSelectNode}
      />
    );

    fireEvent.click(screen.getByRole("tab", { name: "运行事件" }));
    fireEvent.click(screen.getByRole("button", { name: /登录接口请求/ }));

    expect(screen.getAllByText("登录接口请求").length).toBeGreaterThan(0);
    expect(screen.queryByText("request")).not.toBeInTheDocument();
    expect(onSelectNode).toHaveBeenCalledWith({
      nodeId: "request",
      scope: ["each", "iteration:0"],
      source: "run_event",
    });
  });

  it("shows generic node execution data and selects the execution node", () => {
    const onSelectNode = vi.fn();
    const events: RunEvent[] = [
      runEvent({
        id: 1,
        type: "node_started",
        node_id: "request",
        scope: ["each", "iteration:0"],
        payload: { inputs: { row: 1 } },
      }),
      runEvent({
        id: 2,
        type: "node_succeeded",
        node_id: "request",
        scope: ["each", "iteration:0"],
        payload: { duration_ms: 8, outputs: { success: [{ ok: true }, { ok: false }] } },
      }),
    ];

    render(<RunPanel events={events} run={null} onSelectNode={onSelectNode} />);

    fireEvent.click(screen.getByRole("tab", { name: "执行数据" }));
    fireEvent.click(screen.getByRole("button", { name: "查看执行数据 request 第 1 次" }));

    expect(screen.getByText("request")).toBeInTheDocument();
    expect(screen.getByText("第 1 次")).toBeInTheDocument();
    expect(screen.getByText("成功")).toBeInTheDocument();
    expect(screen.getByText("success")).toBeInTheDocument();
    expect(screen.getByText("2 项")).toBeInTheDocument();
    expect(onSelectNode).toHaveBeenCalledWith({
      nodeId: "request",
      scope: ["each", "iteration:0"],
      source: "execution_data",
    });
  });

  it("shows friendly node names in execution data while keeping node id selection", () => {
    const onSelectNode = vi.fn();
    const events: RunEvent[] = [
      runEvent({
        id: 1,
        type: "node_started",
        node_id: "request",
        payload: { inputs: { url: "/login" } },
      }),
      runEvent({
        id: 2,
        type: "node_succeeded",
        node_id: "request",
        payload: { duration_ms: 18, outputs: { success: { status_code: 200 } } },
      }),
    ];

    render(
      <RunPanel
        events={events}
        nodeDisplayNames={{ request: "登录接口请求" }}
        run={runRecord({ id: "run_detail" })}
        selectedNodeId="request"
        onSelectNode={onSelectNode}
      />
    );

    expect(screen.getAllByText("登录接口请求").length).toBeGreaterThan(0);
    expect(screen.queryByText("request")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "执行数据" }));
    fireEvent.click(screen.getByRole("button", { name: "查看执行数据 登录接口请求 第 1 次" }));

    expect(screen.getAllByText("登录接口请求").length).toBeGreaterThan(0);
    expect(onSelectNode).toHaveBeenCalledWith({ nodeId: "request", scope: [], source: "execution_data" });
  });

  it("shows node execution summaries on the execution data tab", () => {
    const events: RunEvent[] = [
      runEvent({
        id: 1,
        type: "node_started",
        node_id: "transform",
        payload: { inputs: [{ id: 1 }, { id: 2 }] },
      }),
      runEvent({
        id: 2,
        type: "node_succeeded",
        node_id: "transform",
        payload: { outputs: { success: [{ id: 1 }, { id: 2 }] } },
      }),
      runEvent({
        id: 3,
        type: "node_started",
        node_id: "transform",
        scope: ["each", "iteration:0"],
        payload: { inputs: { id: 3 } },
      }),
      runEvent({
        id: 4,
        type: "node_succeeded",
        node_id: "transform",
        scope: ["each", "iteration:0"],
        payload: { outputs: { success: { id: 3 } } },
      }),
    ];

    render(<RunPanel events={events} run={null} />);

    fireEvent.click(screen.getByRole("tab", { name: "执行数据" }));

    expect(screen.getByText("2 次运行")).toBeInTheDocument();
    expect(screen.getByText("3 项输入")).toBeInTheDocument();
    expect(screen.getByText("3 项输出")).toBeInTheDocument();
    expect(screen.getByText("最近成功")).toBeInTheDocument();
  });
  it("filters execution data by search text and latest node status", () => {
    const searchLabel = "\u641c\u7d22\u6267\u884c\u6570\u636e";
    const dataTab = "\u6267\u884c\u6570\u636e";
    const failedOnly = "\u5931\u8d25";
    const showAll = "\u5168\u90e8";
    const requestName = "\u767b\u5f55\u8bf7\u6c42";
    const assertName = "\u72b6\u6001\u65ad\u8a00";
    const events: RunEvent[] = [
      runEvent({
        id: 1,
        type: "node_started",
        node_id: "request",
        payload: { inputs: { url: "/login" } },
      }),
      runEvent({
        id: 2,
        type: "node_succeeded",
        node_id: "request",
        payload: { outputs: { success: { status_code: 200 } } },
      }),
      runEvent({
        id: 3,
        type: "node_started",
        node_id: "assert",
        payload: { inputs: { actual: 500 } },
      }),
      runEvent({
        id: 4,
        type: "node_failed",
        node_id: "assert",
        payload: { error: { message: "status mismatch" } },
      }),
    ];

    render(
      <RunPanel
        events={events}
        nodeDisplayNames={{ assert: assertName, request: requestName }}
        run={runRecord({ id: "run_filter" })}
      />
    );

    fireEvent.click(screen.getByRole("tab", { name: dataTab }));

    expect(screen.getByRole("button", { name: showAll })).toHaveTextContent("2");
    expect(screen.getByRole("button", { name: failedOnly })).toHaveTextContent("1");

    fireEvent.change(screen.getByLabelText(searchLabel), { target: { value: "login" } });

    expect(screen.getByText(requestName)).toBeInTheDocument();
    expect(screen.queryByText(assertName)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(searchLabel), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: failedOnly }));

    expect(screen.queryByText(requestName)).not.toBeInTheDocument();
    expect(screen.getByText(assertName)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: showAll }));

    expect(screen.getByText(requestName)).toBeInTheDocument();
    expect(screen.getByText(assertName)).toBeInTheDocument();
  });

  it("shows the selected node latest execution as a focused run detail", () => {
    const events: RunEvent[] = [
      runEvent({
        id: 1,
        type: "node_started",
        node_id: "request",
        payload: { inputs: { url: "/login" } },
      }),
      runEvent({
        id: 2,
        type: "node_succeeded",
        node_id: "request",
        payload: { duration_ms: 18, outputs: { success: { status_code: 200 } } },
      }),
      runEvent({
        id: 3,
        type: "node_started",
        node_id: "assert",
        payload: { inputs: { actual: 200 } },
      }),
    ];

    render(<RunPanel events={events} run={runRecord({ id: "run_detail" })} selectedNodeId="request" />);

    expect(screen.getByRole("heading", { name: "当前节点详情" })).toBeInTheDocument();
    expect(screen.getByText("request")).toBeInTheDocument();
    expect(screen.getByText("最近成功")).toBeInTheDocument();
    expect(screen.getByText("耗时 18 ms")).toBeInTheDocument();
    expect(screen.getByText("输入 1 项")).toBeInTheDocument();
    expect(screen.getByText("输出 1 项")).toBeInTheDocument();
    expect(screen.getByText(/"status_code":200/)).toBeInTheDocument();
    expect(screen.queryByText("assert")).not.toBeInTheDocument();
  });
  it("selects source nodes from report cases on the default tab", () => {
    const onSelectNode = vi.fn();

    render(
      <RunPanel
        events={[recordResultEvent("record_result", { name: "保存结果", status: "failed" })]}
        run={null}
        onSelectNode={onSelectNode}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /保存结果/ }));

    expect(onSelectNode).toHaveBeenCalledWith({ nodeId: "record_result", scope: [], source: "test_report" });
  });

  it("updates report data when events change", () => {
    const { rerender } = render(
      <RunPanel events={[recordResultEvent("record-login", { name: "登录接口", status: "passed" })]} run={null} />
    );

    expect(screen.getByText("登录接口")).toBeInTheDocument();

    rerender(<RunPanel events={[recordResultEvent("record-profile", { name: "资料接口", status: "failed" })]} run={null} />);

    expect(screen.getByText("资料接口")).toBeInTheDocument();
    expect(screen.queryByText("登录接口")).not.toBeInTheDocument();
  });

  it("keeps the run events tab selected when events update for the same run", () => {
    const run = runRecord({ id: "run_1" });
    const { rerender } = render(
      <RunPanel events={[runEvent({ type: "node_started", node_id: "request" })]} run={run} />
    );

    fireEvent.click(screen.getByRole("tab", { name: "运行事件" }));
    expect(screen.getByRole("tab", { name: "运行事件" })).toHaveAttribute("aria-selected", "true");

    rerender(<RunPanel events={[runEvent({ type: "node_succeeded", node_id: "request" })]} run={run} />);

    expect(screen.getByRole("tab", { name: "运行事件" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("request")).toBeInTheDocument();
  });

  it("resets to the test report tab when the run id changes", () => {
    const { rerender } = render(
      <RunPanel events={[runEvent({ type: "node_started", node_id: "request" })]} run={runRecord({ id: "run_1" })} />
    );

    fireEvent.click(screen.getByRole("tab", { name: "运行事件" }));

    rerender(
      <RunPanel
        events={[recordResultEvent("record-profile", { name: "资料接口", status: "passed" })]}
        run={runRecord({ id: "run_2" })}
      />
    );

    expect(screen.getByRole("tab", { name: "测试报告" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("资料接口")).toBeInTheDocument();
  });

  it("shows historical run context and clears it", () => {
    const onClearHistoricalRun = vi.fn();

    render(
      <RunPanel
        events={[]}
        run={runRecord({
          id: "run_history",
          workflow_version: 3,
          created_at: "2026-06-24T02:00:00Z",
          started_at: "2026-06-24T02:00:01Z",
          completed_at: "2026-06-24T02:00:04Z",
        })}
        isHistoricalRun
        onClearHistoricalRun={onClearHistoricalRun}
      />
    );

    expect(screen.getByText("历史运行")).toBeInTheDocument();
    expect(screen.getByText("版本 v3")).toBeInTheDocument();
    expect(screen.getByText("耗时 3 秒")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "清除历史视图" }));

    expect(onClearHistoricalRun).toHaveBeenCalledTimes(1);
  });

  it("offers to retry a failed historical manual run", () => {
    const onRetryHistoricalRun = vi.fn();

    render(
      <RunPanel
        events={[]}
        run={runRecord({ id: "run_failed_history", status: "failed" })}
        isHistoricalRun
        onRetryHistoricalRun={onRetryHistoricalRun}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "重新运行" }));

    expect(onRetryHistoricalRun).toHaveBeenCalledTimes(1);
  });

  it("opens a node comparison after selecting another historical run", () => {
    const onSelectComparisonRun = vi.fn();

    render(
      <RunPanel
        comparisonEvents={[runEvent({ type: "node_failed", node_id: "assert", payload: { error: "状态码不匹配" } })]}
        comparisonRun={runRecord({ id: "run_baseline", status: "failed" })}
        comparisonRuns={[runRecord({ id: "run_baseline", status: "failed" })]}
        events={[runEvent({ type: "node_succeeded", node_id: "assert", payload: { outputs: { success: { passed: true } } } })]}
        isHistoricalRun
        nodeDisplayNames={{ assert: "状态断言" }}
        onSelectComparisonRun={onSelectComparisonRun}
        run={runRecord({ id: "run_current" })}
      />
    );

    fireEvent.change(screen.getByRole("combobox", { name: "选择对比运行" }), { target: { value: "run_baseline" } });

    expect(onSelectComparisonRun).toHaveBeenCalledWith("run_baseline");
    expect(screen.getByRole("tab", { name: "运行对比" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "运行对比" }));
    expect(screen.getByText("失败 -> 成功")).toBeInTheDocument();
  });

  it("does not offer retry for a historical webhook run", () => {
    render(
      <RunPanel
        events={[]}
        run={runRecord({ id: "run_webhook_history", execution_mode: "webhook", status: "failed" })}
        isHistoricalRun
      />
    );

    expect(screen.queryByRole("button", { name: "重新运行" })).not.toBeInTheDocument();
  });

  it("opens a parent run from the lineage context", () => {
    const onOpenParentRun = vi.fn();

    render(
      <RunPanel
        events={[]}
        run={runRecord({ id: "run_child", parent_run_id: "run_parent", parent_node_id: "execute_workflow" })}
        onOpenParentRun={onOpenParentRun}
      />
    );

    expect(screen.getByText("由父运行中的节点触发")).toBeInTheDocument();
    expect(screen.queryByText("execute_workflow")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "查看父运行" }));

    expect(onOpenParentRun).toHaveBeenCalledWith("run_parent");
  });

  it("resets the test report filter when the run id changes", () => {
    const failedFilter = "\u5931\u8d25";
    const allFilter = "\u5168\u90e8";
    const failedCase = "\u5931\u8d25\u7528\u4f8b";
    const passedCase = "\u901a\u8fc7\u7528\u4f8b";
    const { rerender } = render(
      <RunPanel
        events={[recordResultEvent("record-failed", { name: failedCase, status: "failed" })]}
        run={runRecord({ id: "run_1" })}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: failedFilter }));
    expect(screen.getByRole("button", { name: failedFilter })).toHaveAttribute("aria-pressed", "true");

    rerender(
      <RunPanel
        events={[recordResultEvent("record-passed", { name: passedCase, status: "passed" })]}
        run={runRecord({ id: "run_2" })}
      />
    );

    expect(screen.getByText(passedCase)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: allFilter })).toHaveAttribute("aria-pressed", "true");
  });
});

function recordResultEvent(nodeId: string, result: Record<string, unknown>): RunEvent {
  return runEvent({
    type: "node_succeeded",
    node_id: nodeId,
    payload: {
      node_type: "test.record_result",
      outputs: {
        success: { case: result },
      },
    },
  });
}

function runEvent(overrides: Partial<RunEvent>): RunEvent {
  return {
    run_id: "run_1",
    type: "node_started",
    timestamp: "2026-06-18T00:00:00Z",
    node_id: null,
    scope: [],
    payload: {},
    ...overrides,
  };
}

function runRecord(overrides: Partial<RunRecord>): RunRecord {
  return {
    id: "run_1",
    workflow_id: "wf_1",
    workflow_version: 1,
    status: "succeeded",
    created_at: "2026-06-18T00:00:00Z",
    started_at: "2026-06-18T00:00:01Z",
    completed_at: "2026-06-18T00:00:02Z",
    error: null,
    ...overrides,
  };
}
