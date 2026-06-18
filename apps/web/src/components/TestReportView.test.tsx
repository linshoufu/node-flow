import { cleanup, render, screen } from "@testing-library/react";
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
});
