import {
  Background,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useUpdateNodeInternals,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import { ClipboardPaste, Copy, CopyPlus, Map as MapIcon, Maximize2, Minus, Plus, StickyNote, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, memo, type DragEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { CanvasQuickSearch } from "./CanvasQuickSearch";
import { buildCanvasConnectionEdge } from "../lib/canvasConnectionEdge";
import { buildCanvasNodeData, type CanvasNodePortEntry } from "../lib/canvasNodeData";
import { validateConnection } from "../lib/connectionValidation";
import { buildEdgeRepairCandidates, type EdgeRepairCandidate } from "../lib/edgeRepairCandidates";
import { resolveNodeInputPorts, resolveNodeOutputPorts } from "../lib/nodePorts";
import { portDisplayName, portTooltip } from "../lib/schemaDisplay";
import { createWorkflowEdge } from "../lib/workflow";
import type { NodeRunDetail } from "../lib/nodeRunDetail";
import { buildNodeRuntimeTarget, type NodeRuntimeNavigationTarget } from "../lib/nodeRuntimeNavigation";
import type { NodeRuntimeState } from "../lib/runState";
import type { WorkflowIssueItem } from "../lib/workflowIssues";
import type { CanvasAnnotation, NodePort, NodeType, WorkflowDocument, WorkflowEdge, WorkflowNode } from "../types";
import { NodeTypeIcon } from "./NodeTypeIcon";
import { getInlineFields, renderInlineField } from "../lib/inlineFieldControls";

type FlowCanvasProps = {
  disabled?: boolean;
  workflow: WorkflowDocument;
  nodeTypes: NodeType[];
  edgeIssues?: Record<string, WorkflowIssueItem[]>;
  focusedEdgeId?: string | null;
  focusedEdgeRequestKey?: number;
  fitRequestKey?: string | number;
  nodeIssues?: Record<string, WorkflowIssueItem[]>;
  nodeRunStates?: Record<string, NodeRuntimeState>;
  nodeRunDetails?: Record<string, NodeRunDetail>;
  selectedNodeId: string | null;
  selectedNodeIds?: string[];
  selectionResetKey?: string;
  children?: ReactNode;
  onAddAnnotationAt?: (position: CanvasAnnotation["position"]) => void;
  onAddNodeAt?: (nodeType: NodeType, position: WorkflowNode["position"]) => void;
  hasNodeClipboard?: boolean;
  onCopyNodes?: (nodeIds: string[]) => void;
  onPasteNodes?: () => void;
  onDuplicateNodes?: (nodeIds: string[]) => void;
  onDeleteEdge?: (edgeId: string) => void;
  onOpenNodeRuntime?: (target: NodeRuntimeNavigationTarget) => void;
  onNodeDragStateChange?: (isDragging: boolean) => void;
  onSelectIssue?: (issue: WorkflowIssueItem) => void;
  onConfigChange?: (nodeId: string, key: string, value: unknown) => void;
  onWorkflowChange: (workflow: WorkflowDocument) => void;
  onSelectNode: (nodeId: string | null) => void;
  onSelectNodes?: (nodeIds: string[], primaryNodeId: string | null) => void;
};

type EditorNodeData = {
  workflowNode: WorkflowNode;
  nodeType?: NodeType;
  issues?: WorkflowIssueItem[];
  runtimeState?: NodeRuntimeState;
  runDetail?: NodeRunDetail;
  onOpenNodeRuntime?: (target: NodeRuntimeNavigationTarget) => void;
  onSelectIssue?: (issue: WorkflowIssueItem) => void;
  /** 内联控件配置变更回调：由上层 useCanvasOperations 提供 */
  onConfigChange?: (nodeId: string, key: string, value: unknown) => void;
};

type EditorNode = Node<EditorNodeData, "workflowNode">;
type AnnotationNodeData = {
  annotation: CanvasAnnotation;
  onContentChange: (annotationId: string, patch: Pick<CanvasAnnotation, "content">) => void;
  onColorChange: (annotationId: string, color: CanvasAnnotation["color"]) => void;
  onSizeChange: (annotationId: string, size: Pick<CanvasAnnotation, "width" | "height">) => void;
};
type AnnotationNode = Node<AnnotationNodeData, "canvasAnnotation">;
type CanvasEditorNode = EditorNode | AnnotationNode;
type NodeMeasurement = {
  measured: {
    width?: number;
    height?: number;
  };
  width?: number;
  height?: number;
};

const FLOW_NODE_INITIAL_WIDTH = 190;
const FLOW_NODE_INITIAL_HEIGHT = 110;

// 节点类型注册表移到文件末尾声明，因为 WorkflowNodeView 现在由 memo 包装为 const 绑定

export function FlowCanvas({
  ...props
}: FlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function FlowCanvasInner({
  disabled = false,
  workflow,
  nodeTypes,
  edgeIssues = {},
  focusedEdgeId,
  focusedEdgeRequestKey,
  fitRequestKey,
  nodeIssues = {},
  nodeRunStates = {},
  nodeRunDetails = {},
  selectedNodeId,
  selectedNodeIds,
  selectionResetKey,
  children,
  onAddAnnotationAt,
  onAddNodeAt,
  hasNodeClipboard = false,
  onConfigChange,
  onCopyNodes,
  onPasteNodes,
  onDuplicateNodes,
  onDeleteEdge,
  onOpenNodeRuntime,
  onNodeDragStateChange,
  onSelectIssue,
  onWorkflowChange,
  onSelectNode,
  onSelectNodes,
}: FlowCanvasProps) {
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<Set<string>>(() => new Set());
  const [nodeMeasurements, setNodeMeasurements] = useState<Record<string, NodeMeasurement>>({});
  const [showFallbackEdges, setShowFallbackEdges] = useState(false);
  const [connectionHint, setConnectionHint] = useState<string | null>(null);
  // 双击画布空白处弹出的快速搜索框位置（屏幕坐标）
  const [quickSearchScreenPosition, setQuickSearchScreenPosition] = useState<{ x: number; y: number } | null>(null);
  // 小地图默认开启，帮助定位大画布；用户偏好持久化，关闭后下次仍保持关闭。
  const [isMinimapVisible, setIsMinimapVisible] = useState(readMinimapPreference);
  const canvasShellRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    writeMinimapPreference(isMinimapVisible);
  }, [isMinimapVisible]);
  const connectionHintRef = useRef<string | null>(null);
  const { fitView, screenToFlowPosition, zoomIn, zoomOut } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const nodeTypeById = useMemo(() => new Map(nodeTypes.map((nodeType) => [nodeType.id, nodeType])), [nodeTypes]);
  const previousEditorNodesRef = useRef<Map<string, EditorNode>>(new Map());
  const selectedWorkflowNodeIds = useMemo(
    () => new Set(selectedNodeIds ?? (selectedNodeId ? [selectedNodeId] : [])),
    [selectedNodeId, selectedNodeIds]
  );
  const reportNodeSelection = useCallback(
    (nodeIds: Set<string>, primaryNodeId: string | null) => {
      const normalizedNodeIds = [...nodeIds];
      if (onSelectNodes) {
        onSelectNodes(normalizedNodeIds, primaryNodeId);
      } else {
        onSelectNode(primaryNodeId);
      }
    },
    [onSelectNode, onSelectNodes]
  );

  const updateAnnotation = useCallback(
    (annotationId: string, patch: Partial<Pick<CanvasAnnotation, "content" | "color" | "width" | "height">>) => {
      if (disabled) {
        return;
      }

      onWorkflowChange({
        ...workflow,
        annotations: (workflow.annotations ?? []).map((annotation) =>
          annotation.id === annotationId ? { ...annotation, ...patch } : annotation
        ),
      });
    },
    [disabled, onWorkflowChange, workflow]
  );

  useEffect(() => {
    setSelectedEdgeIds((currentSelectedEdgeIds) =>
      currentSelectedEdgeIds.size === 0 ? currentSelectedEdgeIds : new Set()
    );
  }, [selectionResetKey]);

  useEffect(() => {
    if (!focusedEdgeId) {
      return;
    }

    const edgeExists = workflow.edges.some((edge) => edge.id === focusedEdgeId);
    if (!edgeExists) {
      setSelectedEdgeIds((currentSelectedEdgeIds) =>
        currentSelectedEdgeIds.size === 0 ? currentSelectedEdgeIds : new Set()
      );
      return;
    }

    setSelectedEdgeIds((currentSelectedEdgeIds) => {
      const nextSelectedEdgeIds = new Set([focusedEdgeId]);
      return areSetsEqual(currentSelectedEdgeIds, nextSelectedEdgeIds) ? currentSelectedEdgeIds : nextSelectedEdgeIds;
    });
  }, [focusedEdgeId, focusedEdgeRequestKey, workflow.edges]);

  const nodes = useMemo<CanvasEditorNode[]>(() => {
    const previousEditorNodes = previousEditorNodesRef.current;
    const nextEditorNodes = new Map<string, EditorNode>();
    const mappedNodes = workflow.nodes.map((node) => {
      const nodeType = nodeTypeById.get(node.type);
      const issues = nodeIssues[node.id];
      const runtimeState = nodeRunStates[node.id];
      const runDetail = nodeRunDetails[node.id];
      const measurement = nodeMeasurements[node.id];
      const selected = selectedWorkflowNodeIds.has(node.id);
      const previousNode = previousEditorNodes.get(node.id);

      if (
        previousNode &&
        previousNode.position.x === node.position.x &&
        previousNode.position.y === node.position.y &&
        previousNode.selected === selected &&
        previousNode.data.workflowNode === node &&
        previousNode.data.nodeType === nodeType &&
        previousNode.data.issues === issues &&
        previousNode.data.runtimeState === runtimeState &&
        previousNode.data.runDetail === runDetail &&
        previousNode.data.onOpenNodeRuntime === onOpenNodeRuntime &&
        previousNode.data.onSelectIssue === onSelectIssue &&
        previousNode.data.onConfigChange === onConfigChange &&
        hasSameMeasurement(previousNode, measurement)
      ) {
        nextEditorNodes.set(node.id, previousNode);
        return previousNode;
      }

      const nextNode: EditorNode = {
        id: node.id,
        type: "workflowNode",
        position: node.position,
        selected,
        initialWidth: FLOW_NODE_INITIAL_WIDTH,
        initialHeight: FLOW_NODE_INITIAL_HEIGHT,
        data: {
          workflowNode: node,
          nodeType,
          issues,
          runtimeState,
          runDetail,
          onOpenNodeRuntime,
          onSelectIssue,
          onConfigChange,
        },
        ...(measurement ? measurement : {}),
      };
      nextEditorNodes.set(node.id, nextNode);
      return nextNode;
    });

    previousEditorNodesRef.current = nextEditorNodes;
    const annotationNodes: AnnotationNode[] = (workflow.annotations ?? []).map((annotation) => ({
      id: annotation.id,
      type: "canvasAnnotation",
      position: annotation.position,
      data: {
        annotation,
        onContentChange: (annotationId, patch) => updateAnnotation(annotationId, patch),
        onColorChange: (annotationId, color) => updateAnnotation(annotationId, { color }),
        onSizeChange: (annotationId, size) => updateAnnotation(annotationId, size),
      },
      style: {
        width: annotation.width,
        height: annotation.height,
      },
    }));

    return [...mappedNodes, ...annotationNodes];
  }, [
    nodeIssues,
    nodeMeasurements,
    nodeRunDetails,
    nodeRunStates,
    nodeTypeById,
    onOpenNodeRuntime,
    onSelectIssue,
    selectedWorkflowNodeIds,
    updateAnnotation,
    workflow.annotations,
    workflow.nodes,
  ]);

  // 记录上一次各节点的端口结构签名，用于只对实际变化的节点调用 updateNodeInternals
  const nodeInternalsSignatureRef = useRef<Map<string, string> | null>(null);

  useEffect(() => {
    if (
      nodes.length === 0 ||
      typeof window === "undefined" ||
      window.navigator.userAgent.toLowerCase().includes("jsdom")
    ) {
      return;
    }

    // 对比前后节点集合：仅新增/删除/端口结构变化的节点才需要重新测量 handle 位置
    const nextSignatures = new Map(nodes.map((node) => [node.id, nodeInternalsSignature(node)]));
    const previousSignatures = nodeInternalsSignatureRef.current;
    nodeInternalsSignatureRef.current = nextSignatures;

    const changedNodeIds = [...nextSignatures.entries()]
      .filter(([nodeId, signature]) => previousSignatures?.get(nodeId) !== signature)
      .map(([nodeId]) => nodeId);
    if (changedNodeIds.length === 0) {
      return;
    }

    const animationFrame = window.requestAnimationFrame(() => {
      updateNodeInternals(changedNodeIds);
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [nodes, updateNodeInternals]);

  useEffect(() => {
    if (fitRequestKey === undefined || nodes.length === 0) {
      return;
    }

    void fitView({ duration: 180, padding: 0.18 });
  }, [fitRequestKey, fitView, nodes.length]);

  const edges = useMemo<Edge[]>(
    () =>
      workflow.edges.map((edge) => {
        const canvasEdge = buildCanvasConnectionEdge({
          edge,
          nodeRunDetails,
          nodeTypes,
          selected: selectedEdgeIds.has(edge.id),
          workflow,
        });

        return {
          ...canvasEdge,
          className: canvasConnectionEdgeClassName(canvasEdge.className, edgeIssues[edge.id]),
          markerEnd: { type: MarkerType.ArrowClosed },
        };
      }),
    [edgeIssues, nodeRunDetails, nodeTypes, selectedEdgeIds, workflow]
  );
  const selectedIssueEdge = useMemo(
    () => selectedIssueEdgeFromSelection(selectedEdgeIds, edgeIssues, workflow.edges),
    [edgeIssues, selectedEdgeIds, workflow.edges]
  );
  const selectedIssueEdgeRepairCandidates = useMemo(
    () => (selectedIssueEdge ? buildEdgeRepairCandidates(selectedIssueEdge.edge, workflow, nodeTypes) : []),
    [nodeTypes, selectedIssueEdge, workflow]
  );

  useEffect(() => {
    if (edges.length === 0 || typeof window === "undefined") {
      setShowFallbackEdges(false);
      return;
    }

    const timeout = window.setTimeout(() => {
      const renderedEdgeCount = canvasShellRef.current?.querySelectorAll(".react-flow__edge").length ?? 0;
      setShowFallbackEdges(renderedEdgeCount < edges.length);
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [edges, nodes]);

  const handleNodesChange = useCallback(
    (changes: NodeChange<CanvasEditorNode>[]) => {
      const dimensionChanges = changes.filter(isDimensionChange);
      const positionChanges = new Map(
        changes
          .filter(isPositionChange)
          .map((change) => [change.id, change.position])
      );
      const annotationIds = new Set((workflow.annotations ?? []).map((annotation) => annotation.id));
      const removedAnnotationIds = new Set(
        changes.filter(isNodeRemoveChange).map((change) => change.id).filter((id) => annotationIds.has(id))
      );
      const removedNodeIds = new Set(
        changes.filter(isNodeRemoveChange).map((change) => change.id).filter((id) => !annotationIds.has(id))
      );
      const nodeChanges = changes.filter(hasNodeChangeId).filter((change) => !annotationIds.has(change.id));
      const hasNodeSelectionChanges = nodeChanges.some(isNodeSelectChange);
      const nextSelectedNodeIds = selectedNodeIdsFromChanges(nodeChanges, selectedWorkflowNodeIds);
      for (const nodeId of removedNodeIds) {
        nextSelectedNodeIds.delete(nodeId);
      }
      const nextSelectedNodeId = primarySelectedNodeId(nodeChanges, nextSelectedNodeIds, selectedNodeId);

      if (disabled) {
        if (dimensionChanges.length > 0) {
          setNodeMeasurements((currentMeasurements) =>
            nextNodeMeasurementsFromChanges(currentMeasurements, dimensionChanges, new Set())
          );
        }
        if (hasNodeSelectionChanges) {
          reportNodeSelection(nextSelectedNodeIds, nextSelectedNodeId);
        }
        return;
      }

      if (dimensionChanges.length > 0 || removedNodeIds.size > 0) {
        setNodeMeasurements((currentMeasurements) =>
          nextNodeMeasurementsFromChanges(currentMeasurements, dimensionChanges, removedNodeIds)
        );
      }

      if (positionChanges.size === 0 && removedNodeIds.size === 0 && removedAnnotationIds.size === 0) {
        if (hasNodeSelectionChanges) {
          reportNodeSelection(nextSelectedNodeIds, nextSelectedNodeId);
        }
        return;
      }

      const nextNodes = workflow.nodes
        .filter((node) => !removedNodeIds.has(node.id))
        .map((node) => {
          const position = positionChanges.get(node.id);
          return position ? { ...node, position } : node;
        });
      const nextEdges =
        removedNodeIds.size === 0
          ? workflow.edges
          : workflow.edges.filter((edge) => !removedNodeIds.has(edge.source) && !removedNodeIds.has(edge.target));
      const nextAnnotations = (workflow.annotations ?? [])
        .filter((annotation) => !removedAnnotationIds.has(annotation.id))
        .map((annotation) => {
          const position = positionChanges.get(annotation.id);
          return position ? { ...annotation, position } : annotation;
        });

      if (removedNodeIds.size > 0) {
        const remainingEdgeIds = new Set(nextEdges.map((edge) => edge.id));
        setSelectedEdgeIds((currentSelectedEdgeIds) => {
          const nextSelectedEdgeIds = new Set(
            [...currentSelectedEdgeIds].filter((edgeId) => remainingEdgeIds.has(edgeId))
          );
          return areSetsEqual(currentSelectedEdgeIds, nextSelectedEdgeIds) ? currentSelectedEdgeIds : nextSelectedEdgeIds;
        });
      }

      onWorkflowChange({
        ...workflow,
        nodes: nextNodes,
        edges: nextEdges,
        ...(workflow.annotations ? { annotations: nextAnnotations } : {}),
      });

      if (hasNodeSelectionChanges || removedNodeIds.size > 0) {
        reportNodeSelection(nextSelectedNodeIds, nextSelectedNodeId);
      }
    },
    [disabled, onWorkflowChange, reportNodeSelection, selectedNodeId, selectedWorkflowNodeIds, workflow]
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      if (disabled) {
        return;
      }

      const removedEdgeIds = new Set(changes.filter(isEdgeRemoveChange).map((change) => change.id));
      const hasEdgeSelectionChanges = changes.some(isEdgeSelectChange);

      if (hasEdgeSelectionChanges || removedEdgeIds.size > 0) {
        setSelectedEdgeIds((currentSelectedEdgeIds) => {
          const nextSelectedEdgeIds = selectedEdgeIdsFromChanges(changes, currentSelectedEdgeIds);

          for (const edgeId of removedEdgeIds) {
            nextSelectedEdgeIds.delete(edgeId);
          }

          return areSetsEqual(currentSelectedEdgeIds, nextSelectedEdgeIds) ? currentSelectedEdgeIds : nextSelectedEdgeIds;
        });
      }

      if (removedEdgeIds.size === 0) {
        return;
      }

      onWorkflowChange({
        ...workflow,
        edges: workflow.edges.filter((edge) => !removedEdgeIds.has(edge.id)),
      });
    },
    [disabled, onWorkflowChange, workflow]
  );

  const showConnectionHint = useCallback((message: string | null) => {
    connectionHintRef.current = message;
    setConnectionHint((currentMessage) => (currentMessage === message ? currentMessage : message));
  }, []);

  const isValidConnection = useCallback(
    (connection: Connection | Edge) => {
      const result = validateConnection(connection, workflow, nodeTypes);
      showConnectionHint(result.valid ? null : result.message);
      return result.valid;
    },
    [nodeTypes, showConnectionHint, workflow]
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (disabled) {
        return;
      }

      const result = validateConnection(connection, workflow, nodeTypes);
      if (!result.valid) {
        showConnectionHint(result.message);
        return;
      }
      const { source, sourceHandle, target, targetHandle } = connection;
      if (!source || !sourceHandle || !target || !targetHandle) {
        showConnectionHint("请从输出端口拖到输入端口。");
        return;
      }

      const nextEdge: WorkflowEdge = createWorkflowEdge(
        source,
        sourceHandle,
        target,
        targetHandle
      );

      onWorkflowChange({
        ...workflow,
        edges: [...workflow.edges, nextEdge],
      });
      showConnectionHint(null);
    },
    [disabled, nodeTypes, onWorkflowChange, showConnectionHint, workflow]
  );

  const handleRepairEdgeTarget = useCallback(
    (edgeId: string, targetHandle: string) => {
      if (disabled) {
        return;
      }

      onWorkflowChange({
        ...workflow,
        edges: workflow.edges.map((edge) => (edge.id === edgeId ? { ...edge, targetHandle } : edge)),
      });
      showConnectionHint(null);
    },
    [disabled, onWorkflowChange, showConnectionHint, workflow]
  );

  const handleDragOver = useCallback(
    (event: DragEvent) => {
      if (disabled) {
        event.dataTransfer.dropEffect = "none";
        return;
      }

      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    [disabled]
  );

  const handleDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      if (disabled) {
        return;
      }

      const nodeTypeId =
        event.dataTransfer.getData("application/node-flow-node-type") || event.dataTransfer.getData("text/plain");
      const nodeType = nodeTypeById.get(nodeTypeId);
      if (!nodeType || !onAddNodeAt) {
        return;
      }

      onAddNodeAt(
        nodeType,
        screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
        })
      );
    },
    [disabled, nodeTypeById, onAddNodeAt, screenToFlowPosition]
  );

  const handleCanvasDoubleClick = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (disabled || !onAddNodeAt) {
        return;
      }
      const target = event.target as HTMLElement;
      // 双击节点/连线/按钮等交互元素不触发；仅在空白 pane 或空画布模板遮罩上打开
      if (target.closest("button, a, .flow-node, .canvas-quick-search")) {
        return;
      }
      if (!target.closest(".react-flow__pane") && !target.closest(".canvas-empty-overlay")) {
        return;
      }
      setQuickSearchScreenPosition({ x: event.clientX, y: event.clientY });
    },
    [disabled, onAddNodeAt]
  );

  return (
    <section className="canvas-shell" aria-label="画布工作区" onDoubleClick={handleCanvasDoubleClick} ref={canvasShellRef}>
      <ReactFlow
        deleteKeyCode={disabled ? [] : ["Delete", "Backspace"]}
        edges={edges}
        nodes={nodes}
        nodeTypes={flowNodeTypes}
        nodesConnectable={!disabled}
        nodesDraggable={!disabled}
        // 双击留给快速搜索框，不再缩放画布
        zoomOnDoubleClick={false}
        multiSelectionKeyCode={["Control", "Meta", "Shift"]}
        proOptions={{ hideAttribution: true }}
        selectionKeyCode="Shift"
        isValidConnection={isValidConnection}
        onConnect={handleConnect}
        onConnectStart={() => showConnectionHint(null)}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onEdgesChange={handleEdgesChange}
        onNodeDragStart={() => onNodeDragStateChange?.(true)}
        onNodeDragStop={() => onNodeDragStateChange?.(false)}
        onNodesChange={handleNodesChange}
        onPaneClick={() => {
          reportNodeSelection(new Set(), null);
          setSelectedEdgeIds((currentSelectedEdgeIds) =>
            currentSelectedEdgeIds.size === 0 ? currentSelectedEdgeIds : new Set()
          );
        }}
      >
        <Background />
        {isMinimapVisible ? (
          <MiniMap
            ariaLabel="画布导航缩略图"
            className="canvas-minimap"
            pannable
            zoomable
          />
        ) : null}
      </ReactFlow>
      {workflow.nodes.length > 0 ? (
        <div className="canvas-controls nodrag nopan" role="group" aria-label="画布控制">
          {onAddAnnotationAt ? (
            <button
              aria-label="添加画布说明"
              disabled={disabled}
              title="添加画布说明"
              type="button"
              onClick={() => {
                const bounds = canvasShellRef.current?.getBoundingClientRect();
                onAddAnnotationAt(
                  bounds
                    ? screenToFlowPosition({ x: bounds.left + bounds.width / 2 - 160, y: bounds.top + bounds.height / 2 - 90 })
                    : { x: 120, y: 120 }
                );
              }}
            >
              <StickyNote aria-hidden="true" size={16} strokeWidth={2.1} />
            </button>
          ) : null}
          {onDuplicateNodes ? (
            <button
              aria-label="克隆所选节点"
              disabled={disabled || selectedWorkflowNodeIds.size === 0}
              title="克隆所选节点 (Ctrl/Cmd + D)"
              type="button"
              onClick={() => onDuplicateNodes([...selectedWorkflowNodeIds])}
            >
              <CopyPlus aria-hidden="true" size={16} strokeWidth={2.1} />
            </button>
          ) : null}
          {onCopyNodes ? (
            <button
              aria-label="复制所选节点"
              disabled={disabled || selectedWorkflowNodeIds.size === 0}
              title="复制所选节点 (Ctrl/Cmd + C)"
              type="button"
              onClick={() => onCopyNodes([...selectedWorkflowNodeIds])}
            >
              <Copy aria-hidden="true" size={16} strokeWidth={2.1} />
            </button>
          ) : null}
          {onPasteNodes ? (
            <button
              aria-label="粘贴节点"
              disabled={disabled || !hasNodeClipboard}
              title="粘贴节点 (Ctrl/Cmd + V)"
              type="button"
              onClick={onPasteNodes}
            >
              <ClipboardPaste aria-hidden="true" size={16} strokeWidth={2.1} />
            </button>
          ) : null}
          <button aria-label="放大画布" title="放大画布" type="button" onClick={() => void zoomIn()}>
            <ZoomIn aria-hidden="true" size={16} strokeWidth={2.1} />
          </button>
          <button aria-label="缩小画布" title="缩小画布" type="button" onClick={() => void zoomOut()}>
            <ZoomOut aria-hidden="true" size={16} strokeWidth={2.1} />
          </button>
          <button aria-label="适应画布" title="适应画布" type="button" onClick={() => void fitView()}>
            <Maximize2 aria-hidden="true" size={16} strokeWidth={2.1} />
          </button>
          <button
            aria-label={isMinimapVisible ? "隐藏导航缩略图" : "显示导航缩略图"}
            aria-pressed={isMinimapVisible}
            title={isMinimapVisible ? "隐藏导航缩略图" : "显示导航缩略图"}
            type="button"
            onClick={() => setIsMinimapVisible((current) => !current)}
          >
            <MapIcon aria-hidden="true" size={16} strokeWidth={2.1} />
          </button>
        </div>
      ) : null}
      {connectionHint ? (
        <div className="connection-hint" role="status">
          {connectionHint}
        </div>
      ) : null}
      {quickSearchScreenPosition && !disabled && onAddNodeAt ? (
        <CanvasQuickSearch
          nodeTypes={nodeTypes}
          screenPosition={quickSearchScreenPosition}
          onAdd={(nodeType) => onAddNodeAt(nodeType, screenToFlowPosition(quickSearchScreenPosition))}
          onClose={() => setQuickSearchScreenPosition(null)}
        />
      ) : null}
      {selectedIssueEdge ? (
        <SelectedIssueEdgeActionBar
          disabled={disabled}
          edgeId={selectedIssueEdge.edge.id}
          issue={selectedIssueEdge.issue}
          onDeleteEdge={onDeleteEdge}
          onRepairTargetHandle={(targetHandle) => handleRepairEdgeTarget(selectedIssueEdge.edge.id, targetHandle)}
          onSelectIssue={onSelectIssue}
          repairCandidates={selectedIssueEdgeRepairCandidates}
        />
      ) : null}
      {showFallbackEdges ? (
        <FallbackEdges
          edgeIssues={edgeIssues}
          edges={workflow.edges}
          nodes={nodes.filter(isWorkflowEditorNode)}
          selectedEdgeIds={selectedEdgeIds}
        />
      ) : null}
      {workflow.nodes.length === 0 && children ? (
        <div className="canvas-empty-overlay" onDragOver={handleDragOver} onDrop={handleDrop}>
          {children}
        </div>
      ) : null}
    </section>
  );
}

function isPositionChange(
  change: NodeChange<CanvasEditorNode>
): change is Extract<NodeChange<CanvasEditorNode>, { type: "position" }> & { position: { x: number; y: number } } {
  return change.type === "position" && Boolean(change.position);
}

function isDimensionChange(
  change: NodeChange<CanvasEditorNode>
): change is Extract<NodeChange<CanvasEditorNode>, { type: "dimensions" }> {
  return change.type === "dimensions";
}

function isNodeRemoveChange(
  change: NodeChange<CanvasEditorNode>
): change is Extract<NodeChange<CanvasEditorNode>, { type: "remove" }> {
  return change.type === "remove";
}

function isNodeSelectChange(
  change: NodeChange<CanvasEditorNode>
): change is Extract<NodeChange<CanvasEditorNode>, { type: "select" }> {
  return change.type === "select";
}

function hasNodeChangeId(
  change: NodeChange<CanvasEditorNode>
): change is Exclude<NodeChange<CanvasEditorNode>, { type: "add" }> {
  return change.type !== "add";
}

function isWorkflowEditorNode(node: CanvasEditorNode): node is EditorNode {
  return node.type === "workflowNode";
}

function selectedNodeIdsFromChanges(changes: NodeChange<CanvasEditorNode>[], currentSelectedNodeIds: Set<string>) {
  return changes.filter(isNodeSelectChange).reduce((nextSelectedNodeIds, change) => {
    if (change.selected) {
      nextSelectedNodeIds.add(change.id);
    } else {
      nextSelectedNodeIds.delete(change.id);
    }

    return nextSelectedNodeIds;
  }, new Set(currentSelectedNodeIds));
}

function primarySelectedNodeId(
  changes: NodeChange<CanvasEditorNode>[],
  selectedNodeIds: Set<string>,
  currentSelectedNodeId: string | null
) {
  const mostRecentlySelectedNodeId = changes
    .filter(isNodeSelectChange)
    .filter((change) => change.selected)
    .map((change) => change.id)
    .pop();
  if (mostRecentlySelectedNodeId && selectedNodeIds.has(mostRecentlySelectedNodeId)) {
    return mostRecentlySelectedNodeId;
  }

  if (currentSelectedNodeId && selectedNodeIds.has(currentSelectedNodeId)) {
    return currentSelectedNodeId;
  }

  const selectedIds = [...selectedNodeIds];
  return selectedIds[selectedIds.length - 1] ?? null;
}

function isEdgeRemoveChange(change: EdgeChange<Edge>): change is Extract<EdgeChange<Edge>, { type: "remove" }> {
  return change.type === "remove";
}

function isEdgeSelectChange(change: EdgeChange<Edge>): change is Extract<EdgeChange<Edge>, { type: "select" }> {
  return change.type === "select";
}

function selectedEdgeIdsFromChanges(changes: EdgeChange<Edge>[], currentSelectedEdgeIds: Set<string>) {
  return changes.filter(isEdgeSelectChange).reduce((nextSelectedEdgeIds, change) => {
    if (change.selected) {
      nextSelectedEdgeIds.add(change.id);
    } else {
      nextSelectedEdgeIds.delete(change.id);
    }

    return nextSelectedEdgeIds;
  }, new Set(currentSelectedEdgeIds));
}

function areSetsEqual<T>(left: Set<T>, right: Set<T>) {
  if (left.size !== right.size) {
    return false;
  }

  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }

  return true;
}

function canvasConnectionEdgeClassName(currentClassName: string | undefined, issues: WorkflowIssueItem[] | undefined) {
  return [currentClassName, issues && issues.length > 0 ? "has-issue" : ""].filter(Boolean).join(" ") || undefined;
}

function selectedIssueEdgeFromSelection(
  selectedEdgeIds: Set<string>,
  edgeIssues: Record<string, WorkflowIssueItem[]>,
  edges: WorkflowEdge[]
): { edge: WorkflowEdge; issue: WorkflowIssueItem } | null {
  for (const edge of edges) {
    if (!selectedEdgeIds.has(edge.id)) {
      continue;
    }

    const firstIssue = edgeIssues[edge.id]?.[0];
    if (firstIssue) {
      return { edge, issue: firstIssue };
    }
  }

  return null;
}

function nextNodeMeasurementsFromChanges(
  currentMeasurements: Record<string, NodeMeasurement>,
  dimensionChanges: Array<Extract<NodeChange<EditorNode>, { type: "dimensions" }>>,
  removedNodeIds: Set<string>
) {
  let didChange = false;
  const nextMeasurements = { ...currentMeasurements };

  for (const nodeId of removedNodeIds) {
    if (nodeId in nextMeasurements) {
      delete nextMeasurements[nodeId];
      didChange = true;
    }
  }

  for (const change of dimensionChanges) {
    const dimensions = change.dimensions;
    if (!dimensions) {
      continue;
    }

    const nextMeasurement = nodeMeasurementFromDimensionChange(change, dimensions);
    if (!areMeasurementsEqual(nextMeasurements[change.id], nextMeasurement)) {
      nextMeasurements[change.id] = nextMeasurement;
      didChange = true;
    }
  }

  return didChange ? nextMeasurements : currentMeasurements;
}

function nodeMeasurementFromDimensionChange(
  change: Extract<NodeChange<EditorNode>, { type: "dimensions" }>,
  dimensions: { width: number; height: number }
): NodeMeasurement {
  const measurement: NodeMeasurement = {
    measured: {
      width: dimensions.width,
      height: dimensions.height,
    },
  };

  if (change.setAttributes === true || change.setAttributes === "width") {
    measurement.width = dimensions.width;
  }

  if (change.setAttributes === true || change.setAttributes === "height") {
    measurement.height = dimensions.height;
  }

  return measurement;
}

function hasSameMeasurement(node: EditorNode, measurement: NodeMeasurement | undefined) {
  return (
    node.measured?.width === measurement?.measured.width &&
    node.measured?.height === measurement?.measured.height &&
    node.width === measurement?.width &&
    node.height === measurement?.height
  );
}

function areMeasurementsEqual(left: NodeMeasurement | undefined, right: NodeMeasurement | undefined) {
  return (
    left?.measured.width === right?.measured.width &&
    left?.measured.height === right?.measured.height &&
    left?.width === right?.width &&
    left?.height === right?.height
  );
}

function SelectedIssueEdgeActionBar({
  disabled = false,
  edgeId,
  issue,
  onDeleteEdge,
  onRepairTargetHandle,
  onSelectIssue,
  repairCandidates,
}: {
  disabled?: boolean;
  edgeId: string;
  issue: WorkflowIssueItem;
  onDeleteEdge?: (edgeId: string) => void;
  onRepairTargetHandle: (targetHandle: string) => void;
  onSelectIssue?: (issue: WorkflowIssueItem) => void;
  repairCandidates: EdgeRepairCandidate[];
}) {
  return (
    <aside aria-label="连线问题" className="edge-issue-action-bar nodrag nopan" role="region">
      <div>
        <strong>连线 {edgeId} 有问题</strong>
        <span>{issue.message}</span>
      </div>
      <div className="edge-issue-action-bar-actions">
        {onSelectIssue ? (
          <button type="button" onClick={() => onSelectIssue(issue)}>
            查看问题
          </button>
        ) : null}
        {repairCandidates.length > 0 ? (
          repairCandidates.map((candidate) => (
            <button
              aria-label={`改接到输入端口 ${candidate.label}`}
              disabled={disabled}
              key={candidate.handle}
              type="button"
              onClick={() => {
                if (!disabled) {
                  onRepairTargetHandle(candidate.handle);
                }
              }}
            >
              改接到 {candidate.label}
            </button>
          ))
        ) : (
          <span className="edge-issue-action-bar-empty">没有可直接改接的输入端口</span>
        )}
        {onDeleteEdge ? (
          <button
            className="danger-button"
            disabled={disabled}
            type="button"
            onClick={() => {
              if (!disabled) {
                onDeleteEdge(edgeId);
              }
            }}
          >
            删除连线 {edgeId}
          </button>
        ) : null}
      </div>
    </aside>
  );
}

type FallbackEdgesProps = {
  edgeIssues: Record<string, WorkflowIssueItem[]>;
  edges: WorkflowEdge[];
  nodes: EditorNode[];
  selectedEdgeIds: Set<string>;
};

function FallbackEdges({ edgeIssues, edges, nodes, selectedEdgeIds }: FallbackEdgesProps) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  return (
    <svg aria-hidden="true" className="canvas-fallback-edges">
      {edges.map((edge) => {
        const path = fallbackEdgePath(edge, nodeById);
        return path ? (
          <path
            className={[
              selectedEdgeIds.has(edge.id) ? "is-selected" : "",
              edgeIssues[edge.id]?.length ? "has-issue" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            d={path}
            key={edge.id}
          />
        ) : null;
      })}
    </svg>
  );
}

function fallbackEdgePath(edge: WorkflowEdge, nodeById: Map<string, EditorNode>) {
  const sourceNode = nodeById.get(edge.source);
  const targetNode = nodeById.get(edge.target);
  if (!sourceNode || !targetNode) {
    return null;
  }

  const sourcePoint = fallbackPortPoint(sourceNode, edge.sourceHandle, "output");
  const targetPoint = fallbackPortPoint(targetNode, edge.targetHandle, "input");
  const controlOffset = Math.max(42, Math.abs(targetPoint.x - sourcePoint.x) * 0.45);

  return [
    `M ${sourcePoint.x} ${sourcePoint.y}`,
    `C ${sourcePoint.x + controlOffset} ${sourcePoint.y}`,
    `${targetPoint.x - controlOffset} ${targetPoint.y}`,
    `${targetPoint.x} ${targetPoint.y}`,
  ].join(" ");
}

function fallbackPortPoint(node: EditorNode, handleId: string, side: "input" | "output") {
  const width = node.width ?? node.measured?.width ?? node.initialWidth ?? FLOW_NODE_INITIAL_WIDTH;
  const height = node.height ?? node.measured?.height ?? node.initialHeight ?? FLOW_NODE_INITIAL_HEIGHT;
  const ports = node.data.nodeType
    ? side === "input"
      ? Object.keys(resolveNodeInputPorts(node.data.workflowNode, node.data.nodeType))
      : Object.keys(resolveNodeOutputPorts(node.data.workflowNode, node.data.nodeType))
    : [];
  const portIndex = Math.max(0, ports.indexOf(handleId));
  const portY = ports.length > 0 ? ((portIndex + 1) / (ports.length + 1)) * height : height / 2;

  return {
    x: node.position.x + (side === "output" ? width : 0),
    y: node.position.y + portY,
  };
}

function CanvasAnnotationView({ data }: NodeProps<AnnotationNode>) {
  const { annotation } = data;
  const [content, setContent] = useState(annotation.content);

  useEffect(() => {
    setContent(annotation.content);
  }, [annotation.content]);

  return (
    <article className={`canvas-annotation is-${annotation.color}`}>
      <textarea
        aria-label="画布说明内容"
        className="nodrag nowheel"
        maxLength={5000}
        placeholder="记录这个阶段的目的、约束或交接信息"
        value={content}
        onBlur={() => {
          if (content !== annotation.content) {
            data.onContentChange(annotation.id, { content });
          }
        }}
        onChange={(event) => setContent(event.currentTarget.value)}
      />
      <div aria-label="说明颜色" className="canvas-annotation-colors" role="group">
        <button
          aria-label="缩小画布说明"
          className="canvas-annotation-size-button"
          disabled={annotation.width <= 160 || annotation.height <= 100}
          title="缩小画布说明"
          type="button"
          onClick={() =>
            data.onSizeChange(annotation.id, {
              width: Math.max(160, annotation.width - 80),
              height: Math.max(100, annotation.height - 45),
            })
          }
        >
          <Minus aria-hidden="true" size={14} strokeWidth={2.2} />
        </button>
        <button
          aria-label="放大画布说明"
          className="canvas-annotation-size-button"
          disabled={annotation.width >= 1600 || annotation.height >= 1200}
          title="放大画布说明"
          type="button"
          onClick={() =>
            data.onSizeChange(annotation.id, {
              width: Math.min(1600, annotation.width + 80),
              height: Math.min(1200, annotation.height + 45),
            })
          }
        >
          <Plus aria-hidden="true" size={14} strokeWidth={2.2} />
        </button>
        {(["yellow", "blue", "green", "pink"] as const).map((color) => (
          <button
            aria-label={`设置为${annotationColorLabel(color)}`}
            aria-pressed={annotation.color === color}
            className={`canvas-annotation-color is-${color}`}
            key={color}
            title={annotationColorLabel(color)}
            type="button"
            onClick={() => data.onColorChange(annotation.id, color)}
          />
        ))}
      </div>
    </article>
  );
}

function annotationColorLabel(color: CanvasAnnotation["color"]) {
  switch (color) {
    case "blue":
      return "蓝色";
    case "green":
      return "绿色";
    case "pink":
      return "粉色";
    default:
      return "黄色";
  }
}

// memo 包装：画布重渲染时，data/selected 未变的节点跳过重渲染；
// 上层 nodes useMemo 已对未变化节点复用同一对象引用，浅比较即可命中
export function NodeVisualCard({
  canvasNode,
  className = "",
  interactivePorts = true,
  nodeType,
  onConfigChange,
  topContent,
  workflowNode,
}: {
  canvasNode: ReturnType<typeof buildCanvasNodeData>;
  className?: string;
  interactivePorts?: boolean;
  nodeType?: NodeType;
  onConfigChange?: (nodeId: string, key: string, value: unknown) => void;
  topContent?: ReactNode;
  workflowNode: WorkflowNode;
}) {
  const inlineFields = useMemo(
    () => getInlineFields(nodeType),
    [nodeType],
  );

  return (
    <div
      className={`flow-node${canvasNode.isDisabled ? " is-disabled" : ""}${className ? ` ${className}` : ""}`}
      data-category={nodeType?.category || "其他"}
    >
      <div className="flow-node-header">
        <NodeTypeIcon className="flow-node-icon" icon={nodeType?.icon} size={15} />
        <span className="flow-node-title">
          <strong>
            {canvasNode.displayName}
            {canvasNode.hasPinnedData ? <em className="flow-node-pinned-badge">固定输出</em> : null}
            {canvasNode.isDisabled ? <em className="flow-node-disabled-badge">已禁用</em> : null}
          </strong>
          <small title={canvasNode.subtitleTitle}>{canvasNode.subtitle}</small>
        </span>
      </div>
      {topContent}
      {canvasNode.description ? <p>{canvasNode.description}</p> : null}
      {canvasNode.notes ? <p className="flow-node-note" title={canvasNode.notes}>{canvasNode.notes}</p> : null}
      {/* 内联控件：仅 placement="inline" 的字段渲染在卡片上 */}
      {inlineFields.length > 0 ? (
        <div className="flow-node-inline-fields nodrag" onClick={(e) => e.stopPropagation()}>
          {inlineFields.map((field) => {
            const currentValue = workflowNode.config[field.key];
            return (
              <div className="inline-field-row" key={field.key}>
                {renderInlineField(
                  field,
                  currentValue,
                  (value) => onConfigChange?.(workflowNode.id, field.key, value),
                  canvasNode.isDisabled,
                )}
              </div>
            );
          })}
        </div>
      ) : null}
      <PortSection inputPorts={canvasNode.inputPorts} interactive={interactivePorts} outputPorts={canvasNode.outputPorts} />
    </div>
  );
}

// memo 包装：画布重渲染时，data/selected 未变的节点跳过重渲染；
// 上层 nodes useMemo 已对未变化节点复用同一对象引用，浅比较即可命中
const WorkflowNodeView = memo(function WorkflowNodeView({ data, selected }: NodeProps<EditorNode>) {
  const { workflowNode, nodeType, issues, runtimeState, runDetail } = data;
  const statusClass = runtimeState ? ` run-${runtimeState.status}` : "";
  const canvasNode = buildCanvasNodeData({ issues, node: workflowNode, nodeType, runDetail, runtimeState });

  return (
    <NodeVisualCard
      canvasNode={canvasNode}
      className={`${selected ? "is-selected" : ""}${statusClass}`}
      nodeType={nodeType}
      onConfigChange={data.onConfigChange}
      workflowNode={workflowNode}
      topContent={<>
        {canvasNode.runtimeStatusLabel ? <div className="run-status-badge">{canvasNode.runtimeStatusLabel}</div> : null}
        <NodeIssueBadge canvasNode={canvasNode} onSelectIssue={data.onSelectIssue} />
        {canvasNode.runSummary ? (
          <button
            aria-label={`查看运行数据：${canvasNode.displayName}，${canvasNode.runSummary.ariaLabel}`}
            className="run-summary-badges nodrag"
            title={canvasNode.runSummary.ariaLabel}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              data.onOpenNodeRuntime?.(buildNodeRuntimeTarget(workflowNode.id, "canvas"));
            }}
          >
            {canvasNode.runSummary.badges.map((badge) => <span className={badge.tone ? `is-${badge.tone}` : undefined} key={badge.id}>{badge.label}</span>)}
          </button>
        ) : null}
      </>}
    />
  );
});

function NodeIssueBadge({
  canvasNode,
  onSelectIssue,
}: {
  canvasNode: ReturnType<typeof buildCanvasNodeData>;
  onSelectIssue?: (issue: WorkflowIssueItem) => void;
}) {
  if (!canvasNode.issues) {
    return null;
  }

  const issues = canvasNode.issues;
  const className = `node-issue-badge ${issues.errorCount > 0 ? "has-error" : "has-warning"}`;

  if (!onSelectIssue) {
    return (
      <div className={className} title={issues.title}>
        {issues.label}
      </div>
    );
  }

  return (
    <button
      aria-label={`查看节点问题：${canvasNode.displayName}，${issues.label}`}
      className={`${className} nodrag`}
      title={issues.title}
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onSelectIssue(issues.firstIssue);
      }}
    >
      {issues.label}
    </button>
  );
}

type PortSectionProps = {
  inputPorts: CanvasNodePortEntry[];
  interactive?: boolean;
  outputPorts: CanvasNodePortEntry[];
};

function PortSection({ inputPorts, interactive = true, outputPorts }: PortSectionProps) {
  const rowCount = Math.max(inputPorts.length, outputPorts.length);

  if (rowCount === 0) {
    return null;
  }

  return (
    <div aria-label="节点端口" className="flow-port-section" role="group">
      {Array.from({ length: rowCount }, (_, index) => (
        <div className="flow-port-row" key={index}>
          <PortCell entry={inputPorts[index]} interactive={interactive} side="input" />
          <PortCell entry={outputPorts[index]} interactive={interactive} side="output" />
        </div>
      ))}
    </div>
  );
}

function PortCell({ entry, interactive, side }: { entry?: CanvasNodePortEntry; interactive: boolean; side: "input" | "output" }) {
  if (!entry) {
    return <span aria-hidden="true" className={`flow-port-cell is-${side} is-empty`} />;
  }

  const [portName, port] = entry;
  const position = side === "input" ? Position.Left : Position.Right;
  const type = side === "input" ? "target" : "source";
  const label = portDisplayName(portName, port);
  const classNames = [
    "flow-port-label",
    isMultiConnectionInput(side, port) ? "is-multi-connection" : "",
    isErrorOutput(side, port) ? "is-error-port" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={`flow-port-cell is-${side}`}>
      {interactive ? <Handle
        className={[
          "flow-handle",
          isMultiConnectionInput(side, port) ? "is-multi-connection" : "",
          isErrorOutput(side, port) ? "is-error-port" : "",
        ].filter(Boolean).join(" ")}
        id={portName}
        position={position}
        title={portTooltip({ direction: side, name: portName, port })}
        type={type}
      /> : <span aria-hidden="true" className="flow-handle" />}
      <span className={classNames} title={label}>
        {label}
      </span>
    </span>
  );
}

function isMultiConnectionInput(side: "input" | "output", port: NodePort): boolean {
  return side === "input" && (port.maxConnections === null || (typeof port.maxConnections === "number" && port.maxConnections > 1));
}

function isErrorOutput(side: "input" | "output", port: NodePort): boolean {
  return side === "output" && port.category === "error";
}

const MINIMAP_PREFERENCE_STORAGE_KEY = "node-flow.canvas-minimap-visible";

function readMinimapPreference(): boolean {
  try {
    const stored = window.localStorage.getItem(MINIMAP_PREFERENCE_STORAGE_KEY);
    if (stored === null) return true;
    return stored !== "false";
  } catch {
    return true;
  }
}

function writeMinimapPreference(visible: boolean) {
  try {
    window.localStorage.setItem(MINIMAP_PREFERENCE_STORAGE_KEY, String(visible));
  } catch {
    // localStorage 不可用时静默降级，仅影响偏好持久化。
  }
}

// 节点类型注册表：依赖 memo 包装的 WorkflowNodeView，故声明在组件定义之后
const flowNodeTypes = {
  workflowNode: WorkflowNodeView,
  canvasAnnotation: CanvasAnnotationView,
};

// 节点端口结构签名：端口集合变化时才需要 updateNodeInternals 重新测量 handle
function nodeInternalsSignature(node: CanvasEditorNode): string {
  if (node.type !== "workflowNode") {
    return "annotation";
  }

  const { workflowNode, nodeType } = node.data;
  if (!nodeType) {
    return `unknown:${workflowNode.type}`;
  }

  const inputPortIds = Object.keys(resolveNodeInputPorts(workflowNode, nodeType));
  const outputPortIds = Object.keys(resolveNodeOutputPorts(workflowNode, nodeType));
  return `${inputPortIds.join(",")}|${outputPortIds.join(",")}`;
}
