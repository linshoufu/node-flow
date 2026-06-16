import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

describe("ConfigPanel", () => {
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
});
