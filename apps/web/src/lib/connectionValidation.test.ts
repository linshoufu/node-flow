import { describe, expect, it } from "vitest";
import type { NodeType, WorkflowDocument } from "../types";
import { validateConnection } from "./connectionValidation";

const sourceType: NodeType = {
  id: "source.node",
  name: "Source",
  category: "test",
  description: "Source node",
  inputs: {},
  outputs: {
    success: {},
    error: {},
  },
  configSchema: { type: "object", properties: {} },
};

const targetType: NodeType = {
  id: "target.node",
  name: "Target",
  category: "test",
  description: "Target node",
  inputs: {
    input: {},
    fallback: {},
  },
  outputs: {},
  configSchema: { type: "object", properties: {} },
};

const workflow: WorkflowDocument = {
  id: "workflow",
  name: "Workflow",
  version: 1,
  nodes: [
    { id: "source", type: "source.node", position: { x: 0, y: 0 }, config: {} },
    { id: "target", type: "target.node", position: { x: 200, y: 0 }, config: {} },
  ],
  edges: [],
};

describe("validateConnection", () => {
  it("accepts an output port connected to an input port", () => {
    expect(
      validateConnection(
        {
          source: "source",
          sourceHandle: "success",
          target: "target",
          targetHandle: "input",
        },
        workflow,
        [sourceType, targetType]
      )
    ).toEqual({ valid: true });
  });

  it("rejects connections without complete endpoints", () => {
    expect(
      validateConnection(
        {
          source: "source",
          sourceHandle: "success",
          target: null,
          targetHandle: null,
        },
        workflow,
        [sourceType, targetType]
      )
    ).toEqual({ valid: false, code: "incomplete_endpoint", message: "请从输出端口拖到输入端口。" });
  });

  it("reports a direction error when an output port is dropped onto another output port", () => {
    expect(
      validateConnection(
        {
          source: "source",
          sourceHandle: "success",
          target: "source",
          targetHandle: "success",
        },
        workflow,
        [sourceType, targetType]
      )
    ).toEqual({
      valid: false,
      code: "wrong_port_direction",
      message: "端口方向不对：成功 是输出端口，连线只能从输出端口拖到输入端口。",
      targetPort: "success",
    });

    expect(
      validateConnection(
        {
          source: "source",
          sourceHandle: "success",
          target: "source_2",
          targetHandle: "success",
        },
        {
          ...workflow,
          nodes: [
            ...workflow.nodes,
            { id: "source_2", type: "source.node", position: { x: 0, y: 200 }, config: {} },
          ],
        },
        [sourceType, targetType]
      )
    ).toEqual({
      valid: false,
      code: "wrong_port_direction",
      message: "端口方向不对：成功 是输出端口，连线只能从输出端口拖到输入端口。",
      targetPort: "success",
    });
  });

  it("reports a direction error when a connection starts from an input port", () => {
    expect(
      validateConnection(
        {
          source: "target",
          sourceHandle: "input",
          target: "target_2",
          targetHandle: "input",
        },
        {
          ...workflow,
          nodes: [
            ...workflow.nodes,
            { id: "target_2", type: "target.node", position: { x: 400, y: 0 }, config: {} },
          ],
        },
        [sourceType, targetType]
      )
    ).toEqual({
      valid: false,
      code: "wrong_port_direction",
      message: "端口方向不对：输入 是输入端口，连线应从输出端口开始。",
      sourcePort: "input",
    });
  });

  it("rejects self connections between a node's own output and input", () => {
    const passthroughType: NodeType = {
      ...sourceType,
      id: "passthrough.node",
      inputs: { input: {} },
    };
    const passthroughWorkflow: WorkflowDocument = {
      ...workflow,
      nodes: [{ id: "passthrough", type: "passthrough.node", position: { x: 0, y: 0 }, config: {} }],
    };

    expect(
      validateConnection(
        {
          source: "passthrough",
          sourceHandle: "success",
          target: "passthrough",
          targetHandle: "input",
        },
        passthroughWorkflow,
        [passthroughType]
      )
    ).toEqual({ valid: false, code: "self_connection", message: "不能把节点连接到自己。" });
  });

  it("rejects undeclared source and target ports", () => {
    expect(
      validateConnection(
        {
          source: "source",
          sourceHandle: "missing",
          target: "target",
          targetHandle: "input",
        },
        workflow,
        [sourceType, targetType]
      )
    ).toEqual({ valid: false, code: "unknown_source_port", message: "源节点没有输出端口 missing。" });

    expect(
      validateConnection(
        {
          source: "source",
          sourceHandle: "success",
          target: "target",
          targetHandle: "missing",
        },
        workflow,
        [sourceType, targetType]
      )
    ).toEqual({ valid: false, code: "unknown_target_port", message: "目标节点没有输入端口 missing。" });
  });

  it("accepts configured dynamic output ports and rejects stale route ports", () => {
    const dynamicSourceType: NodeType = {
      ...sourceType,
      id: "logic.switch",
      outputs: { fallback: { displayName: "未匹配" } },
      dynamicOutputs: {
        configKey: "rules",
        idKey: "id",
        labelKey: "label",
        output: { description: "命中的输入" },
      },
    };
    const dynamicWorkflow: WorkflowDocument = {
      ...workflow,
      nodes: [
        { id: "source", type: "logic.switch", position: { x: 0, y: 0 }, config: { rules: [{ id: "matched", label: "命中" }] } },
        workflow.nodes[1],
      ],
    };

    expect(
      validateConnection(
        { source: "source", sourceHandle: "matched", target: "target", targetHandle: "input" },
        dynamicWorkflow,
        [dynamicSourceType, targetType]
      )
    ).toEqual({ valid: true });
    expect(
      validateConnection(
        { source: "source", sourceHandle: "stale", target: "target", targetHandle: "input" },
        dynamicWorkflow,
        [dynamicSourceType, targetType]
      )
    ).toEqual({ valid: false, code: "unknown_source_port", message: "源节点没有输出端口 stale。" });
  });

  it("accepts configured dynamic input ports and rejects stale input ports", () => {
    const dynamicTargetType: NodeType = {
      ...targetType,
      id: "data.collect",
      inputs: {},
      dynamicInputs: { configKey: "sources", idKey: "id", labelKey: "label", input: {} },
    };
    const dynamicWorkflow: WorkflowDocument = {
      ...workflow,
      nodes: [
        workflow.nodes[0],
        { id: "target", type: "data.collect", position: { x: 200, y: 0 }, config: { sources: [{ id: "left", label: "左侧" }] } },
      ],
    };

    expect(
      validateConnection(
        { source: "source", sourceHandle: "success", target: "target", targetHandle: "left" },
        dynamicWorkflow,
        [sourceType, dynamicTargetType]
      )
    ).toEqual({ valid: true });
    expect(
      validateConnection(
        { source: "source", sourceHandle: "success", target: "target", targetHandle: "stale" },
        dynamicWorkflow,
        [sourceType, dynamicTargetType]
      )
    ).toEqual({ valid: false, code: "unknown_target_port", message: "目标节点没有输入端口 stale。" });
  });

  it("rejects duplicate edges and occupied input ports", () => {
    const connectedWorkflow: WorkflowDocument = {
      ...workflow,
      edges: [
        {
          id: "edge_1",
          source: "source",
          sourceHandle: "success",
          target: "target",
          targetHandle: "input",
        },
      ],
    };

    expect(
      validateConnection(
        {
          source: "source",
          sourceHandle: "success",
          target: "target",
          targetHandle: "input",
        },
        connectedWorkflow,
        [sourceType, targetType]
      )
    ).toEqual({ valid: false, code: "duplicate_connection", message: "这条连线已经存在。" });

    expect(
      validateConnection(
        {
          source: "source",
          sourceHandle: "error",
          target: "target",
          targetHandle: "input",
        },
        connectedWorkflow,
        [sourceType, targetType]
      )
    ).toEqual({ valid: false, code: "input_already_connected", message: "目标输入端口 输入 已经连接。" });
  });

  it("accepts another edge into an input that declares unlimited connections", () => {
    const multiTargetType: NodeType = {
      ...targetType,
      inputs: {
        input: { maxConnections: null },
      },
    };
    const connectedWorkflow: WorkflowDocument = {
      ...workflow,
      nodes: [
        ...workflow.nodes,
        { id: "source_2", type: "source.node", position: { x: 0, y: 100 }, config: {} },
      ],
      edges: [
        {
          id: "edge_1",
          source: "source",
          sourceHandle: "success",
          target: "target",
          targetHandle: "input",
        },
      ],
    };

    expect(
      validateConnection(
        {
          source: "source_2",
          sourceHandle: "success",
          target: "target",
          targetHandle: "input",
        },
        connectedWorkflow,
        [sourceType, multiTargetType]
      )
    ).toEqual({ valid: true });
  });

  it("rejects incompatible schema types", () => {
    const textSourceType: NodeType = {
      ...sourceType,
      outputs: {
        success: { schema: { type: "string" } },
      },
    };
    const numberTargetType: NodeType = {
      ...targetType,
      inputs: {
        input: { schema: { type: "number" } },
      },
    };

    expect(
      validateConnection(
        {
          source: "source",
          sourceHandle: "success",
          target: "target",
          targetHandle: "input",
        },
        workflow,
        [textSourceType, numberTargetType]
      )
    ).toEqual({
      valid: false,
      code: "incompatible_schema",
      message: "输出端口 成功 的数据类型 string 不能连接到输入端口 输入 的数据类型 number。",
      sourcePort: "success",
      targetPort: "input",
      sourceSchemaLabel: "string",
      targetSchemaLabel: "number",
    });
  });

  it("uses port display names in connection validation messages", () => {
    const textSourceType: NodeType = {
      ...sourceType,
      outputs: {
        success: { displayName: "成功", schema: { type: "string" } },
      },
    };
    const numberTargetType: NodeType = {
      ...targetType,
      inputs: {
        input: { displayName: "数值输入", schema: { type: "number" } },
      },
    };

    expect(
      validateConnection(
        {
          source: "source",
          sourceHandle: "success",
          target: "target",
          targetHandle: "input",
        },
        workflow,
        [textSourceType, numberTargetType]
      )
    ).toMatchObject({
      valid: false,
      code: "incompatible_schema",
      message: "输出端口 成功 的数据类型 string 不能连接到输入端口 数值输入 的数据类型 number。",
    });
  });

  it("accepts integer output ports connected to number input ports", () => {
    const integerSourceType: NodeType = {
      ...sourceType,
      outputs: {
        success: { schema: { type: "integer" } },
      },
    };
    const numberTargetType: NodeType = {
      ...targetType,
      inputs: {
        input: { schema: { type: "number" } },
      },
    };

    expect(
      validateConnection(
        {
          source: "source",
          sourceHandle: "success",
          target: "target",
          targetHandle: "input",
        },
        workflow,
        [integerSourceType, numberTargetType]
      )
    ).toEqual({ valid: true });
  });

  it("rejects ports with different connection kinds before checking their schemas", () => {
    const resourceSourceType: NodeType = {
      ...sourceType,
      outputs: {
        success: { connectionKind: "resource", schema: { type: "string" } },
      },
    };
    const toolTargetType: NodeType = {
      ...targetType,
      inputs: {
        input: { connectionKind: "tool", schema: { type: "string" } },
      },
    };

    expect(
      validateConnection(
        {
          source: "source",
          sourceHandle: "success",
          target: "target",
          targetHandle: "input",
        },
        workflow,
        [resourceSourceType, toolTargetType]
      )
    ).toEqual({
      valid: false,
      code: "incompatible_connection_kind",
      message: "输出端口 成功 使用 resource 通道，不能连接到输入端口 输入 使用 tool 通道。",
      sourcePort: "success",
      targetPort: "input",
      sourceConnectionKind: "resource",
      targetConnectionKind: "tool",
    });
  });

  it("enforces an explicit output connection limit while leaving default outputs fan-out capable", () => {
    const limitedSourceType: NodeType = {
      ...sourceType,
      outputs: { success: { displayName: "单路输出", maxConnections: 1 } },
    };
    const fanOutWorkflow: WorkflowDocument = {
      ...workflow,
      nodes: [
        ...workflow.nodes,
        { id: "target_2", type: "target.node", position: { x: 300, y: 0 }, config: {} },
      ],
      edges: [
        { id: "first", source: "source", sourceHandle: "success", target: "target", targetHandle: "input" },
      ],
    };

    expect(
      validateConnection(
        { source: "source", sourceHandle: "success", target: "target_2", targetHandle: "input" },
        fanOutWorkflow,
        [limitedSourceType, targetType]
      )
    ).toMatchObject({
      valid: false,
      code: "output_connection_limit_reached",
      message: "输出端口 单路输出 已达到最多 1 条下游连接的限制。",
    });

    expect(
      validateConnection(
        { source: "source", sourceHandle: "error", target: "target_2", targetHandle: "input" },
        fanOutWorkflow,
        [sourceType, targetType]
      )
    ).toEqual({ valid: true });
  });

  it("enforces output and input node-type filters", () => {
    const outputFilteredSource: NodeType = {
      ...sourceType,
      outputs: { success: { displayName: "受限输出", filter: { nodes: ["other.target"] } } },
    };
    const inputFilteredTarget: NodeType = {
      ...targetType,
      displayName: "受限目标",
      inputs: { input: { displayName: "受限输入", filter: { nodes: ["other.source"], excludedNodes: ["source.node"] } } },
    };

    expect(
      validateConnection(
        { source: "source", sourceHandle: "success", target: "target", targetHandle: "input" },
        workflow,
        [outputFilteredSource, targetType]
      )
    ).toMatchObject({
      valid: false,
      code: "output_port_filter_rejected",
      message: "输出端口 受限输出 不允许连接到节点类型 Target。",
    });

    expect(
      validateConnection(
        { source: "source", sourceHandle: "success", target: "target", targetHandle: "input" },
        workflow,
        [sourceType, inputFilteredTarget]
      )
    ).toMatchObject({
      valid: false,
      code: "input_port_filter_rejected",
      message: "输入端口 受限输入 不接受来自节点类型 Source 的连线。",
    });

    const acceptingTarget: NodeType = {
      ...inputFilteredTarget,
      inputs: { input: { filter: { nodes: ["source.node"] } } },
    };
    expect(
      validateConnection(
        { source: "source", sourceHandle: "success", target: "target", targetHandle: "input" },
        workflow,
        [sourceType, acceptingTarget]
      )
    ).toEqual({ valid: true });
  });
});
