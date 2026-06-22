import { useEffect, useMemo, useRef, useState } from "react";
import { apiClient } from "./api/client";
import { CanvasEmptyState, type CanvasTemplateCard } from "./components/CanvasEmptyState";
import { ConfigPanel } from "./components/ConfigPanel";
import { FlowCanvas } from "./components/FlowCanvas";
import { NodePalette } from "./components/NodePalette";
import { PreRunIssueList } from "./components/PreRunIssueList";
import { RunPanel } from "./components/RunPanel";
import {
  createEmptyWorkflow,
  createWorkflowNode,
  getEditableWorkflow,
  scopeKey,
  scopeLabel,
  updateEditableWorkflow,
  type EditScope,
} from "./lib/workflow";
import { localizeNodeType } from "./lib/display";
import { buildPreRunIssues, type PreRunIssue } from "./lib/preRunChecks";
import { buildNodeRunStates } from "./lib/runState";
import { API_TESTING_TEMPLATES, createWorkflowFromTemplate, templateAvailability } from "./lib/workflowTemplates";
import type { NodeType, RunEvent, RunRecord, RunStatus, WorkflowDocument } from "./types";

const TERMINAL_RUN_STATUSES = new Set<RunStatus>(["succeeded", "failed", "cancelled"]);
const RUN_POLL_INTERVAL_MS = 1000;
const MAX_RUN_POLL_ATTEMPTS = 120;
type WorkflowSummary = { id: string; name: string; version: number };

export default function App() {
  const [nodeTypes, setNodeTypes] = useState<NodeType[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState("");
  const [workflow, setWorkflow] = useState<WorkflowDocument>(() => createEmptyWorkflow());
  const [editScope, setEditScope] = useState<EditScope>(undefined);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [message, setMessage] = useState("正在加载节点类型...");
  const [isBusy, setIsBusy] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [run, setRun] = useState<RunRecord | null>(null);
  const [runEvents, setRunEvents] = useState<RunEvent[]>([]);
  const [showPreRunIssues, setShowPreRunIssues] = useState(false);
  const mountedRef = useRef(true);
  const runInFlightRef = useRef(false);
  const runTokenRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      runTokenRef.current += 1;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    apiClient
      .listNodeTypes()
      .then((types) => {
        if (cancelled) {
          return;
        }
        setNodeTypes(types);
        setMessage(types.length === 0 ? "没有可用节点。" : `已加载 ${types.length} 个节点类型。`);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setMessage(`节点类型加载失败：${formatError(error)}`);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    apiClient
      .listWorkflows()
      .then((savedWorkflows) => {
        if (cancelled) {
          return;
        }
        setWorkflows(savedWorkflows);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setMessage(`工作流列表加载失败：${formatError(error)}`);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const displayNodeTypes = useMemo(() => nodeTypes.map(localizeNodeType), [nodeTypes]);
  const templateCards = useMemo<CanvasTemplateCard[]>(
    () =>
      API_TESTING_TEMPLATES.map((template) => {
        const availability = templateAvailability(template);
        return {
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
    }),
    [editableWorkflow.edges, editableWorkflow.nodes, workflow]
  );
  const selectedNode = editableWorkflow.nodes.find((node) => node.id === selectedNodeId);
  const selectedNodeType = useMemo(
    () => displayNodeTypes.find((nodeType) => nodeType.id === selectedNode?.type),
    [displayNodeTypes, selectedNode?.type]
  );
  const nodeRunStates = useMemo(
    () => buildNodeRunStates(editableWorkflow.nodes, runEvents, run?.status),
    [editableWorkflow.nodes, run?.status, runEvents]
  );
  const currentPreRunIssues = useMemo(() => buildPreRunIssues(workflow), [workflow]);
  const visiblePreRunIssues = showPreRunIssues ? currentPreRunIssues : [];
  const selectedRuntimeState = selectedNodeId ? nodeRunStates[selectedNodeId] : undefined;
  const canCancelRun = Boolean(run && !TERMINAL_RUN_STATUSES.has(run.status));

  function addNodeAt(nodeType: NodeType, position: { x: number; y: number }) {
    const nextNode = createWorkflowNode(nodeType, position);
    setWorkflow((current) => {
      const currentEditableWorkflow = getEditableWorkflow(current, editScope);
      return updateEditableWorkflow(current, editScope, {
        nodes: [...currentEditableWorkflow.nodes, nextNode],
        edges: currentEditableWorkflow.edges,
      });
    });
    setSelectedNodeId(nextNode.id);
  }

  function addNode(nodeType: NodeType) {
    const editableNodeCount = editableWorkflow.nodes.length;
    addNodeAt(nodeType, {
      x: 80 + editableNodeCount * 40,
      y: 80 + editableNodeCount * 30,
    });
  }

  function updateNodeConfig(nodeId: string, key: string, value: unknown) {
    setWorkflow((current) => {
      const currentEditableWorkflow = getEditableWorkflow(current, editScope);
      return updateEditableWorkflow(current, editScope, {
        nodes: currentEditableWorkflow.nodes.map((node) =>
          node.id === nodeId ? { ...node, config: { ...node.config, [key]: value } } : node
        ),
        edges: currentEditableWorkflow.edges,
      });
    });
  }

  function updateCurrentEditableWorkflow(nextWorkflow: WorkflowDocument) {
    setWorkflow((current) =>
      updateEditableWorkflow(current, editScope, {
        nodes: nextWorkflow.nodes,
        edges: nextWorkflow.edges,
      })
    );
  }

  function openSubflow(nodeId: string, subflowName: string) {
    setEditScope((currentScope) => [...(currentScope ?? []), { nodeId, subflowName }]);
    setSelectedNodeId(null);
  }

  function returnToMain() {
    setEditScope(undefined);
    setSelectedNodeId(null);
  }

  function selectRunEventNode(nodeId: string) {
    if (editableWorkflow.nodes.some((node) => node.id === nodeId)) {
      setSelectedNodeId(nodeId);
      return;
    }

    setMessage("这个运行事件属于未打开的子流程，请先进入对应循环体查看。");
  }

  function selectPreRunIssue(issue: PreRunIssue) {
    if (editableWorkflow.nodes.some((node) => node.id === issue.nodeId)) {
      setSelectedNodeId(issue.nodeId);
      return;
    }

    setMessage("这个运行前问题属于未打开的子流程，请先进入对应循环体查看。");
  }

  function resetRunState() {
    runTokenRef.current += 1;
    runInFlightRef.current = false;
    setRun(null);
    setRunEvents([]);
  }

  function startNewWorkflow() {
    resetRunState();
    setShowPreRunIssues(false);
    setWorkflow(createEmptyWorkflow());
    setSelectedWorkflowId("");
    setEditScope(undefined);
    setSelectedNodeId(null);
    setMessage("已新建工作流。");
  }

  function applyTemplate(templateId: string) {
    try {
      const nextWorkflow = createWorkflowFromTemplate(templateId);
      resetRunState();
      setShowPreRunIssues(false);
      setWorkflow(nextWorkflow);
      setSelectedWorkflowId("");
      setEditScope(undefined);
      setSelectedNodeId(defaultSelectedTemplateNodeId(templateId));
      setMessage(`已应用模板：${nextWorkflow.name}。`);
    } catch (error) {
      setMessage(`模板应用失败：${formatError(error)}`);
    }
  }

  async function loadWorkflow(workflowId: string) {
    setSelectedWorkflowId(workflowId);
    setShowPreRunIssues(false);
    if (!workflowId) {
      return;
    }

    resetRunState();
    setIsBusy(true);
    try {
      const loaded = await apiClient.getWorkflow(workflowId);
      setWorkflow(loaded);
      setSelectedWorkflowId(loaded.id);
      setEditScope(undefined);
      setSelectedNodeId(null);
      setMessage(`已加载 ${loaded.name} v${loaded.version}。`);
    } catch (error) {
      setMessage(`工作流加载失败：${formatError(error)}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function validateWorkflow() {
    setIsBusy(true);
    try {
      const result = await apiClient.validateWorkflow(workflow);
      setMessage(
        result.valid
          ? "工作流验证通过。"
          : `工作流有 ${result.issues.length} 个问题：${result.issues
              .map((issue) => `${issue.path}: ${issue.message}`)
              .join("; ")}`
      );
    } catch (error) {
      setMessage(`验证失败：${formatError(error)}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function saveWorkflow() {
    setIsBusy(true);
    try {
      const saved = await apiClient.saveWorkflow(workflow);
      setWorkflow(saved);
      setSelectedWorkflowId(saved.id);
      upsertWorkflowSummary(saved);
      setShowPreRunIssues(false);
      setMessage(`已保存 v${saved.version}。`);
      return saved;
    } catch (error) {
      setMessage(`保存失败：${formatError(error)}`);
      return null;
    } finally {
      setIsBusy(false);
    }
  }

  function isActiveRun(runToken: number) {
    return mountedRef.current && runTokenRef.current === runToken;
  }

  async function runWorkflow() {
    if (runInFlightRef.current) {
      return;
    }

    const issues = currentPreRunIssues;
    if (issues.length > 0) {
      setShowPreRunIssues(true);
      if (editableWorkflow.nodes.some((node) => node.id === issues[0].nodeId)) {
        setSelectedNodeId(issues[0].nodeId);
      }
      setMessage(`运行前检查发现 ${issues.length} 个问题，请先补齐配置。`);
      return;
    }

    const runToken = runTokenRef.current + 1;
    runTokenRef.current = runToken;
    runInFlightRef.current = true;
    setIsBusy(true);
    setShowPreRunIssues(false);
    setRunEvents([]);
    try {
      const saved = await apiClient.saveWorkflow(workflow);
      if (!isActiveRun(runToken)) {
        return;
      }
      setWorkflow(saved);
      setSelectedWorkflowId(saved.id);
      upsertWorkflowSummary(saved);
      setMessage(`已保存 v${saved.version}，正在运行...`);

      let currentRun = await apiClient.createRun(saved.id);
      if (!isActiveRun(runToken)) {
        return;
      }
      setRun(currentRun);
      const initialEvents = await apiClient.getRunEvents(currentRun.id);
      if (!isActiveRun(runToken)) {
        return;
      }
      setRunEvents(initialEvents);

      let attempts = 0;
      while (!TERMINAL_RUN_STATUSES.has(currentRun.status) && attempts < MAX_RUN_POLL_ATTEMPTS) {
        attempts += 1;
        await delay(RUN_POLL_INTERVAL_MS);
        if (!isActiveRun(runToken)) {
          return;
        }
        const [nextRun, nextEvents] = await Promise.all([
          apiClient.getRun(currentRun.id),
          apiClient.getRunEvents(currentRun.id),
        ]);
        if (!isActiveRun(runToken)) {
          return;
        }
        currentRun = nextRun;
        setRun(nextRun);
        setRunEvents(nextEvents);
      }

      if (!isActiveRun(runToken)) {
        return;
      }

      setMessage(
        TERMINAL_RUN_STATUSES.has(currentRun.status)
          ? `运行 ${currentRun.id} ${formatRunStatus(currentRun.status)}。`
          : `运行 ${currentRun.id} 轮询超时，已尝试 ${MAX_RUN_POLL_ATTEMPTS} 次。`
      );
    } catch (error) {
      if (isActiveRun(runToken)) {
        setMessage(`运行失败：${formatError(error)}`);
      }
    } finally {
      if (runTokenRef.current === runToken) {
        runInFlightRef.current = false;
        if (mountedRef.current) {
          setIsBusy(false);
        }
      }
    }
  }

  async function cancelRun() {
    if (!run || TERMINAL_RUN_STATUSES.has(run.status) || isCancelling) {
      return;
    }

    const runId = run.id;
    runTokenRef.current += 1;
    const cancelToken = runTokenRef.current;
    runInFlightRef.current = false;
    setIsCancelling(true);
    setIsBusy(true);
    setMessage(`正在请求取消运行 ${runId}...`);

    try {
      let currentRun = await apiClient.cancelRun(runId);
      if (!isActiveRun(cancelToken)) {
        return;
      }

      let currentEvents = await apiClient.getRunEvents(runId);
      if (!isActiveRun(cancelToken)) {
        return;
      }

      setRun(currentRun);
      setRunEvents(currentEvents);

      let attempts = 0;
      while (!TERMINAL_RUN_STATUSES.has(currentRun.status) && attempts < MAX_RUN_POLL_ATTEMPTS) {
        if (attempts > 0) {
          await delay(RUN_POLL_INTERVAL_MS);
        }
        attempts += 1;

        if (!isActiveRun(cancelToken)) {
          return;
        }

        const [nextRun, nextEvents] = await Promise.all([apiClient.getRun(runId), apiClient.getRunEvents(runId)]);
        if (!isActiveRun(cancelToken)) {
          return;
        }

        currentRun = nextRun;
        currentEvents = nextEvents;
        setRun(currentRun);
        setRunEvents(currentEvents);
      }

      setMessage(
        TERMINAL_RUN_STATUSES.has(currentRun.status)
          ? `运行 ${currentRun.id} ${formatRunStatus(currentRun.status)}。`
          : `运行 ${currentRun.id} 取消后轮询超时，已尝试 ${MAX_RUN_POLL_ATTEMPTS} 次。`
      );
    } catch (error) {
      if (isActiveRun(cancelToken)) {
        setMessage(`取消运行失败：${formatError(error)}`);
      }
    } finally {
      if (runTokenRef.current === cancelToken && mountedRef.current) {
        setIsCancelling(false);
        setIsBusy(false);
      }
    }
  }

  function upsertWorkflowSummary(saved: WorkflowDocument) {
    setWorkflows((current) => {
      const summary = { id: saved.id, name: saved.name, version: saved.version };
      const existingIndex = current.findIndex((item) => item.id === saved.id);
      if (existingIndex === -1) {
        return [...current, summary];
      }
      return current.map((item, index) => (index === existingIndex ? summary : item));
    });
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-title">节点流</span>
          <input
            aria-label="工作流名称"
            className="workflow-name"
            value={workflow.name}
            onChange={(event) => setWorkflow({ ...workflow, name: event.currentTarget.value })}
          />
          <nav aria-label="编辑范围" className="breadcrumbs">
            <button disabled={!editScope?.length} type="button" onClick={returnToMain}>
              主流程
            </button>
            {editScope?.length ? <span className="breadcrumb-current">/ {editScopeLabel}</span> : null}
          </nav>
        </div>
        <div className="topbar-actions">
          <label className="workflow-picker">
            <span>工作流</span>
            <select
              aria-label="已保存工作流"
              disabled={isBusy || workflows.length === 0}
              value={selectedWorkflowId}
              onChange={(event) => void loadWorkflow(event.currentTarget.value)}
            >
              <option value="">选择工作流...</option>
              {workflows.map((savedWorkflow) => (
                <option key={savedWorkflow.id} value={savedWorkflow.id}>
                  {savedWorkflow.name} v{savedWorkflow.version}
                </option>
              ))}
            </select>
          </label>
          <button disabled={isBusy} type="button" onClick={startNewWorkflow}>
            新建
          </button>
          <button disabled={isBusy} type="button" onClick={validateWorkflow}>
            验证
          </button>
          <button disabled={isBusy} type="button" onClick={saveWorkflow}>
            保存
          </button>
          <button className="primary-button" disabled={isBusy} type="button" onClick={runWorkflow}>
            运行
          </button>
          <button className="danger-button" disabled={!canCancelRun || isCancelling} type="button" onClick={cancelRun}>
            取消
          </button>
        </div>
      </header>

      <div className="message-bar" role="status">
        {message}
      </div>

      <PreRunIssueList issues={visiblePreRunIssues} onSelectIssue={selectPreRunIssue} />

      <main className="workspace-grid">
        <NodePalette nodeTypes={displayNodeTypes} onAddNode={addNode} />
        <FlowCanvas
          nodeRunStates={nodeRunStates}
          nodeTypes={displayNodeTypes}
          selectedNodeId={selectedNodeId}
          selectionResetKey={editScopeKey}
          workflow={canvasWorkflow}
          onAddNodeAt={addNodeAt}
          onSelectNode={setSelectedNodeId}
          onWorkflowChange={updateCurrentEditableWorkflow}
        >
          <CanvasEmptyState
            actionsDisabled={isBusy || isCancelling}
            templates={templateCards}
            onApplyTemplate={applyTemplate}
          />
        </FlowCanvas>
        <ConfigPanel
          node={selectedNode}
          nodeType={selectedNodeType}
          runtimeState={selectedRuntimeState}
          onConfigChange={updateNodeConfig}
          onOpenSubflow={openSubflow}
        />
        <RunPanel events={runEvents} run={run} onSelectNode={selectRunEventNode} />
      </main>
    </div>
  );
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatRunStatus(status: RunStatus): string {
  switch (status) {
    case "succeeded":
      return "成功";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
    case "running":
      return "运行中";
    case "queued":
      return "排队中";
  }
}

function defaultSelectedTemplateNodeId(templateId: string): string | null {
  switch (templateId) {
    case "single-api-status-code":
      return "request";
    case "csv-parameterized-api":
      return "csv";
    default:
      return null;
  }
}
