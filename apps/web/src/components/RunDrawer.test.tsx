import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RunRecord } from "../types";
import { RunDrawer } from "./RunDrawer";

const run: RunRecord = {
  id: "run_12",
  workflow_id: "workflow_3",
  workflow_version: 1,
  status: "succeeded",
  created_at: "2026-07-14T08:00:00Z",
  started_at: "2026-07-14T08:00:02Z",
  completed_at: "2026-07-14T08:00:03Z",
  error: null,
};

describe("RunDrawer", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows an accessible compact summary while collapsed", () => {
    const onToggle = vi.fn();

    render(
      <RunDrawer expanded={false} run={null} onToggle={onToggle}>
        <div>运行内容</div>
      </RunDrawer>,
    );

    expect(screen.getByRole("heading", { name: "运行结果" })).toBeInTheDocument();
    expect(screen.getByText("空闲")).toBeInTheDocument();
    expect(screen.getByText("暂无运行结果")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "展开运行结果" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("运行内容").parentElement).toHaveAttribute("hidden");

    fireEvent.click(screen.getByRole("button", { name: "展开运行结果" }));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("shows the current run summary and expanded content", () => {
    render(
      <RunDrawer expanded run={run} onToggle={() => undefined}>
        <div>运行内容</div>
      </RunDrawer>,
    );

    expect(screen.getByText("成功")).toBeInTheDocument();
    expect(screen.getByText("本次运行")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "收起运行结果" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("运行内容").parentElement).not.toHaveAttribute("hidden");
  });
});
