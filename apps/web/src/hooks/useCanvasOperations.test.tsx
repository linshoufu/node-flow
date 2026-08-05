import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyWorkflow, getEditableWorkflow } from "../lib/workflow";
import { serializeWorkflowNodeClipboard } from "../lib/workflowClipboard";
import type {
  CanvasAnnotation,
  NodeType,
  WorkflowDocument,
  WorkflowEdge,
  WorkflowNode,
} from "../types";
import { useCanvasOperations } from "./useCanvasOperations";

const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");

afterEach(() => {
  if (originalClipboardDescriptor) {
    Object.defineProperty(navigator, "clipboard", originalClipboardDescriptor);
  } else {
    Reflect.deleteProperty(navigator, "clipboard");
  }
});

function node(id: string, config: Record<string, unknown> = {}): WorkflowNode {
  return {
    id,
    type: "test.node",
    typeVersion: 1,
    position: { x: 10, y: 20 },
    config,
  };
}

function edge(id = "edge-1"): WorkflowEdge {
  return {
    id,
    source: "node-1",
    sourceHandle: "success",
    target: "node-2",
    targetHandle: "input",
  };
}

function annotation(id = "note-1"): CanvasAnnotation {
  return {
    id,
    content: "keep me",
    position: { x: 30, y: 40 },
    width: 320,
    height: 180,
    color: "yellow",
  };
}

function workflow(): WorkflowDocument {
  return {
    ...createEmptyWorkflow(),
    id: "wf-1",
    nodes: [node("node-1", { message: "old" }), node("node-2")],
    edges: [edge()],
    annotations: [annotation()],
  };
}

function nodeType(): NodeType {
  return {
    id: "test.node",
    name: "Test Node",
    category: "test",
    description: "Test node",
    inputs: {},
    outputs: {},
    configSchema: { type: "object", properties: {} },
  };
}

function useHarness({
  documentKey = "wf-1:root",
  initialWorkflow = workflow(),
  isEditorLocked = false,
}: {
  documentKey?: string;
  initialWorkflow?: WorkflowDocument;
  isEditorLocked?: boolean;
}) {
  const [currentWorkflow, setCurrentWorkflow] = useState(initialWorkflow);
  const [messages, setMessages] = useState<string[]>([]);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [validationClearCount, setValidationClearCount] = useState(0);
  const operations = useCanvasOperations({
    clearValidationIssues: () => setValidationClearCount((current) => current + 1),
    commitWorkflowChange: (updater) => setCurrentWorkflow((current) => updater(current)),
    documentKey,
    editableWorkflow: getEditableWorkflow(currentWorkflow, undefined),
    editScope: undefined,
    isEditorLocked,
    onMessage: (message) => setMessages((current) => [...current, message]),
    selectNode: (nodeId, _tab, _field, nodeIds = nodeId ? [nodeId] : []) => {
      setSelectedNodeIds(nodeIds);
    },
  });

  return {
    ...operations,
    currentWorkflow,
    messages,
    selectedNodeIds,
    validationClearCount,
  };
}

describe("useCanvasOperations", () => {
  it("updates nodes without clearing canvas annotations", () => {
    const { result } = renderHook(() => useHarness({}));

    act(() => result.current.updateNodeConfig("node-1", "message", "new"));

    expect(result.current.currentWorkflow.nodes[0].config.message).toBe("new");
    expect(result.current.currentWorkflow.annotations).toEqual([annotation()]);
    expect(result.current.validationClearCount).toBe(1);
  });

  it("adds and selects a node through the canvas command boundary", () => {
    const { result } = renderHook(() => useHarness({}));

    act(() => result.current.addNode(nodeType()));

    expect(result.current.currentWorkflow.nodes).toHaveLength(3);
    expect(result.current.selectedNodeIds).toEqual([
      result.current.currentWorkflow.nodes[2].id,
    ]);
    expect(result.current.currentWorkflow.annotations).toEqual([annotation()]);
  });

  it("deletes and restores edges without losing other canvas data", () => {
    const { result } = renderHook(() => useHarness({}));

    act(() => result.current.removeWorkflowEdges(["edge-1", "edge-1"]));
    expect(result.current.currentWorkflow.edges).toEqual([]);
    expect(result.current.canUndoDeletedEdges).toBe(true);
    expect(result.current.currentWorkflow.annotations).toEqual([annotation()]);

    act(() => result.current.undoDeletedEdges());
    expect(result.current.currentWorkflow.edges).toEqual([edge()]);
    expect(result.current.canUndoDeletedEdges).toBe(false);
    expect(result.current.messages.at(-1)).toBe("已恢复 1 条连线。");
  });

  it("ignores an asynchronous clipboard read after the editor changes documents", async () => {
    let resolveClipboard!: (value: string) => void;
    const clipboardText = new Promise<string>((resolve) => {
      resolveClipboard = resolve;
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { readText: vi.fn().mockReturnValue(clipboardText) },
    });
    const { result, rerender } = renderHook(
      ({ documentKey }) => useHarness({ documentKey }),
      { initialProps: { documentKey: "wf-1:root" } },
    );

    let pastePromise!: Promise<void>;
    act(() => {
      pastePromise = result.current.pasteCopiedNodes();
    });
    rerender({ documentKey: "wf-2:root" });
    resolveClipboard(serializeWorkflowNodeClipboard({
      nodes: [node("clipboard-node")],
      edges: [],
    }));
    await act(async () => pastePromise);

    expect(result.current.currentWorkflow.nodes).toHaveLength(2);
    expect(result.current.selectedNodeIds).toEqual([]);
  });

  it("keeps every canvas mutation inert while the editor is locked", () => {
    const { result } = renderHook(() => useHarness({ isEditorLocked: true }));

    act(() => {
      result.current.addNode(nodeType());
      result.current.removeWorkflowEdge("edge-1");
      result.current.updateNodeLabel("node-1", "changed");
    });

    expect(result.current.currentWorkflow).toEqual(workflow());
    expect(result.current.validationClearCount).toBe(0);
  });
});
