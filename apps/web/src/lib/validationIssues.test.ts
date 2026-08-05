import { describe, expect, it } from "vitest";
import type { ValidationIssue } from "../types";
import { formatValidationIssue, formatValidationSummary } from "./validationIssues";

describe("validation issue display", () => {
  it("formats node config paths and common backend messages in Chinese", () => {
    const issue: ValidationIssue = {
      path: "nodes.request.config.url",
      message: "Field required",
    };

    expect(formatValidationIssue(issue)).toBe("节点 request 的配置 URL：必填项不能为空");
  });

  it("formats connection and variable paths with friendly locations", () => {
    expect(
      formatValidationIssue({
        path: "edges.edge_1.targetHandle",
        message: "Input handle already connected: input",
      })
    ).toBe("连线 edge_1 的输入端口：输入端口已连接：input");

    expect(
      formatValidationIssue({
        path: "settings.variables.base-url",
        message: "变量名只能包含字母、数字和下划线，且不能以数字开头。",
      })
    ).toBe("工作流变量 base-url：变量名只能包含字母、数字和下划线，且不能以数字开头。");
  });

  it("formats workflow timeout range messages in Chinese", () => {
    expect(
      formatValidationIssue({
        path: "settings.timeout_seconds",
        message: "Workflow timeout must be between 1 and 86400 seconds",
      })
    ).toBe("工作流设置超时秒数：超时时间必须在 1 到 86400 秒之间");
  });

  it("formats Webhook structural validation messages in Chinese", () => {
    expect(
      formatValidationIssue({
        path: "edges.manual_to_webhook.target",
        message: "Webhook trigger must not have incoming connections.",
      })
    ).toBe("连线 manual_to_webhook 的终点节点：Webhook 触发器不能有上游连接。");

    expect(
      formatValidationIssue({
        path: "nodes.webhook_orders_again.config.path",
        message: "Webhook endpoint POST /hooks/orders is already used by node webhook_orders.",
      })
    ).toBe("节点 webhook_orders_again 的配置 路径：Webhook 地址 POST /hooks/orders 已被节点 webhook_orders 使用。");

    expect(
      formatValidationIssue({
        path: "nodes.respond",
        message: "Webhook response nodes require a Webhook trigger on every incoming workflow path.",
      })
    ).toBe("节点 respond：Webhook 响应节点只能位于 Webhook 触发器的下游路径中。");
  });

  it("formats incompatible port schema issues from structured details", () => {
    expect(
      formatValidationIssue({
        path: "edges.edge_1",
        message: "backend fallback text",
        code: "incompatible_schema",
        details: {
          source_port: "success",
          target_port: "input",
          source_schema_label: "string",
          target_schema_label: "number",
        },
      })
    ).toBe("连线 edge_1：端口数据类型不兼容：success string -> input number");
  });

  it("formats incompatible connection kind issues from structured details", () => {
    expect(
      formatValidationIssue({
        path: "edges.edge_1",
        message: "backend fallback text",
        code: "incompatible_connection_kind",
        details: {
          source_port: "success",
          target_port: "input",
          source_connection_kind: "resource",
          target_connection_kind: "tool",
        },
      })
    ).toBe("连线 edge_1：端口通道不匹配：success 资源 -> input 工具");
  });

  it("summarizes the first few issues without exposing raw backend paths", () => {
    const issues: ValidationIssue[] = [
      { path: "nodes.request.config.url", message: "Field required" },
      { path: "edges.edge_1.targetHandle", message: "Missing required input: input" },
      { path: "nodes", message: "Workflow graph contains a cycle" },
      { path: "settings.timeout_seconds", message: "Input should be greater than 0" },
    ];

    expect(formatValidationSummary(issues, 3)).toBe(
      "工作流有 4 个问题：节点 request 的配置 URL：必填项不能为空；连线 edge_1 的输入端口：缺少必填输入：input；节点：工作流中存在循环依赖；另有 1 个问题。"
    );
  });
});
