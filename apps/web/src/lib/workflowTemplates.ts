import type { WorkflowDocument, WorkflowEdge, WorkflowNode } from "../types";
import { LOCAL_SMOKE_HEALTH_URL } from "./projectConfig";

export type TemplateAvailability = {
  available: boolean;
  reason?: string;
};

export type WorkflowTemplate = {
  category: "general" | "testing";
  id: string;
  name: string;
  description: string;
  nodeCount: number;
  tags: readonly string[];
  available: boolean;
  unavailableReason?: string;
  workflow: WorkflowDocument;
};

const GENERIC_WORKFLOW_TEMPLATE_SOURCE: WorkflowTemplate[] = [
  createTemplate({
    category: "general",
    id: "webhook-echo",
    name: "Webhook 请求回显",
    description: "接收外部 POST 请求，并将请求数据作为 JSON 响应返回。",
    tags: ["Webhook", "HTTP", "通用"],
    available: true,
    workflow: {
      id: "webhook-echo",
      name: "Webhook 请求回显",
      version: 1,
      settings: {
        timeout_seconds: 600,
      },
      nodes: [
        node("webhook", "webhook.trigger", 0, 0, {
          method: "POST",
          path: "hooks/echo",
        }),
        node("respond", "webhook.respond", 280, 0, {
          status_code: 200,
          headers: {},
        }),
      ],
      edges: [edge("webhook_respond", "webhook", "success", "respond", "input")],
    },
  }),
  createTemplate({
    category: "general",
    id: "manual-data-flow",
    name: "手动处理数据",
    description: "从手动输入开始调试、转换或编排数据。",
    tags: ["手动", "数据", "通用"],
    available: true,
    workflow: {
      id: "manual-data-flow",
      name: "手动处理数据",
      version: 1,
      settings: {
        timeout_seconds: 600,
      },
      nodes: [
        node("start", "manual.trigger", 0, 0, {
          payload: { message: "你好，工作流" },
        }),
        node("log", "utility.log", 280, 0, {
          message: "手动数据流已开始",
        }),
      ],
      edges: [edge("start_log", "start", "success", "log", "input")],
    },
  }),
  createTemplate({
    category: "general",
    id: "manual-approval-branch",
    name: "条件分支路由",
    description: "根据输入中的布尔条件，分别进入获准或待处理的下游路径。",
    tags: ["条件", "分支", "通用"],
    available: true,
    workflow: {
      id: "manual-approval-branch",
      name: "条件分支路由",
      version: 1,
      settings: {
        timeout_seconds: 600,
      },
      nodes: [
        node("start", "manual.trigger", 0, 0, {
          payload: { approved: true },
        }),
        node("condition", "logic.if", 260, 0, {
          condition: "{{ inputs.input.approved }}",
        }),
        node("approved", "utility.log", 520, -90, {
          message: "请求已获准。",
        }),
        node("review", "utility.log", 520, 90, {
          message: "请求需要人工处理。",
        }),
      ],
      edges: [
        edge("start_condition", "start", "success", "condition", "input"),
        edge("condition_approved", "condition", "true", "approved", "input"),
        edge("condition_review", "condition", "false", "review", "input"),
      ],
    },
  }),
  createTemplate({
    category: "general",
    id: "manual-value-route",
    name: "多分支值路由",
    description: "从输入对象提取状态值，并按已批准、待处理或未匹配分支继续执行。",
    tags: ["路由", "分支", "数据", "通用"],
    available: true,
    workflow: {
      id: "manual-value-route",
      name: "多分支值路由",
      version: 1,
      settings: {
        timeout_seconds: 600,
      },
      nodes: [
        node("start", "manual.trigger", 0, 0, {
          payload: { status: "approved", request_id: "demo-001" },
        }),
        node("status", "utility.transform", 240, 0, {
          value: "{{ inputs.input.status }}",
        }),
        node("route", "logic.switch", 480, 0, {
          rules: [
            { id: "approved", label: "已批准", value: "approved" },
            { id: "pending", label: "待处理", value: "pending" },
          ],
        }),
        node("approved_log", "utility.log", 740, -110, {
          message: "请求已批准。",
        }),
        node("pending_log", "utility.log", 740, 0, {
          message: "请求等待处理。",
        }),
        node("fallback_log", "utility.log", 740, 110, {
          message: "状态未匹配，请检查输入。",
        }),
      ],
      edges: [
        edge("start_status", "start", "success", "status", "input"),
        edge("status_route", "status", "success", "route", "input"),
        edge("route_approved", "route", "approved", "approved_log", "input"),
        edge("route_pending", "route", "pending", "pending_log", "input"),
        edge("route_fallback", "route", "fallback", "fallback_log", "input"),
      ],
    },
  }),
];

const API_TESTING_TEMPLATE_SOURCE: WorkflowTemplate[] = [
  createTemplate({
    category: "testing",
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
        node("start", "manual.trigger", 0, 0),
        node("request", "http.request", 240, 0, {
          method: "GET",
          url: LOCAL_SMOKE_HEALTH_URL,
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
    category: "testing",
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
        node("start", "manual.trigger", 0, 0),
        node("csv", "data.csv_read", 240, 0, {
          path: "examples/api-cases.csv",
          delimiter: ",",
          encoding: "utf-8",
          has_header: true,
        }),
        {
          ...node("each_row", "control.each_item", 480, 0, {
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
        edge("csv_each_row", "csv", "items", "each_row", "items"),
        edge("each_row_summary", "each_row", "done", "summary", "input"),
        edge("summary_write_report", "summary", "success", "write_report", "input"),
      ],
    },
  }),
];

export const API_TESTING_TEMPLATES: readonly WorkflowTemplate[] = deepFreeze(API_TESTING_TEMPLATE_SOURCE);
export const WORKFLOW_TEMPLATES: readonly WorkflowTemplate[] = deepFreeze([
  ...GENERIC_WORKFLOW_TEMPLATE_SOURCE,
  ...API_TESTING_TEMPLATE_SOURCE,
]);

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
  const template = WORKFLOW_TEMPLATES.find((candidate) => candidate.id === templateId);

  if (!template) {
    throw new Error(`Unknown workflow template: "${templateId}"`);
  }

  return {
    ...deepClone(template.workflow),
    id: workflowId(template.id),
    active: false,
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
