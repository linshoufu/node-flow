import { useCallback, useState } from "react";
import type { NodeRuntimeNavigationSource, NodeRuntimeNavigationTarget } from "../lib/nodeRuntimeNavigation";
import type { EditScope } from "../lib/workflow";

export type ConfigPanelInitialTab = "config" | "runtime";

export type ConfigPanelTabRequest = {
  field?: string;
  key: number;
  tab: ConfigPanelInitialTab;
};

export type EdgeFocusRequest = {
  edgeId: string;
  key: number;
};

export function useWorkbenchNavigationController() {
  const [editScope, setEditScope] = useState<EditScope>(undefined);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [runtimeNavigationSource, setRuntimeNavigationSource] =
    useState<NodeRuntimeNavigationSource | null>(null);
  const [runtimeNavigationScope, setRuntimeNavigationScope] = useState<string[] | null>(null);
  const [configPanelTabRequest, setConfigPanelTabRequest] = useState<ConfigPanelTabRequest>({
    tab: "config",
    key: 0,
  });
  const [edgeFocusRequest, setEdgeFocusRequest] = useState<EdgeFocusRequest | null>(null);
  const [fitRequestKey, setFitRequestKey] = useState(0);

  const selectNodeForPanel = useCallback((
    nodeId: string | null,
    tab: ConfigPanelInitialTab = "config",
    field?: string,
    nodeIds: string[] = nodeId ? [nodeId] : [],
  ) => {
    setEdgeFocusRequest(null);
    setSelectedNodeId(nodeId);
    setSelectedNodeIds(nodeIds);
    setRuntimeNavigationSource(null);
    setRuntimeNavigationScope(null);
    setConfigPanelTabRequest((current) => ({ tab, key: current.key + 1, field }));
  }, []);

  const openRuntimeSelection = useCallback((target: NodeRuntimeNavigationTarget) => {
    setEdgeFocusRequest(null);
    setSelectedNodeId(target.nodeId);
    setSelectedNodeIds([target.nodeId]);
    setRuntimeNavigationSource(target.source);
    setRuntimeNavigationScope(target.scope);
    setConfigPanelTabRequest((current) => ({ tab: "runtime", key: current.key + 1 }));
  }, []);

  const focusEdge = useCallback((edgeId: string) => {
    setSelectedNodeId(null);
    setSelectedNodeIds([]);
    setRuntimeNavigationSource(null);
    setRuntimeNavigationScope(null);
    setEdgeFocusRequest((current) => ({ edgeId, key: (current?.key ?? 0) + 1 }));
  }, []);

  const clearEdgeFocus = useCallback(() => {
    setEdgeFocusRequest(null);
  }, []);

  const requestCanvasFit = useCallback(() => {
    setFitRequestKey((current) => current + 1);
  }, []);

  const enterSubflow = useCallback((nodeId: string, subflowName: string) => {
    setEditScope((current) => [...(current ?? []), { nodeId, subflowName }]);
    requestCanvasFit();
    selectNodeForPanel(null);
  }, [requestCanvasFit, selectNodeForPanel]);

  const returnToMain = useCallback(() => {
    setEditScope(undefined);
    requestCanvasFit();
    selectNodeForPanel(null);
  }, [requestCanvasFit, selectNodeForPanel]);

  const restoreHistorySelection = useCallback((
    nextEditScope: EditScope,
    nextSelectedNodeId: string | null,
  ) => {
    setEditScope(nextEditScope);
    selectNodeForPanel(nextSelectedNodeId);
  }, [selectNodeForPanel]);

  const resetForDocument = useCallback((nextSelectedNodeId: string | null) => {
    setEditScope(undefined);
    requestCanvasFit();
    selectNodeForPanel(nextSelectedNodeId);
  }, [requestCanvasFit, selectNodeForPanel]);

  return {
    clearEdgeFocus,
    configPanelTabRequest,
    edgeFocusRequest,
    editScope,
    enterSubflow,
    fitRequestKey,
    focusEdge,
    openRuntimeSelection,
    requestCanvasFit,
    resetForDocument,
    restoreHistorySelection,
    returnToMain,
    runtimeNavigationScope,
    runtimeNavigationSource,
    selectedNodeId,
    selectedNodeIds,
    selectNodeForPanel,
  };
}
