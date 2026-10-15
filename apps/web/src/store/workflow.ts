import type { LibraryEditSession } from "@/lib/libraryEditing";
import { templateDependencyIssue } from "@/lib/templateDependencies";
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
import { createNodeInstance } from "@/lib/nodeInstance";
import { describeSaveFailure, type SaveFailure } from "@/lib/saveFailure";

type WorkflowState = {
  libraryEdit: LibraryEditSession | null;
  // Document
  workflow: WorkflowDocument;
  workflows: WorkflowSummary[];
  nodeTypes: NodeType[];
  selectedNodeId: string | null;
  canvasScope: CanvasScopeSegment[];
  isDirty: boolean;
  isSaving: boolean;
  saveError: SaveFailure | null;

  // Actions
  loadWorkflows: () => Promise<void>;
  loadNodeTypes: () => Promise<void>;
  selectWorkflow: (id: string) => Promise<void>;
  selectNode: (nodeId: string | null) => void;
  enterSubflow: (nodeId: string, key?: string, label?: string) => void;
  exitSubflow: () => void;
  returnToRoot: () => void;
  updateNodeConfig: (nodeId: string, key: string, value: unknown) => void;
  replaceNodeConfig: (nodeId: string, config: Record<string, unknown>) => void;
  setNodeBindings: (nodeId: string, bindings: NonNullable<WorkflowNode["configBindings"]>) => void;
  setWorkflowConfiguration: (fields: import("@/lib/runParameters").RunParameter[]) => void;
  updateNodeLabel: (nodeId: string, label: string) => void;
  updateNodePosition: (nodeId: string, position: { x: number; y: number }) => void;
  setNodes: (nodes: WorkflowNode[]) => void;
  setEdges: (edges: WorkflowEdge[]) => void;
  addNode: (nodeType: NodeType, position: { x: number; y: number }) => void;
  insertTemplate: (template: import("@/types").NodeTemplate) => void;
  deleteNode: (nodeId: string) => void;
  addEdge: (edge: WorkflowEdge) => void;
  deleteEdge: (edgeId: string) => void;
  saveWorkflow: () => Promise<void>;
  clearSaveError: () => void;
  reloadFromServer: () => Promise<void>;
  saveAsCopy: () => Promise<void>;
  runWorkflow: (entryNodeId?: string, input?: unknown) => Promise<RunRecord | null>;
  setWorkflowName: (name: string) => void;
  setRunMode: (mode: "live" | "preview") => void;
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
  libraryEdit: null,
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
    if (get().libraryEdit) throw new Error("请先结束个人资源编辑");
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

  replaceNodeConfig: (nodeId, config) => {
    const { workflow, canvasScope } = get();
    set({ workflow: updateActiveGraph(workflow, canvasScope, (graph) => ({ ...graph,
      nodes: graph.nodes.map((node) => node.id === nodeId ? { ...node, config } : node),
    })), isDirty: true });
  },

  setNodeBindings: (nodeId, configBindings) => {
    const { workflow, canvasScope } = get();
    set({ workflow: updateActiveGraph(workflow, canvasScope, (graph) => ({ ...graph, nodes: graph.nodes.map((node) => node.id === nodeId ? { ...node, configBindings } : node) })), isDirty: true });
  },
  setWorkflowConfiguration: (configuration) => {
    set((state) => ({ workflow: { ...state.workflow, settings: { timeout_seconds: 600, ...state.workflow.settings, configuration } }, isDirty: true }));
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
    const node = createNodeInstance(nodeType, id, position);
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

  insertTemplate: (template) => {
    const { workflow, canvasScope } = get();
    if (template.kind === "workflow" && (canvasScope.length || workflow.nodes.length)) return;
    if (template.kind !== "workflow" && templateDependencyIssue(template, workflow)) return;
    const currentGraph = getActiveGraph(workflow, canvasScope);
    if (template.kind === "subflow" && (!canvasScope.length || currentGraph.nodes.some((node) => !["control.loop_input", "control.loop_output"].includes(node.type)))) return;
    const source = template.node ? { nodes: [template.node], edges: [] } : template.graph ?? template.workflow;
    if (!source) return;
    const clone = (graph: WorkflowGraph): WorkflowGraph => {
      const ids = new Map(graph.nodes.map((node) => [node.id, crypto.randomUUID()]));
      return { nodes: graph.nodes.map((node) => ({ ...structuredClone(node), id: ids.get(node.id)!, subflows: node.subflows ? Object.fromEntries(Object.entries(node.subflows).map(([key, body]) => [key, clone(body)])) : undefined })),
        edges: graph.edges.map((edge) => ({ ...edge, id: crypto.randomUUID(), source: ids.get(edge.source)!, target: ids.get(edge.target)! })) };
    };
    const graph = clone(source);
    const next = updateActiveGraph(workflow, canvasScope, (current) => template.kind === "subflow" ? graph : ({ nodes: [...current.nodes, ...graph.nodes], edges: [...current.edges, ...graph.edges] }));
    if (template.kind === "workflow") { next.settings = { timeout_seconds: 600, ...next.settings, ...structuredClone(template.workflow?.settings ?? {}), run_mode: "preview" }; next.active = false; }
    else if (template.configuration?.length) {
      const current = next.settings?.configuration ?? [];
      next.settings = { timeout_seconds: 600, ...next.settings, configuration: [...current, ...structuredClone(template.configuration.filter((field) => !current.some((item) => item.name === field.name)))] };
    }
    if (template.variables && template.kind !== "workflow") next.settings = { timeout_seconds: 600, ...next.settings, variables: { ...structuredClone(template.variables), ...next.settings?.variables } };
    set({ workflow: next, selectedNodeId: graph.nodes[0]?.id ?? null, isDirty: true });
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
    if (get().libraryEdit) throw new Error("资源草稿请使用保存到节点库");
    const wf = get().workflow;
    if (!wf.id) return;
    set({ isSaving: true, saveError: null });
    try {
      const expectedVersion = wf.version;
      const saved = await apiClient.saveWorkflow(wf, expectedVersion);
      set({ workflow: saved, isDirty: false, isSaving: false, saveError: null });
    } catch (e) {
      set({ isSaving: false, saveError: describeSaveFailure(e) });
    }
  },

  clearSaveError: () => set({ saveError: null }),

  /** 放弃本地未保存的修改，重新加载服务器上的最新版本。 */
  reloadFromServer: async () => {
    if (get().libraryEdit) throw new Error("请先结束个人资源编辑");
    const wf = get().workflow;
    if (!wf.id) return;
    try {
      const reloaded = await apiClient.getWorkflow(wf.id);
      set({ workflow: reloaded, selectedNodeId: null, canvasScope: [], isDirty: false, saveError: null });
    } catch (e) {
      set({ saveError: describeSaveFailure(e) });
    }
  },

  /** 把当前画布另存为一个新的未发布副本，避免版本冲突阻断本地修改。 */
  saveAsCopy: async () => {
    if (get().libraryEdit) throw new Error("请先结束个人资源编辑");
    const wf = get().workflow;
    if (!wf.id) return;
    try {
      const copy = { ...wf, id: "", version: 1, name: `${wf.name || "工作流"}（副本）` };
      const saved = await apiClient.saveWorkflow(copy);
      await get().loadWorkflows();
      await get().selectWorkflow(saved.id);
      set({ saveError: null });
    } catch (e) {
      set({ saveError: describeSaveFailure(e) });
    }
  },

  runWorkflow: async (entryNodeId?, input?) => {
    if (get().libraryEdit) return null;
    const wf = get().workflow;
    if (!wf.id) return null;
    return apiClient.createRun(wf.id, entryNodeId, input);
  },

  setWorkflowName: (name) => {
    set((s) => ({ workflow: { ...s.workflow, name }, isDirty: true }));
  },
  setRunMode: (mode) => {
    set((s) => ({ workflow: { ...s.workflow, settings: { timeout_seconds: 600, ...s.workflow.settings, run_mode: mode } }, isDirty: true }));
  },
}));
