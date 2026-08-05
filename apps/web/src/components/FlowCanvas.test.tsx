import { act, cleanup, createEvent, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NodeType, WorkflowDocument } from "../types";
import { FlowCanvas } from "./FlowCanvas";

const reactFlowProps = vi.hoisted(() => ({
  current: undefined as undefined | Record<string, unknown>,
}));
const miniMapProps = vi.hoisted(() => ({
  current: undefined as undefined | Record<string, unknown>,
}));
const updateNodeInternals = vi.hoisted(() => vi.fn());
const reactFlowApi = vi.hoisted(() => ({
  fitView: vi.fn(),
  zoomIn: vi.fn(),
  zoomOut: vi.fn(),
}));

vi.mock("@xyflow/react", () => ({
  Background: () => null,
  Controls: () => null,
  MiniMap: (props: Record<string, unknown>) => {
    miniMapProps.current = props;
    return <div aria-label={String(props.ariaLabel)} />;
  },
  Handle: (props: Record<string, unknown>) => (
    <div
      className={typeof props.className === "string" ? props.className : undefined}
      data-handle-id={String(props.id)}
      data-handle-type={String(props.type)}
      title={typeof props.title === "string" ? props.title : undefined}
    />
  ),
  MarkerType: { ArrowClosed: "arrowclosed" },
  Position: { Left: "left", Right: "right" },
  ReactFlow: (props: Record<string, unknown>) => {
    reactFlowProps.current = props;
    const nodeTypes = props.nodeTypes as Record<string, (nodeProps: Record<string, unknown>) => ReactNode> | undefined;
    const nodes = props.nodes as Array<Record<string, unknown>> | undefined;

    return (
      <div aria-label="Mock React Flow">
        {props.children as ReactNode}
        {nodes?.map((node) => {
          const NodeComponent = nodeTypes?.[String(node.type)];
          return NodeComponent ? (
            <div key={String(node.id)}>{NodeComponent({ ...node, data: node.data, selected: node.selected })}</div>
          ) : null;
        })}
      </div>
    );
  },
  ReactFlowProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useReactFlow: () => ({
    fitView: reactFlowApi.fitView,
    screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x: x - 10, y: y - 20 }),
    zoomIn: reactFlowApi.zoomIn,
    zoomOut: reactFlowApi.zoomOut,
  }),
  useUpdateNodeInternals: () => updateNodeInternals,
}));

const manualTriggerType: NodeType = {
  id: "manual.trigger",
  name: "Manual Trigger",
  category: "trigger",
  description: "Start a workflow manually.",
  inputs: {},
  outputs: {
    output: {},
  },
  configSchema: {
    type: "object",
    properties: {
      payload: { type: "object", additionalProperties: true },
    },
  },
};

const logType: NodeType = {
  id: "utility.log",
  name: "Log",
  category: "utility",
  description: "Write an input value to the run log.",
  inputs: {
    input: {},
  },
  outputs: {},
  configSchema: {
    type: "object",
    properties: {},
  },
};

const workflow: WorkflowDocument = {
  id: "wf_test",
  name: "Test Workflow",
  version: 1,
  nodes: [
    {
      id: "node_manual",
      type: "manual.trigger",
      position: { x: 80, y: 80 },
      config: { payload: {} },
    },
  ],
  edges: [],
};

const emptyWorkflow: WorkflowDocument = {
  ...workflow,
  nodes: [],
  edges: [],
};

const workflowWithEdge: WorkflowDocument = {
  ...workflow,
  nodes: [
    ...workflow.nodes,
    {
      id: "node_log",
      type: "utility.log",
      position: { x: 320, y: 80 },
      config: {},
    },
  ],
  edges: [
    {
      id: "edge_manual_log",
      source: "node_manual",
      sourceHandle: "output",
      target: "node_log",
      targetHandle: "input",
    },
  ],
};

describe("FlowCanvas", () => {
  afterEach(() => {
    cleanup();
    reactFlowProps.current = undefined;
    miniMapProps.current = undefined;
    reactFlowApi.fitView.mockClear();
    reactFlowApi.zoomIn.mockClear();
    reactFlowApi.zoomOut.mockClear();
    updateNodeInternals.mockClear();
  });

  it("passes selected state into controlled React Flow nodes", () => {
    render(
      <FlowCanvas
        nodeTypes={[manualTriggerType]}
        selectedNodeId="node_manual"
        workflow={workflow}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      />
    );

    expect(reactFlowProps.current).toBeDefined();
    const nodes = reactFlowProps.current?.nodes as Array<Record<string, unknown>>;
    expect(nodes[0]).toHaveProperty("selected", true);
    expect(reactFlowProps.current?.deleteKeyCode).toEqual(["Delete", "Backspace"]);
    expect(reactFlowProps.current?.multiSelectionKeyCode).toEqual(["Control", "Meta", "Shift"]);
    expect(reactFlowProps.current?.selectionKeyCode).toBe("Shift");
    expect(reactFlowProps.current?.onSelectionChange).toBeUndefined();
    expect(reactFlowProps.current?.proOptions).toEqual({ hideAttribution: true });
  });

  it("copies the selected nodes and pastes from the editor clipboard", () => {
    const onCopyNodes = vi.fn();
    const onPasteNodes = vi.fn();
    render(
      <FlowCanvas
        hasNodeClipboard
        nodeTypes={[manualTriggerType]}
        selectedNodeId="node_manual"
        workflow={workflow}
        onCopyNodes={onCopyNodes}
        onPasteNodes={onPasteNodes}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "复制所选节点" }));
    fireEvent.click(screen.getByRole("button", { name: "粘贴节点" }));

    expect(onCopyNodes).toHaveBeenCalledWith(["node_manual"]);
    expect(onPasteNodes).toHaveBeenCalledOnce();
  });

  it("reports multiple selected workflow nodes while retaining the most recent primary node", () => {
    const onSelectNodes = vi.fn();
    render(
      <FlowCanvas
        nodeTypes={[manualTriggerType, logType]}
        selectedNodeId={null}
        selectedNodeIds={[]}
        workflow={workflowWithEdge}
        onSelectNode={vi.fn()}
        onSelectNodes={onSelectNodes}
        onWorkflowChange={vi.fn()}
      />
    );

    const onNodesChange = reactFlowProps.current?.onNodesChange as (changes: unknown[]) => void;
    onNodesChange([
      { id: "node_manual", selected: true, type: "select" },
      { id: "node_log", selected: true, type: "select" },
    ]);

    expect(onSelectNodes).toHaveBeenCalledWith(["node_manual", "node_log"], "node_log");
  });

  it("passes runtime state into controlled React Flow nodes", () => {
    render(
      <FlowCanvas
        nodeRunStates={{
          node_manual: {
            nodeId: "node_manual",
            status: "succeeded",
            outputs: { success: {} },
            durationMs: 3,
            scopes: [[]],
          },
        }}
        nodeTypes={[manualTriggerType]}
        selectedNodeId="node_manual"
        workflow={workflow}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      />
    );

    const nodes = reactFlowProps.current?.nodes as Array<{ data: Record<string, unknown> }>;
    expect(nodes[0].data.runtimeState).toMatchObject({
      nodeId: "node_manual",
      status: "succeeded",
      durationMs: 3,
    });
  });

  it("shows execution input and output item summaries on run nodes", () => {
    render(
      <FlowCanvas
        nodeRunStates={{
          node_manual: {
            nodeId: "node_manual",
            status: "succeeded",
            outputs: { success: [{ ok: false }, { ok: true }] },
            durationMs: 3,
            scopes: [[], ["foreach", "iteration:0"]],
            executions: [
              {
                runIndex: 0,
                status: "succeeded",
                scope: [],
                inputItems: [{ json: { row: 1 } }],
                outputs: {
                  success: {
                    name: "success",
                    value: { ok: true },
                    items: [{ json: { ok: true } }],
                  },
                },
                events: [],
              },
              {
                runIndex: 1,
                status: "succeeded",
                scope: ["foreach", "iteration:0"],
                inputItems: [{ json: { row: 2 } }, { json: { row: 3 } }],
                outputs: {
                  success: {
                    name: "success",
                    value: [{ ok: false }, { ok: true }],
                    items: [{ json: { ok: false } }, { json: { ok: true } }],
                  },
                },
                events: [],
              },
            ],
          },
        }}
        nodeTypes={[manualTriggerType]}
        selectedNodeId="node_manual"
        workflow={workflow}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      />
    );

    expect(screen.getByText("2 次执行")).toBeInTheDocument();
    expect(screen.getByText("3 项输入")).toBeInTheDocument();
    expect(screen.getByText("3 项输出")).toBeInTheDocument();
  });

  it("shows product-facing node subtitles instead of internal node type ids on the canvas", () => {
    render(
      <FlowCanvas
        nodeTypes={[manualTriggerType]}
        selectedNodeId={null}
        workflow={workflow}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      />
    );

    expect(screen.getByText("Manual Trigger")).toBeInTheDocument();
    expect(screen.getByText("触发器")).toBeInTheDocument();
    expect(screen.queryByText("manual.trigger")).not.toBeInTheDocument();
  });

  it("renders node type icons from metadata on canvas nodes", () => {
    render(
      <FlowCanvas
        nodeTypes={[{ ...manualTriggerType, icon: "play" }]}
        selectedNodeId={null}
        workflow={workflow}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      />
    );

    expect(screen.getByTitle("节点图标：play")).toBeInTheDocument();
  });

  it("uses configured node labels as canvas node titles", () => {
    render(
      <FlowCanvas
        nodeTypes={[manualTriggerType]}
        selectedNodeId={null}
        workflow={{
          ...workflow,
          nodes: [
            {
              ...workflow.nodes[0],
              config: { label: "登录入口" },
            },
          ],
        }}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      />
    );

    expect(screen.getByText("登录入口")).toBeInTheDocument();
    expect(screen.queryByText("Manual Trigger")).not.toBeInTheDocument();
    expect(screen.getByText("触发器")).toBeInTheDocument();
  });

  it("opens the first node issue when a canvas issue badge is clicked", () => {
    const onSelectIssue = vi.fn();
    const issue = {
      id: "pre_run:node_manual:payload",
      source: "pre_run" as const,
      severity: "error" as const,
      title: "节点配置问题",
      message: "缺少 payload。",
      location: "节点 node_manual",
      target: { kind: "node" as const, nodeId: "node_manual", field: "payload" },
    };
    render(
      <FlowCanvas
        nodeIssues={{
          node_manual: [issue],
        }}
        nodeTypes={[manualTriggerType]}
        selectedNodeId={null}
        workflow={workflow}
        onSelectIssue={onSelectIssue}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "查看节点问题：Manual Trigger，1 个问题" }));

    expect(onSelectIssue).toHaveBeenCalledWith(issue);
    expect(screen.getByTitle("此节点有 1 个问题：1 个错误")).toBeInTheDocument();
  });

  it("uses unified node run detail counters for canvas run summaries", () => {
    render(
      <FlowCanvas
        nodeRunDetails={{
          node_manual: {
            nodeId: "node_manual",
            hasData: true,
            status: "succeeded",
            executionCount: 2,
            latestRunIndex: 1,
            latestScope: [],
            latestDurationMs: 8,
            inputItemCount: 3,
            outputItemCount: 4,
            latestInputItemCount: 1,
            latestOutputItemCount: 2,
            eventCount: 5,
            latestEventCount: 2,
            errorCount: 0,
          },
        }}
        nodeRunStates={{
          node_manual: {
            nodeId: "node_manual",
            status: "succeeded",
            outputs: { success: { ok: true } },
            durationMs: 3,
            scopes: [[]],
          },
        }}
        nodeTypes={[manualTriggerType]}
        selectedNodeId="node_manual"
        workflow={workflow}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      />
    );

    expect(screen.getByText("2 次执行")).toBeInTheDocument();
    expect(screen.getByText("3 项输入")).toBeInTheDocument();
    expect(screen.getByText("4 项输出")).toBeInTheDocument();
  });

  it("marks disabled nodes without hiding their ports or label", () => {
    render(
      <FlowCanvas
        nodeTypes={[manualTriggerType]}
        selectedNodeId={null}
        workflow={{
          ...workflow,
          nodes: [{ ...workflow.nodes[0], disabled: true }],
        }}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      />
    );

    const node = screen.getByText("Manual Trigger").closest(".flow-node");
    expect(node).toHaveClass("is-disabled");
    expect(within(node as HTMLElement).getByText("已禁用")).toBeInTheDocument();
    expect(within(node as HTMLElement).getByText("输出")).toBeInTheDocument();
  });

  it("shows loop, error, and duration badges in canvas run summaries", () => {
    render(
      <FlowCanvas
        nodeRunDetails={{
          node_manual: {
            nodeId: "node_manual",
            hasData: true,
            status: "failed",
            executionCount: 3,
            latestRunIndex: 2,
            latestScope: ["each", "iteration:2"],
            latestDurationMs: 1280,
            inputItemCount: 5,
            outputItemCount: 7,
            latestInputItemCount: 1,
            latestOutputItemCount: 2,
            eventCount: 8,
            latestEventCount: 2,
            errorCount: 1,
          },
        }}
        nodeRunStates={{
          node_manual: {
            nodeId: "node_manual",
            status: "failed",
            outputs: { success: { ok: false } },
            durationMs: 1280,
            scopes: [
              ["each", "iteration:0"],
              ["each", "iteration:1"],
              ["each", "iteration:2"],
            ],
          },
        }}
        nodeTypes={[manualTriggerType]}
        selectedNodeId={null}
        workflow={workflow}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      />
    );

    expect(screen.getByText("3 轮循环")).toBeInTheDocument();
    expect(screen.getByText("1 个错误")).toBeInTheDocument();
    expect(screen.getByText("耗时 1.3 秒")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "查看运行数据：Manual Trigger，3 次执行，3 轮循环，5 项输入，7 项输出，1 个错误，耗时 1.3 秒",
      })
    ).toBeInTheDocument();
  });

  it("refreshes canvas run summaries when node run detail changes", () => {
    const runtimeState = {
      nodeId: "node_manual",
      status: "pending" as const,
      scopes: [],
    };
    const { rerender } = render(
      <FlowCanvas
        nodeRunStates={{ node_manual: runtimeState }}
        nodeTypes={[manualTriggerType]}
        selectedNodeId={null}
        workflow={workflow}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      />
    );

    expect(screen.queryByRole("button", { name: /查看运行数据：Manual Trigger/ })).not.toBeInTheDocument();

    rerender(
      <FlowCanvas
        nodeRunDetails={{
          node_manual: {
            nodeId: "node_manual",
            hasData: true,
            status: "succeeded",
            executionCount: 2,
            latestRunIndex: 1,
            latestScope: [],
            inputItemCount: 1,
            outputItemCount: 3,
            latestInputItemCount: 1,
            latestOutputItemCount: 2,
            eventCount: 4,
            latestEventCount: 2,
            errorCount: 0,
          },
        }}
        nodeRunStates={{ node_manual: runtimeState }}
        nodeTypes={[manualTriggerType]}
        selectedNodeId={null}
        workflow={workflow}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: /查看运行数据：Manual Trigger/ })).toBeInTheDocument();
    expect(screen.getByText("2 次执行")).toBeInTheDocument();
    expect(screen.getByText("3 项输出")).toBeInTheDocument();
  });

  it("opens node runtime details when the run summary is clicked", () => {
    const onOpenNodeRuntime = vi.fn();
    render(
      <FlowCanvas
        nodeRunStates={{
          node_manual: {
            nodeId: "node_manual",
            status: "succeeded",
            outputs: { success: { ok: true } },
            durationMs: 3,
            scopes: [[]],
            executions: [
              {
                runIndex: 0,
                status: "succeeded",
                scope: [],
                inputItems: [{ json: { row: 1 } }],
                outputs: {
                  success: {
                    name: "success",
                    value: { ok: true },
                    items: [{ json: { ok: true } }],
                  },
                },
                events: [],
              },
            ],
          },
        }}
        nodeTypes={[manualTriggerType]}
        selectedNodeId={null}
        workflow={workflow}
        onOpenNodeRuntime={onOpenNodeRuntime}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /查看运行数据：Manual Trigger/ }));

    expect(onOpenNodeRuntime).toHaveBeenCalledWith({ nodeId: "node_manual", scope: [], source: "canvas" });
  });
  it("sets initial node dimensions so React Flow does not hide nodes before measuring them", () => {
    render(
      <FlowCanvas
        nodeTypes={[manualTriggerType]}
        selectedNodeId={null}
        workflow={workflow}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      />
    );

    const nodes = reactFlowProps.current?.nodes as Array<Record<string, unknown>>;
    expect(nodes[0]).toHaveProperty("initialWidth", 190);
    expect(nodes[0]).toHaveProperty("initialHeight", 110);
  });

  it("uses Chinese canvas controls instead of React Flow's default English controls", () => {
    render(
      <FlowCanvas
        nodeTypes={[manualTriggerType]}
        selectedNodeId={null}
        workflow={workflow}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "放大画布" }));
    fireEvent.click(screen.getByRole("button", { name: "缩小画布" }));
    fireEvent.click(screen.getByRole("button", { name: "适应画布" }));

    expect(reactFlowApi.zoomIn).toHaveBeenCalledTimes(1);
    expect(reactFlowApi.zoomOut).toHaveBeenCalledTimes(1);
    expect(reactFlowApi.fitView).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Zoom In" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Fit View" })).not.toBeInTheDocument();
  });

  it("shows a navigable minimap only when the user asks for a canvas overview", () => {
    render(
      <FlowCanvas
        nodeTypes={[manualTriggerType]}
        selectedNodeId={null}
        workflow={workflow}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      />
    );

    expect(screen.queryByLabelText("画布导航缩略图")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "显示导航缩略图" }));

    expect(screen.getByLabelText("画布导航缩略图")).toBeInTheDocument();
    expect(miniMapProps.current).toMatchObject({ pannable: true, zoomable: true });
    expect(screen.getByRole("button", { name: "隐藏导航缩略图" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "隐藏导航缩略图" }));

    expect(screen.queryByLabelText("画布导航缩略图")).not.toBeInTheDocument();
  });

  it("offers a duplicate action only for the selected editable workflow node", () => {
    const onDuplicateNodes = vi.fn();
    const { rerender } = render(
      <FlowCanvas
        nodeTypes={[manualTriggerType]}
        selectedNodeId={null}
        workflow={workflow}
        onDuplicateNodes={onDuplicateNodes}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "复制所选节点" })).toBeDisabled();

    rerender(
      <FlowCanvas
        nodeTypes={[manualTriggerType]}
        selectedNodeId="node_manual"
        workflow={workflow}
        onDuplicateNodes={onDuplicateNodes}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "复制所选节点" }));

    expect(onDuplicateNodes).toHaveBeenCalledWith(["node_manual"]);
  });

  it("passes every selected workflow node to the duplicate action", () => {
    const onDuplicateNodes = vi.fn();
    render(
      <FlowCanvas
        nodeTypes={[manualTriggerType, logType]}
        selectedNodeId="node_log"
        selectedNodeIds={["node_manual", "node_log"]}
        workflow={workflowWithEdge}
        onDuplicateNodes={onDuplicateNodes}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "复制所选节点" }));

    expect(onDuplicateNodes).toHaveBeenCalledWith(["node_manual", "node_log"]);
  });

  it("hides canvas controls while the empty-canvas template overlay is shown", () => {
    render(
      <FlowCanvas
        nodeTypes={[manualTriggerType]}
        selectedNodeId={null}
        workflow={emptyWorkflow}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      >
        <div>空画布模板入口</div>
      </FlowCanvas>
    );

    expect(screen.getByText("空画布模板入口")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "画布控制" })).not.toBeInTheDocument();
  });

  it("keeps unchanged React Flow node objects stable across position-only rerenders", () => {
    const { rerender } = render(
      <FlowCanvas
        nodeTypes={[manualTriggerType, logType]}
        selectedNodeId={null}
        workflow={workflowWithEdge}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      />
    );
    const initialNodes = reactFlowProps.current?.nodes as Array<Record<string, unknown>>;
    const initialManualNode = initialNodes[0];
    const initialLogNode = initialNodes[1];
    const workflowWithMovedManualNode: WorkflowDocument = {
      ...workflowWithEdge,
      nodes: [{ ...workflowWithEdge.nodes[0], position: { x: 120, y: 140 } }, workflowWithEdge.nodes[1]],
    };

    rerender(
      <FlowCanvas
        nodeTypes={[manualTriggerType, logType]}
        selectedNodeId={null}
        workflow={workflowWithMovedManualNode}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      />
    );

    const nextNodes = reactFlowProps.current?.nodes as Array<Record<string, unknown>>;
    expect(nextNodes[0]).not.toBe(initialManualNode);
    expect(nextNodes[1]).toBe(initialLogNode);
  });

  it("keeps measured dimensions from React Flow node changes", () => {
    render(
      <FlowCanvas
        nodeTypes={[manualTriggerType]}
        selectedNodeId={null}
        workflow={workflow}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      />
    );

    const onNodesChange = reactFlowProps.current?.onNodesChange as (changes: Array<Record<string, unknown>>) => void;
    act(() => {
      onNodesChange([
        {
          id: "node_manual",
          type: "dimensions",
          dimensions: { width: 190, height: 93 },
          setAttributes: true,
        },
      ]);
    });

    const nodes = reactFlowProps.current?.nodes as Array<Record<string, unknown>>;
    expect(nodes[0]).toHaveProperty("measured", { width: 190, height: 93 });
    expect(nodes[0]).toHaveProperty("width", 190);
    expect(nodes[0]).toHaveProperty("height", 93);
  });

  it("does not fit an empty canvas before nodes are added", () => {
    render(
      <FlowCanvas
        nodeTypes={[manualTriggerType]}
        selectedNodeId={null}
        workflow={emptyWorkflow}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      />
    );

    expect(reactFlowProps.current?.fitView).toBeUndefined();
  });

  it("fits the canvas once for each explicit workflow loading request", () => {
    const { rerender } = render(
      <FlowCanvas
        fitRequestKey="workflow:1"
        nodeTypes={[manualTriggerType]}
        selectedNodeId={null}
        workflow={workflow}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      />
    );

    expect(reactFlowApi.fitView).toHaveBeenCalledTimes(1);
    expect(reactFlowApi.fitView).toHaveBeenLastCalledWith({ duration: 180, padding: 0.18 });

    rerender(
      <FlowCanvas
        fitRequestKey="workflow:1"
        nodeTypes={[manualTriggerType]}
        selectedNodeId={null}
        workflow={workflow}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      />
    );
    expect(reactFlowApi.fitView).toHaveBeenCalledTimes(1);

    rerender(
      <FlowCanvas
        fitRequestKey="workflow:2"
        nodeTypes={[manualTriggerType]}
        selectedNodeId={null}
        workflow={workflow}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      />
    );
    expect(reactFlowApi.fitView).toHaveBeenCalledTimes(2);
  });

  it("renders children as an overlay on an empty canvas", () => {
    render(
      <FlowCanvas
        nodeTypes={[manualTriggerType]}
        selectedNodeId={null}
        workflow={emptyWorkflow}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      >
        <button type="button">使用模板</button>
      </FlowCanvas>
    );

    expect(screen.getByRole("button", { name: "使用模板" })).toBeInTheDocument();
  });

  it("hides children when the editable workflow has nodes", () => {
    render(
      <FlowCanvas
        nodeTypes={[manualTriggerType]}
        selectedNodeId={null}
        workflow={workflow}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      >
        <button type="button">使用模板</button>
      </FlowCanvas>
    );

    expect(screen.queryByRole("button", { name: "使用模板" })).not.toBeInTheDocument();
  });

  it("round-trips select node changes into app selection", () => {
    const onSelectNode = vi.fn();
    render(
      <FlowCanvas
        nodeTypes={[manualTriggerType]}
        selectedNodeId={null}
        workflow={workflow}
        onSelectNode={onSelectNode}
        onWorkflowChange={vi.fn()}
      />
    );

    expect(reactFlowProps.current).toBeDefined();
    expect(reactFlowProps.current?.onSelectionChange).toBeUndefined();

    const onNodesChange = reactFlowProps.current?.onNodesChange as (changes: Array<Record<string, unknown>>) => void;
    onNodesChange([{ id: "node_manual", type: "select", selected: true }]);
    expect(onSelectNode).toHaveBeenLastCalledWith("node_manual");
  });

  it("round-trips deselect node changes into app selection", () => {
    const onSelectNode = vi.fn();
    render(
      <FlowCanvas
        nodeTypes={[manualTriggerType]}
        selectedNodeId="node_manual"
        workflow={workflow}
        onSelectNode={onSelectNode}
        onWorkflowChange={vi.fn()}
      />
    );

    const onNodesChange = reactFlowProps.current?.onNodesChange as (changes: Array<Record<string, unknown>>) => void;
    onNodesChange([{ id: "node_manual", type: "select", selected: false }]);
    expect(onSelectNode).toHaveBeenLastCalledWith(null);
  });

  it("keeps remove changes wired while selection is controlled", () => {
    const onWorkflowChange = vi.fn();
    render(
      <FlowCanvas
        nodeTypes={[manualTriggerType, logType]}
        selectedNodeId="node_manual"
        workflow={workflowWithEdge}
        onSelectNode={vi.fn()}
        onWorkflowChange={onWorkflowChange}
      />
    );

    const onNodesChange = reactFlowProps.current?.onNodesChange as (changes: Array<Record<string, unknown>>) => void;
    onNodesChange([{ id: "node_manual", type: "remove" }]);

    expect(onWorkflowChange).toHaveBeenCalledWith({
      ...workflowWithEdge,
      nodes: [workflowWithEdge.nodes[1]],
      edges: [],
    });
  });

  it("passes selected edge changes into controlled React Flow edges", () => {
    render(
      <FlowCanvas
        nodeTypes={[manualTriggerType, logType]}
        selectedNodeId={null}
        workflow={workflowWithEdge}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      />
    );

    const initialEdges = reactFlowProps.current?.edges as Array<Record<string, unknown>>;
    expect(initialEdges[0]).toHaveProperty("selected", false);

    const onEdgesChange = reactFlowProps.current?.onEdgesChange as (changes: Array<Record<string, unknown>>) => void;
    act(() => {
      onEdgesChange([{ id: "edge_manual_log", type: "select", selected: true }]);
    });

    const selectedEdges = reactFlowProps.current?.edges as Array<Record<string, unknown>>;
    expect(selectedEdges[0]).toHaveProperty("selected", true);
    expect(selectedEdges[0]).toHaveProperty("label", "输出 → 输入");

    act(() => {
      onEdgesChange([{ id: "edge_manual_log", type: "select", selected: false }]);
    });

    const deselectedEdges = reactFlowProps.current?.edges as Array<Record<string, unknown>>;
    expect(deselectedEdges[0]).toHaveProperty("selected", false);
  });

  it("selects a focused edge requested from outside the canvas", () => {
    const { rerender } = render(
      <FlowCanvas
        focusedEdgeId="edge_manual_log"
        focusedEdgeRequestKey={1}
        nodeTypes={[manualTriggerType, logType]}
        selectedNodeId={null}
        workflow={workflowWithEdge}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      />
    );

    expect((reactFlowProps.current?.edges as Array<Record<string, unknown>>)[0]).toHaveProperty("selected", true);

    const onPaneClick = reactFlowProps.current?.onPaneClick as () => void;
    act(() => {
      onPaneClick();
    });
    expect((reactFlowProps.current?.edges as Array<Record<string, unknown>>)[0]).toHaveProperty("selected", false);

    rerender(
      <FlowCanvas
        focusedEdgeId="edge_manual_log"
        focusedEdgeRequestKey={2}
        nodeTypes={[manualTriggerType, logType]}
        selectedNodeId={null}
        workflow={workflowWithEdge}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      />
    );

    expect((reactFlowProps.current?.edges as Array<Record<string, unknown>>)[0]).toHaveProperty("selected", true);
  });

  it("marks issue edges so invalid connections are visible on the canvas", () => {
    render(
      <FlowCanvas
        edgeIssues={{
          edge_manual_log: [
            {
              id: "edge_issue",
              source: "pre_run",
              severity: "error",
              title: "连线无效",
              message: "目标节点没有输入端口 old_input。",
              location: "连线 edge_manual_log",
              target: { kind: "edge", edgeId: "edge_manual_log" },
            },
          ],
        }}
        nodeTypes={[manualTriggerType, logType]}
        selectedNodeId={null}
        workflow={workflowWithEdge}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      />
    );

    expect((reactFlowProps.current?.edges as Array<Record<string, unknown>>)[0]).toHaveProperty(
      "className",
      expect.stringContaining("has-issue")
    );
  });

  it("shows an action bar for a selected issue edge", () => {
    const issue = {
      id: "edge_issue",
      source: "pre_run" as const,
      severity: "error" as const,
      title: "连线无效",
      message: "目标节点没有输入端口 old_input。",
      location: "连线 edge_manual_log",
      target: { kind: "edge" as const, edgeId: "edge_manual_log" },
    };
    const onSelectIssue = vi.fn();

    render(
      <FlowCanvas
        edgeIssues={{
          edge_manual_log: [issue],
        }}
        nodeTypes={[manualTriggerType, logType]}
        selectedNodeId={null}
        workflow={workflowWithEdge}
        onSelectIssue={onSelectIssue}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      />
    );

    const onEdgesChange = reactFlowProps.current?.onEdgesChange as (changes: Array<Record<string, unknown>>) => void;
    act(() => {
      onEdgesChange([{ id: "edge_manual_log", type: "select", selected: true }]);
    });

    const actionBar = screen.getByRole("region", { name: "连线问题" });
    expect(actionBar).toHaveTextContent("连线 edge_manual_log 有问题");
    expect(actionBar).toHaveTextContent("目标节点没有输入端口 old_input。");

    fireEvent.click(screen.getByRole("button", { name: "查看问题" }));

    expect(onSelectIssue).toHaveBeenCalledWith(issue);
  });

  it("deletes a selected issue edge from the canvas action bar", () => {
    const onDeleteEdge = vi.fn();

    render(
      <FlowCanvas
        edgeIssues={{
          edge_manual_log: [
            {
              id: "edge_issue",
              source: "pre_run",
              severity: "error",
              title: "连线无效",
              message: "目标节点没有输入端口 old_input。",
              location: "连线 edge_manual_log",
              target: { kind: "edge", edgeId: "edge_manual_log" },
            },
          ],
        }}
        nodeTypes={[manualTriggerType, logType]}
        selectedNodeId={null}
        workflow={workflowWithEdge}
        onDeleteEdge={onDeleteEdge}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      />
    );

    const onEdgesChange = reactFlowProps.current?.onEdgesChange as (changes: Array<Record<string, unknown>>) => void;
    act(() => {
      onEdgesChange([{ id: "edge_manual_log", type: "select", selected: true }]);
    });

    fireEvent.click(screen.getByRole("button", { name: "删除连线 edge_manual_log" }));

    expect(onDeleteEdge).toHaveBeenCalledWith("edge_manual_log");
  });

  it("disables selected issue edge mutations when the editor is locked", () => {
    const onDeleteEdge = vi.fn();
    const onWorkflowChange = vi.fn();
    const issue = {
      id: "edge_issue",
      source: "pre_run" as const,
      severity: "error" as const,
      title: "连线无效",
      message: "目标节点没有输入端口 old_input。",
      location: "连线 edge_manual_log",
      target: { kind: "edge" as const, edgeId: "edge_manual_log" },
    };
    const workflowWithInvalidTarget: WorkflowDocument = {
      ...workflowWithEdge,
      edges: [
        {
          id: "edge_manual_log",
          source: "node_manual",
          sourceHandle: "output",
          target: "node_log",
          targetHandle: "old_input",
        },
      ],
    };
    const { rerender } = render(
      <FlowCanvas
        edgeIssues={{ edge_manual_log: [issue] }}
        nodeTypes={[manualTriggerType, logType]}
        selectedNodeId={null}
        workflow={workflowWithInvalidTarget}
        onDeleteEdge={onDeleteEdge}
        onSelectNode={vi.fn()}
        onWorkflowChange={onWorkflowChange}
      />
    );

    const onEdgesChange = reactFlowProps.current?.onEdgesChange as (changes: Array<Record<string, unknown>>) => void;
    act(() => {
      onEdgesChange([{ id: "edge_manual_log", type: "select", selected: true }]);
    });

    rerender(
      <FlowCanvas
        disabled
        edgeIssues={{ edge_manual_log: [issue] }}
        nodeTypes={[manualTriggerType, logType]}
        selectedNodeId={null}
        workflow={workflowWithInvalidTarget}
        onDeleteEdge={onDeleteEdge}
        onSelectNode={vi.fn()}
        onWorkflowChange={onWorkflowChange}
      />
    );

    const repairButton = screen.getByRole("button", { name: "改接到输入端口 输入" });
    const deleteButton = screen.getByRole("button", { name: "删除连线 edge_manual_log" });
    expect(repairButton).toBeDisabled();
    expect(deleteButton).toBeDisabled();

    fireEvent.click(repairButton);
    fireEvent.click(deleteButton);

    expect(onWorkflowChange).not.toHaveBeenCalled();
    expect(onDeleteEdge).not.toHaveBeenCalled();
  });

  it("repairs a selected issue edge by retargeting it to a valid input port", () => {
    const onWorkflowChange = vi.fn();
    const workflowWithInvalidTarget: WorkflowDocument = {
      ...workflowWithEdge,
      edges: [
        {
          id: "edge_manual_log",
          source: "node_manual",
          sourceHandle: "output",
          target: "node_log",
          targetHandle: "old_input",
        },
      ],
    };

    render(
      <FlowCanvas
        edgeIssues={{
          edge_manual_log: [
            {
              id: "edge_issue",
              source: "pre_run",
              severity: "error",
              title: "连线无效",
              message: "目标节点没有输入端口 old_input。",
              location: "连线 edge_manual_log",
              target: { kind: "edge", edgeId: "edge_manual_log" },
            },
          ],
        }}
        nodeTypes={[manualTriggerType, logType]}
        selectedNodeId={null}
        workflow={workflowWithInvalidTarget}
        onSelectNode={vi.fn()}
        onWorkflowChange={onWorkflowChange}
      />
    );

    const onEdgesChange = reactFlowProps.current?.onEdgesChange as (changes: Array<Record<string, unknown>>) => void;
    act(() => {
      onEdgesChange([{ id: "edge_manual_log", type: "select", selected: true }]);
    });

    fireEvent.click(screen.getByRole("button", { name: "改接到输入端口 输入" }));

    expect(onWorkflowChange).toHaveBeenCalledWith({
      ...workflowWithInvalidTarget,
      edges: [
        {
          id: "edge_manual_log",
          source: "node_manual",
          sourceHandle: "output",
          target: "node_log",
          targetHandle: "input",
        },
      ],
    });
  });

  it("does not offer incompatible input ports as edge repair candidates", () => {
    const strictSinkType: NodeType = {
      ...logType,
      inputs: {
        input: { displayName: "文本输入", schema: { type: "string" } },
      },
    };
    const numericTriggerType: NodeType = {
      ...manualTriggerType,
      outputs: {
        output: { displayName: "数字输出", schema: { type: "number" } },
      },
    };
    const workflowWithInvalidTarget: WorkflowDocument = {
      ...workflowWithEdge,
      edges: [
        {
          id: "edge_manual_log",
          source: "node_manual",
          sourceHandle: "output",
          target: "node_log",
          targetHandle: "old_input",
        },
      ],
    };

    render(
      <FlowCanvas
        edgeIssues={{
          edge_manual_log: [
            {
              id: "edge_issue",
              source: "pre_run",
              severity: "error",
              title: "连线无效",
              message: "目标节点没有输入端口 old_input。",
              location: "连线 edge_manual_log",
              target: { kind: "edge", edgeId: "edge_manual_log" },
            },
          ],
        }}
        nodeTypes={[numericTriggerType, strictSinkType]}
        selectedNodeId={null}
        workflow={workflowWithInvalidTarget}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      />
    );

    const onEdgesChange = reactFlowProps.current?.onEdgesChange as (changes: Array<Record<string, unknown>>) => void;
    act(() => {
      onEdgesChange([{ id: "edge_manual_log", type: "select", selected: true }]);
    });

    expect(screen.getByRole("region", { name: "连线问题" })).toHaveTextContent("没有可直接改接的输入端口");
    expect(screen.queryByRole("button", { name: "改接到输入端口 文本输入" })).not.toBeInTheDocument();
  });

  it("adds runtime item counts to canvas connection edges", () => {
    render(
      <FlowCanvas
        nodeRunDetails={{
          node_manual: {
            nodeId: "node_manual",
            hasData: true,
            status: "succeeded",
            executionCount: 1,
            latestRunIndex: 0,
            latestScope: [],
            inputItemCount: 0,
            outputItemCount: 2,
            latestInputItemCount: 0,
            latestOutputItemCount: 2,
            eventCount: 2,
            latestEventCount: 2,
            errorCount: 0,
            latestExecution: {
              nodeId: "node_manual",
              runIndex: 0,
              status: "succeeded",
              scope: [],
              outputs: {
                output: {
                  name: "output",
                  value: [{ ok: true }, { ok: false }],
                  items: [{ json: { ok: true } }, { json: { ok: false } }],
                },
              },
              events: [],
            },
          },
        }}
        nodeTypes={[manualTriggerType, logType]}
        selectedNodeId={null}
        workflow={workflowWithEdge}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      />
    );

    const edges = reactFlowProps.current?.edges as Array<Record<string, unknown>>;
    expect(edges[0]).toHaveProperty("label", "2 项数据");
    expect(edges[0]).toHaveProperty("className", expect.stringContaining("has-run-data"));
    expect(edges[0]).toHaveProperty(
      "data",
      expect.objectContaining({
        itemCount: 2,
        source: expect.objectContaining({ handle: "output", nodeId: "node_manual" }),
        status: "succeeded",
        target: expect.objectContaining({ handle: "input", nodeId: "node_log" }),
      })
    );

    const onEdgesChange = reactFlowProps.current?.onEdgesChange as (changes: Array<Record<string, unknown>>) => void;
    act(() => {
      onEdgesChange([{ id: "edge_manual_log", type: "select", selected: true }]);
    });

    const selectedEdges = reactFlowProps.current?.edges as Array<Record<string, unknown>>;
    expect(selectedEdges[0]).toHaveProperty("label", "输出 → 输入 · 2 项数据");
  });

  it("clears selected edges when the selection reset key changes", () => {
    const { rerender } = render(
      <FlowCanvas
        nodeTypes={[manualTriggerType, logType]}
        selectedNodeId={null}
        selectionResetKey="root"
        workflow={workflowWithEdge}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      />
    );

    const onEdgesChange = reactFlowProps.current?.onEdgesChange as (changes: Array<Record<string, unknown>>) => void;
    act(() => {
      onEdgesChange([{ id: "edge_manual_log", type: "select", selected: true }]);
    });
    expect((reactFlowProps.current?.edges as Array<Record<string, unknown>>)[0]).toHaveProperty("selected", true);

    rerender(
      <FlowCanvas
        nodeTypes={[manualTriggerType, logType]}
        selectedNodeId={null}
        selectionResetKey="foreach.body"
        workflow={workflowWithEdge}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      />
    );

    expect((reactFlowProps.current?.edges as Array<Record<string, unknown>>)[0]).toHaveProperty("selected", false);
  });

  it("removes edges from controlled React Flow edge changes", () => {
    const onWorkflowChange = vi.fn();
    render(
      <FlowCanvas
        nodeTypes={[manualTriggerType, logType]}
        selectedNodeId={null}
        workflow={workflowWithEdge}
        onSelectNode={vi.fn()}
        onWorkflowChange={onWorkflowChange}
      />
    );

    const onEdgesChange = reactFlowProps.current?.onEdgesChange as (changes: Array<Record<string, unknown>>) => void;
    onEdgesChange([{ id: "edge_manual_log", type: "remove" }]);

    expect(onWorkflowChange).toHaveBeenCalledWith({
      ...workflowWithEdge,
      edges: [],
    });
  });

  it("passes a connection validator to React Flow", () => {
    render(
      <FlowCanvas
        nodeTypes={[manualTriggerType, logType]}
        selectedNodeId={null}
        workflow={workflowWithEdge}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      />
    );

    const isValidConnection = reactFlowProps.current?.isValidConnection as (connection: Record<string, unknown>) => boolean;

    expect(isValidConnection).toBeTypeOf("function");
    expect(
      isValidConnection({
        source: "node_manual",
        sourceHandle: "output",
        target: "node_log",
        targetHandle: "input",
      })
    ).toBe(false);
    expect(
      isValidConnection({
        source: "node_manual",
        sourceHandle: "output",
        target: "node_log",
        targetHandle: "missing",
      })
    ).toBe(false);
  });

  it("passes readable schema tooltips to node port handles", () => {
    const typedSourceType: NodeType = {
      ...manualTriggerType,
      outputs: {
        output: {
          description: "启动数据",
          schema: {
            type: "object",
            properties: {
              user_id: { type: "string" },
              token: { type: "string" },
            },
            required: ["user_id"],
          },
        },
      },
    };
    const typedTargetType: NodeType = {
      ...logType,
      inputs: {
        input: {
          required: false,
          description: "日志输入",
          schema: { type: "object" },
        },
      },
    };

    render(
      <FlowCanvas
        nodeTypes={[typedSourceType, typedTargetType]}
        selectedNodeId={null}
        workflow={workflowWithEdge}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      />
    );

    expect(screen.getByTitle("输出端口 输出 · object · 启动数据 · 字段：user_id, token · 必填：user_id")).toBeInTheDocument();
    expect(screen.getByTitle("输入端口 输入 · object · 日志输入")).toBeInTheDocument();
  });
  it("shows product-facing port labels directly on canvas nodes", () => {
    const labeledSourceType: NodeType = {
      ...manualTriggerType,
      outputs: {
        success: {
          displayName: "成功数据",
          description: "正常输出",
        },
        error: {
          displayName: "错误数据",
          category: "error",
          description: "错误输出",
        },
      },
    };
    const labeledTargetType: NodeType = {
      ...logType,
      inputs: {
        input: {
          displayName: "日志输入",
          description: "写入日志的数据",
        },
      },
    };

    render(
      <FlowCanvas
        nodeTypes={[labeledSourceType, labeledTargetType]}
        selectedNodeId={null}
        workflow={workflowWithEdge}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      />
    );

    expect(screen.getByText("成功数据")).toBeInTheDocument();
    expect(screen.getByText("错误数据")).toBeInTheDocument();
    expect(screen.getByText("日志输入")).toBeInTheDocument();
  });

  it("keeps multiple port labels in a dedicated section outside node content", () => {
    const collectType: NodeType = {
      ...logType,
      id: "data.collect",
      name: "命名汇聚",
      description: "将多个具名输入端口的值汇聚为一个对象。",
      inputs: {},
      outputs: { output: { displayName: "汇聚结果" } },
      dynamicInputs: {
        configKey: "sources",
        idKey: "id",
        labelKey: "label",
        input: { required: true },
      },
    };
    const collectWorkflow: WorkflowDocument = {
      ...workflow,
      nodes: [
        {
          id: "collect",
          type: "data.collect",
          position: { x: 80, y: 80 },
          config: {
            sources: [
              { id: "input_1", label: "输入 1" },
              { id: "input_2", label: "输入 2" },
            ],
          },
        },
      ],
    };

    render(
      <FlowCanvas
        nodeTypes={[collectType]}
        selectedNodeId="collect"
        workflow={collectWorkflow}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      />
    );

    const portSection = screen.getByRole("group", { name: "节点端口" });
    expect(portSection).toContainElement(screen.getByText("输入 1"));
    expect(portSection).toContainElement(screen.getByText("输入 2"));
    expect(portSection).toContainElement(screen.getByText("汇聚结果"));
    expect(portSection.querySelectorAll(".flow-port-row")).toHaveLength(2);
    expect(portSection).not.toContainElement(screen.getByText("将多个具名输入端口的值汇聚为一个对象。"));
  });
  it("uses port display names as primary canvas handle titles", () => {
    const displayNameSourceType: NodeType = {
      ...manualTriggerType,
      outputs: {
        output: {
          displayName: "启动数据",
          description: "手动触发输出",
          schema: { type: "object" },
        },
      },
    };
    const displayNameTargetType: NodeType = {
      ...logType,
      inputs: {
        input: {
          displayName: "日志输入",
          description: "写入日志的数据",
          schema: { type: "object" },
        },
      },
    };

    render(
      <FlowCanvas
        nodeTypes={[displayNameSourceType, displayNameTargetType]}
        selectedNodeId={null}
        workflow={workflowWithEdge}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      />
    );

    expect(screen.getByTitle("输出端口 启动数据 · object · 手动触发输出")).toBeInTheDocument();
    expect(screen.getByTitle("输入端口 日志输入 · object · 写入日志的数据")).toBeInTheDocument();
  });

  it("marks multi-connection input handles with a visible class and tooltip hint", () => {
    const multiTargetType: NodeType = {
      ...logType,
      inputs: {
        input: {
          description: "Multi input",
          maxConnections: null,
        },
      },
    };

    render(
      <FlowCanvas
        nodeTypes={[manualTriggerType, multiTargetType]}
        selectedNodeId={null}
        workflow={workflowWithEdge}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      />
    );

    const inputHandle = screen.getByTitle("输入端口 输入 · 任意 · Multi input · 不限连接");
    expect(inputHandle).toHaveClass("is-multi-connection");
  });

  it("marks error output handles with a visible class", () => {
    const sourceWithErrorType: NodeType = {
      ...manualTriggerType,
      outputs: {
        success: {
          displayName: "成功",
          description: "正常输出",
        },
        error: {
          displayName: "错误",
          category: "error",
          description: "错误分支",
        },
      },
    };

    render(
      <FlowCanvas
        nodeTypes={[sourceWithErrorType]}
        selectedNodeId={null}
        workflow={workflow}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      />
    );

    expect(screen.getByTitle("输出端口 成功 · 任意 · 正常输出")).not.toHaveClass("is-error-port");
    expect(screen.getByTitle("输出端口 错误 · 任意 · 错误分支")).toHaveClass("is-error-port");
  });

  it("adds valid connections and blocks invalid ones with a Chinese hint", () => {
    const onWorkflowChange = vi.fn();
    render(
      <FlowCanvas
        nodeTypes={[manualTriggerType, logType]}
        selectedNodeId={null}
        workflow={{
          ...workflowWithEdge,
          edges: [],
        }}
        onSelectNode={vi.fn()}
        onWorkflowChange={onWorkflowChange}
      />
    );

    const onConnect = reactFlowProps.current?.onConnect as (connection: Record<string, unknown>) => void;

    act(() => {
      onConnect({
        source: "node_manual",
        sourceHandle: "output",
        target: "node_log",
        targetHandle: "input",
      });
    });
    expect(onWorkflowChange).toHaveBeenCalledWith(
      expect.objectContaining({
        edges: [
          expect.objectContaining({
            source: "node_manual",
            sourceHandle: "output",
            target: "node_log",
            targetHandle: "input",
          }),
        ],
      })
    );

    onWorkflowChange.mockClear();
    act(() => {
      onConnect({
        source: "node_manual",
        sourceHandle: "missing",
        target: "node_log",
        targetHandle: "input",
      });
    });

    expect(onWorkflowChange).not.toHaveBeenCalled();
    expect(screen.getByText("源节点没有输出端口 missing。")).toBeInTheDocument();
  });

  it("adds a dragged palette node at the dropped canvas position", () => {
    const onAddNodeAt = vi.fn();
    render(
      <FlowCanvas
        nodeTypes={[manualTriggerType]}
        selectedNodeId={null}
        workflow={emptyWorkflow}
        onAddNodeAt={onAddNodeAt}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      />
    );

    const onDragOver = reactFlowProps.current?.onDragOver as (event: {
      preventDefault: () => void;
      dataTransfer: { dropEffect: string };
    }) => void;
    const preventDefault = vi.fn();
    onDragOver({ preventDefault, dataTransfer: { dropEffect: "" } });
    expect(preventDefault).toHaveBeenCalled();

    const onDrop = reactFlowProps.current?.onDrop as (event: {
      preventDefault: () => void;
      clientX: number;
      clientY: number;
      dataTransfer: { getData: (type: string) => string };
    }) => void;
    onDrop({
      preventDefault,
      clientX: 110,
      clientY: 220,
      dataTransfer: {
        getData: (type) => (type === "application/node-flow-node-type" ? "manual.trigger" : ""),
      },
    });

    expect(onAddNodeAt).toHaveBeenCalledWith(manualTriggerType, { x: 100, y: 200 });
  });

  it("prevents canvas mutation gestures when disabled", () => {
    const onAddNodeAt = vi.fn();
    const onWorkflowChange = vi.fn();
    render(
      <FlowCanvas
        disabled
        nodeTypes={[manualTriggerType]}
        selectedNodeId={null}
        workflow={emptyWorkflow}
        onAddNodeAt={onAddNodeAt}
        onSelectNode={vi.fn()}
        onWorkflowChange={onWorkflowChange}
      />
    );

    expect(reactFlowProps.current?.nodesDraggable).toBe(false);
    expect(reactFlowProps.current?.nodesConnectable).toBe(false);
    expect(reactFlowProps.current?.deleteKeyCode).toEqual([]);

    const onDrop = reactFlowProps.current?.onDrop as (event: {
      preventDefault: () => void;
      clientX: number;
      clientY: number;
      dataTransfer: { getData: (type: string) => string };
    }) => void;
    onDrop({
      preventDefault: vi.fn(),
      clientX: 110,
      clientY: 220,
      dataTransfer: {
        getData: (type) => (type === "application/node-flow-node-type" ? "manual.trigger" : ""),
      },
    });

    expect(onAddNodeAt).not.toHaveBeenCalled();
    expect(onWorkflowChange).not.toHaveBeenCalled();
  });

  it("still allows node selection while disabled", () => {
    const onSelectNode = vi.fn();
    const onWorkflowChange = vi.fn();
    render(
      <FlowCanvas
        disabled
        nodeTypes={[manualTriggerType]}
        selectedNodeId={null}
        workflow={workflow}
        onSelectNode={onSelectNode}
        onWorkflowChange={onWorkflowChange}
      />
    );

    const onNodesChange = reactFlowProps.current?.onNodesChange as (changes: unknown[]) => void;
    onNodesChange([{ id: "node_manual", selected: true, type: "select" }]);

    expect(onSelectNode).toHaveBeenCalledWith("node_manual");
    expect(onWorkflowChange).not.toHaveBeenCalled();
  });

  it("renders independent canvas annotations and offers a canvas add action", () => {
    const onAddAnnotationAt = vi.fn();
    const onWorkflowChange = vi.fn();
    const workflowWithAnnotation = {
      ...workflow,
      annotations: [
        {
          id: "annotation_prepare",
          content: "第一阶段：准备输入",
          position: { x: 20, y: 24 },
          width: 360,
          height: 180,
          color: "yellow" as const,
        },
      ],
    };
    render(
      <FlowCanvas
        nodeTypes={[manualTriggerType]}
        selectedNodeId={null}
        workflow={workflowWithAnnotation}
        onAddAnnotationAt={onAddAnnotationAt}
        onSelectNode={vi.fn()}
        onWorkflowChange={onWorkflowChange}
      />
    );

    expect(screen.getByText("第一阶段：准备输入")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "设置为蓝色" }));
    expect(onWorkflowChange).toHaveBeenLastCalledWith({
      ...workflowWithAnnotation,
      annotations: [expect.objectContaining({ id: "annotation_prepare", color: "blue" })],
    });

    fireEvent.click(screen.getByRole("button", { name: "放大画布说明" }));
    expect(onWorkflowChange).toHaveBeenLastCalledWith({
      ...workflowWithAnnotation,
      annotations: [expect.objectContaining({ id: "annotation_prepare", width: 440, height: 225 })],
    });

    fireEvent.click(screen.getByRole("button", { name: "添加画布说明" }));
    expect(onAddAnnotationAt).toHaveBeenCalledWith(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }));
  });

  it("keeps dragged palette drops working when they land on the empty overlay", () => {
    const onAddNodeAt = vi.fn();
    render(
      <FlowCanvas
        nodeTypes={[manualTriggerType]}
        selectedNodeId={null}
        workflow={emptyWorkflow}
        onAddNodeAt={onAddNodeAt}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      >
        <div>空画布模板入口</div>
      </FlowCanvas>
    );

    const overlay = screen.getByText("空画布模板入口").closest(".canvas-empty-overlay");
    expect(overlay).toBeInTheDocument();

    fireEvent.dragOver(overlay as Element, {
      dataTransfer: { dropEffect: "" },
    });
    const dropEvent = createEvent.drop(overlay as Element, {
      dataTransfer: {
        getData: (type: string) => (type === "application/node-flow-node-type" ? "manual.trigger" : ""),
      },
    });
    Object.defineProperty(dropEvent, "clientX", { value: 130 });
    Object.defineProperty(dropEvent, "clientY", { value: 260 });
    fireEvent(overlay as Element, dropEvent);

    expect(onAddNodeAt).toHaveBeenCalledWith(manualTriggerType, { x: 120, y: 240 });
  });
});
