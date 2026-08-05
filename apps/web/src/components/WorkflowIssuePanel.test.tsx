import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkflowIssueItem } from "../lib/workflowIssues";
import { WorkflowIssuePanel } from "./WorkflowIssuePanel";

describe("WorkflowIssuePanel", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders validation and pre-run issues as one product issue center", () => {
    const onSelectIssue = vi.fn();
    const issues: WorkflowIssueItem[] = [
      {
        id: "validation:nodes.request.config.url",
        source: "validation",
        severity: "error",
        title: "节点配置问题",
        message: "HTTP 请求 URL 不能为空。",
        location: "节点 请求接口",
        field: "url",
        target: { kind: "node", nodeId: "request", field: "url" },
      },
      {
        id: "pre_run:root/assert:expression",
        source: "pre_run",
        severity: "warning",
        title: "断言配置建议",
        message: "建议补充断言表达式。",
        location: "节点 断言响应",
        field: "expression",
        pathLabel: "主流程 / assert",
        target: { kind: "node", nodeId: "assert", field: "expression", path: ["root", "assert"] },
      },
    ];

    render(<WorkflowIssuePanel issues={issues} onSelectIssue={onSelectIssue} />);

    expect(screen.getByRole("heading", { name: "问题中心" })).toBeInTheDocument();
    expect(screen.getByText("共 2 个问题")).toBeInTheDocument();
    expect(screen.getByText("验证 1")).toBeInTheDocument();
    expect(screen.getByText("本地检查 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "全部 2" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("验证")).toBeInTheDocument();
    expect(screen.getByText("本地检查")).toBeInTheDocument();
    expect(screen.getByText("警告")).toBeInTheDocument();
    expect(screen.getByText("位置 主流程 / assert")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /建议补充断言表达式。/ }));

    expect(onSelectIssue).toHaveBeenCalledWith(issues[1]);
  });

  it("filters visible issues by source without changing issue selection", () => {
    const onSelectIssue = vi.fn();
    const issues: WorkflowIssueItem[] = [
      {
        id: "validation:nodes.request.config.url",
        source: "validation",
        severity: "error",
        title: "节点配置问题",
        message: "HTTP 请求 URL 不能为空。",
        location: "节点 请求接口",
        field: "url",
        target: { kind: "node", nodeId: "request", field: "url" },
      },
      {
        id: "pre_run:root/assert:expression",
        source: "pre_run",
        severity: "warning",
        title: "断言配置建议",
        message: "建议补充断言表达式。",
        location: "节点 断言响应",
        field: "expression",
        pathLabel: "主流程 / assert",
        target: { kind: "node", nodeId: "assert", field: "expression", path: ["root", "assert"] },
      },
    ];

    const { container } = render(<WorkflowIssuePanel issues={issues} onSelectIssue={onSelectIssue} />);
    const panel = within(container);

    expect(panel.getByText("HTTP 请求 URL 不能为空。")).toBeInTheDocument();
    expect(panel.getByText("建议补充断言表达式。")).toBeInTheDocument();

    fireEvent.click(panel.getByRole("button", { name: "验证 1" }));

    expect(panel.getByRole("button", { name: "验证 1" })).toHaveAttribute("aria-pressed", "true");
    expect(panel.getByText("HTTP 请求 URL 不能为空。")).toBeInTheDocument();
    expect(panel.queryByText("建议补充断言表达式。")).not.toBeInTheDocument();

    fireEvent.click(panel.getByRole("button", { name: "本地检查 1" }));

    expect(panel.getByRole("button", { name: "本地检查 1" })).toHaveAttribute("aria-pressed", "true");
    expect(panel.queryByText("HTTP 请求 URL 不能为空。")).not.toBeInTheDocument();
    expect(panel.getByText("建议补充断言表达式。")).toBeInTheDocument();

    fireEvent.click(panel.getByRole("button", { name: /建议补充断言表达式。/ }));

    expect(onSelectIssue).toHaveBeenCalledWith(issues[1]);
  });

  it("offers a delete action for edge issues without selecting the issue", () => {
    const onDeleteEdge = vi.fn();
    const onSelectIssue = vi.fn();
    const issues: WorkflowIssueItem[] = [
      {
        id: "pre_run:root:edge:edge_old_port",
        source: "pre_run",
        severity: "error",
        title: "连线无效",
        message: "目标节点没有输入端口 old_input。",
        location: "连线 edge_old_port",
        target: { kind: "edge", edgeId: "edge_old_port" },
      },
    ];

    render(<WorkflowIssuePanel issues={issues} onDeleteEdge={onDeleteEdge} onSelectIssue={onSelectIssue} />);

    fireEvent.click(screen.getByRole("button", { name: "删除连线 edge_old_port" }));

    expect(onDeleteEdge).toHaveBeenCalledWith("edge_old_port");
    expect(onSelectIssue).not.toHaveBeenCalled();
  });

  it("disables edge repair and delete actions when editing is locked", () => {
    const onDeleteEdge = vi.fn();
    const onDeleteEdges = vi.fn();
    const onRepairEdgeTarget = vi.fn();
    const issues: WorkflowIssueItem[] = [
      {
        id: "pre_run:root:edge:edge_old_port",
        source: "pre_run",
        severity: "error",
        title: "连线无效",
        message: "目标节点没有输入端口 old_input。",
        location: "连线 edge_old_port",
        target: { kind: "edge", edgeId: "edge_old_port" },
      },
      {
        id: "validation:edge:edge_schema",
        source: "validation",
        severity: "error",
        title: "连线问题",
        message: "输入端口类型不兼容。",
        location: "连线 edge_schema",
        target: { kind: "edge", edgeId: "edge_schema" },
      },
    ];

    render(
      <WorkflowIssuePanel
        disabled
        edgeRepairCandidates={{ edge_old_port: [{ handle: "input", label: "输入" }] }}
        issues={issues}
        onDeleteEdge={onDeleteEdge}
        onDeleteEdges={onDeleteEdges}
        onRepairEdgeTarget={onRepairEdgeTarget}
        onSelectIssue={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "删除全部无效连线，共 2 条" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "改接连线 edge_old_port 到输入端口 输入" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "删除连线 edge_old_port" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "删除全部无效连线，共 2 条" }));
    fireEvent.click(screen.getByRole("button", { name: "改接连线 edge_old_port 到输入端口 输入" }));
    fireEvent.click(screen.getByRole("button", { name: "删除连线 edge_old_port" }));

    expect(onDeleteEdge).not.toHaveBeenCalled();
    expect(onDeleteEdges).not.toHaveBeenCalled();
    expect(onRepairEdgeTarget).not.toHaveBeenCalled();
  });

  it("offers a bulk delete action for multiple invalid edge issues", () => {
    const onDeleteEdge = vi.fn();
    const onDeleteEdges = vi.fn();
    const onSelectIssue = vi.fn();
    const issues: WorkflowIssueItem[] = [
      {
        id: "pre_run:root:edge:edge_old_port",
        source: "pre_run",
        severity: "error",
        title: "连线无效",
        message: "目标节点没有输入端口 old_input。",
        location: "连线 edge_old_port",
        target: { kind: "edge", edgeId: "edge_old_port" },
      },
      {
        id: "validation:edge:edge_schema",
        source: "validation",
        severity: "error",
        title: "连线问题",
        message: "输入端口类型不兼容。",
        location: "连线 edge_schema",
        target: { kind: "edge", edgeId: "edge_schema" },
      },
      {
        id: "pre_run:node:url",
        source: "pre_run",
        severity: "error",
        title: "节点配置问题",
        message: "URL 不能为空。",
        location: "节点 HTTP 请求",
        target: { kind: "node", nodeId: "request", field: "url" },
      },
    ];

    render(
      <WorkflowIssuePanel
        issues={issues}
        onDeleteEdge={onDeleteEdge}
        onDeleteEdges={onDeleteEdges}
        onSelectIssue={onSelectIssue}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "删除全部无效连线，共 2 条" }));

    expect(onDeleteEdges).toHaveBeenCalledWith(["edge_schema", "edge_old_port"]);
    expect(onDeleteEdge).not.toHaveBeenCalled();
    expect(onSelectIssue).not.toHaveBeenCalled();
  });

  it("does not offer bulk delete when there is only one edge issue", () => {
    const issues: WorkflowIssueItem[] = [
      {
        id: "pre_run:root:edge:edge_old_port",
        source: "pre_run",
        severity: "error",
        title: "连线无效",
        message: "目标节点没有输入端口 old_input。",
        location: "连线 edge_old_port",
        target: { kind: "edge", edgeId: "edge_old_port" },
      },
    ];

    render(<WorkflowIssuePanel issues={issues} onDeleteEdge={vi.fn()} onSelectIssue={vi.fn()} />);

    expect(screen.queryByRole("button", { name: /删除全部无效连线/ })).not.toBeInTheDocument();
  });

  it("offers edge repair candidates without selecting the issue", () => {
    const onRepairEdgeTarget = vi.fn();
    const onSelectIssue = vi.fn();
    const issues: WorkflowIssueItem[] = [
      {
        id: "pre_run:root:edge:edge_old_port",
        source: "pre_run",
        severity: "error",
        title: "连线无效",
        message: "目标节点没有输入端口 old_input。",
        location: "连线 edge_old_port",
        target: { kind: "edge", edgeId: "edge_old_port" },
      },
    ];

    render(
      <WorkflowIssuePanel
        edgeRepairCandidates={{
          edge_old_port: [{ handle: "input", label: "输入" }],
        }}
        issues={issues}
        onRepairEdgeTarget={onRepairEdgeTarget}
        onSelectIssue={onSelectIssue}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "改接连线 edge_old_port 到输入端口 输入" }));

    expect(onRepairEdgeTarget).toHaveBeenCalledWith("edge_old_port", "input");
    expect(onSelectIssue).not.toHaveBeenCalled();
  });

  it("explains when an edge issue has no direct repair candidates", () => {
    const issues: WorkflowIssueItem[] = [
      {
        id: "pre_run:root:edge:edge_old_port",
        source: "pre_run",
        severity: "error",
        title: "连线无效",
        message: "目标节点没有输入端口 old_input。",
        location: "连线 edge_old_port",
        target: { kind: "edge", edgeId: "edge_old_port" },
      },
    ];

    render(
      <WorkflowIssuePanel
        edgeRepairCandidates={{ edge_old_port: [] }}
        issues={issues}
        onRepairEdgeTarget={vi.fn()}
        onSelectIssue={vi.fn()}
      />
    );

    expect(screen.getByText("没有可直接改接的输入端口")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /改接连线 edge_old_port/ })).not.toBeInTheDocument();
  });

  it("hides source filters that have no issues", () => {
    const issues: WorkflowIssueItem[] = [
      {
        id: "pre_run:root/assert:expression",
        source: "pre_run",
        severity: "warning",
        title: "断言配置建议",
        message: "建议补充断言表达式。",
        location: "节点 断言响应",
        target: { kind: "node", nodeId: "assert" },
      },
    ];

    render(<WorkflowIssuePanel issues={issues} onSelectIssue={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "验证 0" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "本地检查 1" })).toBeInTheDocument();
  });

  it("shows blocking errors before warnings with stable issue ordering", () => {
    const onSelectIssue = vi.fn();
    const issues: WorkflowIssueItem[] = [
      {
        id: "pre_run:assert:expression",
        source: "pre_run",
        severity: "warning",
        title: "断言配置建议",
        message: "建议补充断言表达式。",
        location: "节点 断言响应",
        field: "expression",
        target: { kind: "node", nodeId: "assert", field: "expression" },
      },
      {
        id: "pre_run:request:url",
        source: "pre_run",
        severity: "error",
        title: "运行前阻断",
        message: "HTTP 请求缺少 URL。",
        location: "节点 请求接口",
        field: "url",
        target: { kind: "node", nodeId: "request", field: "url" },
      },
      {
        id: "validation:edge:e1",
        source: "validation",
        severity: "error",
        title: "连线问题",
        message: "输入端口类型不兼容。",
        location: "连线 请求接口 -> 断言响应",
        target: { kind: "edge", edgeId: "e1" },
      },
    ];

    render(<WorkflowIssuePanel issues={issues} onSelectIssue={onSelectIssue} />);

    const cards = screen.getAllByRole("button", {
      name: /HTTP 请求缺少 URL。|输入端口类型不兼容。|建议补充断言表达式。/,
    });

    expect(cards.map((card) => card.textContent)).toEqual([
      expect.stringContaining("输入端口类型不兼容。"),
      expect.stringContaining("HTTP 请求缺少 URL。"),
      expect.stringContaining("建议补充断言表达式。"),
    ]);

    fireEvent.click(cards[1]);

    expect(onSelectIssue).toHaveBeenCalledWith(issues[1]);
  });

  it("falls back to all issues when the selected source disappears", () => {
    const issues: WorkflowIssueItem[] = [
      {
        id: "validation:nodes.request.config.url",
        source: "validation",
        severity: "error",
        title: "节点配置问题",
        message: "HTTP 请求 URL 不能为空。",
        location: "节点 请求接口",
        field: "url",
        target: { kind: "node", nodeId: "request", field: "url" },
      },
      {
        id: "pre_run:root/assert:expression",
        source: "pre_run",
        severity: "warning",
        title: "断言配置建议",
        message: "建议补充断言表达式。",
        location: "节点 断言响应",
        field: "expression",
        pathLabel: "主流程 / assert",
        target: { kind: "node", nodeId: "assert", field: "expression", path: ["root", "assert"] },
      },
    ];
    const remainingIssues = [issues[1]];
    const { container, rerender } = render(<WorkflowIssuePanel issues={issues} onSelectIssue={vi.fn()} />);
    const panel = within(container);

    fireEvent.click(panel.getByRole("button", { name: "验证 1" }));
    expect(panel.getByRole("button", { name: "验证 1" })).toHaveAttribute("aria-pressed", "true");

    rerender(<WorkflowIssuePanel issues={remainingIssues} onSelectIssue={vi.fn()} />);

    expect(panel.getByRole("button", { name: "全部 1" })).toHaveAttribute("aria-pressed", "true");
    expect(panel.getByText("建议补充断言表达式。")).toBeInTheDocument();
  });

  it("keeps hook order stable when issues appear and disappear", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const issue: WorkflowIssueItem = {
      id: "pre_run:root/assert:expression",
      source: "pre_run",
      severity: "warning",
      title: "断言配置建议",
      message: "建议补充断言表达式。",
      location: "节点 断言响应",
      field: "expression",
      pathLabel: "主流程 / assert",
      target: { kind: "node", nodeId: "assert", field: "expression", path: ["root", "assert"] },
    };

    const { rerender } = render(<WorkflowIssuePanel issues={[]} onSelectIssue={vi.fn()} />);
    rerender(<WorkflowIssuePanel issues={[issue]} onSelectIssue={vi.fn()} />);
    rerender(<WorkflowIssuePanel issues={[]} onSelectIssue={vi.fn()} />);

    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("renders nothing when there are no issues", () => {
    const { container } = render(<WorkflowIssuePanel issues={[]} onSelectIssue={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });
});
