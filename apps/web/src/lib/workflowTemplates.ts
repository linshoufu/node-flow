import type { WorkflowDocument, WorkflowEdge, WorkflowNode } from "../types";

export type TemplateAvailability = {
  available: boolean;
  reason?: string;
};

export type WorkflowTemplate = {
  id: string;
  name: string;
  description: string;
  nodeCount: number;
  tags: readonly string[];
  available: boolean;
  unavailableReason?: string;
  workflow: WorkflowDocument;
};

const API_TESTING_TEMPLATE_SOURCE: WorkflowTemplate[] = [
  createTemplate({
    id: "single-api-status-code",
    name: "单接口状态码断言",
    description: "发送一次 HTTP 请求，并断言响应状态码为 200，随后记录结果并写入报告。",
    tags: ["API", "HTTP", "状态码", "报告"],
    available: true,
    workflow: {
      id: "single-api-status-code",
      name: "单接口状态码断言",
      version: 1,
      settings: {
        timeout_seconds: 600,
      },
      nodes: [
        node("start", "control.start", 0, 0),
        node("request", "http.request", 240, 0, {
          method: "GET",
          url: "https://api.example.com/health",
        }),
        node("assert_status", "assert.status_code", 480, 0, {
          expected: 200,
        }),
        node("record_result", "test.record_result", 720, 0, {
          name: "状态码为 200",
        }),
        node("summary", "test.summary", 960, 0, {
          fail_run_on_failed: true,
        }),
        node("write_report", "test.write_report", 1200, 0, {
          path: "reports/single-api-status-code.json",
        }),
      ],
      edges: [
        edge("start_request", "start", "success", "request", "body"),
        edge("request_assert_status", "request", "success", "assert_status", "input"),
        edge("assert_status_record_result", "assert_status", "passed", "record_result", "input"),
        edge("record_result_summary", "record_result", "success", "summary", "input"),
        edge("summary_write_report", "summary", "success", "write_report", "input"),
      ],
    },
  }),
  createTemplate({
    id: "csv-parameterized-api",
    name: "CSV 参数化接口测试",
    description: "读取 CSV 用例列表，逐行请求对应 URL，断言状态码为 200 并汇总报告。",
    tags: ["API", "CSV", "参数化", "循环"],
    available: true,
    workflow: {
      id: "csv-parameterized-api",
      name: "CSV 参数化接口测试",
      version: 1,
      settings: {
        timeout_seconds: 600,
      },
      nodes: [
        node("start", "control.start", 0, 0),
        node("csv", "data.csv_read", 240, 0, {
          path: "examples/api-cases.csv",
          delimiter: ",",
          encoding: "utf-8",
          has_header: true,
        }),
        {
          ...node("each_row", "control.foreach", 480, 0, {
            items_expression: "{{ nodes.csv.outputs.success.rows }}",
            max_items: 100,
            continue_on_error: false,
            timeout_seconds: 300,
          }),
          subflows: {
            body: {
              nodes: [
                node("request", "http.request", 0, 0, {
                  method: "GET",
                  url: "{{ loop.item.url }}",
                }),
                node("assert_status", "assert.status_code", 240, 0, {
                  expected: 200,
                }),
                node("record_result", "test.record_result", 480, 0, {
                  name: "状态码为 200",
                }),
              ],
              edges: [
                edge("body_request_assert_status", "request", "success", "assert_status", "input"),
                edge("body_assert_status_record_result", "assert_status", "passed", "record_result", "input"),
              ],
            },
          },
        },
        node("summary", "test.summary", 720, 0, {
          fail_run_on_failed: true,
        }),
        node("write_report", "test.write_report", 960, 0, {
          path: "reports/csv-parameterized-api.json",
        }),
      ],
      edges: [
        edge("start_csv", "start", "success", "csv", "input"),
        edge("csv_each_row", "csv", "success", "each_row", "input"),
        edge("each_row_summary", "each_row", "done", "summary", "input"),
        edge("summary_write_report", "summary", "success", "write_report", "input"),
      ],
    },
  }),
];

export const API_TESTING_TEMPLATES: readonly WorkflowTemplate[] = deepFreeze(API_TESTING_TEMPLATE_SOURCE);

export function templateAvailability(template: WorkflowTemplate): TemplateAvailability {
  if (template.available) {
    return { available: true };
  }

  return {
    available: false,
    reason: template.unavailableReason,
  };
}

export function createWorkflowFromTemplate(templateId: string): WorkflowDocument {
  const template = API_TESTING_TEMPLATES.find((candidate) => candidate.id === templateId);

  if (!template) {
    throw new Error(`Unknown workflow template: "${templateId}"`);
  }

  return {
    ...deepClone(template.workflow),
    id: workflowId(template.id),
  };
}

function createTemplate(template: Omit<WorkflowTemplate, "nodeCount">): WorkflowTemplate {
  return {
    ...template,
    nodeCount: countWorkflowNodes(template.workflow.nodes),
  };
}

function countWorkflowNodes(nodes: WorkflowNode[]): number {
  return nodes.reduce((total, node) => {
    const subflowNodeCount = Object.values(node.subflows ?? {}).reduce(
      (subflowTotal, subflow) => subflowTotal + countWorkflowNodes(subflow.nodes),
      0
    );

    return total + 1 + subflowNodeCount;
  }, 0);
}

function node(id: string, type: string, x: number, y: number, config: Record<string, unknown> = {}): WorkflowNode {
  return {
    id,
    type,
    position: { x, y },
    config,
  };
}

function edge(
  id: string,
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string
): WorkflowEdge {
  return {
    id,
    source,
    sourceHandle,
    target,
    targetHandle,
  };
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
  if (!isObject(value) || Object.isFrozen(value)) {
    return value;
  }

  for (const child of Object.values(value)) {
    deepFreeze(child);
  }

  return Object.freeze(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function workflowId(templateId: string): string {
  return `wf_${templateId.replace(/[^a-z0-9]+/gi, "_")}_${randomId()}`;
}

function randomId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID().replace(/-/g, "");
  }

  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
