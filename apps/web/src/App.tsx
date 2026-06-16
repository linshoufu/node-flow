import { useEffect, useMemo, useRef, useState } from "react";
import { apiClient } from "./api/client";
import { ConfigPanel } from "./components/ConfigPanel";
import { FlowCanvas } from "./components/FlowCanvas";
import { NodePalette } from "./components/NodePalette";
import { RunPanel } from "./components/RunPanel";
import { createEmptyWorkflow, createWorkflowNode } from "./lib/workflow";
import type { NodeType, RunEvent, RunRecord, RunStatus, WorkflowDocument } from "./types";

const TERMINAL_RUN_STATUSES = new Set<RunStatus>(["succeeded", "failed", "cancelled"]);
const RUN_POLL_INTERVAL_MS = 1000;
const MAX_RUN_POLL_ATTEMPTS = 120;

export default function App() {
  const [nodeTypes, setNodeTypes] = useState<NodeType[]>([]);
  const [workflow, setWorkflow] = useState<WorkflowDocument>(() => createEmptyWorkflow());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [message, setMessage] = useState("Loading node types...");
  const [isBusy, setIsBusy] = useState(false);
  const [run, setRun] = useState<RunRecord | null>(null);
  const [runEvents, setRunEvents] = useState<RunEvent[]>([]);
  const mountedRef = useRef(true);
  const runInFlightRef = useRef(false);
  const runTokenRef = useRef(0);

  useEffect(() => {
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
        setMessage(types.length === 0 ? "No node types available." : `Loaded ${types.length} node types.`);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setMessage(`Node type load failed: ${formatError(error)}`);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedNode = workflow.nodes.find((node) => node.id === selectedNodeId);
  const selectedNodeType = useMemo(
    () => nodeTypes.find((nodeType) => nodeType.id === selectedNode?.type),
    [nodeTypes, selectedNode?.type]
  );

  function addNode(nodeType: NodeType) {
    const nextNode = createWorkflowNode(nodeType, {
      x: 80 + workflow.nodes.length * 40,
      y: 80 + workflow.nodes.length * 30,
    });

    setWorkflow((current) => ({
      ...current,
      nodes: [...current.nodes, nextNode],
    }));
    setSelectedNodeId(nextNode.id);
  }

  function updateNodeConfig(nodeId: string, key: string, value: unknown) {
    setWorkflow((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        node.id === nodeId ? { ...node, config: { ...node.config, [key]: value } } : node
      ),
    }));
  }

  async function validateWorkflow() {
    setIsBusy(true);
    try {
      const result = await apiClient.validateWorkflow(workflow);
      setMessage(
        result.valid
          ? "Workflow is valid."
          : `Workflow has ${result.issues.length} issue${result.issues.length === 1 ? "" : "s"}: ${result.issues
              .map((issue) => `${issue.path}: ${issue.message}`)
              .join("; ")}`
      );
    } catch (error) {
      setMessage(`Validate failed: ${formatError(error)}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function saveWorkflow() {
    setIsBusy(true);
    try {
      const saved = await apiClient.saveWorkflow(workflow);
      setWorkflow(saved);
      setMessage(`Saved version ${saved.version}.`);
      return saved;
    } catch (error) {
      setMessage(`Save failed: ${formatError(error)}`);
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

    const runToken = runTokenRef.current + 1;
    runTokenRef.current = runToken;
    runInFlightRef.current = true;
    setIsBusy(true);
    setRunEvents([]);
    try {
      const saved = await apiClient.saveWorkflow(workflow);
      if (!isActiveRun(runToken)) {
        return;
      }
      setWorkflow(saved);
      setMessage(`Saved version ${saved.version}. Starting run...`);

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
          ? `Run ${currentRun.id} ${currentRun.status}.`
          : `Run ${currentRun.id} polling timed out after ${MAX_RUN_POLL_ATTEMPTS} attempts.`
      );
    } catch (error) {
      if (isActiveRun(runToken)) {
        setMessage(`Run failed: ${formatError(error)}`);
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

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-title">Node Flow</span>
          <input
            aria-label="Workflow name"
            className="workflow-name"
            value={workflow.name}
            onChange={(event) => setWorkflow({ ...workflow, name: event.currentTarget.value })}
          />
        </div>
        <div className="topbar-actions">
          <button disabled={isBusy} type="button" onClick={validateWorkflow}>
            Validate
          </button>
          <button disabled={isBusy} type="button" onClick={saveWorkflow}>
            Save
          </button>
          <button className="primary-button" disabled={isBusy} type="button" onClick={runWorkflow}>
            Run
          </button>
        </div>
      </header>

      <div className="message-bar" role="status">
        {message}
      </div>

      <main className="workspace-grid">
        <NodePalette nodeTypes={nodeTypes} onAddNode={addNode} />
        <FlowCanvas
          nodeTypes={nodeTypes}
          selectedNodeId={selectedNodeId}
          workflow={workflow}
          onSelectNode={setSelectedNodeId}
          onWorkflowChange={setWorkflow}
        />
        <ConfigPanel node={selectedNode} nodeType={selectedNodeType} onConfigChange={updateNodeConfig} />
        <RunPanel events={runEvents} run={run} />
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
