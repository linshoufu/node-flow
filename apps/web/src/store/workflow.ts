import { create } from "zustand";
import type {
  WorkflowDocument,
  WorkflowNode,
  WorkflowEdge,
  NodeType,
  WorkflowSummary,
  RunRecord,
  WorkflowSubflow,
} from "@/types";
import { apiClient } from "@/api/client";

type WorkflowState = {
  // Document
  workflow: WorkflowDocument;
  workflows: WorkflowSummary[];
  nodeTypes: NodeType[];
  selectedNodeId: string | null;
  canvasScope: CanvasScopeSegment[];
  isDirty: boolean;
  isSaving: boolean;
  saveError: string | null;

  // Actions
  loadWorkflows: () => Promise<void>;
  loadNodeTypes: () => Promise<void>;
  selectWorkflow: (id: string) => Promise<void>;
  selectNode: (nodeId: string | null) => void;
  enterSubflow: (nodeId: string, key?: string, label?: string) => void;
  exitSubflow: () => void;
  returnToRoot: () => void;
  updateNodeConfig: (nodeId: string, key: string, value: unknown) => void;
  updateNodeLabel: (nodeId: string, label: string) => void;
  updateNodePosition: (nodeId: string, position: { x: number; y: number }) => void;
  setNodes: (nodes: WorkflowNode[]) => void;
  setEdges: (edges: WorkflowEdge[]) => void;
  addNode: (nodeType: NodeType, position: { x: number; y: number }) => void;
  deleteNode: (nodeId: string) => void;
  addEdge: (edge: WorkflowEdge) => void;
  deleteEdge: (edgeId: string) => void;
  saveWorkflow: () => Promise<void>;
  runWorkflow: (entryNodeId?: string, input?: unknown) => Promise<RunRecord | null>;
  setWorkflowName: (name: string) => void;
};

export type CanvasScopeSegment = { nodeId: string; key: string; label: string };
export type WorkflowGraph = Pick<WorkflowSubflow, "nodes" | "edges">;

const EMPTY_GRAPH: WorkflowGraph = { nodes: [], edges: [] };

export function getActiveGraph(workflow: WorkflowDocument, scope: CanvasScopeSegment[]): WorkflowGraph {
  let graph: WorkflowGraph = { nodes: workflow.nodes, edges: workflow.edges };
  for (const segment of scope) {
    const owner = graph.nodes.find((node) => node.id === segment.nodeId);
    const subflow = owner?.subflows?.[segment.key];
    if (!subflow) return EMPTY_GRAPH;
    graph = subflow;
  }
  return graph;
}

function updateActiveGraph(workflow: WorkflowDocument, scope: CanvasScopeSegment[], update: (graph: WorkflowGraph) => WorkflowGraph): WorkflowDocument {
  if (scope.length === 0) return { ...workflow, ...update({ nodes: workflow.nodes, edges: workflow.edges }) };
  const [segment, ...rest] = scope;
  return {
    ...workflow,
    nodes: workflow.nodes.map((node) => node.id === segment.nodeId ? updateNodeSubflow(node, segment.key, rest, update) : node),
  };
}

function updateNodeSubflow(node: WorkflowNode, key: string, rest: CanvasScopeSegment[], update: (graph: WorkflowGraph) => WorkflowGraph): WorkflowNode {
  const current = node.subflows?.[key] ?? { nodes: [], edges: [] };
  const next = updateNestedSubflow(current, rest, update);
  return { ...node, subflows: { ...node.subflows, [key]: next } };
}

function updateNestedSubflow(subflow: WorkflowSubflow, scope: CanvasScopeSegment[], update: (graph: WorkflowGraph) => WorkflowGraph): WorkflowSubflow {
  if (scope.length === 0) return { ...subflow, ...update(subflow) };
  const [segment, ...rest] = scope;
  return {
    ...subflow,
    nodes: subflow.nodes.map((node) => node.id === segment.nodeId ? updateNodeSubflow(node, segment.key, rest, update) : node),
  };
}

function emptyWorkflow(): WorkflowDocument {
  return {
    id: "",
    name: "新建工作流",
    version: 1,
    nodes: [],
    edges: [],
  };
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  workflow: emptyWorkflow(),
  workflows: [],
  nodeTypes: [],
  selectedNodeId: null,
  canvasScope: [],
  isDirty: false,
  isSaving: false,
  saveError: null,

  loadWorkflows: async () => {
    try {
      const workflows = await apiClient.listWorkflows();
      set({ workflows });
    } catch (e) {
      console.error("Failed to load workflows", e);
    }
  },

  loadNodeTypes: async () => {
    try {
      const nodeTypes = await apiClient.listNodeTypes();
      set({ nodeTypes });
    } catch (e) {
      console.error("Failed to load node types", e);
    }
  },

  selectWorkflow: async (id: string) => {
    try {
      const wf = await apiClient.getWorkflow(id);
      set({ workflow: wf, selectedNodeId: null, canvasScope: [], isDirty: false });
    } catch (e) {
      console.error("Failed to load workflow", e);
    }
  },

  selectNode: (nodeId) => set({ selectedNodeId: nodeId }),

  enterSubflow: (nodeId, key = "body", label = "子流程") => {
    const { workflow, canvasScope } = get();
    const graph = getActiveGraph(workflow, canvasScope);
    const owner = graph.nodes.find((node) => node.id === nodeId);
    if (!owner) return;
    const needsInitialization = !owner.subflows?.[key];
    const nextWorkflow = needsInitialization ? updateActiveGraph(workflow, canvasScope, (current) => ({
      ...current,
      nodes: current.nodes.map((node) => node.id === nodeId && !node.subflows?.[key]
        ? { ...node, subflows: { ...node.subflows, [key]: { nodes: [], edges: [] } } }
        : node),
    })) : workflow;
    set({ workflow: nextWorkflow, canvasScope: [...canvasScope, { nodeId, key, label }], selectedNodeId: null, isDirty: needsInitialization || get().isDirty });
  },

  exitSubflow: () => set((state) => ({ canvasScope: state.canvasScope.slice(0, -1), selectedNodeId: null })),
  returnToRoot: () => set({ canvasScope: [], selectedNodeId: null }),

  updateNodeConfig: (nodeId, key, value) => {
    const { workflow: wf, canvasScope } = get();
    set({
      workflow: updateActiveGraph(wf, canvasScope, (graph) => ({
        ...graph,
        nodes: graph.nodes.map((n) =>
          n.id === nodeId ? { ...n, config: { ...n.config, [key]: value } } : n,
        ),
      })),
      isDirty: true,
    });
  },

  updateNodeLabel: (nodeId, label) => {
    const { workflow: wf, canvasScope } = get();
    set({
      workflow: updateActiveGraph(wf, canvasScope, (graph) => ({ ...graph, nodes: graph.nodes.map((n) => (n.id === nodeId ? { ...n, label } : n)) })),
      isDirty: true,
    });
  },

  updateNodePosition: (nodeId, position) => {
    const { workflow: wf, canvasScope } = get();
    set({
      workflow: updateActiveGraph(wf, canvasScope, (graph) => ({
        ...graph,
        nodes: graph.nodes.map((n) =>
          n.id === nodeId ? { ...n, position } : n,
        ),
      })),
      isDirty: true,
    });
  },

  setNodes: (nodes) => {
    set((s) => ({ workflow: updateActiveGraph(s.workflow, s.canvasScope, (graph) => ({ ...graph, nodes })), isDirty: true }));
  },

  setEdges: (edges) => {
    set((s) => ({ workflow: updateActiveGraph(s.workflow, s.canvasScope, (graph) => ({ ...graph, edges })), isDirty: true }));
  },

  addNode: (nodeType, position) => {
    const { workflow: wf, canvasScope } = get();
    const id = `${nodeType.id}.${Date.now().toString(36)}`;
    const config: Record<string, unknown> = {};
    const props = nodeType.configSchema?.properties ?? {};
    for (const [key, schema] of Object.entries(props)) {
      const s = schema as Record<string, unknown>;
      if ("default" in s) config[key] = s.default;
    }
    const node: WorkflowNode = {
      id,
      type: nodeType.id,
      position,
      config,
      ...(["control.each_item", "control.foreach", "control.while"].includes(nodeType.id) ? { subflows: { body: { nodes: [], edges: [] } } } : {}),
    };
    set({
      workflow: updateActiveGraph(wf, canvasScope, (graph) => ({ ...graph, nodes: [...graph.nodes, node] })),
      selectedNodeId: id,
      isDirty: true,
    });
  },

  deleteNode: (nodeId) => {
    const { workflow: wf, canvasScope } = get();
    set({
      workflow: updateActiveGraph(wf, canvasScope, (graph) => ({
        nodes: graph.nodes.filter((n) => n.id !== nodeId),
        edges: graph.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
      })),
      selectedNodeId: null,
      isDirty: true,
    });
  },

  addEdge: (edge) => {
    const { workflow: wf, canvasScope } = get();
    const graph = getActiveGraph(wf, canvasScope);
    if (graph.edges.some((e) => e.source === edge.source && e.target === edge.target && e.sourceHandle === edge.sourceHandle && e.targetHandle === edge.targetHandle)) return;
    set({
      workflow: updateActiveGraph(wf, canvasScope, (current) => ({ ...current, edges: [...current.edges, edge] })),
      isDirty: true,
    });
  },

  deleteEdge: (edgeId) => {
    const { workflow: wf, canvasScope } = get();
    set({
      workflow: updateActiveGraph(wf, canvasScope, (graph) => ({ ...graph, edges: graph.edges.filter((e) => e.id !== edgeId) })),
      isDirty: true,
    });
  },

  saveWorkflow: async () => {
    const wf = get().workflow;
    if (!wf.id) return;
    set({ isSaving: true, saveError: null });
    try {
      const expectedVersion = wf.version;
      const saved = await apiClient.saveWorkflow(wf, expectedVersion);
      set({ workflow: saved, isDirty: false, isSaving: false });
    } catch (e) {
      set({ isSaving: false, saveError: (e as Error).message });
    }
  },

  runWorkflow: async (entryNodeId?, input?) => {
    const wf = get().workflow;
    if (!wf.id) return null;
    return apiClient.createRun(wf.id, entryNodeId, input);
  },

  setWorkflowName: (name) => {
    set((s) => ({ workflow: { ...s.workflow, name }, isDirty: true }));
  },
}));
