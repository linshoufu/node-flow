import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiClient } from "./api/client";
import { AppLoadingSkeleton } from "./components/AppLoadingSkeleton";
import { CanvasEmptyState, type CanvasTemplateCard } from "./components/CanvasEmptyState";
import { CommandPalette } from "./components/CommandPalette";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { FlowCanvas } from "./components/FlowCanvas";
import { ManualRunDialog } from "./components/ManualRunDialog";
import { nodePackageAttentionCount } from "./lib/nodePackageDisplay";
import { NodePalette } from "./components/NodePalette";
import { RunDrawer } from "./components/RunDrawer";
import { RunPanel } from "./components/RunPanel";
import { StatusNotifications } from "./components/StatusNotifications";
import { ThemeToggle } from "./components/ThemeToggle";
import { WorkflowIssuePanel } from "./components/WorkflowIssuePanel";
import { WorkflowConflictDialog } from "./components/WorkflowConflictDialog";
import { WorkflowSettingsMenu } from "./components/WorkflowSettingsMenu";
import { WorkflowTopbar } from "./components/WorkflowTopbar";
import { WorkflowWorkbenchLayout } from "./components/WorkflowWorkbenchLayout";
import {
  WorkspaceResourceMenu,
} from "./components/WorkspaceResourceMenu";
import {
  LazyConfigPanel,
  LazyNodePackageAttentionNotice,
  LazyWorkflowManager,
  LazyWorkspaceResourcePage,
} from "./lazyComponents";
import { useWorkspaceResources } from "./hooks/useWorkspaceResources";
import { useCommandPaletteController } from "./hooks/useCommandPaletteController";
import { useConfirmDialog } from "./hooks/useConfirmDialog";
import { useStatusNotifications } from "./hooks/useStatusNotifications";
import { useWorkflowCatalogController } from "./hooks/useWorkflowCatalogController";
import { useCanvasOperations } from "./hooks/useCanvasOperations";
import { useNodeCatalogController } from "./hooks/useNodeCatalogController";
import { useRunInspectorController } from "./hooks/useRunInspectorController";
import { useHistoricalRunActions } from "./hooks/useHistoricalRunActions";
import { useWorkflowSettingsController } from "./hooks/useWorkflowSettingsController";
import { useWorkflowVersionActions } from "./hooks/useWorkflowVersionActions";
import { useWorkflowAutoSaveController } from "./hooks/useWorkflowAutoSaveController";
import { useWorkflowDocumentController } from "./hooks/useWorkflowDocumentController";
import { useWorkflowExecutionController } from "./hooks/useWorkflowExecutionController";
import { useWorkflowLifecycleController } from "./hooks/useWorkflowLifecycleController";
import { useWorkflowMutationController } from "./hooks/useWorkflowMutationController";
import {
  useWorkflowNavigationActions,
  type WorkflowNavigationActions,
  type WorkflowNavigationDocumentRequest,
} from "./hooks/useWorkflowNavigationActions";
import { useWorkflowPersistenceActions } from "./hooks/useWorkflowPersistenceActions";
import { useWorkflowConflictController } from "./hooks/useWorkflowConflictController";
import { useWorkflowConflictRecoveryActions } from "./hooks/useWorkflowConflictRecoveryActions";
import { useWebhookTestListenerController } from "./hooks/useWebhookTestListenerController";
import { useWorkflowValidationController } from "./hooks/useWorkflowValidationController";
import { useWorkflowTransferActions } from "./hooks/useWorkflowTransferActions";
import { useWorkbenchNavigationController } from "./hooks/useWorkbenchNavigationController";
import { useWorkflowRouteController } from "./hooks/useWorkflowRouteController";
import { useWorkflowRunHistory } from "./hooks/useWorkflowRunHistory";
import { useWorkflowReleaseActions } from "./hooks/useWorkflowReleaseActions";
import { useWorkflowRunActions } from "./hooks/useWorkflowRunActions";
import { formatApiError as formatError } from "./lib/apiError";
import { buildWorkspaceCommands } from "./lib/workspaceCommands";
import { resourceRouteSectionForKind } from "./lib/workspaceResources";
import type { ResourceRouteSection, WorkflowRoute } from "./lib/workflowRoute";
import {
  createEmptyWorkflow,
  getEditableWorkflow,
  scopeKey,
  scopeLabel,
  workflowErrorWorkflowId,
  workflowEnvironmentId,
  workflowVariables,
} from "./lib/workflow";
import { localizeNodeType } from "./lib/display";
import { buildExpressionReferences } from "./lib/expressionReferences";
import { buildEdgeRepairCandidates } from "./lib/edgeRepairCandidates";
import { buildNodeDisplayNames } from "./lib/nodeDisplayNames";
import {
  nodeRuntimeSourceLabel,
  type NodeRuntimeNavigationSource,
  type NodeRuntimeNavigationTarget,
} from "./lib/nodeRuntimeNavigation";
import { buildPreRunIssues, isSettingsPreRunIssue } from "./lib/preRunChecks";
import { buildRunInspector } from "./lib/runInspector";
import {
  canCancelRunView,
  isHistoricalRunView,
} from "./lib/runView";
import { buildWorkflowSaveActionState } from "./lib/saveState";
import { buildWorkflowReleaseActionStates } from "./lib/workflowRelease";
import { buildWorkflowVariableIssues } from "./lib/workflowVariables";
import { WORKFLOW_TEMPLATES, createWorkflowFromTemplate, templateAvailability } from "./lib/workflowTemplates";
import { formatNodeUpgradeDetails, formatNodeUpgradeSummary } from "./lib/nodeVersionUpgrades";
import { initialRunDrawerState, reduceRunDrawer } from "./lib/workbenchLayout";
import { manualRunUnavailableReason } from "./lib/manualRun";
import type { WorkflowHistoryEntry } from "./lib/workflowHistory";
import {
  preRunIssuesToWorkflowIssues,
  validationIssuesToWorkflowIssues,
  type WorkflowIssueItem,
} from "./lib/workflowIssues";
import {
  buildEdgeIssuesByEdgeId,
  buildNodeIssuesByNodeId,
  isIssuePathInCurrentEditScope,
  isRunSelectionInCurrentEditScope,
} from "./lib/workflowIssueScopes";
import { resolveWorkflowIssueSelection } from "./lib/workflowIssueSelection";
import type { WorkflowDocument } from "./types";

const RUN_POLL_INTERVAL_MS = 1000;
const MAX_RUN_POLL_ATTEMPTS = 120;
const AUTO_SAVE_STORAGE_KEY = "node-flow:auto-save-enabled";
// 命中该模式的画布消息（删除连线）会附带“撤销删除”操作按钮
const EDGE_UNDO_MESSAGE_PATTERN = /已删除.*连线/;

type VisiblePreRunIssueMode = "none" | "all" | "settings";

/**
 * ConfigPanel 懒加载占位：复用真实面板的 panel/config-panel 容器类名，
 * 保持同尺寸骨架，避免 chunk 加载期间右侧插槽布局跳动与闪白。
 */
function ConfigPanelFallback() {
  return (
    <aside aria-label="配置面板加载中" className="panel config-panel lazy-panel-skeleton" role="status">
      <div className="app-skeleton-bar app-skeleton-heading" />
      <div className="app-skeleton-bar app-skeleton-line-long" />
      <div className="app-skeleton-bar app-skeleton-line-short" />
      <div className="app-skeleton-bar app-skeleton-line-long" />
      <div className="app-skeleton-bar app-skeleton-line-short" />
    </aside>
  );
}

/**
 * WorkflowManager 懒加载占位：复用触发按钮类名保持同尺寸，
 * 避免顶栏按钮位在 chunk 加载期间塌陷。
 */
function WorkflowManagerFallback() {
  return (
    <button className="workflow-manager-trigger" disabled type="button">
      工作流加载中
    </button>
  );
}

type WorkflowSettingsFocusRequest = {
  field?: string;
  key: number;
};
export default function App() {
  const {
    dismiss: dismissStatusNotification,
    notifications: statusNotifications,
    push: pushStatusNotification,
  } = useStatusNotifications();
  // 兼容既有 onMessage 调用点：状态消息统一进入通知队列，tone 由文案关键词判定
  const setMessage = useCallback((text: string) => {
    pushStatusNotification(text);
  }, [pushStatusNotification]);
  // 节点目录首次加载完成前，画布与节点库以骨架屏占位（替代原先的加载 toast）
  const [isInitialCatalogReady, setIsInitialCatalogReady] = useState(false);
  const handleNodeCatalogMessage = useCallback((text: string) => {
    setIsInitialCatalogReady(true);
    pushStatusNotification(text);
  }, [pushStatusNotification]);
  // 统一确认弹窗服务：替换节点包与丢弃未保存修改等场景的原生 window.confirm
  const confirmDialog = useConfirmDialog();
  const confirmNodeCatalogAction = useCallback(
    (message: string) => confirmDialog.confirm({
      confirmLabel: "执行操作",
      danger: true,
      description: message,
      title: "节点包操作确认",
    }),
    [confirmDialog.confirm],
  );
  const nodeCatalogController = useNodeCatalogController({
    confirmAction: confirmNodeCatalogAction,
    onMessage: handleNodeCatalogMessage,
  });
  const { isNodeTypesReloading, nodePackageScan, nodeTypes, reloadNodeTypes } = nodeCatalogController;
  const {
    catalogError: workflowCatalogError,
    isSelectedWorkflowCurrent: isSelectedWorkflowStillCurrent,
    publication: workflowPublication,
    refreshCatalog: refreshWorkflowCatalog,
    selectedWorkflowId,
    selectWorkflow: updateSelectedWorkflowId,
    upsertWorkflowSummary,
    workflows,
  } = useWorkflowCatalogController();
  const [initialWorkflow] = useState<WorkflowDocument>(() => createEmptyWorkflow());
  const {
    acceptSavedWorkflow,
    canRedo: hasRedoWorkflowChange,
    canUndo: hasUndoWorkflowChange,
    commitChange: commitDocumentChange,
    redo: redoDocumentChange,
    replaceWorkflow,
    revision: workflowRevision,
    saveState: workflowSaveState,
    setHistoryGroupActive: setWorkflowHistoryGroupActive,
    undo: undoDocumentChange,
    workflow,
  } = useWorkflowDocumentController({ initialWorkflow, selectedWorkflowId });
  const {
    clearVersionDiff: clearWorkflowVersionDiff,
    compareVersion: loadWorkflowVersionDiff,
    isTriggersLoading: isWorkflowTriggersLoading,
    isTriggersOpen: isWorkflowTriggersOpen,
    isVersionDiffLoading: isWorkflowVersionDiffLoading,
    isVersionsLoading: isWorkflowVersionsLoading,
    isVersionsOpen: isWorkflowVersionsOpen,
    refreshVersions: loadWorkflowVersions,
    rollbackTargetVersion,
    setRollbackTargetVersion,
    toggleTriggers: toggleWorkflowTriggersPanel,
    toggleVersions: toggleWorkflowVersionsPanel,
    triggers: workflowTriggers,
    triggersError: workflowTriggersError,
    versionDiff: workflowVersionDiff,
    versionDiffError: workflowVersionDiffError,
    versions: workflowVersions,
    versionsError: workflowVersionsError,
  } = useWorkflowLifecycleController({
    currentWorkflow: workflow,
    workflowId: selectedWorkflowId,
  });
  const {
    activeOperation: workflowMutationOperation,
    activeSaveMode: workflowSaveMode,
    applyNodeUpgrades: applyNodeUpgradePreview,
    dismissUpgradePreview: dismissNodeUpgradePreview,
    isMutating: isWorkflowMutating,
    previewNodeUpgrades: loadNodeUpgradePreview,
    restoreVersion: restoreWorkflowDocumentVersion,
    rollbackVersion: rollbackWorkflowDocumentVersion,
    saveWorkflow: commitWorkflowSave,
    updateActivation: mutateWorkflowActivation,
    upgradePreview: nodeUpgradePreview,
  } = useWorkflowMutationController({ documentId: workflow.id });
  const {
    clearEdgeFocus,
    configPanelTabRequest,
    edgeFocusRequest,
    editScope,
    enterSubflow,
    fitRequestKey,
    focusEdge,
    openRuntimeSelection,
    requestCanvasFit,
    resetForDocument: resetWorkbenchForDocument,
    restoreHistorySelection,
    returnToMain,
    runtimeNavigationScope,
    runtimeNavigationSource,
    selectedNodeId,
    selectedNodeIds,
    selectNodeForPanel,
  } = useWorkbenchNavigationController();
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(readAutoSavePreference);
  const workspaceResources = useWorkspaceResources({ onMessage: setMessage });
  const {
    credentialTypes,
    credentials,
    projectEnvironments,
    projectVariables,
  } = workspaceResources;
  // 资源页面当前分区：非空时表示处于 /resources/{section} 路由页面
  const [resourceSection, setResourceSection] = useState<ResourceRouteSection | null>(null);
  // 编辑器分区附带的节点类型 ID（仅 /resources/editor/{nodeTypeId} 时有效）
  const [resourceNodeTypeId, setResourceNodeTypeId] = useState<string | undefined>(undefined);
  const [isPageBusy, setIsBusy] = useState(false);
  const isAutoSavingMutation =
    workflowMutationOperation === "save" && workflowSaveMode === "auto";
  const [isManualRunDialogOpen, setIsManualRunDialogOpen] = useState(false);
  const isApplyingNodeUpgrades = workflowMutationOperation === "apply_upgrades";
  const {
    beginCancelOperation,
    beginRunOperation,
    finishOperation,
    hasActiveOperation,
    isCancelling,
    isOperationActive: isActiveRun,
    queueStatus: runQueueStatus,
    resetRunState: resetExecutionState,
    runView,
    showHistoricalRun,
    trackCurrentRun,
  } = useWorkflowExecutionController();
  const [runDrawerState, setRunDrawerState] = useState(() => initialRunDrawerState);
  const [isCanvasFocusMode, setIsCanvasFocusMode] = useState(false);

  useEffect(() => {
    if (!isCanvasFocusMode) {
      return;
    }
    const handleFocusModeShortcut = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      setIsCanvasFocusMode(false);
    };
    window.addEventListener("keydown", handleFocusModeShortcut);
    return () => window.removeEventListener("keydown", handleFocusModeShortcut);
  }, [isCanvasFocusMode]);
  const {
    changeStatusFilter: changeRunHistoryStatusFilter,
    error: workflowRunHistoryError,
    hasMore: hasMoreWorkflowRuns,
    isLoading: isWorkflowRunHistoryLoading,
    loadMore: loadMoreWorkflowRunHistory,
    retry: retryWorkflowRunHistory,
    runs: selectedWorkflowRuns,
    statusFilter: runHistoryStatusFilter,
  } = useWorkflowRunHistory({ workflowId: selectedWorkflowId });
  const {
    clearHistoricalRunWorkflow,
    comparisonError,
    comparisonEvents,
    comparisonRun,
    historicalRunWorkflow,
    isComparisonLoading,
    isHistoricalRunLoading,
    loadComparisonRun,
    loadHistoricalRun,
    resetRunInspector,
  } = useRunInspectorController({
    currentWorkflow: workflow,
    recentRuns: selectedWorkflowRuns,
  });
  const isBusy = isPageBusy || isWorkflowMutating || isHistoricalRunLoading;
  const [visiblePreRunIssueMode, setVisiblePreRunIssueMode] = useState<VisiblePreRunIssueMode>("none");
  const {
    clearValidationIssues,
    issueItems: validationIssueItems,
    validateWorkflow,
  } = useWorkflowValidationController({
    blocked: isBusy,
    documentKey: `${workflow.id}:${workflowRevision}`,
    onBusyChange: setIsBusy,
    onMessage: setMessage,
    workflow,
  });
  const [isWorkflowSettingsOpen, setIsWorkflowSettingsOpen] = useState(false);
  const closeWorkflowSettingsForCommandPalette = useCallback(() => {
    setIsWorkflowSettingsOpen(false);
  }, []);
  const {
    closeCommandPalette,
    isCommandPaletteOpen,
    openCommandPalette,
  } = useCommandPaletteController({
    blocked: isManualRunDialogOpen,
    onBeforeOpen: closeWorkflowSettingsForCommandPalette,
  });
  const [workflowSettingsFocusRequest, setWorkflowSettingsFocusRequest] =
    useState<WorkflowSettingsFocusRequest | null>(null);
  // 设置弹层输入框注册版本号：懒加载输入框挂载后递增，用于重试待处理的聚焦请求
  const [workflowSettingsInputRegistrationKey, setWorkflowSettingsInputRegistrationKey] = useState(0);
  const isRollingBackWorkflowVersion = workflowMutationOperation === "rollback";
  const mountedRef = useRef(true);
  const workflowTimeoutInputRef = useRef<HTMLInputElement>(null);
  const workflowConcurrencyInputRef = useRef<HTMLInputElement>(null);
  const workflowVariableNameRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const workflowNavigationActionsRef = useRef<WorkflowNavigationActions | null>(null);
  const workflowRouteController = useWorkflowRouteController({
    onRouteRequested: async (route, source) => {
      // 资源页面路由不加载工作流，直接接受并记录分区
      if (route.kind === "resources") {
        setResourceSection(route.section);
        setResourceNodeTypeId(route.nodeTypeId);
        return route;
      }
      const acceptedRoute = await (
        workflowNavigationActionsRef.current?.handleRouteRequest(route, source) ?? null
      );
      if (acceptedRoute) {
        setResourceSection(null);
        setResourceNodeTypeId(undefined);
      }
      return acceptedRoute;
    },
  });
  // 统一路由导航入口：同步资源页分区状态，保证从资源页离开时页面即时切回工作区
  const navigateWorkflowRoute = useCallback((
    route: WorkflowRoute,
    options?: { replace?: boolean },
  ) => {
    if (route.kind === "resources") {
      setResourceSection(route.section);
      setResourceNodeTypeId(route.nodeTypeId);
    } else {
      setResourceSection(null);
      setResourceNodeTypeId(undefined);
    }
    workflowRouteController.navigate(route, options);
  }, [workflowRouteController.navigate]);
  const {
    clearWorkflowConflict,
    closeWorkflowConflict,
    conflict: workflowConflict,
    isOpen: isWorkflowConflictOpen,
    openWorkflowConflict,
    reopenWorkflowConflict,
  } = useWorkflowConflictController({
    documentId: workflow.id,
    onMessage: setMessage,
  });

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (workflowCatalogError) {
      setMessage(workflowCatalogError);
    }
  }, [workflowCatalogError]);
  const displayNodeTypes = useMemo(() => nodeTypes.map(localizeNodeType), [nodeTypes]);
  const templateCards = useMemo<CanvasTemplateCard[]>(
    () =>
      WORKFLOW_TEMPLATES.map((template) => {
        const availability = templateAvailability(template);
        return {
          category: template.category,
          id: template.id,
          name: template.name,
          description: template.description,
          tags: template.tags,
          nodeCount: template.nodeCount,
          available: availability.available,
          unavailableReason: availability.reason,
        };
      }),
    []
  );
  const editableWorkflow = useMemo(() => getEditableWorkflow(workflow, editScope), [editScope, workflow]);
  const editScopeKey = useMemo(() => scopeKey(editScope), [editScope]);
  const editScopeLabel = useMemo(
    () => scopeLabel(workflow, editScope, displayNodeTypes),
    [displayNodeTypes, editScope, workflow]
  );
  const canvasWorkflow = useMemo(
    () => ({
      ...workflow,
      nodes: editableWorkflow.nodes,
      edges: editableWorkflow.edges,
      annotations: editableWorkflow.annotations ?? [],
    }),
    [editableWorkflow.annotations, editableWorkflow.edges, editableWorkflow.nodes, workflow]
  );
  const runDisplayWorkflow = useMemo(
    () =>
      isHistoricalRunView(runView) && historicalRunWorkflow
        ? getEditableWorkflow(historicalRunWorkflow, editScope)
        : editableWorkflow,
    [editScope, editableWorkflow, historicalRunWorkflow, runView]
  );
  const nodeDisplayNames = useMemo(
    () => buildNodeDisplayNames(runDisplayWorkflow, displayNodeTypes),
    [displayNodeTypes, runDisplayWorkflow]
  );
  const nodeTypesByRunNodeId = useMemo(() => {
    const nodeTypesByTypeId = new Map(displayNodeTypes.map((nodeType) => [nodeType.id, nodeType]));

    return Object.fromEntries(
      runDisplayWorkflow.nodes.flatMap((node) => {
        const nodeType = nodeTypesByTypeId.get(node.type);
        return nodeType ? [[node.id, nodeType] as const] : [];
      })
    );
  }, [displayNodeTypes, runDisplayWorkflow.nodes]);
  const selectedNode = editableWorkflow.nodes.find((node) => node.id === selectedNodeId);
  const selectedNodeType = useMemo(
    () => displayNodeTypes.find((nodeType) => nodeType.id === selectedNode?.type),
    [displayNodeTypes, selectedNode?.type]
  );
  const selectedNodeConnectedOutputHandles = useMemo(
    () =>
      selectedNode
        ? [...new Set(editableWorkflow.edges.filter((edge) => edge.source === selectedNode.id).map((edge) => edge.sourceHandle))]
        : [],
    [editableWorkflow.edges, selectedNode]
  );
  const selectedNodeConnectedInputHandles = useMemo(
    () =>
      selectedNode
        ? [...new Set(editableWorkflow.edges.filter((edge) => edge.target === selectedNode.id).map((edge) => edge.targetHandle))]
        : [],
    [editableWorkflow.edges, selectedNode]
  );
  const runFromNodeUnavailableReason = useMemo(
    () => (editScope?.length ? undefined : manualRunUnavailableReason(selectedNode, selectedNodeType, editableWorkflow)),
    [editScope, editableWorkflow, selectedNode, selectedNodeType]
  );
  const run = runView.run;
  const runEvents = runView.events;

  useEffect(() => {
    setRunDrawerState((currentState) =>
      reduceRunDrawer(currentState, {
        type: "run-updated",
        status: run?.status ?? null,
        hasError: Boolean(run?.error),
      })
    );
  }, [run?.error, run?.status]);
  const runDisplayNodeIdsKey = runDisplayWorkflow.nodes.map((node) => node.id).join("\u0000");
  const runDisplayNodeIds = useMemo(
    () => (runDisplayNodeIdsKey ? runDisplayNodeIdsKey.split("\u0000") : []),
    [runDisplayNodeIdsKey]
  );
  const isHistoricalRun = isHistoricalRunView(runView);
  const runInspector = useMemo(
    () =>
      buildRunInspector({
        run,
        events: runEvents,
        isHistoricalRun,
        nodeIds: runDisplayNodeIds,
        selectedNodeId,
      }),
    [isHistoricalRun, run, runDisplayNodeIds, runEvents, selectedNodeId]
  );
  const nodeRunStates = runInspector.nodeRunStates;
  const selectedRuntimeState = runInspector.selectedRuntimeState;
  const selectedRunDetail = runInspector.selectedNodeRunDetail ?? undefined;
  const nodeRunDetails = runInspector.nodeRunDetails;
  const currentPreRunIssues = useMemo(() => buildPreRunIssues(workflow, displayNodeTypes), [displayNodeTypes, workflow]);
  const nodeUpgradeReviewItems = useMemo(
    () =>
      (nodeUpgradePreview?.upgrades ?? []).map((upgrade) => ({
        details: formatNodeUpgradeDetails(upgrade),
        path: upgrade.path,
        summary: formatNodeUpgradeSummary([upgrade], displayNodeTypes)[0],
      })),
    [displayNodeTypes, nodeUpgradePreview]
  );
  const visiblePreRunIssues = useMemo(() => {
    if (visiblePreRunIssueMode === "all") {
      return currentPreRunIssues;
    }
    if (visiblePreRunIssueMode === "settings") {
      return currentPreRunIssues.filter(isSettingsPreRunIssue);
    }
    return [];
  }, [currentPreRunIssues, visiblePreRunIssueMode]);
  const visiblePreRunWorkflowIssues = useMemo(
    () => preRunIssuesToWorkflowIssues(visiblePreRunIssues),
    [visiblePreRunIssues]
  );
  const validationWorkflowIssues = useMemo(
    () => validationIssuesToWorkflowIssues(validationIssueItems),
    [validationIssueItems]
  );
  const workflowIssues = useMemo(
    () => [...validationWorkflowIssues, ...visiblePreRunWorkflowIssues],
    [validationWorkflowIssues, visiblePreRunWorkflowIssues]
  );
  const nodeIssuesByEditableNodeId = useMemo(
    () => buildNodeIssuesByNodeId(workflowIssues, editableWorkflow.nodes, editScope),
    [editScope, editableWorkflow.nodes, workflowIssues]
  );
  const edgeIssuesByEditableEdgeId = useMemo(
    () => buildEdgeIssuesByEdgeId(workflowIssues, editableWorkflow.edges, editScope),
    [editScope, editableWorkflow.edges, workflowIssues]
  );
  const edgeRepairCandidatesByEditableEdgeId = useMemo(
    () =>
      Object.fromEntries(
        editableWorkflow.edges
          .filter((edge) => edgeIssuesByEditableEdgeId[edge.id]?.length)
          .map((edge) => [edge.id, buildEdgeRepairCandidates(edge, canvasWorkflow, displayNodeTypes)] as const)
      ),
    [canvasWorkflow, displayNodeTypes, edgeIssuesByEditableEdgeId, editableWorkflow.edges]
  );
  const expressionReferences = useMemo(
    () =>
      buildExpressionReferences({
        workflow,
        nodeTypes: displayNodeTypes,
        editScope,
        runEvents,
        nodeRunStates,
        projectVariables: Object.fromEntries(projectVariables.map((variable) => [variable.name, variable.value])),
      }),
    [displayNodeTypes, editScope, nodeRunStates, projectVariables, runEvents, workflow]
  );
  const canCancelRun = canCancelRunView(runView);
  const workflowVariableIssues = useMemo(() => buildWorkflowVariableIssues(workflowVariables(workflow)), [workflow]);
  const hasWorkflowVariableIssues = workflowVariableIssues.length > 0;
  const isWorkflowDirty = workflowSaveState.isDirty;
  const isEditorLocked =
    isPageBusy
    || isHistoricalRunLoading
    || isCancelling
    || (isWorkflowMutating && !isAutoSavingMutation);
  const {
    isChanging: isWebhookTestListenerChanging,
    listener: webhookTestListener,
    startListening: startWebhookTestListener,
    stopListening: stopWebhookTestListener,
  } = useWebhookTestListenerController({
    isEditorLocked,
    onMessage: setMessage,
    pollIntervalMs: RUN_POLL_INTERVAL_MS,
    workflowId: selectedWorkflowId,
  });
  const workflowReleaseActionStates = useMemo(() => buildWorkflowReleaseActionStates({
    isApplyingNodeUpgrades,
    isEditorLocked,
    isWorkflowDirty,
    publication: workflowPublication,
    selectedWorkflowId,
  }), [
    isApplyingNodeUpgrades,
    isEditorLocked,
    isWorkflowDirty,
    selectedWorkflowId,
    workflowPublication,
  ]);
  const clearWorkflowIssues = useCallback(() => {
    setVisiblePreRunIssueMode("none");
    clearValidationIssues();
  }, [clearValidationIssues]);
  const commitWorkflowChange = useCallback((
    updater: (current: WorkflowDocument) => WorkflowDocument,
  ) => {
    if (isEditorLocked) {
      return;
    }
    commitDocumentChange(updater, { editScope, selectedNodeId });
  }, [commitDocumentChange, editScope, isEditorLocked, selectedNodeId]);
  const {
    addWorkflowTag,
    addWorkflowVariable,
    removeWorkflowTag,
    removeWorkflowVariable,
    renameWorkflowVariable,
    setWorkflowTagInput,
    updateErrorWorkflow,
    updateWorkflowDescription,
    updateWorkflowEnvironment,
    updateWorkflowMaxConcurrentRuns,
    updateWorkflowName,
    updateWorkflowTimeoutSeconds,
    updateWorkflowVariableValue,
    workflowTagInput,
  } = useWorkflowSettingsController({
    commitWorkflowChange,
    isEditorLocked,
    workflowId: workflow.id,
  });
  const {
    compareWorkflowVersion,
    restoreWorkflowVersion,
    rollbackWorkflowVersion,
    toggleWorkflowTriggers,
    toggleWorkflowVersions,
  } = useWorkflowVersionActions({
    clearVersionDiff: clearWorkflowVersionDiff,
    compareVersion: loadWorkflowVersionDiff,
    currentWorkflow: workflow,
    isEditorLocked,
    isRollingBack: isRollingBackWorkflowVersion,
    isWorkflowCurrent: isSelectedWorkflowStillCurrent,
    isWorkflowDirty,
    onConflict: openWorkflowConflict,
    onMessage: setMessage,
    refreshVersions: loadWorkflowVersions,
    replaceWorkflow,
    restoreVersion: restoreWorkflowDocumentVersion,
    rollbackVersion: rollbackWorkflowDocumentVersion,
    selectedWorkflowId,
    selectWorkflow: updateSelectedWorkflowId,
    setRollbackTargetVersion,
    toggleTriggersPanel: toggleWorkflowTriggersPanel,
    toggleVersionsPanel: toggleWorkflowVersionsPanel,
    upsertWorkflowSummary,
  });
  const {
    applyWorkflowNodeUpgrades: applyNodeUpgrades,
    previewWorkflowNodeUpgrades: previewNodeUpgrades,
    updateWorkflowActivation,
  } = useWorkflowReleaseActions({
    acceptSavedWorkflow,
    applyNodeUpgrades: applyNodeUpgradePreview,
    clearWorkflowIssues,
    currentWorkflow: workflow,
    isEditorLocked,
    isWorkflowCurrent: isSelectedWorkflowStillCurrent,
    isWorkflowDirty,
    nodeUpgradePreview,
    onConflict: openWorkflowConflict,
    onMessage: setMessage,
    previewNodeUpgrades: loadNodeUpgradePreview,
    publication: workflowPublication,
    replaceWorkflow,
    selectedWorkflowId,
    selectWorkflow: updateSelectedWorkflowId,
    updateActivation: mutateWorkflowActivation,
    upsertWorkflowSummary,
  });
  // 连线删除通知的“撤销删除”操作由 useCanvasOperations 提供，先用 ref 打破循环依赖
  const undoDeletedEdgesRef = useRef<() => void>(() => {});
  const edgeUndoNotificationIdRef = useRef<string | null>(null);
  const handleCanvasMessage = useCallback((text: string) => {
    if (!EDGE_UNDO_MESSAGE_PATTERN.test(text)) {
      pushStatusNotification(text);
      return;
    }
    // 已有旧的删除连线通知时先丢弃，保证同一时间只保留一个撤销入口
    if (edgeUndoNotificationIdRef.current !== null) {
      dismissStatusNotification(edgeUndoNotificationIdRef.current);
    }
    edgeUndoNotificationIdRef.current = pushStatusNotification(text, {
      action: {
        label: "撤销删除",
        onClick: () => undoDeletedEdgesRef.current(),
      },
    });
  }, [dismissStatusNotification, pushStatusNotification]);
  const {
    addCanvasAnnotation,
    addNode,
    addNodeAt,
    canUndoDeletedEdges,
    clearDeletedEdgesUndo,
    copySelectedNodes,
    duplicateSelectedNodes,
    hasNodeClipboard,
    pasteCopiedNodes,
    removeNodeConfig,
    removeWorkflowEdge,
    removeWorkflowEdges,
    repairWorkflowEdgeTarget,
    undoDeletedEdges,
    updateCurrentEditableWorkflow,
    updateNodeConfig,
    updateNodeDisabled,
    updateNodeFailurePolicy,
    updateNodeLabel,
    updateNodeNotes,
    updateNodePinnedData,
  } = useCanvasOperations({
    clearValidationIssues,
    commitWorkflowChange,
    documentKey: `${workflow.id}:${workflowRevision}:${editScopeKey}`,
    editableWorkflow,
    editScope,
    isEditorLocked,
    onMessage: handleCanvasMessage,
    selectNode: selectNodeForPanel,
  });

  useEffect(() => {
    undoDeletedEdgesRef.current = undoDeletedEdges;
  }, [undoDeletedEdges]);

  useEffect(() => {
    // 撤销栈被清空（已撤销、切换文档或被其他操作清除）时，移除附带“撤销删除”的通知
    if (canUndoDeletedEdges || edgeUndoNotificationIdRef.current === null) {
      return;
    }
    dismissStatusNotification(edgeUndoNotificationIdRef.current);
    edgeUndoNotificationIdRef.current = null;
  }, [canUndoDeletedEdges, dismissStatusNotification]);
  const navigateToSavedWorkflow = useCallback((workflowId: string) => {
    navigateWorkflowRoute({ kind: "workflow", workflowId });
  }, [navigateWorkflowRoute]);
  // 进入资源页面指定分区（顶栏菜单 / 命令面板 / 快捷入口共用）
  const openResourceSection = useCallback((section: ResourceRouteSection, nodeTypeId?: string) => {
    navigateWorkflowRoute({ kind: "resources", section, nodeTypeId });
  }, [navigateWorkflowRoute]);
  // 从资源页面返回当前选中工作流（无选中时回到新建工作流）
  const leaveResourcePage = useCallback(() => {
    navigateWorkflowRoute(
      selectedWorkflowId
        ? { kind: "workflow", workflowId: selectedWorkflowId }
        : { kind: "new" },
    );
  }, [navigateWorkflowRoute, selectedWorkflowId]);
  const showSettingsSaveIssues = useCallback(() => {
    setVisiblePreRunIssueMode("settings");
  }, []);
  const { saveWorkflow, saveWorkflowAutomatically } = useWorkflowPersistenceActions({
    acceptSavedWorkflow,
    commitWorkflowSave,
    currentPreRunIssues,
    isWorkflowDirty,
    onClearIssues: clearWorkflowIssues,
    onConflict: openWorkflowConflict,
    onMessage: setMessage,
    onNavigateToWorkflow: navigateToSavedWorkflow,
    onShowSettingsIssues: showSettingsSaveIssues,
    selectedWorkflowId,
    selectWorkflow: updateSelectedWorkflowId,
    upsertWorkflowSummary,
    workflow,
    workflowRevision,
  });
  const {
    clearHistoricalRunView,
    openHistoricalRun,
    openParentRun,
    selectHistoricalRunForComparison,
  } = useHistoricalRunActions({
    currentWorkflow: workflow,
    editScopeActive: Boolean(editScope?.length),
    loadComparisonRun,
    loadHistoricalRun,
    navigate: navigateWorkflowRoute,
    onClearPreRunIssues: () => setVisiblePreRunIssueMode("none"),
    onExpandRunDrawer: (manuallyPinned) =>
      setRunDrawerState({ expanded: true, manuallyPinned }),
    onMessage: setMessage,
    onResetRunState: resetRunState,
    onSelectNode: (nodeId, tab) => selectNodeForPanel(nodeId, tab),
    selectedNodeId,
    selectedWorkflowId,
    showHistoricalRun,
  });
  const { cancelRun, retryHistoricalRun, runWorkflow } = useWorkflowRunActions({
    beginCancelOperation,
    beginRunOperation,
    currentPreRunIssues,
    currentRun: run,
    editableWorkflow,
    finishOperation,
    isBusy,
    isCancelling,
    isIssueInCurrentScope: (path) => isIssuePathInCurrentEditScope(path, editScope),
    isOperationActive: isActiveRun,
    maxPollAttempts: MAX_RUN_POLL_ATTEMPTS,
    navigate: navigateWorkflowRoute,
    onClearHistoricalRunWorkflow: clearHistoricalRunWorkflow,
    onExpandRunDrawer: () =>
      setRunDrawerState({ expanded: true, manuallyPinned: false }),
    onMessage: setMessage,
    onPageBusyChange: setIsBusy,
    onSelectIssueNode: (nodeId) => selectNodeForPanel(nodeId, "config"),
    onShowPreRunIssues: () => setVisiblePreRunIssueMode("all"),
    runView,
    saveWorkflow,
    shouldSaveBeforeRun: workflowSaveState.shouldSaveBeforeRun,
    trackCurrentRun,
    workflow,
  });
  const workflowNavigationActions = useWorkflowNavigationActions({
    confirmDiscard: confirmDialog.confirm,
    createWorkflowFromTemplate,
    hasActiveOperation,
    isBusy,
    isCancelling,
    isWorkflowDirty,
    navigate: navigateWorkflowRoute,
    onApplyDocument: applyWorkflowNavigationDocument,
    onBusyChange: setIsBusy,
    onMessage: setMessage,
    openHistoricalRun,
    refreshWorkflowCatalog,
    selectedWorkflowId,
    selectTemplateNode: defaultSelectedTemplateNodeId,
  });
  workflowNavigationActionsRef.current = workflowNavigationActions;
  const {
    applyTemplate,
    confirmDiscardUnsavedChanges,
    deleteWorkflow,
    loadWorkflow,
    resetEditorForNewWorkflow,
    startNewWorkflow,
  } = workflowNavigationActions;
  const {
    duplicateWorkflow,
    exportWorkflow,
    importWorkflow,
  } = useWorkflowTransferActions({
    blocked: isBusy,
    confirmDiscardUnsavedChanges,
    currentWorkflow: workflow,
    documentId: workflow.id,
    navigateToNew: () => navigateWorkflowRoute({ kind: "new" }),
    onBusyChange: setIsBusy,
    onMessage: setMessage,
    onOpenDraft: (draft, message) => applyWorkflowNavigationDocument({
      baseline: "dirty",
      message,
      selectedNodeId: null,
      selectedWorkflowId: "",
      workflow: draft,
    }),
  });
  const autoSaveCanSave =
    !hasWorkflowVariableIssues && !currentPreRunIssues.some(isSettingsPreRunIssue);
  const autoSaveController = useWorkflowAutoSaveController({
    blocked:
      isPageBusy
      || isHistoricalRunLoading
      || isWorkflowMutating
      || isCancelling
      || hasActiveOperation(),
    canSave: autoSaveCanSave,
    dirty: isWorkflowDirty,
    documentKey: workflow.id,
    enabled: autoSaveEnabled,
    onSave: saveWorkflowAutomatically,
    revision: workflowRevision,
  });
  const {
    reloadWorkflowAfterConflict,
    saveWorkflowConflictAsCopy,
  } = useWorkflowConflictRecoveryActions({
    clearConflict: clearWorkflowConflict,
    commitWorkflowSave,
    conflict: workflowConflict,
    currentWorkflow: workflow,
    isPageBusy,
    isWorkflowMutating,
    navigate: navigateWorkflowRoute,
    onBusyChange: setIsBusy,
    onClearIssues: clearWorkflowIssues,
    onMessage: setMessage,
    onResetAutoSave: autoSaveController.reset,
    onResetEditor: () => resetWorkbenchForDocument(null),
    replaceWorkflow,
    selectedWorkflowId,
    selectWorkflow: updateSelectedWorkflowId,
    upsertWorkflowSummary,
  });
  const workflowSavePresentation = buildWorkflowSavePresentation({
    autoSaveStatus: autoSaveController.status,
    baseClassName: workflowSaveState.className,
    baseLabel: workflowSaveState.label,
    hasConflict: workflowConflict !== null,
    isSaving: workflowMutationOperation === "save",
    saveMode: workflowSaveMode,
  });
  const canRedoWorkflowChange = !isEditorLocked && hasRedoWorkflowChange;
  const canUndoWorkflowChange = !isEditorLocked && hasUndoWorkflowChange;
  const workflowSaveActionState = useMemo(
    () => {
      const actionState = buildWorkflowSaveActionState(workflowSaveState, isBusy);
      if (!actionState.disabled && hasWorkflowVariableIssues) {
        return {
          disabled: true,
          title: "请先修正工作流变量名",
        };
      }
      return actionState;
    },
    [hasWorkflowVariableIssues, isBusy, workflowSaveState]
  );
  const commandPaletteCommands = buildWorkspaceCommands(
    {
      canCancelRun,
      canRedo: canRedoWorkflowChange,
      canUndo: canUndoWorkflowChange,
      isBusy,
      isCancelling,
      isEditorLocked,
      isNodeTypesReloading,
      saveAction: workflowSaveActionState,
    },
    {
      cancelRun: () => void cancelRun(),
      fitCanvas: requestCanvasFit,
      newWorkflow: startNewWorkflow,
      openResource: (kind) => openResourceSection(resourceRouteSectionForKind(kind)),
      openWorkflowSettings: () => setIsWorkflowSettingsOpen(true),
      redo: redoWorkflowChange,
      reloadNodeTypes: () => void reloadNodeTypes(),
      runWorkflow: () => void runWorkflow(),
      saveWorkflow: () => void saveWorkflow(),
      undo: undoWorkflowChange,
      validateWorkflow: () => void validateWorkflow(),
    },
  );

  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (!isWorkflowDirty) {
        return;
      }

      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isWorkflowDirty]);

  useEffect(() => {
    // 资源页面期间不同步工作流/执行 URL，返回后依赖项变化会自动重新同步
    if (resourceSection) {
      return;
    }
    if (run) {
      const routeNodeId = !editScope?.length && selectedNodeId
        && runDisplayWorkflow.nodes.some((node) => node.id === selectedNodeId)
        ? selectedNodeId
        : undefined;
      workflowRouteController.navigate(
        {
          kind: "execution",
          workflowId: run.workflow_id,
          executionId: run.id,
          ...(routeNodeId ? { nodeId: routeNodeId } : {}),
        },
        { replace: true },
      );
      return;
    }
    if (!selectedWorkflowId) {
      return;
    }
    const routeNodeId = !editScope?.length && selectedNodeId
      && workflow.nodes.some((node) => node.id === selectedNodeId)
      ? selectedNodeId
      : undefined;
    workflowRouteController.navigate(
      {
        kind: "workflow",
        workflowId: selectedWorkflowId,
        ...(routeNodeId ? { nodeId: routeNodeId } : {}),
      },
      { replace: true },
    );
  }, [editScope, resourceSection, run, runDisplayWorkflow.nodes, selectedNodeId, selectedWorkflowId, workflow.nodes]);

  useEffect(() => {
    function handleSaveShortcut(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") {
        return;
      }

      event.preventDefault();
      if (!isBusy) {
        void saveWorkflow();
      }
    }

    window.addEventListener("keydown", handleSaveShortcut);
    return () => window.removeEventListener("keydown", handleSaveShortcut);
  }, [isBusy, workflow]);

  useEffect(() => {
    function handleHistoryShortcut(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || isEditableTextTarget(event.target)) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "d") {
        event.preventDefault();
        duplicateSelectedNodes(selectedNodeIds);
        return;
      }

      if (key === "c") {
        event.preventDefault();
        copySelectedNodes(selectedNodeIds);
        return;
      }

      if (key === "v") {
        event.preventDefault();
        void pasteCopiedNodes();
        return;
      }

      if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          redoWorkflowChange();
        } else {
          undoWorkflowChange();
        }
        return;
      }

      if (key === "y") {
        event.preventDefault();
        redoWorkflowChange();
      }
    }

    window.addEventListener("keydown", handleHistoryShortcut);
    return () => window.removeEventListener("keydown", handleHistoryShortcut);
  }, [
    canRedoWorkflowChange,
    canUndoWorkflowChange,
    editableWorkflow.nodes,
    editScope,
    isEditorLocked,
    selectedNodeIds,
  ]);

  function restoreWorkflowHistoryEntry(entry: WorkflowHistoryEntry) {
    restoreHistorySelection(entry.editScope, entry.selectedNodeId);
    clearValidationIssues();
    clearDeletedEdgesUndo();
  }

  function undoWorkflowChange() {
    if (isEditorLocked) {
      return;
    }

    const entry = undoDocumentChange({ editScope, selectedNodeId });
    if (!entry) {
      return;
    }
    restoreWorkflowHistoryEntry(entry);
    setMessage("已撤销上一步编辑。");
  }

  function redoWorkflowChange() {
    if (isEditorLocked) {
      return;
    }

    const entry = redoDocumentChange({ editScope, selectedNodeId });
    if (!entry) {
      return;
    }
    restoreWorkflowHistoryEntry(entry);
    setMessage("已重做上一步编辑。");
  }

  useEffect(() => {
    if (!selectedNodeId) {
      return;
    }

    const selectedNodeStillExists = editableWorkflow.nodes.some((node) => node.id === selectedNodeId);
    if (!selectedNodeStillExists) {
      selectNodeForPanel(null);
    }
  }, [editableWorkflow.nodes, selectedNodeId, selectNodeForPanel]);

  useEffect(() => {
    if (!edgeFocusRequest) {
      return;
    }

    const focusedEdgeStillExists = editableWorkflow.edges.some((edge) => edge.id === edgeFocusRequest.edgeId);
    if (!focusedEdgeStillExists) {
      clearEdgeFocus();
    }
  }, [clearEdgeFocus, edgeFocusRequest, editableWorkflow.edges]);

  const openNodeRuntime = useCallback(
    (target: NodeRuntimeNavigationTarget) => {
      openRuntimeSelection(target);
      setMessage(`已从${nodeRuntimeSourceLabel(target.source)}打开节点运行详情。`);
    },
    [openRuntimeSelection]
  );

  function openSubflow(nodeId: string, subflowName: string) {
    if (isEditorLocked) {
      return;
    }

    enterSubflow(nodeId, subflowName);
  }

  function selectRunEventNode(target: NodeRuntimeNavigationTarget) {
    if (
      isRunSelectionInCurrentEditScope(target, editScope) &&
      editableWorkflow.nodes.some((node) => node.id === target.nodeId)
    ) {
      openRuntimeSelection(target);
      setMessage(`已从${nodeRuntimeSourceLabel(target.source)}打开节点运行详情。`);
      return;
    }

    setMessage("这个运行事件属于未打开的子流程，请先进入对应循环体查看。");
  }

  function selectWorkflowIssue(issue: WorkflowIssueItem) {
    const selection = resolveWorkflowIssueSelection(issue, {
      editScope,
      editableNodeIds: new Set(editableWorkflow.nodes.map((node) => node.id)),
      editableEdgeIds: new Set(editableWorkflow.edges.map((edge) => edge.id)),
    });

    if (selection.kind === "node") {
      selectNodeForPanel(selection.nodeId, "config", selection.field);
      return;
    }

    if (selection.kind === "settings") {
      clearEdgeFocus();
      setIsWorkflowSettingsOpen(true);
      setWorkflowSettingsFocusRequest((current) => ({
        field: selection.field,
        key: (current?.key ?? 0) + 1,
      }));
      setMessage("已打开工作流设置，请修正对应配置。");
      return;
    }

    if (selection.kind === "edge") {
      focusEdge(selection.edgeId);
      setMessage(`已在画布中选中连线 ${selection.edgeId}，可直接删除或重新连接。`);
      return;
    }

    if (selection.resetEdgeFocus) {
      clearEdgeFocus();
    }
    setMessage(selection.message);
  }

  function resetRunState() {
    resetExecutionState();
    resetRunInspector();
    setRunDrawerState(initialRunDrawerState);
  }

  function applyWorkflowNavigationDocument({
    baseline,
    message,
    selectedNodeId: nextSelectedNodeId,
    selectedWorkflowId: nextSelectedWorkflowId,
    workflow: nextWorkflow,
  }: WorkflowNavigationDocumentRequest) {
    resetRunState();
    scrollAppToTop();
    clearWorkflowIssues();
    clearDeletedEdgesUndo();
    replaceWorkflow(nextWorkflow, { baseline });
    void updateSelectedWorkflowId(nextSelectedWorkflowId);
    resetWorkbenchForDocument(nextSelectedNodeId);
    setMessage(message);
  }

  useEffect(() => {
    if (!workflowSettingsFocusRequest) {
      return;
    }

    // 输入框位于懒加载的设置弹层内，未挂载时保留请求，等注册回调触发后重试
    if (workflowSettingsFocusRequest.field === "timeout_seconds") {
      if (!workflowTimeoutInputRef.current) {
        return;
      }
      workflowTimeoutInputRef.current.focus();
      setWorkflowSettingsFocusRequest(null);
      return;
    }

    if (workflowSettingsFocusRequest.field === "max_concurrent_runs") {
      if (!workflowConcurrencyInputRef.current) {
        return;
      }
      workflowConcurrencyInputRef.current.focus();
      setWorkflowSettingsFocusRequest(null);
      return;
    }

    if (!isWorkflowSettingsOpen || !workflowSettingsFocusRequest.field) {
      return;
    }

    const variableNameInput = workflowVariableNameRefs.current.get(workflowSettingsFocusRequest.field);
    if (!variableNameInput) {
      return;
    }
    variableNameInput.focus();
    setWorkflowSettingsFocusRequest(null);
  }, [isWorkflowSettingsOpen, workflowSettingsFocusRequest, workflowSettingsInputRegistrationKey]);

  // 设置弹层输入框注册回调需保持引用稳定：
  // 内联 ref 回调每次渲染都会以 null 卸载再重挂，会触发循环渲染；
  // 稳定身份后只在真正挂载时递增注册版本号，用于重试待处理的聚焦请求
  const registerWorkflowSettingsTimeoutInput = useCallback((element: HTMLInputElement | null) => {
    workflowTimeoutInputRef.current = element;
    if (element) {
      setWorkflowSettingsInputRegistrationKey((current) => current + 1);
    }
  }, []);
  const registerWorkflowSettingsConcurrencyInput = useCallback((element: HTMLInputElement | null) => {
    workflowConcurrencyInputRef.current = element;
    if (element) {
      setWorkflowSettingsInputRegistrationKey((current) => current + 1);
    }
  }, []);

  return (
    <div
      className="app-shell"
      data-focus={isCanvasFocusMode ? "true" : undefined}
      data-resource={resourceSection ?? undefined}
    >
      <WorkflowTopbar
        actions={{
          onCancelRun: cancelRun,
          onCreateWorkflow: startNewWorkflow,
          onOpenCommandPalette: openCommandPalette,
          onOpenManualRun: () => setIsManualRunDialogOpen(true),
          onOpenSaveConflict: reopenWorkflowConflict,
          onPreviewNodeUpgrades: () => void previewNodeUpgrades(),
          onRedo: redoWorkflowChange,
          onReturnToMain: returnToMain,
          onRunWorkflow: () => void runWorkflow(),
          onSaveWorkflow: () => void saveWorkflow(),
          onToggleActivation: () => void updateWorkflowActivation(),
          onUndo: undoWorkflowChange,
          onUpdateName: updateWorkflowName,
          onValidateWorkflow: () => void validateWorkflow(),
        }}
        identity={{
          activeScopeLabel: editScope?.length ? editScopeLabel : null,
          editorLocked: isEditorLocked,
          name: workflow.name,
          publication: workflowPublication,
          saveStatus: {
            className: workflowSavePresentation.className,
            hasConflict: workflowConflict !== null,
            label: workflowSavePresentation.label,
            title: autoSaveController.lastError ?? workflowSavePresentation.title,
          },
          selectedWorkflowId,
        }}
        operationState={{
          activation: workflowReleaseActionStates.activation,
          canCancelRun,
          canRedo: canRedoWorkflowChange,
          canUndo: canUndoWorkflowChange,
          isBusy,
          isCancelling,
          save: workflowSaveActionState,
          upgrade: workflowReleaseActionStates.upgrade,
        }}
        resourceMenu={(
          <WorkspaceResourceMenu
            credentialCount={credentials.length}
            disabled={isEditorLocked}
            environmentCount={projectEnvironments.length}
            nodeCount={nodeTypes.length}
            packageAttentionCount={nodePackageAttentionCount(nodePackageScan)}
            packageCount={nodePackageScan?.packages.length ?? 0}
            variableCount={projectVariables.length}
            onSelect={(kind) => openResourceSection(resourceRouteSectionForKind(kind))}
          />
        )}
        settingsMenu={(
          <WorkflowSettingsMenu
            actions={{
              onAddTag: addWorkflowTag,
              onAddVariable: addWorkflowVariable,
              onAutoSaveChange: (enabled) => {
                setAutoSaveEnabled(enabled);
                writeAutoSavePreference(enabled);
                if (!enabled) {
                  autoSaveController.reset();
                }
              },
              onCompareVersion: (version) => void compareWorkflowVersion(version),
              onDescriptionChange: updateWorkflowDescription,
              onEnvironmentChange: updateWorkflowEnvironment,
              onErrorWorkflowChange: updateErrorWorkflow,
              onMaxConcurrentRunsChange: updateWorkflowMaxConcurrentRuns,
              onRegisterConcurrencyInput: registerWorkflowSettingsConcurrencyInput,
              onRegisterTimeoutInput: registerWorkflowSettingsTimeoutInput,
              onRegisterVariableNameInput: (name, element) => {
                if (element) {
                  workflowVariableNameRefs.current.set(name, element);
                } else {
                  workflowVariableNameRefs.current.delete(name);
                }
              },
              onRemoveTag: removeWorkflowTag,
              onRemoveVariable: removeWorkflowVariable,
              onRenameVariable: renameWorkflowVariable,
              onRestoreVersion: (version) => void restoreWorkflowVersion(version),
              onRollbackTargetChange: setRollbackTargetVersion,
              onRollbackVersion: (version) => void rollbackWorkflowVersion(version),
              onTagInputChange: setWorkflowTagInput,
              onTimeoutChange: updateWorkflowTimeoutSeconds,
              onToggleTriggers: toggleWorkflowTriggers,
              onToggleVersions: toggleWorkflowVersions,
              onVariableValueChange: updateWorkflowVariableValue,
            }}
            disabled={isEditorLocked}
            editor={{
              autoSaveDisabled: isWorkflowMutating,
              autoSaveEnabled,
              isDirty: isWorkflowDirty,
              isLocked: isEditorLocked,
              selectedWorkflowId,
            }}
            lifecycle={{
              isRollingBack: isRollingBackWorkflowVersion,
              isTriggersLoading: isWorkflowTriggersLoading,
              isTriggersOpen: isWorkflowTriggersOpen,
              isVersionDiffLoading: isWorkflowVersionDiffLoading,
              isVersionsLoading: isWorkflowVersionsLoading,
              isVersionsOpen: isWorkflowVersionsOpen,
              publication: workflowPublication,
              rollbackTargetVersion,
              triggers: workflowTriggers,
              triggersError: workflowTriggersError,
              versionDiff: workflowVersionDiff,
              versionDiffError: workflowVersionDiffError,
              versions: workflowVersions,
              versionsError: workflowVersionsError,
            }}
            nodeDisplayNames={nodeDisplayNames}
            nodeTypes={displayNodeTypes}
            open={isWorkflowSettingsOpen}
            projectEnvironments={projectEnvironments}
            tagInput={workflowTagInput}
            workflow={workflow}
            workflows={workflows}
            onOpenChange={setIsWorkflowSettingsOpen}
          />
        )}
        themeToggle={<ThemeToggle />}
        workflowManager={(
          <Suspense fallback={<WorkflowManagerFallback />}>
            <LazyWorkflowManager
              currentWorkflowName={selectedWorkflowId ? workflow.name : undefined}
              disabled={isBusy}
              hasMoreRunHistory={hasMoreWorkflowRuns}
              isCurrentWorkflowDirty={isWorkflowDirty}
              runHistoryError={workflowRunHistoryError}
              runHistoryLoading={isWorkflowRunHistoryLoading}
              runHistoryStatus={runHistoryStatusFilter}
              saveActionState={workflowSaveActionState}
              selectedWorkflowId={selectedWorkflowId}
              selectedWorkflowRuns={selectedWorkflowRuns}
              workflows={workflows}
              onCreateWorkflow={startNewWorkflow}
              onDeleteWorkflow={deleteWorkflow}
              onDuplicateWorkflow={(workflowId) => void duplicateWorkflow(workflowId)}
              onExportWorkflow={exportWorkflow}
              onImportWorkflow={(file) => void importWorkflow(file)}
              onLoadMoreRunHistory={loadMoreWorkflowRunHistory}
              onLoadWorkflow={(workflowId) => void loadWorkflow(workflowId)}
              onOpenRun={(runId) => void openHistoricalRun(runId)}
              onReloadRunHistory={retryWorkflowRunHistory}
              onRunHistoryStatusChange={changeRunHistoryStatusFilter}
              onSaveWorkflow={() => void saveWorkflow()}
              onValidateWorkflow={() => void validateWorkflow()}
            />
          </Suspense>
        )}
      />

      {isCommandPaletteOpen ? (
        <CommandPalette commands={commandPaletteCommands} onClose={closeCommandPalette} />
      ) : null}

      <ManualRunDialog
        defaultEnvironmentId={workflowEnvironmentId(workflow)}
        disabled={isBusy}
        environments={projectEnvironments}
        open={isManualRunDialogOpen}
        onClose={() => setIsManualRunDialogOpen(false)}
        onRun={(input, environmentId) => {
          if (currentPreRunIssues.length > 0) {
            void runWorkflow();
            return;
          }
          setIsManualRunDialogOpen(false);
          void runWorkflow(
            undefined,
            input,
            environmentId === workflowEnvironmentId(workflow) ? undefined : environmentId
          );
        }}
      />

      <StatusNotifications
        actionsDisabled={isEditorLocked}
        notifications={statusNotifications}
        onDismiss={dismissStatusNotification}
      />

      {nodeUpgradePreview ? (
        <section aria-label="节点升级" className="node-upgrade-review">
          <div>
            <strong>节点升级</strong>
            <p>升级会基于已保存的工作流创建一个新版本。</p>
          </div>
          <ul className="node-upgrade-review-list">
            {nodeUpgradeReviewItems.map(({ details, path, summary }) => (
              <li key={path} className="node-upgrade-review-item">
                <strong>{summary}</strong>
                <span>{path}</span>
                {details.migrationNotes.length > 0 ? (
                  <ul className="node-upgrade-review-notes">
                    {details.migrationNotes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                ) : null}
                {details.changes.length > 0 ? (
                  <ul className="node-upgrade-review-changes">
                    {details.changes.map((change) => (
                      <li key={change}>{change}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="node-upgrade-review-unchanged">配置字段无需调整。</p>
                )}
              </li>
            ))}
          </ul>
          <div className="node-upgrade-review-actions">
            <button disabled={isApplyingNodeUpgrades} type="button" onClick={dismissNodeUpgradePreview}>
              暂不升级
            </button>
            <button className="primary-button" disabled={isApplyingNodeUpgrades} type="button" onClick={() => void applyNodeUpgrades()}>
              应用升级
            </button>
          </div>
        </section>
      ) : null}

      <WorkflowIssuePanel
        disabled={isEditorLocked}
        edgeRepairCandidates={edgeRepairCandidatesByEditableEdgeId}
        issues={workflowIssues}
        onDeleteEdge={removeWorkflowEdge}
        onDeleteEdges={removeWorkflowEdges}
        onRepairEdgeTarget={repairWorkflowEdgeTarget}
        onSelectIssue={selectWorkflowIssue}
      />

      {/* 仅在扫描结果需要提示时才渲染内容的通知，懒加载时以空占位过渡 */}
      <Suspense fallback={null}>
        <LazyNodePackageAttentionNotice
          scan={nodePackageScan}
          onOpen={() => openResourceSection("packages")}
        />
      </Suspense>

      {workflowConflict && isWorkflowConflictOpen ? (
        <WorkflowConflictDialog
          action={workflowConflict.action}
          busy={isPageBusy || isWorkflowMutating}
          currentVersion={workflowConflict.currentVersion}
          expectedVersion={workflowConflict.expectedVersion}
          onClose={closeWorkflowConflict}
          onReload={() => void reloadWorkflowAfterConflict()}
          onSaveCopy={
            workflowConflict.action === "save"
              ? () => void saveWorkflowConflictAsCopy()
              : undefined
          }
        />
      ) : null}

      {confirmDialog.request ? (
        <ConfirmDialog
          cancelLabel={confirmDialog.request.cancelLabel}
          confirmLabel={confirmDialog.request.confirmLabel ?? "确认"}
          danger={confirmDialog.request.danger}
          description={confirmDialog.request.description}
          title={confirmDialog.request.title}
          onCancel={() => confirmDialog.settle(false)}
          onConfirm={() => confirmDialog.settle(true)}
        />
      ) : null}

      {/* 资源页面路由：替代画布工作区主区域，懒加载保持原有 chunk 拆分 */}
      {resourceSection ? (
        <Suspense fallback={<AppLoadingSkeleton variant="canvas" />}>
          <LazyWorkspaceResourcePage
            nodeCatalog={nodeCatalogController}
            nodeTypeId={resourceNodeTypeId}
            resources={workspaceResources}
            section={resourceSection}
            onBack={leaveResourcePage}
            onSelectSection={openResourceSection}
          />
        </Suspense>
      ) : (
      <WorkflowWorkbenchLayout
        canvas={isInitialCatalogReady ? (
          <FlowCanvas
            disabled={isEditorLocked}
            edgeIssues={edgeIssuesByEditableEdgeId}
            focusedEdgeId={edgeFocusRequest?.edgeId ?? null}
            focusedEdgeRequestKey={edgeFocusRequest?.key}
            fitRequestKey={fitRequestKey}
            hasNodeClipboard={hasNodeClipboard}
            nodeIssues={nodeIssuesByEditableNodeId}
            nodeRunDetails={nodeRunDetails}
            nodeRunStates={nodeRunStates}
            nodeTypes={displayNodeTypes}
            selectedNodeId={selectedNodeId}
            selectedNodeIds={selectedNodeIds}
            selectionResetKey={editScopeKey}
            workflow={canvasWorkflow}
            onAddAnnotationAt={addCanvasAnnotation}
            onAddNodeAt={addNodeAt}
            onConfigChange={updateNodeConfig}
            onCopyNodes={copySelectedNodes}
            onDeleteEdge={removeWorkflowEdge}
            onDuplicateNodes={duplicateSelectedNodes}
            onNodeDragStateChange={setWorkflowHistoryGroupActive}
            onOpenNodeRuntime={openNodeRuntime}
            onPasteNodes={() => void pasteCopiedNodes()}
            onSelectIssue={selectWorkflowIssue}
            onSelectNode={selectNodeForPanel}
            onSelectNodes={(nodeIds, primaryNodeId) =>
              selectNodeForPanel(primaryNodeId, "config", undefined, nodeIds)
            }
            onWorkflowChange={updateCurrentEditableWorkflow}
          >
            <CanvasEmptyState
              actionsDisabled={isBusy || isCancelling}
              templates={templateCards}
              onApplyTemplate={applyTemplate}
            />
          </FlowCanvas>
        ) : (
          <AppLoadingSkeleton variant="canvas" />
        )}
        inspector={(
          <Suspense fallback={<ConfigPanelFallback />}>
            <LazyConfigPanel
              connectedInputHandles={selectedNodeConnectedInputHandles}
              connectedOutputHandles={selectedNodeConnectedOutputHandles}
              credentialTypes={credentialTypes}
              credentials={credentials}
              currentWorkflowId={selectedWorkflowId || undefined}
              disabled={isEditorLocked}
              expressionReferences={expressionReferences}
              fieldFocusRequest={
                configPanelTabRequest.field
                  ? { field: configPanelTabRequest.field, key: configPanelTabRequest.key }
                  : undefined
              }
              initialTab={configPanelTabRequest.tab}
              node={selectedNode}
              nodeType={selectedNodeType}
              runDetail={selectedRunDetail}
              runtimeNavigationScope={runtimeNavigationScope}
              runtimeNavigationSource={runtimeNavigationSource}
              runtimeState={selectedRuntimeState}
              runFromNodeUnavailableReason={runFromNodeUnavailableReason}
              tabRequestKey={configPanelTabRequest.key}
              webhookTestListener={webhookTestListener}
              webhookTestListenerChanging={isWebhookTestListenerChanging}
              workflowOptions={workflows}
              onConfigChange={updateNodeConfig}
              onConfigRemove={removeNodeConfig}
              onDisabledChange={updateNodeDisabled}
              onExecutionPolicyChange={updateNodeFailurePolicy}
              onLabelChange={updateNodeLabel}
              onNotesChange={updateNodeNotes}
              onOpenCredentialManager={() => openResourceSection("credentials")}
              onOpenSubflow={openSubflow}
              onPinnedDataChange={updateNodePinnedData}
              onRunFromNode={editScope?.length ? undefined : (nodeId) => void runWorkflow(nodeId)}
              onStartWebhookTestListener={(nodeId) => void startWebhookTestListener(nodeId)}
              onStopWebhookTestListener={(nodeId) => void stopWebhookTestListener(nodeId)}
            />
          </Suspense>
        )}
        nodeLibrary={isInitialCatalogReady ? (
          <NodePalette
            disabled={isEditorLocked}
            isReloadingNodeTypes={isNodeTypesReloading}
            nodeTypes={displayNodeTypes}
            onAddNode={addNode}
            onReloadNodeTypes={() => void reloadNodeTypes()}
          />
        ) : (
          <AppLoadingSkeleton variant="node-library" />
        )}
        focusMode={isCanvasFocusMode}
        onToggleFocusMode={() => setIsCanvasFocusMode((current) => !current)}
        resetKeys={{
          canvas: `${workflow.id}:${workflowRevision}:${editScopeKey}`,
          inspector: `${workflow.id}:${workflowRevision}:${selectedNodeId ?? "none"}`,
          nodeLibrary: displayNodeTypes
            .map((nodeType) => `${nodeType.id}@${nodeType.version ?? 1}`)
            .join("\u0000"),
          runLog: `${run?.id ?? "empty"}:${runView.events.length}`,
        }}
        runLog={(
          <RunDrawer
            expanded={runDrawerState.expanded}
            run={runView.run}
            onToggle={() =>
              setRunDrawerState((currentState) =>
                reduceRunDrawer(currentState, { type: "toggle" })
              )
            }
          >
            <RunPanel
              comparisonError={comparisonError}
              comparisonEvents={comparisonEvents}
              comparisonLoading={isComparisonLoading}
              comparisonRun={comparisonRun}
              comparisonRuns={
                isHistoricalRun && run
                  ? selectedWorkflowRuns.filter(
                    (candidate) =>
                      candidate.id !== run.id && candidate.workflow_id === run.workflow_id
                  )
                  : []
              }
              events={runView.events}
              inspector={runInspector}
              isHistoricalRun={isHistoricalRun}
              nodeDisplayNames={nodeDisplayNames}
              nodeTypesByNodeId={nodeTypesByRunNodeId}
              queueStatus={runQueueStatus}
              run={runView.run}
              selectedNodeId={selectedNodeId}
              onClearHistoricalRun={clearHistoricalRunView}
              onOpenChildRun={(runId) => void openParentRun(runId)}
              onOpenParentRun={(runId) => void openParentRun(runId)}
              onRetryHistoricalRun={() => void retryHistoricalRun()}
              onSelectComparisonRun={(runId) => void selectHistoricalRunForComparison(runId)}
              onSelectNode={selectRunEventNode}
            />
          </RunDrawer>
        )}
      />
      )}
    </div>
  );
}

function isEditableTextTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function readAutoSavePreference(): boolean {
  if (typeof window === "undefined") {
    return true;
  }
  try {
    return window.localStorage?.getItem(AUTO_SAVE_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

function writeAutoSavePreference(enabled: boolean) {
  try {
    window.localStorage?.setItem(AUTO_SAVE_STORAGE_KEY, String(enabled));
  } catch {
    // Saving remains available even when browser storage is unavailable.
  }
}

function buildWorkflowSavePresentation({
  autoSaveStatus,
  baseClassName,
  baseLabel,
  hasConflict,
  isSaving,
  saveMode,
}: {
  autoSaveStatus: "idle" | "scheduled" | "saving" | "retrying" | "conflict";
  baseClassName: "is-draft" | "is-dirty" | "is-saved";
  baseLabel: "草稿" | "未保存" | "已保存";
  hasConflict: boolean;
  isSaving: boolean;
  saveMode: "auto" | "manual" | null;
}) {
  if (isSaving) {
    return {
      className: "is-saving",
      label: saveMode === "auto" ? "自动保存中" : "保存中",
      title: "正在保存工作流",
    };
  }
  if (hasConflict || autoSaveStatus === "conflict") {
    return {
      className: "is-error",
      label: "保存冲突",
      title: "自动保存已暂停",
    };
  }
  if (autoSaveStatus === "retrying") {
    return {
      className: "is-error",
      label: "等待重试",
      title: "自动保存失败，稍后重试",
    };
  }
  if (autoSaveStatus === "scheduled") {
    return {
      className: baseClassName,
      label: baseLabel,
      title: "自动保存已排队",
    };
  }
  return { className: baseClassName, label: baseLabel, title: "" };
}

function defaultSelectedTemplateNodeId(templateId: string): string | null {
  switch (templateId) {
    case "single-api-status-code":
      return "request";
    case "csv-parameterized-api":
      return "csv";
    case "manual-approval-branch":
      return "condition";
    default:
      return null;
  }
}

function scrollAppToTop() {
  if (typeof window === "undefined" || typeof window.scrollTo !== "function") {
    return;
  }

  if (document.documentElement.scrollHeight <= document.documentElement.clientHeight) {
    return;
  }

  try {
    window.scrollTo({ top: 0, left: 0 });
  } catch {
    // Test environments may expose scrollTo without implementing it.
  }
}
