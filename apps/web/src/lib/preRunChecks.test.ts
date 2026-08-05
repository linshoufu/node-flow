import { describe, expect, it } from "vitest";
import type { NodeType, WorkflowDocument, WorkflowNode } from "../types";
import { buildPreRunIssues } from "./preRunChecks";

describe("buildPreRunIssues", () => {
  it("reports missing HTTP request method and URL", () => {
    const issues = buildPreRunIssues(
      workflow({
        nodes: [node({ id: "request", type: "http.request", config: { method: " ", url: "" } })],
      })
    );

    expect(issues).toEqual([
      {
        id: "root/request:method",
        nodeId: "request",
        nodeType: "http.request",
        severity: "error",
        title: "HTTP 请求配置不完整",
        message: "HTTP 请求缺少请求方法。",
        field: "method",
        path: ["root", "request"],
      },
      {
        id: "root/request:url",
        nodeId: "request",
        nodeType: "http.request",
        severity: "error",
        title: "HTTP 请求配置不完整",
        message: "HTTP 请求缺少 URL。",
        field: "url",
        path: ["root", "request"],
      },
    ]);
  });

  it("reports missing CSV path", () => {
    expect(
      buildPreRunIssues(
        workflow({
          nodes: [node({ id: "csv", type: "data.csv_read", config: { path: null } })],
        })
      )
    ).toEqual([
      {
        id: "root/csv:path",
        nodeId: "csv",
        nodeType: "data.csv_read",
        severity: "error",
        title: "CSV 读取配置不完整",
        message: "读取 CSV 缺少文件路径。",
        field: "path",
        path: ["root", "csv"],
      },
    ]);
  });

  it("does not block a disabled node for incomplete configuration or required inputs", () => {
    expect(
      buildPreRunIssues(
        workflow({
          nodes: [
            node({
              id: "request",
              type: "http.request",
              disabled: true,
              config: { method: "", url: "" },
            }),
            node({ id: "sink", type: "test.required_sink" }),
          ],
        }),
        [
          nodeType({
            id: "test.required_sink",
            name: "Required Sink",
            inputs: { input: { required: true, description: "Required input" } },
          }),
        ]
      )
    ).toEqual([
      {
        id: "root/sink:input",
        nodeId: "sink",
        nodeType: "test.required_sink",
        severity: "error",
        title: "节点输入不完整",
        message: "缺少必填输入端口：input。",
        field: "input",
        path: ["root", "sink"],
      },
    ]);
  });

  it("does not require an actual source for status code assertions", () => {
    expect(
      buildPreRunIssues(
        workflow({
          nodes: [node({ id: "assert", type: "assert.status_code", config: { expected: 200 } })],
        })
      )
    ).toEqual([]);
  });

  it.each(["", " ", null])("reports explicitly empty status code expected value: %s", (expected) => {
    expect(
      buildPreRunIssues(
        workflow({
          nodes: [node({ id: "assert", type: "assert.status_code", config: { expected } })],
        })
      )
    ).toEqual([
      {
        id: "root/assert:expected",
        nodeId: "assert",
        nodeType: "assert.status_code",
        severity: "error",
        title: "状态码断言配置不完整",
        message: "状态码断言缺少期望状态码。",
        field: "expected",
        path: ["root", "assert"],
      },
    ]);
  });

  it("does not report missing status code expected when the backend default applies", () => {
    expect(
      buildPreRunIssues(
        workflow({
          nodes: [node({ id: "assert", type: "assert.status_code", config: {} })],
        })
      )
    ).toEqual([]);
  });

  it("reports missing test report path", () => {
    expect(
      buildPreRunIssues(
        workflow({
          nodes: [node({ id: "report", type: "test.write_report", config: {} })],
        })
      )
    ).toEqual([
      {
        id: "root/report:path",
        nodeId: "report",
        nodeType: "test.write_report",
        severity: "error",
        title: "测试报告配置不完整",
        message: "写入测试报告缺少输出路径。",
        field: "path",
        path: ["root", "report"],
      },
    ]);
  });

  it("reports missing foreach items expression", () => {
    expect(
      buildPreRunIssues(
        workflow({
          nodes: [node({ id: "each", type: "control.foreach", config: { items_expression: "\t" } })],
        })
      )
    ).toEqual([
      {
        id: "root/each:items_expression",
        nodeId: "each",
        nodeType: "control.foreach",
        severity: "error",
        title: "遍历循环配置不完整",
        message: "遍历循环缺少循环数据来源。",
        field: "items_expression",
        path: ["root", "each"],
      },
    ]);
  });

  it("checks nodes inside subflows", () => {
    expect(
      buildPreRunIssues(
        workflow({
          nodes: [
            node({
              id: "each",
              type: "control.foreach",
              config: { items_expression: "$.rows" },
              subflows: {
                body: {
                  nodes: [node({ id: "request", type: "http.request", config: { method: "GET", url: "" } })],
                  edges: [],
                },
              },
            }),
          ],
        })
      )
    ).toEqual([
      {
        id: "root/each/body/request:url",
        nodeId: "request",
        nodeType: "http.request",
        severity: "error",
        title: "HTTP 请求配置不完整",
        message: "HTTP 请求缺少 URL。",
        field: "url",
        path: ["root", "each", "body", "request"],
      },
    ]);
  });

  it("uses scoped issue ids when node ids repeat across root and subflows", () => {
    const issues = buildPreRunIssues(
      workflow({
        nodes: [
          node({ id: "request", type: "http.request", config: { method: "GET", url: "" } }),
          node({
            id: "each",
            type: "control.foreach",
            config: { items_expression: "$.rows" },
            subflows: {
              body: {
                nodes: [node({ id: "request", type: "http.request", config: { method: "GET", url: "" } })],
                edges: [],
              },
            },
          }),
        ],
      })
    );

    expect(issues.map((issue) => issue.id)).toEqual(["root/request:url", "root/each/body/request:url"]);
    expect(new Set(issues.map((issue) => issue.id)).size).toBe(2);
  });

  it("reports incompatible edge port schemas before running", () => {
    const issues = buildPreRunIssues(
      workflow({
        nodes: [
          node({ id: "source", type: "test.text_source" }),
          node({ id: "sink", type: "test.number_sink" }),
        ],
        edges: [
          {
            id: "edge_text_number",
            source: "source",
            sourceHandle: "success",
            target: "sink",
            targetHandle: "input",
          },
        ],
      }),
      [
        nodeType({
          id: "test.text_source",
          name: "Text Source",
          outputs: { success: { description: "文本", schema: { type: "string" } } },
        }),
        nodeType({
          id: "test.number_sink",
          name: "Number Sink",
          inputs: { input: { required: true, description: "数字", schema: { type: "number" } } },
        }),
      ]
    );

    expect(issues).toEqual([
      {
        id: "root:edge:edge_text_number",
        edgeId: "edge_text_number",
        severity: "error",
        title: "连线类型不匹配",
        message: "输出端口 成功 的数据类型 string 不能连接到输入端口 输入 的数据类型 number。",
        field: "input",
        path: ["root"],
        targetKind: "edge",
      },
      {
        id: "root/sink:input",
        nodeId: "sink",
        nodeType: "test.number_sink",
        severity: "error",
        title: "节点输入不完整",
        message: "缺少必填输入端口：input。",
        field: "input",
        path: ["root", "sink"],
      },
    ]);
  });
  it("reports occupied input ports before running", () => {
    const issues = buildPreRunIssues(
      workflow({
        nodes: [
          node({ id: "source_a", type: "test.source" }),
          node({ id: "source_b", type: "test.source" }),
          node({ id: "sink", type: "test.sink" }),
        ],
        edges: [
          {
            id: "edge_a",
            source: "source_a",
            sourceHandle: "success",
            target: "sink",
            targetHandle: "input",
          },
          {
            id: "edge_b",
            source: "source_b",
            sourceHandle: "success",
            target: "sink",
            targetHandle: "input",
          },
        ],
      }),
      [
        nodeType({
          id: "test.source",
          name: "Source",
          outputs: { success: {} },
        }),
        nodeType({
          id: "test.sink",
          name: "Sink",
          inputs: { input: { required: false } },
        }),
      ]
    );

    expect(issues).toEqual([
      {
        id: "root:edge:edge_b",
        edgeId: "edge_b",
        severity: "error",
        title: "连线无效",
        message: "目标输入端口 输入 已经连接。",
        field: "input",
        path: ["root"],
        targetKind: "edge",
      },
    ]);
  });
  it("reports missing required input ports before running", () => {
    const issues = buildPreRunIssues(
      workflow({
        nodes: [node({ id: "sink", type: "test.sink" })],
      }),
      [
        nodeType({
          id: "test.sink",
          name: "Sink",
          inputs: { input: { required: true, description: "输入数据" } },
        }),
      ]
    );

    expect(issues).toEqual([
      {
        id: "root/sink:input",
        nodeId: "sink",
        nodeType: "test.sink",
        severity: "error",
        title: "节点输入不完整",
        message: "缺少必填输入端口：input。",
        field: "input",
        path: ["root", "sink"],
      },
    ]);
  });

  it("does not count invalid edges as required input ports before running", () => {
    const issues = buildPreRunIssues(
      workflow({
        nodes: [
          node({ id: "source", type: "test.source" }),
          node({ id: "sink", type: "test.sink" }),
        ],
        edges: [
          {
            id: "edge_missing_handle",
            source: "source",
            sourceHandle: "missing",
            target: "sink",
            targetHandle: "input",
          },
        ],
      }),
      [
        nodeType({
          id: "test.source",
          name: "Source",
          outputs: { success: {} },
        }),
        nodeType({
          id: "test.sink",
          name: "Sink",
          inputs: { input: { required: true } },
        }),
      ]
    );

    expect(issues).toEqual([
      {
        id: "root:edge:edge_missing_handle",
        edgeId: "edge_missing_handle",
        severity: "error",
        title: "连线无效",
        message: "源节点没有输出端口 missing。",
        field: "input",
        path: ["root"],
        targetKind: "edge",
      },
      {
        id: "root/sink:input",
        nodeId: "sink",
        nodeType: "test.sink",
        severity: "error",
        title: "节点输入不完整",
        message: "缺少必填输入端口：input。",
        field: "input",
        path: ["root", "sink"],
      },
    ]);
  });
  it("returns no issues when checked node configuration is complete", () => {
    expect(
      buildPreRunIssues(
        workflow({
          nodes: [
            node({ id: "request", type: "http.request", config: { method: "GET", url: "https://example.com" } }),
            node({ id: "csv", type: "data.csv_read", config: { path: "./data.csv" } }),
            node({ id: "assert", type: "assert.status_code", config: { expected: 200 } }),
            node({ id: "report", type: "test.write_report", config: { path: "./report.json" } }),
            node({ id: "each", type: "control.foreach", config: { items_expression: "$.rows" } }),
          ],
        })
      )
    ).toEqual([]);
  });

  it("reports workflow timeout values outside the supported range", () => {
    expect(
      buildPreRunIssues(
        workflow({
          settings: {
            timeout_seconds: 86401,
          },
        })
      )
    ).toEqual([
      {
        id: "root:settings:timeout_seconds",
        severity: "error",
        title: "工作流设置不合法",
        message: "超时时间必须在 1 到 86400 秒之间。",
        field: "timeout_seconds",
        path: ["root", "settings"],
        targetKind: "settings",
      },
    ]);
  });

  it("reports a workflow concurrent run limit outside the supported range", () => {
    expect(
      buildPreRunIssues(
        workflow({
          settings: {
            timeout_seconds: 600,
            max_concurrent_runs: 65,
          },
        })
      )
    ).toEqual([
      {
        id: "root:settings:max_concurrent_runs",
        severity: "error",
        title: "\u5de5\u4f5c\u6d41\u8bbe\u7f6e\u4e0d\u5408\u6cd5",
        message: "\u540c\u65f6\u8fd0\u884c\u4e0a\u9650\u5fc5\u987b\u5728 1 \u5230 64 \u4e4b\u95f4\u3002",
        field: "max_concurrent_runs",
        path: ["root", "settings"],
        targetKind: "settings",
      },
    ]);
  });

  it("reports invalid workflow variable names as workflow settings issues", () => {
    expect(
      buildPreRunIssues(
        workflow({
          settings: {
            timeout_seconds: 600,
            variables: {
              baseUrl: "https://api.example.com",
              "bad-name": "ignored",
              "2token": "ignored",
            },
          },
        })
      )
    ).toEqual([
      {
        id: "root:settings:variables:bad-name",
        severity: "error",
        title: "\u5de5\u4f5c\u6d41\u53d8\u91cf\u540d\u4e0d\u5408\u6cd5",
        message: "\u53d8\u91cf bad-name\uff1a\u53d8\u91cf\u540d\u53ea\u80fd\u5305\u542b\u5b57\u6bcd\u3001\u6570\u5b57\u548c\u4e0b\u5212\u7ebf\uff0c\u4e14\u4e0d\u80fd\u4ee5\u6570\u5b57\u5f00\u5934\u3002",
        field: "bad-name",
        path: ["root", "settings"],
        targetKind: "settings",
      },
      {
        id: "root:settings:variables:2token",
        severity: "error",
        title: "\u5de5\u4f5c\u6d41\u53d8\u91cf\u540d\u4e0d\u5408\u6cd5",
        message: "\u53d8\u91cf 2token\uff1a\u53d8\u91cf\u540d\u53ea\u80fd\u5305\u542b\u5b57\u6bcd\u3001\u6570\u5b57\u548c\u4e0b\u5212\u7ebf\uff0c\u4e14\u4e0d\u80fd\u4ee5\u6570\u5b57\u5f00\u5934\u3002",
        field: "2token",
        path: ["root", "settings"],
        targetKind: "settings",
      },
    ]);
  });
  it("reports nodes whose type is no longer loaded", () => {
    expect(
      buildPreRunIssues(
        workflow({
          nodes: [node({ id: "unknown", type: "custom.node", config: {} })],
        }),
        []
      )
    ).toEqual([
      {
        id: "root/unknown:type",
        nodeId: "unknown",
        nodeType: "custom.node",
        severity: "error",
        title: "节点类型未加载",
        message: "节点类型 custom.node 当前不可用，请刷新节点库或恢复对应 Python 节点脚本。",
        field: "type",
        path: ["root", "unknown"],
      },
    ]);
  });

  it("reports missing required config fields from node schemas", () => {
    const issues = buildPreRunIssues(
      workflow({
        nodes: [node({ id: "api", type: "custom.api", config: { endpoint: " " } })],
      }),
      [
        nodeType({
          id: "custom.api",
          name: "Custom API",
          configSchema: {
            type: "object",
            required: ["endpoint"],
            properties: {
              endpoint: { type: "string", title: "Endpoint" },
            },
          },
        }),
      ]
    );

    expect(issues).toEqual([
      {
        id: "root/api:endpoint",
        nodeId: "api",
        nodeType: "custom.api",
        severity: "error",
        title: "节点配置不完整",
        message: "缺少必填配置：Endpoint。",
        field: "endpoint",
        path: ["root", "api"],
      },
    ]);
  });

  it("reports invalid config fields from node schema constraints", () => {
    const issues = buildPreRunIssues(
      workflow({
        nodes: [node({ id: "api", type: "custom.api", config: { endpoint: "ab" } })],
      }),
      [
        nodeType({
          id: "custom.api",
          name: "Custom API",
          configSchema: {
            type: "object",
            properties: {
              endpoint: { type: "string", title: "Endpoint", minLength: 3 },
            },
          },
        }),
      ]
    );

    expect(issues).toEqual([
      {
        id: "root/api:endpoint",
        nodeId: "api",
        nodeType: "custom.api",
        severity: "error",
        title: "节点配置不合法",
        message: "Endpoint：至少需要 3 个字符。",
        field: "endpoint",
        path: ["root", "api"],
      },
    ]);
  });

  it("reports stale config keys removed from the current node schema", () => {
    const issues = buildPreRunIssues(
      workflow({
        nodes: [node({ id: "api", type: "custom.api", config: { endpoint: "/users", legacy_token: "old" } })],
      }),
      [
        nodeType({
          id: "custom.api",
          name: "Custom API",
          configSchema: {
            type: "object",
            additionalProperties: false,
            properties: {
              endpoint: { type: "string", title: "Endpoint" },
            },
          },
        }),
      ]
    );

    expect(issues).toEqual([
      {
        id: "root/api:legacy_token",
        nodeId: "api",
        nodeType: "custom.api",
        severity: "error",
        title: "节点配置包含已移除字段",
        message: "配置字段 legacy_token 当前不在节点定义中，可能来自旧版 Python 节点脚本，请删除或迁移。",
        field: "legacy_token",
        path: ["root", "api"],
      },
    ]);
  });
  it("reports schema errors through local $defs references", () => {
    const issues = buildPreRunIssues(
      workflow({
        nodes: [node({ id: "api", type: "custom.api", config: { auth: {} } })],
      }),
      [
        nodeType({
          id: "custom.api",
          name: "Custom API",
          configSchema: {
            type: "object",
            $defs: {
              Auth: {
                type: "object",
                title: "Auth",
                required: ["token"],
                properties: {
                  token: { type: "string", title: "Token" },
                },
              },
            },
            properties: {
              auth: { $ref: "#/$defs/Auth" },
            },
          },
        }),
      ]
    );

    expect(issues).toEqual([
      {
        id: "root/api:auth",
        nodeId: "api",
        nodeType: "custom.api",
        severity: "error",
        title: "节点配置不合法",
        message: "Auth：Token：必填项不能为空。",
        field: "auth",
        path: ["root", "api"],
      },
    ]);
  });
  it("reports nested schema field errors from node schemas", () => {
    const issues = buildPreRunIssues(
      workflow({
        nodes: [node({ id: "api", type: "custom.api", config: { auth: {} } })],
      }),
      [
        nodeType({
          id: "custom.api",
          name: "Custom API",
          configSchema: {
            type: "object",
            properties: {
              auth: {
                type: "object",
                title: "Auth",
                required: ["token"],
                properties: {
                  token: { type: "string", title: "Token" },
                },
              },
            },
          },
        }),
      ]
    );

    expect(issues).toEqual([
      {
        id: "root/api:auth",
        nodeId: "api",
        nodeType: "custom.api",
        severity: "error",
        title: "节点配置不合法",
        message: "Auth：Token：必填项不能为空。",
        field: "auth",
        path: ["root", "api"],
      },
    ]);
  });
  it("reports dynamic port configuration errors before saving or running", () => {
    const issues = buildPreRunIssues(
      workflow({
        nodes: [
          node({
            id: "collect",
            type: "custom.collect",
            config: { sources: [{ id: "bad-port", label: "Bad" }] },
          }),
        ],
      }),
      [
        nodeType({
          id: "custom.collect",
          name: "Custom Collect",
          configSchema: { type: "object", properties: { sources: {} } },
          dynamicInputs: { configKey: "sources", idKey: "id", labelKey: "label", input: {} },
        }),
      ]
    );

    expect(issues).toEqual([
      {
        id: "root/collect:sources",
        nodeId: "collect",
        nodeType: "custom.collect",
        severity: "error",
        title: "动态端口配置不合法",
        message: "第 1 个动态输入端口 ID 必须使用字母、数字或下划线。",
        field: "sources",
        path: ["root", "collect"],
      },
    ]);
  });
  it("does not modify the input workflow", () => {
    const input = workflow({
      nodes: [
        node({
          id: "each",
          type: "control.foreach",
          config: { items_expression: "$.rows" },
          subflows: {
            body: {
              nodes: [node({ id: "request", type: "http.request", config: { method: "", url: "" } })],
              edges: [],
            },
          },
        }),
      ],
    });
    const before = structuredClone(input);

    buildPreRunIssues(input);

    expect(input).toEqual(before);
  });
});

function workflow(overrides: Partial<WorkflowDocument> = {}): WorkflowDocument {
  return {
    id: "workflow",
    name: "Workflow",
    version: 1,
    nodes: [],
    edges: [],
    ...overrides,
  };
}

function node(overrides: Partial<WorkflowNode> = {}): WorkflowNode {
  return {
    id: "node",
    type: "unknown.node",
    position: { x: 0, y: 0 },
    config: {},
    ...overrides,
  };
}

function nodeType(overrides: Partial<NodeType> = {}): NodeType {
  return {
    id: "custom.node",
    name: "Custom Node",
    category: "Custom",
    description: "",
    inputs: {},
    outputs: {},
    configSchema: { type: "object", properties: {} },
    ...overrides,
  };
}
