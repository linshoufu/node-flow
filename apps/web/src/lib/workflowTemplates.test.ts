import { describe, expect, it } from "vitest";
import {
  API_TESTING_TEMPLATES,
  createWorkflowFromTemplate,
  templateAvailability,
  type WorkflowTemplate,
} from "./workflowTemplates";

function edgePairs(workflow: ReturnType<typeof createWorkflowFromTemplate>): string[] {
  return workflow.edges.map((edge) => `${edge.source}->${edge.target}`);
}

describe("workflow templates", () => {
  it("lists the two API testing templates as available", () => {
    expect(API_TESTING_TEMPLATES.map((template) => template.id)).toEqual([
      "single-api-status-code",
      "csv-parameterized-api",
    ]);

    for (const template of API_TESTING_TEMPLATES) {
      expect(template.name).toEqual(expect.any(String));
      expect(template.description).toEqual(expect.any(String));
      expect(template.nodeCount).toBeGreaterThan(0);
      expect(template.tags.length).toBeGreaterThan(0);
      expect(templateAvailability(template)).toEqual({ available: true });
    }
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
      "control.start",
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
      url: expect.any(String),
    });
    expect(workflow.nodes.find((node) => node.id === "assert_status")?.config).toMatchObject({
      expected: 200,
    });
  });

  it("creates the CSV parameterized workflow with a foreach body subflow", () => {
    const workflow = createWorkflowFromTemplate("csv-parameterized-api");
    const eachRow = workflow.nodes.find((node) => node.id === "each_row");
    const body = eachRow?.subflows?.body;

    expect(workflow.name).toBe("CSV 参数化接口测试");
    expect(workflow.nodes.map((node) => node.id)).toEqual(["start", "csv", "each_row", "summary", "write_report"]);
    expect(edgePairs(workflow)).toEqual(["start->csv", "csv->each_row", "each_row->summary", "summary->write_report"]);
    expect(eachRow).toMatchObject({
      type: "control.foreach",
      config: {
        items_expression: "{{ nodes.csv.outputs.success.rows }}",
      },
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
