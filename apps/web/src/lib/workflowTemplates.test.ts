import { describe, expect, it } from "vitest";
import { LOCAL_SMOKE_HEALTH_URL } from "./projectConfig";
import {
  WORKFLOW_TEMPLATES,
  createWorkflowFromTemplate,
  templateAvailability,
  type WorkflowTemplate,
} from "./workflowTemplates";
import type { WorkflowNode } from "../types";

function edgePairs(workflow: ReturnType<typeof createWorkflowFromTemplate>): string[] {
  return workflow.edges.map((edge) => `${edge.source}->${edge.target}`);
}

function countNodes(nodes: WorkflowNode[]): number {
  return nodes.reduce((total, node) => {
    const subflowNodeCount = Object.values(node.subflows ?? {}).reduce(
      (subflowTotal, subflow) => subflowTotal + countNodes(subflow.nodes),
      0
    );

    return total + 1 + subflowNodeCount;
  }, 0);
}

describe("workflow templates", () => {
  it("lists generic and testing templates as available", () => {
    expect(WORKFLOW_TEMPLATES.map((template) => template.id)).toEqual([
      "webhook-echo",
      "manual-data-flow",
      "manual-approval-branch",
      "manual-value-route",
      "single-api-status-code",
      "csv-parameterized-api",
    ]);

    expect(WORKFLOW_TEMPLATES.map((template) => template.category)).toEqual([
      "general",
      "general",
      "general",
      "general",
      "testing",
      "testing",
    ]);

    for (const template of WORKFLOW_TEMPLATES) {
      expect(template.name).toEqual(expect.any(String));
      expect(template.description).toEqual(expect.any(String));
      expect(template.nodeCount).toBe(countNodes(template.workflow.nodes));
      expect(template.tags.length).toBeGreaterThan(0);
      expect(templateAvailability(template)).toEqual({ available: true });
    }
  });

  it("creates a generic Webhook echo workflow with a matching response boundary", () => {
    const workflow = createWorkflowFromTemplate("webhook-echo");

    expect(workflow.active).toBe(false);
    expect(workflow.nodes.map((node) => node.type)).toEqual(["webhook.trigger", "webhook.respond"]);
    expect(edgePairs(workflow)).toEqual(["webhook->respond"]);
    expect(workflow.nodes.find((node) => node.id === "webhook")?.config).toMatchObject({
      method: "POST",
      path: "hooks/echo",
    });
    expect(workflow.nodes.find((node) => node.id === "respond")?.config).toMatchObject({
      status_code: 200,
    });
  });

  it("创建不依赖测试节点的手动数据流模板", () => {
    const workflow = createWorkflowFromTemplate("manual-data-flow");

    expect(workflow.name).toBe("手动处理数据");
    expect(workflow.nodes.map((node) => node.type)).toEqual(["manual.trigger", "utility.log"]);
    expect(edgePairs(workflow)).toEqual(["start->log"]);
    expect(workflow.nodes.find((node) => node.id === "start")?.config).toEqual({
      payload: { message: "你好，工作流" },
    });
  });

  it("创建带真假输出端口的通用条件分支模板", () => {
    const workflow = createWorkflowFromTemplate("manual-approval-branch");

    expect(workflow.name).toBe("条件分支路由");
    expect(workflow.nodes.map((node) => node.type)).toEqual([
      "manual.trigger",
      "logic.if",
      "utility.log",
      "utility.log",
    ]);
    expect(edgePairs(workflow)).toEqual(["start->condition", "condition->approved", "condition->review"]);
    expect(workflow.nodes.find((node) => node.id === "condition")?.config).toEqual({
      condition: "{{ inputs.input.approved }}",
    });
    expect(workflow.edges.find((edge) => edge.id === "condition_approved")).toMatchObject({
      sourceHandle: "true",
      targetHandle: "input",
    });
    expect(workflow.edges.find((edge) => edge.id === "condition_review")).toMatchObject({
      sourceHandle: "false",
      targetHandle: "input",
    });
  });

  it("创建使用动态输出端口的多分支值路由模板", () => {
    const workflow = createWorkflowFromTemplate("manual-value-route");

    expect(workflow.name).toBe("多分支值路由");
    expect(workflow.nodes.map((node) => node.type)).toEqual([
      "manual.trigger",
      "utility.transform",
      "logic.switch",
      "utility.log",
      "utility.log",
      "utility.log",
    ]);
    expect(edgePairs(workflow)).toEqual([
      "start->status",
      "status->route",
      "route->approved_log",
      "route->pending_log",
      "route->fallback_log",
    ]);
    expect(workflow.nodes.find((node) => node.id === "route")?.config).toEqual({
      rules: [
        { id: "approved", label: "已批准", value: "approved" },
        { id: "pending", label: "待处理", value: "pending" },
      ],
    });
    expect(workflow.edges.find((edge) => edge.id === "route_approved")?.sourceHandle).toBe("approved");
    expect(workflow.edges.find((edge) => edge.id === "route_pending")?.sourceHandle).toBe("pending");
  });

  it("exports frozen template definitions so callers cannot pollute the source workflows", () => {
    const template = WORKFLOW_TEMPLATES[0];
    const responseNode = template.workflow.nodes.find((node) => node.id === "respond");

    expect(Object.isFrozen(WORKFLOW_TEMPLATES)).toBe(true);
    expect(Object.isFrozen(template)).toBe(true);
    expect(Object.isFrozen(template.tags)).toBe(true);
    expect(Object.isFrozen(template.workflow)).toBe(true);
    expect(Object.isFrozen(template.workflow.nodes)).toBe(true);
    expect(Object.isFrozen(responseNode?.config)).toBe(true);
  });

  it("throws a clear error for an unknown template id", () => {
    expect(() => createWorkflowFromTemplate("missing-template")).toThrow(
      'Unknown workflow template: "missing-template"'
    );
  });

  it("creates the single API status code workflow with stable nodes and ordered edges", () => {
    const workflow = createWorkflowFromTemplate("single-api-status-code");

    expect(workflow.name).toBe("单接口状态码断言");
    expect(workflow.nodes.map((node) => node.id)).toEqual([
      "start",
      "request",
      "assert_status",
      "record_result",
      "summary",
      "write_report",
    ]);
    expect(workflow.nodes.map((node) => node.type)).toEqual([
      "manual.trigger",
      "http.request",
      "assert.status_code",
      "test.record_result",
      "test.summary",
      "test.write_report",
    ]);
    expect(edgePairs(workflow)).toEqual([
      "start->request",
      "request->assert_status",
      "assert_status->record_result",
      "record_result->summary",
      "summary->write_report",
    ]);
    expect(workflow.nodes.find((node) => node.id === "request")?.config).toMatchObject({
      method: "GET",
      url: LOCAL_SMOKE_HEALTH_URL,
    });
    expect(workflow.nodes.find((node) => node.id === "assert_status")?.config).toMatchObject({
      expected: 200,
    });
  });

  it("creates the CSV parameterized workflow with an item-loop body subflow", () => {
    const workflow = createWorkflowFromTemplate("csv-parameterized-api");
    const eachRow = workflow.nodes.find((node) => node.id === "each_row");
    const body = eachRow?.subflows?.body;

    expect(workflow.name).toBe("CSV 参数化接口测试");
    expect(workflow.nodes.map((node) => node.id)).toEqual(["start", "csv", "each_row", "summary", "write_report"]);
    expect(edgePairs(workflow)).toEqual(["csv->each_row", "each_row->summary", "summary->write_report"]);
    expect(eachRow).toMatchObject({
      type: "control.each_item",
      config: { max_items: 100, continue_on_error: false, timeout_seconds: 300 },
    });
    expect(workflow.edges.find((edge) => edge.id === "csv_each_row")).toMatchObject({
      sourceHandle: "items",
      targetHandle: "items",
    });
    expect(body?.nodes.map((node) => node.id)).toEqual(["request", "assert_status", "record_result"]);
    expect(body?.edges.map((edge) => `${edge.source}->${edge.target}`)).toEqual([
      "request->assert_status",
      "assert_status->record_result",
    ]);
    expect(body?.nodes.find((node) => node.id === "request")?.config).toMatchObject({
      method: "GET",
      url: "{{ loop.item.url }}",
    });
    expect(body?.nodes.find((node) => node.id === "assert_status")?.config).toMatchObject({
      expected: 200,
    });
  });

  it("returns a deep copy for each workflow created from a template", () => {
    const first = createWorkflowFromTemplate("csv-parameterized-api");
    const second = createWorkflowFromTemplate("csv-parameterized-api");

    first.name = "mutated";
    first.nodes[0].config.changed = true;
    first.nodes[2].subflows?.body?.nodes.push({
      id: "extra",
      type: "test.extra",
      position: { x: 0, y: 0 },
      config: {},
    });

    expect(second.name).toBe("CSV 参数化接口测试");
    expect(second.nodes[0].config).not.toHaveProperty("changed");
    expect(second.nodes[2].subflows?.body?.nodes.map((node) => node.id)).toEqual([
      "request",
      "assert_status",
      "record_result",
    ]);
  });

  it("allows future unavailable templates to include a reason", () => {
    const template: WorkflowTemplate = {
      id: "future-template",
      name: "未来模板",
      description: "依赖尚未安装时不可用。",
      nodeCount: 0,
      tags: ["future"],
      available: false,
      unavailableReason: "Missing dependency",
      workflow: {
        id: "future-template",
        name: "未来模板",
        version: 1,
        nodes: [],
        edges: [],
      },
    };

    expect(templateAvailability(template)).toEqual({
      available: false,
      reason: "Missing dependency",
    });
  });
});
