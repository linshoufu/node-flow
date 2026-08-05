import { describe, expect, it } from "vitest";
import type { WorkflowSummary } from "../types";
import { buildWorkflowPickerGroups } from "./workflowPicker";

describe("workflow picker helpers", () => {
  it("groups duplicate workflow names and gives each option a user-facing duplicate index", () => {
    const workflows: WorkflowSummary[] = [
      { id: "wf_csv_alpha", name: "CSV 参数化接口测试", version: 1 },
      { id: "wf_csv_alpine", name: "CSV 参数化接口测试", version: 1 },
      { id: "wf_status", name: "单接口状态码断言", version: 2 },
    ];

    const groups = buildWorkflowPickerGroups(workflows);

    expect(groups).toEqual([
      {
        key: "csv 参数化接口测试",
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
        key: "单接口状态码断言",
        label: null,
        options: [
          {
            workflow: { id: "wf_status", name: "单接口状态码断言", version: 2 },
            label: "单接口状态码断言 v2",
          },
        ],
      },
    ]);
  });

  it("keeps blank names grouped under the unnamed workflow key", () => {
    const groups = buildWorkflowPickerGroups([{ id: "wf_empty", name: "   ", version: 1 }]);

    expect(groups[0]).toMatchObject({
      key: "未命名工作流",
      label: null,
      options: [{ label: "    v1" }],
    });
  });
});
