import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ValidationIssueList } from "./ValidationIssueList";
import type { ValidationIssueItem } from "../lib/validationIssueView";

describe("ValidationIssueList", () => {
  it("renders validation issues and reports selection", () => {
    const onSelectIssue = vi.fn();
    const issues: ValidationIssueItem[] = [
      {
        id: "nodes.request.config.url",
        title: "节点配置问题",
        message: "节点 request 的配置 URL：必填项不能为空",
        targetKind: "node",
        nodeId: "request",
        field: "url",
        location: "节点 request",
      },
      {
        id: "settings.variables.base-url",
        title: "工作流设置问题",
        message: "工作流变量 base-url：变量名只能包含字母、数字和下划线，且不能以数字开头。",
        targetKind: "settings",
        field: "base-url",
        location: "工作流变量 base-url",
      },
    ];

    render(<ValidationIssueList issues={issues} onSelectIssue={onSelectIssue} />);

    expect(screen.getByRole("heading", { name: "工作流验证" })).toBeInTheDocument();
    expect(screen.getByText("2 个问题")).toBeInTheDocument();
    expect(screen.getByText("节点 request")).toBeInTheDocument();
    expect(screen.getByText("字段 url")).toBeInTheDocument();
    expect(screen.getByText("工作流变量 base-url")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /节点 request 的配置 URL/ }));

    expect(onSelectIssue).toHaveBeenCalledWith(issues[0]);
  });

  it("renders nothing when there are no validation issues", () => {
    const { container } = render(<ValidationIssueList issues={[]} onSelectIssue={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });
});
