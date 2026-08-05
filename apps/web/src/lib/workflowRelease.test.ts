import { describe, expect, it } from "vitest";
import { buildWorkflowReleaseActionStates } from "./workflowRelease";

function states(overrides: Partial<Parameters<typeof buildWorkflowReleaseActionStates>[0]> = {}) {
  return buildWorkflowReleaseActionStates({
    isApplyingNodeUpgrades: false,
    isEditorLocked: false,
    isWorkflowDirty: false,
    publication: null,
    selectedWorkflowId: "workflow-1",
    ...overrides,
  });
}

describe("buildWorkflowReleaseActionStates", () => {
  it("offers publication and upgrade checks for a clean saved draft", () => {
    expect(states()).toEqual({
      activation: {
        disabled: false,
        label: "发布工作流",
        title: "将当前草稿发布给外部触发器",
      },
      upgrade: {
        disabled: false,
        label: "检查节点升级",
        title: "检查 Python 节点是否有可应用的配置升级",
      },
    });
  });

  it("offers deactivation only when production already matches the draft", () => {
    const current = states({
      publication: {
        workflow_id: "workflow-1",
        draft_version: 3,
        published_version: 3,
        active: true,
        has_unpublished_changes: false,
      },
    });
    expect(current.activation.label).toBe("停用工作流");
    expect(current.activation.title).toBe("停止外部触发器接收新请求");

    const changed = states({
      publication: {
        workflow_id: "workflow-1",
        draft_version: 4,
        published_version: 3,
        active: true,
        has_unpublished_changes: true,
      },
    });
    expect(changed.activation.label).toBe("发布工作流");
  });

  it("explains unsaved, dirty, and busy disabled states in priority order", () => {
    expect(states({ selectedWorkflowId: "", isWorkflowDirty: true, isEditorLocked: true }).activation.title)
      .toBe("请先保存工作流");
    expect(states({ isWorkflowDirty: true, isEditorLocked: true }).activation.title)
      .toBe("请先保存当前修改");
    expect(states({ isEditorLocked: true }).activation.title)
      .toBe("工作流正在处理，请稍候");
    expect(states({ isEditorLocked: true, isApplyingNodeUpgrades: true }).upgrade.title)
      .toBe("正在应用节点升级");
  });
});
