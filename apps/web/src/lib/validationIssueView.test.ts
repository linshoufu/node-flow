import { describe, expect, it } from "vitest";
import { buildValidationIssueItems } from "./validationIssueView";

describe("buildValidationIssueItems", () => {
  it("turns backend validation issues into clickable node and settings items", () => {
    expect(
      buildValidationIssueItems([
        { path: "nodes.request.config.url", message: "Field required" },
        { path: "edges.edge_1.targetHandle", message: "Input handle already connected: input" },
        { path: "settings.variables.base-url", message: "变量名只能包含字母、数字和下划线，且不能以数字开头。" },
      ])
    ).toEqual([
      {
        id: "nodes.request.config.url",
        title: "节点配置问题",
        message: "节点 request 的配置 URL：必填项不能为空",
        targetKind: "node",
        nodeId: "request",
        field: "url",
        location: "节点 request",
      },
      {
        id: "edges.edge_1.targetHandle",
        title: "连线问题",
        message: "连线 edge_1 的输入端口：输入端口已连接：input",
        targetKind: "edge",
        edgeId: "edge_1",
        field: "targetHandle",
        location: "连线 edge_1",
      },
      {
        id: "settings.variables.base-url",
        title: "工作流设置问题",
        message: "工作流变量 base-url：变量名只能包含字母、数字和下划线，且不能以数字开头。",
        targetKind: "settings",
        field: "base-url",
        location: "工作流变量 base-url",
      },
    ]);
  });

  it("keeps coded backend connection issues clickable", () => {
    expect(
      buildValidationIssueItems([
        {
          path: "edges.edge_1",
          message: "Incompatible port schemas: source.success string -> sink.input number",
          code: "incompatible_schema",
        },
      ])
    ).toEqual([
      {
        id: "edges.edge_1",
        title: "连线问题",
        message: "连线 edge_1：端口数据类型不兼容：source.success string -> sink.input number",
        targetKind: "edge",
        edgeId: "edge_1",
        field: undefined,
        location: "连线 edge_1",
      },
    ]);
  });
});
