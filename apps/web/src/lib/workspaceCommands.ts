import type { CommandPaletteCommand } from "./commandPalette";
import type { WorkspaceResourceKind } from "./workspaceResources";

export type WorkspaceCommandState = {
  canCancelRun: boolean;
  canRedo: boolean;
  canUndo: boolean;
  isBusy: boolean;
  isCancelling: boolean;
  isEditorLocked: boolean;
  isNodeTypesReloading: boolean;
  saveAction: {
    disabled: boolean;
    title?: string;
  };
};

export type WorkspaceCommandActions = {
  cancelRun: () => void;
  fitCanvas: () => void;
  newWorkflow: () => void;
  openResource: (kind: WorkspaceResourceKind) => void;
  openWorkflowSettings: () => void;
  redo: () => void;
  reloadNodeTypes: () => void;
  runWorkflow: () => void;
  saveWorkflow: () => void;
  undo: () => void;
  validateWorkflow: () => void;
};

export type WorkspaceCommandContext = {
  actions: WorkspaceCommandActions;
  state: WorkspaceCommandState;
};

export type WorkspaceCommandProvider = (context: WorkspaceCommandContext) => CommandPaletteCommand[];

const RESOURCE_COMMANDS: ReadonlyArray<{
  kind: WorkspaceResourceKind;
  icon: "credentials" | "variables" | "environments" | "packages";
  label: string;
  keywords: string[];
}> = [
  { kind: "credentials", icon: "credentials", label: "打开凭据管理", keywords: ["credentials", "密钥", "认证"] },
  { kind: "variables", icon: "variables", label: "打开项目变量", keywords: ["variables", "参数"] },
  { kind: "environments", icon: "environments", label: "打开运行环境", keywords: ["environment", "环境"] },
  { kind: "packages", icon: "packages", label: "打开节点包管理", keywords: ["package", "插件", "扩展"] },
];

const workflowCommandProvider: WorkspaceCommandProvider = ({ state, actions }) => {
  const busyReason = state.isBusy ? "当前操作完成后可用" : undefined;
  return [
    {
      id: "workflow-new",
      group: "工作流",
      icon: "new",
      label: "新建工作流",
      keywords: ["create", "新增"],
      disabled: state.isBusy,
      disabledReason: busyReason,
      onSelect: actions.newWorkflow,
    },
    {
      id: "workflow-save",
      group: "工作流",
      icon: "save",
      label: "保存工作流",
      keywords: ["save"],
      shortcut: "Ctrl+S",
      disabled: state.saveAction.disabled,
      disabledReason: state.saveAction.disabled ? state.saveAction.title : undefined,
      onSelect: actions.saveWorkflow,
    },
    {
      id: "workflow-validate",
      group: "工作流",
      icon: "validate",
      label: "验证工作流",
      keywords: ["validate", "检查"],
      disabled: state.isBusy,
      disabledReason: busyReason,
      onSelect: actions.validateWorkflow,
    },
    {
      id: "workflow-run",
      group: "工作流",
      icon: "run",
      label: "运行工作流",
      keywords: ["run", "执行"],
      disabled: state.isBusy,
      disabledReason: state.isBusy ? "已有操作或运行正在进行" : undefined,
      onSelect: actions.runWorkflow,
    },
    {
      id: "workflow-cancel",
      group: "工作流",
      icon: "cancel",
      label: "取消当前运行",
      keywords: ["cancel", "停止"],
      disabled: !state.canCancelRun || state.isCancelling,
      disabledReason: state.isCancelling
        ? "正在请求取消"
        : !state.canCancelRun ? "当前没有可取消的运行" : undefined,
      onSelect: actions.cancelRun,
    },
  ];
};

const editorCommandProvider: WorkspaceCommandProvider = ({ state, actions }) => {
  const editorLockedReason = state.isEditorLocked ? "编辑器暂时锁定" : undefined;
  return [
    {
      id: "editor-undo",
      group: "编辑器",
      icon: "undo",
      label: "撤销",
      shortcut: "Ctrl+Z",
      disabled: !state.canUndo,
      disabledReason: !state.canUndo ? editorLockedReason ?? "没有可撤销的操作" : undefined,
      onSelect: actions.undo,
    },
    {
      id: "editor-redo",
      group: "编辑器",
      icon: "redo",
      label: "重做",
      shortcut: "Ctrl+Y",
      disabled: !state.canRedo,
      disabledReason: !state.canRedo ? editorLockedReason ?? "没有可重做的操作" : undefined,
      onSelect: actions.redo,
    },
    {
      id: "editor-fit",
      group: "编辑器",
      icon: "fit",
      label: "适应画布",
      keywords: ["fit", "居中", "缩放"],
      onSelect: actions.fitCanvas,
    },
    {
      id: "editor-refresh-nodes",
      group: "编辑器",
      icon: "refresh",
      label: "刷新节点库",
      keywords: ["reload", "Python", "脚本"],
      disabled: state.isNodeTypesReloading,
      disabledReason: state.isNodeTypesReloading ? "正在刷新节点库" : undefined,
      onSelect: actions.reloadNodeTypes,
    },
  ];
};

const settingsCommandProvider: WorkspaceCommandProvider = ({ state, actions }) => [
  {
    id: "settings-workflow",
    group: "设置",
    icon: "settings",
    label: "打开工作流设置",
    keywords: ["settings", "超时", "并发", "变量"],
    disabled: state.isEditorLocked,
    disabledReason: state.isEditorLocked ? "编辑器暂时锁定" : undefined,
    onSelect: actions.openWorkflowSettings,
  },
];

const resourceCommandProvider: WorkspaceCommandProvider = ({ state, actions }) =>
  RESOURCE_COMMANDS.map((resource) => ({
    id: `resource-${resource.kind}`,
    group: "资源",
    icon: resource.icon,
    label: resource.label,
    keywords: resource.keywords,
    disabled: state.isEditorLocked,
    disabledReason: state.isEditorLocked ? "编辑器暂时锁定" : undefined,
    onSelect: () => actions.openResource(resource.kind),
  }));

export const DEFAULT_WORKSPACE_COMMAND_PROVIDERS: readonly WorkspaceCommandProvider[] = [
  workflowCommandProvider,
  editorCommandProvider,
  settingsCommandProvider,
  resourceCommandProvider,
];

export function buildWorkspaceCommands(
  state: WorkspaceCommandState,
  actions: WorkspaceCommandActions,
  providers: readonly WorkspaceCommandProvider[] = DEFAULT_WORKSPACE_COMMAND_PROVIDERS,
): CommandPaletteCommand[] {
  const context = { actions, state };
  return providers.flatMap((provider) => provider(context));
}
