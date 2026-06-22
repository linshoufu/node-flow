import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PreRunIssueList } from "./PreRunIssueList";
import type { PreRunIssue } from "../lib/preRunChecks";

describe("PreRunIssueList", () => {
  it("renders Chinese issue details and selects the issue node", () => {
    const onSelectNode = vi.fn();
    const issues: PreRunIssue[] = [
      {
        id: "root/request:url",
        nodeId: "request",
        nodeType: "http.request",
        severity: "error",
        title: "HTTP 请求配置不完整",
        message: "HTTP 请求缺少 URL。",
        field: "url",
        path: ["root", "request"],
      },
      {
        id: "root/report:path",
        nodeId: "report",
        nodeType: "test.write_report",
        severity: "error",
        title: "测试报告配置不完整",
        message: "写入测试报告缺少输出路径。",
        field: "path",
        path: ["root", "report"],
      },
    ];

    render(<PreRunIssueList issues={issues} onSelectNode={onSelectNode} />);

    expect(screen.getByRole("heading", { name: "运行前检查" })).toBeInTheDocument();
    expect(screen.getByText("2 个问题")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /HTTP 请求缺少 URL。/ }));

    expect(onSelectNode).toHaveBeenCalledWith("request");
  });

  it("renders nothing when there are no issues", () => {
    const { container } = render(<PreRunIssueList issues={[]} onSelectNode={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });
});
