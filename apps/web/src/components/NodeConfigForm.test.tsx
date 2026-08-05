import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NodeType, WorkflowNode } from "../types";
import { NodeConfigForm } from "./NodeConfigForm";

afterEach(cleanup);

const node: WorkflowNode = {
  id: "http_1",
  type: "http.request",
  position: { x: 0, y: 0 },
  config: { method: "POST", url: "https://example.com", body: { enabled: true }, credential_id: "cred_1" },
};

const nodeType: NodeType = {
  id: "http.request",
  name: "HTTP Request",
  category: "Network",
  description: "Send a request",
  inputs: {},
  outputs: {},
  configSchema: {
    type: "object",
    properties: {
      method: { type: "string" },
      url: { type: "string" },
      body: { type: "object" },
      credential_id: { type: "string" },
    },
  },
  form: {
    groups: [
      {
        id: "request",
        label: "请求",
        fields: [
          { key: "method", control: "select", options: [{ value: "GET", label: "GET" }, { value: "POST", label: "POST" }] },
          { key: "url", control: "url" },
        ],
      },
      {
        id: "content",
        label: "内容",
        fields: [{ key: "body", control: "json", visibleWhen: { field: "method", oneOf: ["POST"] } }],
      },
    ],
  },
};

describe("NodeConfigForm", () => {
  it("renders declared Chinese groups and leaves unlisted fields in other parameters", () => {
    const renderField = vi.fn((key: string) => <input aria-label={key} key={key} />);

    render(<NodeConfigForm node={node} nodeType={nodeType} renderField={renderField} />);

    expect(screen.getByRole("group", { name: "请求" })).toBeVisible();
    expect(screen.getByRole("group", { name: "内容" })).toBeVisible();
    expect(screen.getByRole("group", { name: "其他参数" })).toBeVisible();
    expect(screen.getByLabelText("body")).toBeVisible();
    expect(screen.getByLabelText("credential_id")).toBeVisible();
  });

  it("hides a conditional field without changing the supplied node config", () => {
    const renderField = (key: string) => <input aria-label={key} key={key} />;
    const { rerender } = render(<NodeConfigForm node={node} nodeType={nodeType} renderField={renderField} />);
    expect(screen.getByLabelText("body")).toBeVisible();

    rerender(<NodeConfigForm node={{ ...node, config: { ...node.config, method: "GET" } }} nodeType={nodeType} renderField={renderField} />);

    expect(screen.queryByLabelText("body")).not.toBeInTheDocument();
    expect(node.config.body).toEqual({ enabled: true });
  });

  it("falls back to automatic fields when API form metadata is unsafe", () => {
    const renderField = (key: string) => <input aria-label={key} key={key} />;
    const invalidFormNodeType: NodeType = {
      ...nodeType,
      form: { groups: [{ id: "invalid", label: "无效", fields: [{ key: "missing", control: "text" }] }] },
    };

    render(<NodeConfigForm node={node} nodeType={invalidFormNodeType} renderField={renderField} />);

    expect(screen.getByText("节点表单描述无效，已使用通用配置表单。")).toBeVisible();
    expect(screen.getByLabelText("url")).toBeVisible();
  });
});
