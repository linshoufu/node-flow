import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowPicker } from "./WorkflowPicker";
import type { WorkflowPickerGroup } from "../lib/workflowPicker";

describe("WorkflowPicker", () => {
  afterEach(() => {
    cleanup();
  });

  const groups: WorkflowPickerGroup[] = [
    {
      key: "csv",
      label: "CSV 参数化接口测试 · 2 个",
      options: [
        {
          workflow: { id: "wf_csv_alpha", name: "CSV 参数化接口测试", version: 1 },
          label: "CSV 参数化接口测试 v1 · 同名 1",
        },
        {
          workflow: { id: "wf_csv_alpine", name: "CSV 参数化接口测试", version: 1 },
          label: "CSV 参数化接口测试 v1 · 同名 2",
        },
      ],
    },
    {
      key: "status",
      label: null,
      options: [
        {
          workflow: { id: "wf_status", name: "单接口状态码断言", version: 2 },
          label: "单接口状态码断言 v2",
        },
      ],
    },
  ];

  it("renders grouped workflow options and reports selection changes", () => {
    const onChange = vi.fn();

    render(<WorkflowPicker disabled={false} groups={groups} value="" onChange={onChange} />);

    expect(screen.getByText("工作流")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "选择工作流..." })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "CSV 参数化接口测试 · 2 个" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "CSV 参数化接口测试 v1 · 同名 1" })).toBeInTheDocument();
    expect(screen.queryByText("wf_csv_alph")).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "单接口状态码断言 v2" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("已保存工作流"), { target: { value: "wf_status" } });

    expect(onChange).toHaveBeenCalledWith("wf_status");
  });

  it("disables the selector when requested or when no workflows exist", () => {
    const { rerender } = render(<WorkflowPicker disabled={true} groups={groups} value="" onChange={vi.fn()} />);

    expect(screen.getByLabelText("已保存工作流")).toBeDisabled();

    rerender(<WorkflowPicker disabled={false} groups={[]} value="" onChange={vi.fn()} />);

    expect(screen.getByLabelText("已保存工作流")).toBeDisabled();
  });
});
