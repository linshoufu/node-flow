import { describe, expect, it } from "vitest";
import type { WorkflowDocument, WorkflowNode } from "../types";
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

  it("returns no issues for unknown nodes", () => {
    expect(
      buildPreRunIssues(
        workflow({
          nodes: [node({ id: "unknown", type: "custom.node", config: {} })],
        })
      )
    ).toEqual([]);
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
