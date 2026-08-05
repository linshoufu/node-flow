import type { WorkflowPublicationStatus } from "../types";

export type WorkflowReleaseActionState = {
  disabled: boolean;
  label: string;
  title: string;
};

type BuildWorkflowReleaseActionStatesOptions = {
  isApplyingNodeUpgrades: boolean;
  isEditorLocked: boolean;
  isWorkflowDirty: boolean;
  publication: WorkflowPublicationStatus | null;
  selectedWorkflowId: string;
};

export function buildWorkflowReleaseActionStates({
  isApplyingNodeUpgrades,
  isEditorLocked,
  isWorkflowDirty,
  publication,
  selectedWorkflowId,
}: BuildWorkflowReleaseActionStatesOptions): {
  activation: WorkflowReleaseActionState;
  upgrade: WorkflowReleaseActionState;
} {
  const productionIsCurrent = Boolean(publication?.active && !publication.has_unpublished_changes);
  const activationLabel = productionIsCurrent ? "停用工作流" : "发布工作流";
  const activationReadyTitle = productionIsCurrent
    ? "停止外部触发器接收新请求"
    : "将当前草稿发布给外部触发器";

  return {
    activation: actionState({
      busy: isEditorLocked,
      dirty: isWorkflowDirty,
      label: activationLabel,
      readyTitle: activationReadyTitle,
      selectedWorkflowId,
    }),
    upgrade: actionState({
      busy: isEditorLocked,
      busyTitle: isApplyingNodeUpgrades ? "正在应用节点升级" : "工作流正在处理，请稍候",
      dirty: isWorkflowDirty,
      label: "检查节点升级",
      readyTitle: "检查 Python 节点是否有可应用的配置升级",
      selectedWorkflowId,
    }),
  };
}

function actionState({
  busy,
  busyTitle = "工作流正在处理，请稍候",
  dirty,
  label,
  readyTitle,
  selectedWorkflowId,
}: {
  busy: boolean;
  busyTitle?: string;
  dirty: boolean;
  label: string;
  readyTitle: string;
  selectedWorkflowId: string;
}): WorkflowReleaseActionState {
  if (!selectedWorkflowId) {
    return { disabled: true, label, title: "请先保存工作流" };
  }
  if (dirty) {
    return { disabled: true, label, title: "请先保存当前修改" };
  }
  if (busy) {
    return { disabled: true, label, title: busyTitle };
  }
  return { disabled: false, label, title: readyTitle };
}
