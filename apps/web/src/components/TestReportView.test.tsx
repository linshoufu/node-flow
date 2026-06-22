import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TestReport } from "../lib/testReport";
import { TestReportView } from "./TestReportView";

describe("TestReportView", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders summary and case list", () => {
    const report: TestReport = {
      summary: { total: 3, passed: 1, failed: 1, unknown: 1 },
      hasCases: true,
      cases: [
        {
          id: "case-login",
          name: "登录接口返回 200",
          status: "passed",
          message: "断言通过",
          durationMs: 12,
        },
        {
          id: "case-profile",
          name: "资料接口字段完整",
          status: "failed",
          message: "缺少 name 字段",
        },
        {
          id: "case-search",
          name: "搜索接口",
          status: "unknown",
        },
      ],
    };

    render(<TestReportView report={report} />);

    expect(screen.getByText("总数")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getAllByText("通过").length).toBeGreaterThan(0);
    expect(screen.getAllByText("失败").length).toBeGreaterThan(0);
    expect(screen.getAllByText("未知").length).toBeGreaterThan(0);
    expect(screen.getByText("登录接口返回 200")).toBeInTheDocument();
    expect(screen.getByText("资料接口字段完整")).toBeInTheDocument();
    expect(screen.getByText("搜索接口")).toBeInTheDocument();
    expect(screen.getByText("断言通过")).toBeInTheDocument();
    expect(screen.getByText("缺少 name 字段")).toBeInTheDocument();
    expect(screen.getByText("12 ms")).toBeInTheDocument();
  });

  it("renders an empty state when there is no report data", () => {
    const report: TestReport = {
      summary: { total: 0, passed: 0, failed: 0, unknown: 0 },
      hasCases: false,
      cases: [],
    };

    render(<TestReportView report={report} />);

    expect(screen.getByText("暂无测试报告")).toBeInTheDocument();
  });

  it("renders summary-only reports with no detail hint", () => {
    const report: TestReport = {
      summary: { total: 2, passed: 1, failed: 1, unknown: 0 },
      hasCases: false,
      cases: [],
    };

    render(<TestReportView report={report} />);

    expect(screen.getByText("总数")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("暂无明细")).toBeInTheDocument();
  });

  it("renders duplicate case ids and long messages", () => {
    const longMessage = "响应字段 actual.items.0.profile.displayName 与期望值不一致，请检查上游接口返回和断言配置。";
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const report: TestReport = {
      summary: { total: 2, passed: 1, failed: 1, unknown: 0 },
      hasCases: true,
      cases: [
        { id: "duplicate", name: "重复编号用例 A", status: "passed", message: longMessage },
        { id: "duplicate", name: "重复编号用例 B", status: "failed", message: "第二条失败" },
      ],
    };

    render(<TestReportView report={report} />);

    expect(screen.getByText("重复编号用例 A")).toBeInTheDocument();
    expect(screen.getByText("重复编号用例 B")).toBeInTheDocument();
    expect(screen.getByText(longMessage)).toBeInTheDocument();
    expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining("Encountered two children with the same key"), expect.anything());

    consoleError.mockRestore();
  });

  it("filters cases by status", () => {
    render(<TestReportView report={mixedStatusReport()} />);

    expect(screen.getByRole("button", { name: "全部" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("通过用例")).toBeInTheDocument();
    expect(screen.getByText("失败用例")).toBeInTheDocument();
    expect(screen.getByText("未知用例")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "失败" }));

    expect(screen.getByRole("button", { name: "失败" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("通过用例")).not.toBeInTheDocument();
    expect(screen.getByText("失败用例")).toBeInTheDocument();
    expect(screen.queryByText("未知用例")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "未知" }));

    expect(screen.queryByText("通过用例")).not.toBeInTheDocument();
    expect(screen.queryByText("失败用例")).not.toBeInTheDocument();
    expect(screen.getByText("未知用例")).toBeInTheDocument();
  });

  it("renders an empty state when the selected status has no matching cases", () => {
    const report: TestReport = {
      summary: { total: 1, passed: 1, failed: 0, unknown: 0 },
      hasCases: true,
      cases: [{ id: "case-pass", name: "通过用例", status: "passed" }],
    };

    render(<TestReportView report={report} />);

    fireEvent.click(screen.getByRole("button", { name: "失败" }));

    expect(screen.getByText("没有匹配的用例")).toBeInTheDocument();
    expect(screen.queryByText("通过用例")).not.toBeInTheDocument();
  });

  it("selects source nodes from interactive report cases only", () => {
    const onSelectNode = vi.fn();
    const report: TestReport = {
      summary: { total: 2, passed: 1, failed: 1, unknown: 0 },
      hasCases: true,
      cases: [
        { id: "case-source", name: "带来源用例", status: "failed", sourceNodeId: "record_result" },
        { id: "case-scoped", name: "循环体用例", status: "passed", sourceNodeId: "record_result", sourceScope: ["each_row", "iteration:0"] },
        { id: "case-static", name: "无来源用例", status: "passed" },
      ],
    };

    render(<TestReportView report={report} onSelectNode={onSelectNode} />);

    fireEvent.click(screen.getByRole("button", { name: /带来源用例/ }));
    fireEvent.click(screen.getByRole("button", { name: /循环体用例/ }));

    expect(onSelectNode).toHaveBeenNthCalledWith(1, { nodeId: "record_result", scope: [] });
    expect(onSelectNode).toHaveBeenNthCalledWith(2, { nodeId: "record_result", scope: ["each_row", "iteration:0"] });
    expect(screen.getAllByText("来源：record_result")).toHaveLength(2);
    expect(screen.getByText("无来源用例").closest("button")).toBeNull();
  });
});

function mixedStatusReport(): TestReport {
  return {
    summary: { total: 3, passed: 1, failed: 1, unknown: 1 },
    hasCases: true,
    cases: [
      { id: "case-pass", name: "通过用例", status: "passed" },
      { id: "case-fail", name: "失败用例", status: "failed" },
      { id: "case-unknown", name: "未知用例", status: "unknown" },
    ],
  };
}
