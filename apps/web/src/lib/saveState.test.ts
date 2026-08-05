import { describe, expect, it } from "vitest";
import { buildWorkflowSaveActionState, buildWorkflowSaveState, serializeWorkflowForSaveState } from "./saveState";
import type { WorkflowDocument } from "../types";

describe("saveState", () => {
  const workflow: WorkflowDocument = {
    id: "",
    name: "Draft",
    version: 1,
    nodes: [],
    edges: [],
  };

  it("treats a clean new workflow as a saveable draft", () => {
    const snapshot = serializeWorkflowForSaveState(workflow);

    expect(
      buildWorkflowSaveState({
        workflow,
        cleanWorkflowSnapshot: snapshot,
        selectedWorkflowId: "",
      })
    ).toEqual({
      canSave: true,
      isDirty: false,
      label: "草稿",
      className: "is-draft",
      saveDisabledReason: null,
      shouldSaveBeforeRun: true,
    });
  });

  it("treats legacy and normalized default settings as the same save state", () => {
    const legacyWorkflow: WorkflowDocument = {
      id: "wf_legacy",
      name: "Legacy",
      version: 1,
      nodes: [],
      edges: [],
    };
    const normalizedWorkflow: WorkflowDocument = {
      ...legacyWorkflow,
      settings: {
        timeout_seconds: 600,
        variables: {},
      },
    };
    const snapshot = serializeWorkflowForSaveState(normalizedWorkflow);

    expect(
      buildWorkflowSaveState({
        workflow: legacyWorkflow,
        cleanWorkflowSnapshot: snapshot,
        selectedWorkflowId: "wf_legacy",
      })
    ).toMatchObject({
      canSave: false,
      isDirty: false,
      label: "已保存",
    });
  });

  it("ignores object key insertion order when comparing save state", () => {
    const savedWorkflow: WorkflowDocument = {
      id: "wf_order",
      name: "Order",
      version: 1,
      nodes: [
        {
          id: "node_1",
          type: "utility.transform",
          position: { x: 0, y: 0 },
          config: { first: 1, second: 2 },
        },
      ],
      edges: [],
      settings: {
        timeout_seconds: 600,
        variables: { baseUrl: "https://api.example.com", token: "abc" },
      },
    };
    const reorderedWorkflow: WorkflowDocument = {
      id: "wf_order",
      name: "Order",
      version: 1,
      nodes: [
        {
          id: "node_1",
          type: "utility.transform",
          position: { x: 0, y: 0 },
          config: { second: 2, first: 1 },
        },
      ],
      edges: [],
      settings: {
        variables: { token: "abc", baseUrl: "https://api.example.com" },
        timeout_seconds: 600,
      },
    };
    const snapshot = serializeWorkflowForSaveState(savedWorkflow);

    expect(
      buildWorkflowSaveState({
        workflow: reorderedWorkflow,
        cleanWorkflowSnapshot: snapshot,
        selectedWorkflowId: "wf_order",
      })
    ).toMatchObject({
      canSave: false,
      isDirty: false,
      label: "已保存",
    });
  });

  it("treats changed or copied workflows as unsaved", () => {
    expect(
      buildWorkflowSaveState({
        workflow,
        cleanWorkflowSnapshot: null,
        selectedWorkflowId: "",
      })
    ).toMatchObject({
      canSave: true,
      isDirty: true,
      label: "未保存",
      className: "is-dirty",
      saveDisabledReason: null,
      shouldSaveBeforeRun: true,
    });
  });

  it("prevents saving a clean persisted workflow", () => {
    const snapshot = serializeWorkflowForSaveState(workflow);

    expect(
      buildWorkflowSaveState({
        workflow,
        cleanWorkflowSnapshot: snapshot,
        selectedWorkflowId: "wf_1",
      })
    ).toEqual({
      canSave: false,
      isDirty: false,
      label: "已保存",
      className: "is-saved",
      saveDisabledReason: "当前版本没有未保存变更",
      shouldSaveBeforeRun: false,
    });
  });

  it("builds save action button state from workflow and busy state", () => {
    const draftState = buildWorkflowSaveState({
      workflow,
      cleanWorkflowSnapshot: serializeWorkflowForSaveState(workflow),
      selectedWorkflowId: "",
    });
    const savedState = buildWorkflowSaveState({
      workflow,
      cleanWorkflowSnapshot: serializeWorkflowForSaveState(workflow),
      selectedWorkflowId: "wf_1",
    });

    expect(buildWorkflowSaveActionState(draftState, false)).toEqual({
      disabled: false,
      title: "保存当前工作流",
    });
    expect(buildWorkflowSaveActionState(savedState, false)).toEqual({
      disabled: true,
      title: "当前版本没有未保存变更",
    });
    expect(buildWorkflowSaveActionState(draftState, true)).toEqual({
      disabled: true,
      title: "正在处理，请稍候",
    });
  });
});
