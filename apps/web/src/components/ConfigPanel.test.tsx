import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NodeType, WorkflowNode } from "../types";
import { ConfigPanel } from "./ConfigPanel";

const manualTriggerType: NodeType = {
  id: "trigger.manual",
  name: "Manual Trigger",
  category: "trigger",
  description: "Starts a workflow manually",
  inputs: {},
  outputs: {},
  configSchema: {
    type: "object",
    properties: {
      payload: {
        title: "Payload",
        type: "object",
        additionalProperties: true,
      },
    },
  },
};

const manualTriggerNode: WorkflowNode = {
  id: "node_manual",
  type: "trigger.manual",
  position: { x: 0, y: 0 },
  config: {
    payload: { greeting: "hello" },
  },
};

const listNodeType: NodeType = {
  ...manualTriggerType,
  id: "test.list",
  name: "List Node",
  configSchema: {
    type: "object",
    properties: {
      items: {
        title: "Items",
        type: "array",
        items: { type: "string" },
      },
    },
  },
};

const listNode: WorkflowNode = {
  ...manualTriggerNode,
  id: "node_list",
  type: "test.list",
  config: {
    items: ["one"],
  },
};

const forEachType: NodeType = {
  ...manualTriggerType,
  id: "control.foreach",
  name: "For Each",
  category: "control",
  configSchema: {
    type: "object",
    properties: {
      items_path: {
        title: "Items Path",
        type: "string",
      },
    },
  },
};

const forEachNode: WorkflowNode = {
  ...manualTriggerNode,
  id: "node_loop",
  type: "control.foreach",
  config: {
    items_path: "$.items",
  },
  subflows: {
    body: {
      nodes: [],
      edges: [],
    },
  },
};

describe("ConfigPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("edits object config as JSON without corrupting invalid input", () => {
    const onConfigChange = vi.fn();
    render(<ConfigPanel node={manualTriggerNode} nodeType={manualTriggerType} onConfigChange={onConfigChange} />);

    const payloadEditor = screen.getByLabelText("Payload");
    expect(payloadEditor).toHaveValue('{\n  "greeting": "hello"\n}');

    fireEvent.change(payloadEditor, { target: { value: '{ "count": 2 }' } });
    expect(onConfigChange).toHaveBeenLastCalledWith("node_manual", "payload", { count: 2 });

    fireEvent.change(payloadEditor, { target: { value: "{ invalid" } });
    expect(screen.getByText("Invalid JSON")).toBeInTheDocument();
    expect(onConfigChange).toHaveBeenCalledTimes(1);
  });

  it("rejects wrong top-level JSON shapes for object config", () => {
    const onConfigChange = vi.fn();
    render(<ConfigPanel node={manualTriggerNode} nodeType={manualTriggerType} onConfigChange={onConfigChange} />);

    const payloadEditor = screen.getByLabelText("Payload");

    fireEvent.change(payloadEditor, { target: { value: '["wrong"]' } });
    expect(screen.getByText("Expected a JSON object")).toBeInTheDocument();
    expect(onConfigChange).not.toHaveBeenCalled();

    fireEvent.change(payloadEditor, { target: { value: "null" } });
    expect(screen.getByText("Expected a JSON object")).toBeInTheDocument();
    expect(onConfigChange).not.toHaveBeenCalled();

    fireEvent.change(payloadEditor, { target: { value: '"wrong"' } });
    expect(screen.getByText("Expected a JSON object")).toBeInTheDocument();
    expect(onConfigChange).not.toHaveBeenCalled();
  });

  it("accepts arrays and rejects objects for array config", () => {
    const onConfigChange = vi.fn();
    render(<ConfigPanel node={listNode} nodeType={listNodeType} onConfigChange={onConfigChange} />);

    const itemsEditor = screen.getByLabelText("Items");
    expect(itemsEditor).toHaveValue('[\n  "one"\n]');

    fireEvent.change(itemsEditor, { target: { value: '["two", "three"]' } });
    expect(onConfigChange).toHaveBeenLastCalledWith("node_list", "items", ["two", "three"]);

    fireEvent.change(itemsEditor, { target: { value: '{ "wrong": true }' } });
    expect(screen.getByText("Expected a JSON array")).toBeInTheDocument();
    expect(onConfigChange).toHaveBeenCalledTimes(1);
  });

  it("prevents config form submission", () => {
    const onConfigChange = vi.fn();
    render(<ConfigPanel node={manualTriggerNode} nodeType={manualTriggerType} onConfigChange={onConfigChange} />);

    const form = screen.getByLabelText("Configuration fields");
    const submitEvent = new Event("submit", { bubbles: true, cancelable: true });

    form.dispatchEvent(submitEvent);

    expect(submitEvent.defaultPrevented).toBe(true);
  });

  it.each(["control.foreach", "control.while"])("opens the body subflow for %s nodes", (nodeTypeId) => {
    const onOpenSubflow = vi.fn();
    render(
      <ConfigPanel
        node={{ ...forEachNode, type: nodeTypeId }}
        nodeType={{ ...forEachType, id: nodeTypeId }}
        onConfigChange={vi.fn()}
        onOpenSubflow={onOpenSubflow}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Body" }));

    expect(onOpenSubflow).toHaveBeenCalledWith("node_loop", "body");
  });
});
