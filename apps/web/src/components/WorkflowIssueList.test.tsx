import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkflowIssueItem } from "../lib/workflowIssues";
import { WorkflowIssueList } from "./WorkflowIssueList";

describe("WorkflowIssueList", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders unified workflow issues and reports selection", () => {
    const onSelectIssue = vi.fn();
    const issues: WorkflowIssueItem[] = [
      {
        id: "pre_run:root/request:url",
        source: "pre_run",
        severity: "error",
        title: "HTTP 请求配置不完整",
        message: "HTTP 请求缺少 URL。",
        location: "节点 request",
        field: "url",
        pathLabel: "主流程 / request",
        target: { kind: "node", nodeId: "request", field: "url", path: ["root", "request"] },
      },
      {
        id: "validation:settings.timeout_seconds",
        source: "validation",
        severity: "error",
        title: "工作流设置问题",
        message: "工作流设置 超时秒数：必须大于 0",
        location: "工作流设置",
        field: "timeout_seconds",
        target: { kind: "settings", field: "timeout_seconds" },
      },
    ];

    render(<WorkflowIssueList issues={issues} title="问题中心" onSelectIssue={onSelectIssue} />);

    expect(screen.getByRole("heading", { name: "问题中心" })).toBeInTheDocument();
    expect(screen.getByText("2 个问题")).toBeInTheDocument();
    expect(screen.getByText("节点 request")).toBeInTheDocument();
    expect(screen.getByText("字段 url")).toBeInTheDocument();
    expect(screen.getByText("位置 主流程 / request")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /HTTP 请求缺少 URL。/ }));

    expect(onSelectIssue).toHaveBeenCalledWith(issues[0]);
  });

  it("renders nothing when there are no issues", () => {
    const { container } = render(<WorkflowIssueList issues={[]} title="问题中心" onSelectIssue={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("uses the shared issue ordering while keeping original selection payloads", () => {
    const onSelectIssue = vi.fn();
    const issues: WorkflowIssueItem[] = [
      {
        id: "pre_run:assert:expression",
        source: "pre_run",
        severity: "warning",
        title: "断言配置建议",
        message: "建议补充断言表达式。",
        location: "节点 assert",
        field: "expression",
        target: { kind: "node", nodeId: "assert", field: "expression" },
      },
      {
        id: "pre_run:request:url",
        source: "pre_run",
        severity: "error",
        title: "HTTP 请求配置不完整",
        message: "HTTP 请求缺少 URL。",
        location: "节点 request",
        field: "url",
        target: { kind: "node", nodeId: "request", field: "url" },
      },
    ];

    render(<WorkflowIssueList issues={issues} title="运行前检查" onSelectIssue={onSelectIssue} />);

    const cards = screen.getAllByRole("button", { name: /HTTP 请求缺少 URL。|建议补充断言表达式。/ });

    expect(cards[0]).toHaveTextContent("HTTP 请求缺少 URL。");
    expect(cards[1]).toHaveTextContent("建议补充断言表达式。");

    fireEvent.click(cards[0]);

    expect(onSelectIssue).toHaveBeenCalledWith(issues[1]);
  });

  it("shows source and severity badges for each issue", () => {
    const issues: WorkflowIssueItem[] = [
      {
        id: "pre_run:assert:expression",
        source: "pre_run",
        severity: "warning",
        title: "断言配置建议",
        message: "建议补充断言表达式。",
        location: "节点 assert",
        field: "expression",
        target: { kind: "node", nodeId: "assert", field: "expression" },
      },
    ];

    render(<WorkflowIssueList issues={issues} title="运行前检查" onSelectIssue={vi.fn()} />);

    expect(screen.getByText("本地检查")).toBeInTheDocument();
    expect(screen.getByText("警告")).toBeInTheDocument();
  });
});
