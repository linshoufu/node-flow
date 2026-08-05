import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowManager } from "./WorkflowManager";

describe("WorkflowManager", () => {
  afterEach(() => {
    cleanup();
  });

  const workflows = [
    {
      id: "wf_csv_alpha",
      name: "CSV 参数化接口测试",
      version: 3,
      updated_at: "2026-06-24T01:30:00Z",
      node_count: 6,
      last_run_status: "succeeded" as const,
    },
    {
      id: "wf_status",
      name: "单接口状态码断言",
      version: 2,
      updated_at: "2026-06-23T08:15:00Z",
      node_count: 3,
      last_run_status: "failed" as const,
    },
  ];

  it("uses the current saved workflow name in the manager trigger", () => {
    render(
      <WorkflowManager
        currentWorkflowName="当前工作流"
        disabled={false}
        selectedWorkflowId="wf_status"
        workflows={workflows}
        onCreateWorkflow={vi.fn()}
        onDuplicateWorkflow={vi.fn()}
        onLoadWorkflow={vi.fn()}
        onSaveWorkflow={vi.fn()}
        onValidateWorkflow={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "当前工作流，工作流 2" })).toBeInTheDocument();
  });

  it("opens a searchable workflow management panel", () => {
    const onLoadWorkflow = vi.fn();

    render(
      <WorkflowManager
        disabled={false}
        selectedWorkflowId="wf_status"
        workflows={workflows}
        onCreateWorkflow={vi.fn()}
        onDuplicateWorkflow={vi.fn()}
        onLoadWorkflow={onLoadWorkflow}
        onSaveWorkflow={vi.fn()}
        onValidateWorkflow={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "工作流 2" }));
    const panel = screen.getByRole("dialog", { name: "工作流管理" });

    expect(within(panel).getByPlaceholderText("搜索名称或 ID")).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "新建工作流" })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "保存当前" })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "验证当前" })).toBeInTheDocument();
    expect(within(panel).getByText("CSV 参数化接口测试")).toBeInTheDocument();
    expect(within(panel).getByText("v3")).toBeInTheDocument();
    expect(within(panel).queryByText("wf_csv_alpha")).not.toBeInTheDocument();
    expect(within(panel).getByText("6 个节点 · 2026/06/24 01:30")).toBeInTheDocument();
    expect(within(panel).getByText("最近成功")).toBeInTheDocument();
    expect(within(panel).getByText("最近失败")).toBeInTheDocument();
    expect(within(panel).getByRole("listitem", { current: "page" })).toHaveTextContent("单接口状态码断言");

    fireEvent.change(within(panel).getByPlaceholderText("搜索名称或 ID"), { target: { value: "csv" } });

    expect(within(panel).getByText("CSV 参数化接口测试")).toBeInTheDocument();
    expect(within(panel).queryByText("单接口状态码断言")).not.toBeInTheDocument();

    fireEvent.click(within(panel).getByRole("button", { name: "打开 CSV 参数化接口测试" }));

    expect(onLoadWorkflow).toHaveBeenCalledWith("wf_csv_alpha");
  });

  it("filters workflow rows by status and sort mode", () => {
    render(
      <WorkflowManager
        disabled={false}
        selectedWorkflowId=""
        workflows={workflows}
        onCreateWorkflow={vi.fn()}
        onDuplicateWorkflow={vi.fn()}
        onLoadWorkflow={vi.fn()}
        onSaveWorkflow={vi.fn()}
        onValidateWorkflow={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "工作流 2" }));
    const panel = screen.getByRole("dialog", { name: "工作流管理" });

    expect(within(panel).getByRole("button", { name: "失败 1" })).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "失败 1" }));

    expect(within(panel).queryByText("CSV 参数化接口测试")).not.toBeInTheDocument();
    expect(within(panel).getByText("单接口状态码断言")).toBeInTheDocument();

    fireEvent.change(within(panel).getByLabelText("工作流排序"), { target: { value: "node_count_desc" } });

    expect(within(panel).getByLabelText("工作流排序")).toHaveValue("node_count_desc");
  });

  it("filters workflow rows by successful and cancelled status", () => {
    render(
      <WorkflowManager
        disabled={false}
        selectedWorkflowId=""
        workflows={[
          ...workflows,
          {
            id: "wf_cancelled",
            name: "取消调试流程",
            version: 1,
            updated_at: "2026-06-24T03:00:00Z",
            node_count: 2,
            last_run_status: "cancelled",
          },
        ]}
        onCreateWorkflow={vi.fn()}
        onDuplicateWorkflow={vi.fn()}
        onLoadWorkflow={vi.fn()}
        onSaveWorkflow={vi.fn()}
        onValidateWorkflow={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "工作流 3" }));
    const panel = screen.getByRole("dialog", { name: "工作流管理" });

    fireEvent.click(within(panel).getByRole("button", { name: "成功 1" }));

    expect(within(panel).getByText("CSV 参数化接口测试")).toBeInTheDocument();
    expect(within(panel).queryByText("单接口状态码断言")).not.toBeInTheDocument();
    expect(within(panel).queryByText("取消调试流程")).not.toBeInTheDocument();

    fireEvent.click(within(panel).getByRole("button", { name: "已取消 1" }));

    expect(within(panel).queryByText("CSV 参数化接口测试")).not.toBeInTheDocument();
    expect(within(panel).queryByText("单接口状态码断言")).not.toBeInTheDocument();
    expect(within(panel).getByText("取消调试流程")).toBeInTheDocument();
  });

  it("disables only the save action when the current workflow cannot be saved", () => {
    render(
      <WorkflowManager
        disabled={false}
        saveActionState={{ disabled: true, title: "当前版本没有未保存变更" }}
        selectedWorkflowId="wf_status"
        workflows={workflows}
        onCreateWorkflow={vi.fn()}
        onDuplicateWorkflow={vi.fn()}
        onLoadWorkflow={vi.fn()}
        onSaveWorkflow={vi.fn()}
        onValidateWorkflow={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "工作流 2" }));
    const panel = screen.getByRole("dialog", { name: "工作流管理" });

    expect(within(panel).getByRole("button", { name: "新建工作流" })).toBeEnabled();
    expect(within(panel).getByRole("button", { name: "保存当前" })).toBeDisabled();
    expect(within(panel).getByRole("button", { name: "保存当前" })).toHaveAttribute(
      "title",
      "当前版本没有未保存变更"
    );
    expect(within(panel).getByRole("button", { name: "验证当前" })).toBeEnabled();
  });

  it("offers JSON import and export actions when transfer handlers are available", () => {
    const onExportWorkflow = vi.fn();
    const onImportWorkflow = vi.fn();

    render(
      <WorkflowManager
        disabled={false}
        selectedWorkflowId="wf_status"
        workflows={workflows}
        onCreateWorkflow={vi.fn()}
        onDuplicateWorkflow={vi.fn()}
        onExportWorkflow={onExportWorkflow}
        onImportWorkflow={onImportWorkflow}
        onLoadWorkflow={vi.fn()}
        onSaveWorkflow={vi.fn()}
        onValidateWorkflow={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "工作流 2" }));
    const panel = screen.getByRole("dialog", { name: "工作流管理" });
    const file = new File(["{}"], "workflow.json", { type: "application/json" });

    fireEvent.change(within(panel).getByLabelText("选择工作流 JSON 文件"), { target: { files: [file] } });
    expect(onImportWorkflow).toHaveBeenCalledWith(file);

    fireEvent.click(screen.getByRole("button", { name: "工作流 2" }));
    fireEvent.click(screen.getByRole("button", { name: "导出当前工作流" }));
    expect(onExportWorkflow).toHaveBeenCalledOnce();
  });

  it("shows workflow descriptions and tags in the catalog", () => {
    render(
      <WorkflowManager
        disabled={false}
        selectedWorkflowId=""
        workflows={[
          {
            id: "wf_release",
            name: "发布流程",
            active: false,
            description: "构建并发布生产制品",
            tags: ["发布", "自动化"],
            version: 1,
            updated_at: "2026-06-25T00:00:00Z",
            node_count: 4,
            last_run_status: null,
          },
        ]}
        onCreateWorkflow={vi.fn()}
        onDuplicateWorkflow={vi.fn()}
        onLoadWorkflow={vi.fn()}
        onSaveWorkflow={vi.fn()}
        onValidateWorkflow={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "工作流 1" }));

    expect(screen.getByText("构建并发布生产制品")).toBeInTheDocument();
    expect(screen.getByLabelText("发布流程的标签")).toHaveTextContent("发布自动化");
    expect(screen.getByText("已停用")).toBeInTheDocument();
  });

  it("shows recent runs for the selected workflow", () => {
    render(
      <WorkflowManager
        disabled={false}
        selectedWorkflowId="wf_status"
        selectedWorkflowRuns={[
          {
            id: "run_failed",
            workflow_id: "wf_status",
            workflow_version: 2,
            status: "failed",
            created_at: "2026-06-24T02:00:00Z",
            started_at: "2026-06-24T02:00:01Z",
            completed_at: "2026-06-24T02:00:04Z",
            error: "断言失败",
          },
          {
            id: "run_ok",
            workflow_id: "wf_status",
            workflow_version: 2,
            execution_mode: "webhook_test",
            status: "succeeded",
            created_at: "2026-06-23T02:00:00Z",
            started_at: "2026-06-23T02:00:01Z",
            completed_at: "2026-06-23T02:00:02Z",
            error: null,
          },
        ]}
        workflows={workflows}
        onCreateWorkflow={vi.fn()}
        onDuplicateWorkflow={vi.fn()}
        onLoadWorkflow={vi.fn()}
        onSaveWorkflow={vi.fn()}
        onValidateWorkflow={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "工作流 2" }));
    const panel = screen.getByRole("dialog", { name: "工作流管理" });

    expect(within(panel).getByText("当前工作流最近运行")).toBeInTheDocument();
    expect(within(panel).getByText("手动运行 · 运行记录 1")).toBeInTheDocument();
    expect(within(panel).getByText("失败")).toBeInTheDocument();
    expect(within(panel).getByText("v2 · 2026/06/24 10:00 · 3 秒")).toBeInTheDocument();
    expect(within(panel).getByText("断言失败")).toBeInTheDocument();
    expect(within(panel).getByText("手动运行 · 运行记录 1")).toBeInTheDocument();
    expect(within(panel).getByText("成功")).toBeInTheDocument();
    expect(within(panel).getByText("调试 Webhook · 运行记录 2")).toBeInTheDocument();
  });

  it("shows selected workflow runs with the newest run first", () => {
    render(
      <WorkflowManager
        disabled={false}
        selectedWorkflowId="wf_status"
        selectedWorkflowRuns={[
          {
            id: "run_old",
            workflow_id: "wf_status",
            workflow_version: 2,
            status: "failed",
            created_at: "2026-06-23T02:00:00Z",
            started_at: "2026-06-23T02:00:01Z",
            completed_at: "2026-06-23T02:00:04Z",
            error: "旧运行失败",
          },
          {
            id: "run_new",
            workflow_id: "wf_status",
            workflow_version: 2,
            status: "succeeded",
            created_at: "2026-06-24T02:00:00Z",
            started_at: "2026-06-24T02:00:01Z",
            completed_at: "2026-06-24T02:00:02Z",
            error: null,
          },
        ]}
        workflows={workflows}
        onCreateWorkflow={vi.fn()}
        onDuplicateWorkflow={vi.fn()}
        onLoadWorkflow={vi.fn()}
        onSaveWorkflow={vi.fn()}
        onValidateWorkflow={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "工作流 2" }));
    const history = screen.getByRole("region", { name: "当前工作流最近运行" });
    const runRows = within(history).getAllByRole("listitem");

    expect(runRows[0]).toHaveTextContent("运行记录 1");
    expect(runRows[0]).toHaveTextContent("2026/06/24 10:00");
    expect(runRows[1]).toHaveTextContent("运行记录 2");
    expect(runRows[1]).toHaveTextContent("2026/06/23 10:00");
  });

  it("loads more history without hiding the already loaded runs", () => {
    const onLoadMoreRunHistory = vi.fn();
    const selectedWorkflowRuns = Array.from({ length: 5 }, (_, index) => ({
      id: `run_${index}`,
      workflow_id: "wf_status",
      workflow_version: 2,
      status: "succeeded" as const,
      created_at: `2026-06-${String(24 - index).padStart(2, "0")}T02:00:00Z`,
      started_at: "2026-06-24T02:00:01Z",
      completed_at: "2026-06-24T02:00:02Z",
      error: null,
    }));

    render(
      <WorkflowManager
        disabled={false}
        hasMoreRunHistory
        selectedWorkflowId="wf_status"
        selectedWorkflowRuns={selectedWorkflowRuns}
        workflows={workflows}
        onCreateWorkflow={vi.fn()}
        onDuplicateWorkflow={vi.fn()}
        onLoadMoreRunHistory={onLoadMoreRunHistory}
        onLoadWorkflow={vi.fn()}
        onSaveWorkflow={vi.fn()}
        onValidateWorkflow={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "工作流 2" }));
    const history = screen.getByRole("region", { name: "当前工作流最近运行" });

    expect(within(history).getAllByRole("listitem")).toHaveLength(5);
    fireEvent.click(within(history).getByRole("button", { name: "加载更多运行记录" }));
    expect(onLoadMoreRunHistory).toHaveBeenCalledTimes(1);
  });

  it("requests a failed-run history filter", () => {
    const onRunHistoryStatusChange = vi.fn();

    render(
      <WorkflowManager
        disabled={false}
        selectedWorkflowId="wf_status"
        selectedWorkflowRuns={[]}
        workflows={workflows}
        onCreateWorkflow={vi.fn()}
        onDuplicateWorkflow={vi.fn()}
        onLoadWorkflow={vi.fn()}
        onRunHistoryStatusChange={onRunHistoryStatusChange}
        onSaveWorkflow={vi.fn()}
        onValidateWorkflow={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "工作流 2" }));
    fireEvent.click(screen.getByRole("button", { name: "筛选失败运行" }));

    expect(onRunHistoryStatusChange).toHaveBeenCalledWith("failed");
  });

  it("opens a selected historical run", () => {
    const onOpenRun = vi.fn();

    render(
      <WorkflowManager
        disabled={false}
        selectedWorkflowId="wf_status"
        selectedWorkflowRuns={[
          {
            id: "run_failed",
            workflow_id: "wf_status",
            workflow_version: 2,
            status: "failed",
            created_at: "2026-06-24T02:00:00Z",
            started_at: "2026-06-24T02:00:01Z",
            completed_at: "2026-06-24T02:00:04Z",
            error: "断言失败",
          },
        ]}
        workflows={workflows}
        onCreateWorkflow={vi.fn()}
        onDuplicateWorkflow={vi.fn()}
        onLoadWorkflow={vi.fn()}
        onOpenRun={onOpenRun}
        onSaveWorkflow={vi.fn()}
        onValidateWorkflow={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "工作流 2" }));
    const panel = screen.getByRole("dialog", { name: "工作流管理" });
    fireEvent.click(within(panel).getByRole("button", { name: "查看第 1 次运行日志" }));

    expect(onOpenRun).toHaveBeenCalledWith("run_failed");
  });
  it("exposes duplicate and empty-state actions", () => {
    const onDuplicateWorkflow = vi.fn();

    const { rerender } = render(
      <WorkflowManager
        disabled={false}
        selectedWorkflowId=""
        workflows={workflows}
        onCreateWorkflow={vi.fn()}
        onDuplicateWorkflow={onDuplicateWorkflow}
        onLoadWorkflow={vi.fn()}
        onSaveWorkflow={vi.fn()}
        onValidateWorkflow={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "工作流 2" }));
    fireEvent.click(screen.getByRole("button", { name: "复制 CSV 参数化接口测试" }));

    expect(onDuplicateWorkflow).toHaveBeenCalledWith("wf_csv_alpha");

    rerender(
      <WorkflowManager
        disabled={false}
        selectedWorkflowId=""
        workflows={[]}
        onCreateWorkflow={vi.fn()}
        onDuplicateWorkflow={vi.fn()}
        onLoadWorkflow={vi.fn()}
        onSaveWorkflow={vi.fn()}
        onValidateWorkflow={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "工作流 0" }));

    expect(screen.getByText("还没有保存的工作流")).toBeInTheDocument();
  });

  it("requires an explicit Chinese confirmation before deleting a workflow", async () => {
    const onDeleteWorkflow = vi.fn().mockResolvedValue(undefined);

    render(
      <WorkflowManager
        disabled={false}
        selectedWorkflowId=""
        workflows={workflows}
        onCreateWorkflow={vi.fn()}
        onDeleteWorkflow={onDeleteWorkflow}
        onDuplicateWorkflow={vi.fn()}
        onLoadWorkflow={vi.fn()}
        onSaveWorkflow={vi.fn()}
        onValidateWorkflow={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "工作流 2" }));
    fireEvent.click(screen.getByRole("button", { name: "删除 CSV 参数化接口测试" }));

    const confirmation = screen.getByRole("alertdialog", { name: "删除工作流" });
    expect(confirmation).toHaveTextContent("会永久删除此工作流的所有版本和运行记录，且无法恢复。");
    expect(onDeleteWorkflow).not.toHaveBeenCalled();

    fireEvent.click(within(confirmation).getByRole("button", { name: "永久删除" }));

    await vi.waitFor(() => expect(onDeleteWorkflow).toHaveBeenCalledWith("wf_csv_alpha"));
  });

  it("keeps the deletion confirmation open and shows an API error", async () => {
    const onDeleteWorkflow = vi.fn().mockRejectedValue(new Error('API 409: {"detail":{"message":"工作流仍被其他工作流调用，无法删除。"}}'));

    render(
      <WorkflowManager
        disabled={false}
        selectedWorkflowId=""
        workflows={workflows}
        onCreateWorkflow={vi.fn()}
        onDeleteWorkflow={onDeleteWorkflow}
        onDuplicateWorkflow={vi.fn()}
        onLoadWorkflow={vi.fn()}
        onSaveWorkflow={vi.fn()}
        onValidateWorkflow={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "工作流 2" }));
    fireEvent.click(screen.getByRole("button", { name: "删除 CSV 参数化接口测试" }));
    fireEvent.click(screen.getByRole("button", { name: "永久删除" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("工作流仍被其他工作流调用，无法删除。");
    expect(screen.getByRole("alertdialog", { name: "删除工作流" })).toBeInTheDocument();
  });
});
