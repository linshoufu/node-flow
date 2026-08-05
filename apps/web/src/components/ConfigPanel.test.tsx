import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExpressionReference } from "../lib/expressionReferences";
import type { CredentialSummary, CredentialType, NodeType, WorkflowNode, WorkflowSummary } from "../types";
import { ConfigPanel } from "./ConfigPanel";

const manualTriggerType: NodeType = {
  id: "trigger.manual",
  name: "Manual Trigger",
  category: "trigger",
  description: "Starts a workflow manually",
  inputs: {},
  outputs: {},
  configSchema: {
    type: "object",
    properties: {
      payload: {
        title: "Payload",
        type: "object",
        additionalProperties: true,
      },
    },
  },
};

const manualTriggerNode: WorkflowNode = {
  id: "node_manual",
  type: "trigger.manual",
  position: { x: 0, y: 0 },
  config: {
    payload: { greeting: "hello" },
  },
};

const listNodeType: NodeType = {
  ...manualTriggerType,
  id: "test.list",
  name: "List Node",
  configSchema: {
    type: "object",
    properties: {
      items: {
        title: "Items",
        type: "array",
        items: { type: "string" },
      },
    },
  },
};

const listNode: WorkflowNode = {
  ...manualTriggerNode,
  id: "node_list",
  type: "test.list",
  config: {
    items: ["one"],
  },
};

const flexibleNodeType: NodeType = {
  ...manualTriggerType,
  id: "test.flexible",
  name: "Flexible Node",
  configSchema: {
    type: "object",
    properties: {
      value: {
        title: "Value expression",
      },
    },
  },
};

const flexibleNode: WorkflowNode = {
  ...manualTriggerNode,
  id: "node_flexible",
  type: "test.flexible",
  config: {
    value: {
      Authorization: "Bearer {{ secrets.api_token }}",
    },
  },
};

const httpNodeType: NodeType = {
  ...manualTriggerType,
  id: "http.request",
  name: "HTTP 请求",
  configSchema: {
    type: "object",
    properties: {
      url: { title: "URL", type: "string", default: "" },
      method: { title: "方法", type: "string", default: "GET" },
    },
  },
};

const httpCredentialTypes: CredentialType[] = [
  {
    id: "http.bearer",
    display_name: "HTTP Bearer 令牌",
    fields: [{ id: "token", label: "令牌", secret: true }],
    node_type_ids: ["http.request"],
  },
];

const httpCredentials: CredentialSummary[] = [
  {
    id: "cred_bearer",
    type_id: "http.bearer",
    name: "测试接口令牌",
    created_at: "2026-07-20T00:00:00Z",
    updated_at: "2026-07-20T00:00:00Z",
  },
];

const httpNode: WorkflowNode = {
  ...manualTriggerNode,
  id: "node_http",
  type: "http.request",
  config: {
    url: "",
    method: "GET",
  },
};

const forEachType: NodeType = {
  ...manualTriggerType,
  id: "control.foreach",
  name: "For Each",
  category: "control",
  configSchema: {
    type: "object",
    properties: {
      items_path: {
        title: "Items Path",
        type: "string",
      },
    },
  },
};

const forEachNode: WorkflowNode = {
  ...manualTriggerNode,
  id: "node_loop",
  type: "control.foreach",
  config: {
    items_path: "$.items",
  },
  subflows: {
    body: {
      nodes: [],
      edges: [],
    },
  },
};

const errorCapableNodeType: NodeType = {
  ...manualTriggerType,
  id: "test.error-capable",
  outputs: {
    error: { description: "Failure data" },
  },
};

const executeWorkflowType: NodeType = {
  ...manualTriggerType,
  id: "workflow.execute",
  name: "Execute Workflow",
  configSchema: {
    type: "object",
    properties: {
      workflow_id: { title: "Target workflow", type: "string" },
    },
    required: ["workflow_id"],
  },
};

const executeWorkflowNode: WorkflowNode = {
  ...manualTriggerNode,
  id: "node_execute_workflow",
  type: "workflow.execute",
  config: { workflow_id: "wf_login" },
};

const webhookTriggerType: NodeType = {
  ...manualTriggerType,
  id: "webhook.trigger",
  name: "Webhook Trigger",
  configSchema: {
    type: "object",
    properties: {
      method: { title: "Request method", type: "string" },
      path: { title: "Path", type: "string" },
    },
  },
};

const webhookTriggerNode: WorkflowNode = {
  ...manualTriggerNode,
  id: "node_webhook",
  type: "webhook.trigger",
  config: { method: "POST", path: "/hooks/orders/" },
};

const childWorkflowSummary: WorkflowSummary = {
  id: "wf_login",
  name: "登录回归",
  version: 3,
};

const guidanceNodeTypes = [
  ["http.request", "填写请求方法和 URL。"],
  ["data.csv_read", "填写 CSV 文件路径，确认分隔符和表头设置。运行后可在运行详情查看表头和行数。"],
  ["control.foreach", "填写循环数据来源。循环体内可以用 {{ loop.item.column_name }} 引用当前 CSV 行字段。"],
  ["control.each_item", "连接数据项输入后，循环体内可以用 {{ loop.item }} 读取当前项。"],
  ["assert.status_code", "填写期望状态码。"],
  ["test.write_report", "填写测试报告输出路径。"],
] as const;

function createNodeType(id: string): NodeType {
  return {
    ...manualTriggerType,
    id,
    name: id,
    configSchema: {
      type: "object",
      properties: {
        value: {
          title: "Value",
          type: "string",
        },
      },
    },
  };
}

function createNode(type: string): WorkflowNode {
  return {
    ...manualTriggerNode,
    id: `node_${type.replaceAll(".", "_")}`,
    type,
    config: {
      value: "",
    },
  };
}

describe("ConfigPanel", () => {
  it("renders declarative HTTP groups, toggles the request body, and filters credentials", () => {
    const onConfigChange = vi.fn();
    const declarativeHttpType: NodeType = {
      ...httpNodeType,
      configSchema: {
        type: "object",
        properties: {
          method: { title: "Method", type: "string" },
          url: { title: "URL", type: "string" },
          body: { title: "Body" },
          credential_id: { title: "Credential", type: "string" },
        },
      },
      form: {
        groups: [
          {
            id: "request",
            label: "请求",
            fields: [
              {
                key: "method",
                control: "select",
                label: "请求方法",
                options: [
                  { value: "GET", label: "GET" },
                  { value: "POST", label: "POST" },
                ],
              },
              { key: "url", control: "url", label: "URL" },
            ],
          },
          {
            id: "content",
            label: "内容",
            fields: [{ key: "body", control: "json", label: "请求体", visibleWhen: { field: "method", oneOf: ["POST"] } }],
          },
          {
            id: "authentication",
            label: "认证",
            fields: [
              {
                key: "credential_id",
                control: "credential",
                label: "认证凭据",
                credentialTypeIds: ["http.bearer"],
              },
            ],
          },
        ],
      },
    };
    const postNode: WorkflowNode = {
      ...httpNode,
      config: { method: "POST", url: "https://example.com", body: { sample: true }, credential_id: "cred_bearer" },
    };
    const mixedCredentialTypes: CredentialType[] = [
      ...httpCredentialTypes,
      { id: "other.token", display_name: "其他凭据", fields: [{ id: "token", label: "令牌", secret: true }], node_type_ids: ["other.node"] },
    ];
    const mixedCredentials: CredentialSummary[] = [
      ...httpCredentials,
      { id: "cred_other", type_id: "other.token", name: "不应显示", created_at: "2026-07-20T00:00:00Z", updated_at: "2026-07-20T00:00:00Z" },
    ];
    const { rerender } = render(
      <ConfigPanel
        credentialTypes={mixedCredentialTypes}
        credentials={mixedCredentials}
        node={postNode}
        nodeType={declarativeHttpType}
        onConfigChange={onConfigChange}
      />
    );

    expect(screen.getByRole("group", { name: "请求" })).toBeVisible();
    expect(screen.getByRole("group", { name: "内容" })).toBeVisible();
    expect(screen.getByRole("group", { name: "认证" })).toBeVisible();
    expect(screen.getByLabelText("请求体")).toHaveValue(JSON.stringify({ sample: true }, null, 2));
    expect(screen.getByText(/测试接口令牌/)).toBeVisible();
    expect(screen.queryByText(/不应显示/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("请求方法"), { target: { value: "GET" } });
    expect(onConfigChange).toHaveBeenCalledWith(postNode.id, "method", "GET");

    rerender(
      <ConfigPanel
        credentialTypes={mixedCredentialTypes}
        credentials={mixedCredentials}
        node={{ ...postNode, config: { ...postNode.config, method: "GET" } }}
        nodeType={declarativeHttpType}
        onConfigChange={onConfigChange}
      />
    );
    expect(screen.queryByLabelText("请求体")).not.toBeInTheDocument();
    expect(postNode.config.body).toEqual({ sample: true });
  });

  afterEach(() => {
    cleanup();
  });

  it("uses saved workflow names instead of a raw id for Execute Workflow", () => {
    render(
      <ConfigPanel
        currentWorkflowId="wf_parent"
        node={executeWorkflowNode}
        nodeType={executeWorkflowType}
        onConfigChange={vi.fn()}
        workflowOptions={[childWorkflowSummary]}
      />
    );

    expect(screen.getByLabelText("目标工作流")).toHaveValue("wf_login");
    expect(screen.getByRole("option", { name: "登录回归（v3）" })).toBeInTheDocument();
    expect(screen.queryByDisplayValue("wf_login")).not.toBeInTheDocument();
  });

  it("shows enum display labels while saving the stable enum value", () => {
    const onConfigChange = vi.fn();
    const nodeType: NodeType = {
      ...manualTriggerType,
      id: "data.filter_items",
      configSchema: {
        type: "object",
        properties: {
          operator: {
            title: "比较方式",
            type: "string",
            enum: ["equals", "not_equals"],
            enumLabels: {
              equals: "等于",
              not_equals: "不等于",
            },
          },
        },
      },
    };
    const node: WorkflowNode = {
      ...manualTriggerNode,
      id: "node_filter_items",
      type: nodeType.id,
      config: { operator: "equals" },
    };

    render(<ConfigPanel node={node} nodeType={nodeType} onConfigChange={onConfigChange} />);

    expect(screen.getByRole("option", { name: "等于" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "equals" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("比较方式"), { target: { value: "1" } });

    expect(onConfigChange).toHaveBeenLastCalledWith(node.id, "operator", "not_equals");
  });

  it("shows a normalized incoming URL for a Webhook trigger", () => {
    const onConfigChange = vi.fn();
    const nodeType: NodeType = {
      ...webhookTriggerType,
      configSchema: {
        type: "object",
        properties: {
          ...webhookTriggerType.configSchema.properties,
          response_mode: { title: "响应方式", type: "string", default: "sync" },
        },
      },
      form: {
        groups: [
          {
            id: "webhook",
            label: "触发配置",
            fields: [
              { key: "method", control: "select", label: "请求方法", options: [{ value: "POST", label: "POST" }] },
              { key: "path", control: "text", label: "请求路径" },
              {
                key: "response_mode",
                control: "select",
                label: "响应方式",
                options: [
                  { value: "sync", label: "等待工作流完成" },
                  { value: "immediate", label: "立即确认，后台执行" },
                ],
              },
            ],
          },
        ],
      },
    };
    render(
      <ConfigPanel
        currentWorkflowId="wf_webhook_debug"
        node={webhookTriggerNode}
        nodeType={nodeType}
        onConfigChange={onConfigChange}
      />
    );

    expect(screen.getByText("生产地址")).toBeInTheDocument();
    expect(screen.getByText("http://127.0.0.1:8150/webhooks/hooks/orders")).toBeInTheDocument();
    expect(screen.getByText("调试地址")).toBeInTheDocument();
    expect(screen.getByText("http://127.0.0.1:8150/webhooks-test/wf_webhook_debug/hooks/orders")).toBeInTheDocument();
    expect(screen.getByText("选择验证请求头后，未携带匹配值的请求不会创建运行记录。")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("响应方式"), { target: { value: "immediate" } });
    expect(onConfigChange).toHaveBeenCalledWith(webhookTriggerNode.id, "response_mode", "immediate");
  });

  it("controls one-shot debug webhook listening in Chinese", () => {
    const onStartWebhookTestListener = vi.fn();
    const onStopWebhookTestListener = vi.fn();
    const { rerender } = render(
      <ConfigPanel
        currentWorkflowId="wf_webhook_debug"
        node={webhookTriggerNode}
        nodeType={webhookTriggerType}
        onConfigChange={vi.fn()}
        onStartWebhookTestListener={onStartWebhookTestListener}
        onStopWebhookTestListener={onStopWebhookTestListener}
      />
    );

    expect(screen.getByText("未监听：调试地址不会接收请求。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "开始监听" }));
    expect(onStartWebhookTestListener).toHaveBeenCalledWith(webhookTriggerNode.id);

    rerender(
      <ConfigPanel
        currentWorkflowId="wf_webhook_debug"
        node={webhookTriggerNode}
        nodeType={webhookTriggerType}
        onConfigChange={vi.fn()}
        webhookTestListener={{ workflow_id: "wf_webhook_debug", node_id: webhookTriggerNode.id, active: true }}
        onStartWebhookTestListener={onStartWebhookTestListener}
        onStopWebhookTestListener={onStopWebhookTestListener}
      />
    );

    expect(screen.getByText("监听中：下一条请求会启动调试运行，随后自动结束。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "停止监听" }));
    expect(onStopWebhookTestListener).toHaveBeenCalledWith(webhookTriggerNode.id);
  });

  it("marks the no-selection panel state for compact workspace styling", () => {
    render(<ConfigPanel onConfigChange={vi.fn()} />);

    expect(screen.getByLabelText("配置面板")).toHaveAttribute("data-empty", "true");
  });

  it("edits failure handling in Chinese and disables error routing without an error port", () => {
    const onExecutionPolicyChange = vi.fn();
    const { rerender } = render(
      <ConfigPanel
        node={manualTriggerNode}
        nodeType={manualTriggerType}
        onConfigChange={vi.fn()}
        onExecutionPolicyChange={onExecutionPolicyChange}
      />
    );

    expect(screen.getByRole("radiogroup", { name: "失败处理" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "走错误端口" })).toBeDisabled();
    expect(screen.getByText("该节点没有 error 输出端口，不能路由执行异常。")).toBeInTheDocument();

    rerender(
      <ConfigPanel
        node={manualTriggerNode}
        nodeType={errorCapableNodeType}
        onConfigChange={vi.fn()}
        onExecutionPolicyChange={onExecutionPolicyChange}
      />
    );
    fireEvent.click(screen.getByRole("radio", { name: "失败后继续" }));
    expect(onExecutionPolicyChange).toHaveBeenCalledWith("node_manual", {
      onError: "continue",
      retry: { maxAttempts: 1, delaySeconds: 0 },
    });
  });

  it("toggles a node's execution state without changing its configuration", () => {
    const onDisabledChange = vi.fn();
    render(
      <ConfigPanel
        node={manualTriggerNode}
        nodeType={manualTriggerType}
        onConfigChange={vi.fn()}
        onDisabledChange={onDisabledChange}
      />
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "禁用节点" }));

    expect(onDisabledChange).toHaveBeenCalledWith("node_manual", true);
    expect(screen.getByText("运行时跳过此节点，并将输入透传到主输出端口。")).toBeInTheDocument();
  });

  it("edits object config as JSON without corrupting invalid input", () => {
    const onConfigChange = vi.fn();
    render(<ConfigPanel node={manualTriggerNode} nodeType={manualTriggerType} onConfigChange={onConfigChange} />);

    const payloadEditor = screen.getByLabelText("Payload");
    expect(payloadEditor).toHaveValue('{\n  "greeting": "hello"\n}');

    fireEvent.change(payloadEditor, { target: { value: '{ "count": 2 }' } });
    expect(onConfigChange).toHaveBeenLastCalledWith("node_manual", "payload", { count: 2 });

    fireEvent.change(payloadEditor, { target: { value: "{ invalid" } });
    expect(screen.getByText("JSON 格式无效")).toBeInTheDocument();
    expect(onConfigChange).toHaveBeenCalledTimes(1);
  });

  it("disables config editing controls when the editor is locked", () => {
    const onConfigChange = vi.fn();
    const onOpenSubflow = vi.fn();
    render(
      <ConfigPanel
        disabled
        expressionReferences={[
          {
            id: "loop-url",
            group: "loop",
            label: "当前行 URL",
            expression: "{{ loop.item.url }}",
            description: "当前 CSV 行 URL",
          },
        ]}
        node={forEachNode}
        nodeType={forEachType}
        onConfigChange={onConfigChange}
        onOpenSubflow={onOpenSubflow}
      />
    );

    expect(screen.getByLabelText("Items Path")).toBeDisabled();
    expect(screen.getByRole("button", { name: "插入 {{ loop.item.url }}" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "编辑循环体" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Items Path"), { target: { value: "$.rows" } });
    fireEvent.click(screen.getByRole("button", { name: "插入 {{ loop.item.url }}" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑循环体" }));

    expect(onConfigChange).not.toHaveBeenCalled();
    expect(onOpenSubflow).not.toHaveBeenCalled();
  });

  it("shows a product-facing selected node subtitle instead of the internal node type id", () => {
    render(<ConfigPanel node={manualTriggerNode} nodeType={manualTriggerType} onConfigChange={vi.fn()} />);

    const selectedNode = screen.getByText("Manual Trigger").closest(".selected-node");

    expect(selectedNode).not.toBeNull();
    expect(within(selectedNode as HTMLElement).getByText("触发器")).toBeInTheDocument();
    expect(within(selectedNode as HTMLElement).queryByText("trigger.manual")).not.toBeInTheDocument();
  });

  it("edits the stable workflow node label separately from node configuration", () => {
    const onLabelChange = vi.fn();
    render(
      <ConfigPanel
        node={{ ...manualTriggerNode, label: "准备请求" }}
        nodeType={manualTriggerType}
        onConfigChange={vi.fn()}
        onLabelChange={onLabelChange}
      />
    );

    expect(screen.getByLabelText("节点名称")).toHaveValue("准备请求");
    fireEvent.change(screen.getByLabelText("节点名称"), { target: { value: "发送登录请求" } });

    expect(onLabelChange).toHaveBeenCalledWith("node_manual", "发送登录请求");
  });

  it("edits node notes separately from node configuration", () => {
    const onNotesChange = vi.fn();
    render(
      <ConfigPanel
        node={manualTriggerNode}
        nodeType={manualTriggerType}
        onConfigChange={vi.fn()}
        onNotesChange={onNotesChange}
      />
    );

    fireEvent.change(screen.getByLabelText("节点备注"), { target: { value: "调用前准备数据" } });

    expect(onNotesChange).toHaveBeenCalledWith("node_manual", "调用前准备数据");
  });

  it("shows configured node labels as the selected node title", () => {
    render(
      <ConfigPanel
        node={{
          ...manualTriggerNode,
          config: {
            ...manualTriggerNode.config,
            label: "登录入口",
          },
        }}
        nodeType={manualTriggerType}
        onConfigChange={vi.fn()}
      />
    );

    const selectedNode = screen.getByText("登录入口").closest(".selected-node");

    expect(selectedNode).not.toBeNull();
    expect(within(selectedNode as HTMLElement).queryByText("Manual Trigger")).not.toBeInTheDocument();
    expect(within(selectedNode as HTMLElement).getByText("触发器")).toBeInTheDocument();
  });

  it("shows a documentation link for node types that provide one", () => {
    render(
      <ConfigPanel
        node={manualTriggerNode}
        nodeType={{
          ...manualTriggerType,
          documentationUrl: "https://docs.example.com/nodes/manual-trigger",
        }}
        onConfigChange={vi.fn()}
      />
    );

    const selectedNode = screen.getByText("Manual Trigger").closest(".selected-node");
    const documentationLink = within(selectedNode as HTMLElement).getByRole("link", { name: "打开文档" });

    expect(documentationLink).toHaveAttribute("href", "https://docs.example.com/nodes/manual-trigger");
    expect(documentationLink).toHaveAttribute("target", "_blank");
    expect(documentationLink).toHaveAttribute("rel", "noreferrer");
    expect(within(selectedNode as HTMLElement).queryByText("https://docs.example.com/nodes/manual-trigger")).not.toBeInTheDocument();
  });

  it("shows node help metadata without exposing search-only keywords", () => {
    render(
      <ConfigPanel
        node={manualTriggerNode}
        nodeType={{
          ...manualTriggerType,
          description: "手动启动工作流，适合调试和临时验证。",
          displayName: "手动触发",
          tags: ["调试", "入口"],
          keywords: ["manual", "debug"],
          version: 2,
        }}
        onConfigChange={vi.fn()}
      />
    );

    const selectedNode = screen.getByText("手动触发").closest(".selected-node");

    expect(selectedNode).not.toBeNull();
    expect(within(selectedNode as HTMLElement).getByText("手动启动工作流，适合调试和临时验证。")).toBeInTheDocument();
    expect(within(selectedNode as HTMLElement).getByText("调试")).toBeInTheDocument();
    expect(within(selectedNode as HTMLElement).getByText("入口")).toBeInTheDocument();
    expect(within(selectedNode as HTMLElement).getByText("v2")).toBeInTheDocument();
    expect(within(selectedNode as HTMLElement).queryByText("manual")).not.toBeInTheDocument();
    expect(within(selectedNode as HTMLElement).queryByText("debug")).not.toBeInTheDocument();
  });

  it("rejects wrong top-level JSON shapes for object config", () => {
    const onConfigChange = vi.fn();
    render(<ConfigPanel node={manualTriggerNode} nodeType={manualTriggerType} onConfigChange={onConfigChange} />);

    const payloadEditor = screen.getByLabelText("Payload");

    fireEvent.change(payloadEditor, { target: { value: '["wrong"]' } });
    expect(screen.getByText("需要 JSON 对象")).toBeInTheDocument();
    expect(onConfigChange).not.toHaveBeenCalled();

    fireEvent.change(payloadEditor, { target: { value: "null" } });
    expect(screen.getByText("需要 JSON 对象")).toBeInTheDocument();
    expect(onConfigChange).not.toHaveBeenCalled();

    fireEvent.change(payloadEditor, { target: { value: '"wrong"' } });
    expect(screen.getByText("需要 JSON 对象")).toBeInTheDocument();
    expect(onConfigChange).not.toHaveBeenCalled();
  });

  it("accepts arrays and rejects objects for array config", () => {
    const onConfigChange = vi.fn();
    render(<ConfigPanel node={listNode} nodeType={listNodeType} onConfigChange={onConfigChange} />);

    const itemsEditor = screen.getByLabelText("Items");
    expect(itemsEditor).toHaveValue('[\n  "one"\n]');

    fireEvent.change(itemsEditor, { target: { value: '["two", "three"]' } });
    expect(onConfigChange).toHaveBeenLastCalledWith("node_list", "items", ["two", "three"]);

    fireEvent.change(itemsEditor, { target: { value: '{ "wrong": true }' } });
    expect(screen.getByText("需要 JSON 数组")).toBeInTheDocument();
    expect(onConfigChange).toHaveBeenCalledTimes(1);
  });

  it("edits flexible config as either JSON or plain text", () => {
    const onConfigChange = vi.fn();
    render(<ConfigPanel node={flexibleNode} nodeType={flexibleNodeType} onConfigChange={onConfigChange} />);

    const valueEditor = screen.getByLabelText("Value expression");
    expect(valueEditor).toHaveValue('{\n  "Authorization": "Bearer {{ secrets.api_token }}"\n}');

    fireEvent.change(valueEditor, { target: { value: '{ "X-Target": "{{ env.target }}" }' } });
    expect(onConfigChange).toHaveBeenLastCalledWith("node_flexible", "value", {
      "X-Target": "{{ env.target }}",
    });

    fireEvent.change(valueEditor, { target: { value: "{{ env.base_url }}/users" } });
    expect(onConfigChange).toHaveBeenLastCalledWith("node_flexible", "value", "{{ env.base_url }}/users");
  });

  it("marks required config fields from the node schema", () => {
    const requiredNodeType: NodeType = {
      ...manualTriggerType,
      id: "custom.api",
      name: "Custom API",
      configSchema: {
        type: "object",
        required: ["endpoint"],
        properties: {
          endpoint: {
            title: "Endpoint",
            type: "string",
          },
          note: {
            title: "Note",
            type: "string",
          },
        },
      },
    };
    const requiredNode: WorkflowNode = {
      ...manualTriggerNode,
      id: "node_custom_api",
      type: "custom.api",
      config: {
        endpoint: "",
        note: "",
      },
    };

    render(<ConfigPanel node={requiredNode} nodeType={requiredNodeType} onConfigChange={vi.fn()} />);

    expect(screen.getByText("必填")).toBeInTheDocument();
    expect(screen.getByLabelText("Endpoint")).toBeRequired();
    expect(screen.getByLabelText("Endpoint")).toHaveAttribute("aria-required", "true");
    expect(screen.getByLabelText("Note")).not.toBeRequired();
  });

  it("shows config field descriptions from the node schema", () => {
    const describedNodeType: NodeType = {
      ...manualTriggerType,
      id: "custom.api",
      name: "Custom API",
      configSchema: {
        type: "object",
        properties: {
          endpoint: {
            title: "Endpoint",
            type: "string",
            description: "调用目标接口的完整 URL。",
          },
        },
      },
    };
    const describedNode: WorkflowNode = {
      ...manualTriggerNode,
      id: "node_custom_api",
      type: "custom.api",
      config: {
        endpoint: "",
      },
    };

    render(<ConfigPanel node={describedNode} nodeType={describedNodeType} onConfigChange={vi.fn()} />);

    const helpText = screen.getByText("调用目标接口的完整 URL。");
    expect(helpText).toBeInTheDocument();
    expect(helpText.id).toBeTruthy();
    expect(screen.getByLabelText("Endpoint")).toHaveAttribute("aria-describedby", helpText.id);
  });

  it("renders local $defs string references as text inputs", () => {
    const refNodeType: NodeType = {
      ...manualTriggerType,
      id: "custom.ref",
      name: "Ref Node",
      configSchema: {
        type: "object",
        $defs: {
          Endpoint: { type: "string", title: "Endpoint", examples: ["https://api.example.com/users"] },
        },
        properties: {
          endpoint: { $ref: "#/$defs/Endpoint" },
        },
      },
    };
    const refNode: WorkflowNode = {
      ...manualTriggerNode,
      id: "node_ref",
      type: "custom.ref",
      config: {
        endpoint: "",
      },
    };

    render(<ConfigPanel node={refNode} nodeType={refNodeType} onConfigChange={vi.fn()} />);

    const endpoint = screen.getByLabelText("Endpoint");
    expect(endpoint.tagName).toBe("INPUT");
    expect(endpoint).toHaveAttribute("type", "text");
    expect(endpoint).toHaveAttribute("placeholder", "https://api.example.com/users");
  });
  it("renders optional anyOf string fields as text inputs", () => {
    const onConfigChange = vi.fn();
    const optionalNodeType: NodeType = {
      ...manualTriggerType,
      id: "custom.optional",
      name: "Optional Node",
      configSchema: {
        type: "object",
        properties: {
          endpoint: {
            title: "Endpoint",
            anyOf: [{ type: "string", examples: ["https://api.example.com/users"] }, { type: "null" }],
          },
        },
      },
    };
    const optionalNode: WorkflowNode = {
      ...manualTriggerNode,
      id: "node_optional",
      type: "custom.optional",
      config: {
        endpoint: "",
      },
    };

    render(<ConfigPanel node={optionalNode} nodeType={optionalNodeType} onConfigChange={onConfigChange} />);

    const endpoint = screen.getByLabelText("Endpoint");
    expect(endpoint.tagName).toBe("INPUT");
    expect(endpoint).toHaveAttribute("type", "text");
    expect(endpoint).toHaveAttribute("placeholder", "https://api.example.com/users");

    fireEvent.change(endpoint, { target: { value: "https://api.example.com/accounts" } });
    expect(onConfigChange).toHaveBeenLastCalledWith("node_optional", "endpoint", "https://api.example.com/accounts");
  });
  it("uses the first schema example as a field placeholder", () => {
    const exampleNodeType: NodeType = {
      ...manualTriggerType,
      id: "custom.api",
      name: "Custom API",
      configSchema: {
        type: "object",
        properties: {
          endpoint: {
            title: "Endpoint",
            type: "string",
            examples: ["https://api.example.com/users"],
          },
        },
      },
    };
    const exampleNode: WorkflowNode = {
      ...manualTriggerNode,
      id: "node_custom_api",
      type: "custom.api",
      config: {
        endpoint: "",
      },
    };

    render(<ConfigPanel node={exampleNode} nodeType={exampleNodeType} onConfigChange={vi.fn()} />);

    expect(screen.getByLabelText("Endpoint")).toHaveAttribute("placeholder", "https://api.example.com/users");
  });

  it("shows stale config keys and lets the user clean them up", () => {
    const onConfigRemove = vi.fn();
    const nodeType: NodeType = {
      ...manualTriggerType,
      id: "custom.api",
      name: "Custom API",
      configSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          endpoint: { title: "Endpoint", type: "string" },
        },
      },
    };
    const node: WorkflowNode = {
      ...manualTriggerNode,
      id: "api",
      type: "custom.api",
      config: {
        endpoint: "/users",
        legacy_token: "old",
      },
    };

    render(
      <ConfigPanel
        node={node}
        nodeType={nodeType}
        onConfigChange={vi.fn()}
        onConfigRemove={onConfigRemove}
      />
    );

    expect(screen.getByText("已移除的配置字段")).toBeInTheDocument();
    expect(screen.getByText("legacy_token")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "清理 legacy_token" }));

    expect(onConfigRemove).toHaveBeenCalledWith("api", "legacy_token");
  });

  it("shows an inline error when a required schema field is empty", () => {
    const { rerender } = render(
      <ConfigPanel
        node={{
          ...manualTriggerNode,
          id: "node_custom_api",
          type: "custom.api",
          config: { endpoint: "" },
        }}
        nodeType={{
          ...manualTriggerType,
          id: "custom.api",
          name: "Custom API",
          configSchema: {
            type: "object",
            required: ["endpoint"],
            properties: {
              endpoint: {
                title: "Endpoint",
                type: "string",
              },
            },
          },
        }}
        onConfigChange={vi.fn()}
      />
    );

    expect(screen.getByText("必填项不能为空")).toBeInTheDocument();
    expect(screen.getByLabelText("Endpoint")).toHaveAttribute("aria-invalid", "true");

    rerender(
      <ConfigPanel
        node={{
          ...manualTriggerNode,
          id: "node_custom_api",
          type: "custom.api",
          config: { endpoint: "https://api.example.com/users" },
        }}
        nodeType={{
          ...manualTriggerType,
          id: "custom.api",
          name: "Custom API",
          configSchema: {
            type: "object",
            required: ["endpoint"],
            properties: {
              endpoint: {
                title: "Endpoint",
                type: "string",
              },
            },
          },
        }}
        onConfigChange={vi.fn()}
      />
    );

    expect(screen.queryByText("必填项不能为空")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Endpoint")).not.toHaveAttribute("aria-invalid", "true");
  });

  it("shows inline schema constraint errors for configured fields", () => {
    const { rerender } = render(
      <ConfigPanel
        node={{
          ...manualTriggerNode,
          id: "node_custom_api",
          type: "custom.api",
          config: { endpoint: "ab" },
        }}
        nodeType={{
          ...manualTriggerType,
          id: "custom.api",
          name: "Custom API",
          configSchema: {
            type: "object",
            properties: {
              endpoint: {
                title: "Endpoint",
                type: "string",
                minLength: 3,
              },
            },
          },
        }}
        onConfigChange={vi.fn()}
      />
    );

    expect(screen.getByText("至少需要 3 个字符")).toBeInTheDocument();
    expect(screen.getByLabelText("Endpoint")).toHaveAttribute("aria-invalid", "true");

    rerender(
      <ConfigPanel
        node={{
          ...manualTriggerNode,
          id: "node_custom_api",
          type: "custom.api",
          config: { endpoint: "abc" },
        }}
        nodeType={{
          ...manualTriggerType,
          id: "custom.api",
          name: "Custom API",
          configSchema: {
            type: "object",
            properties: {
              endpoint: {
                title: "Endpoint",
                type: "string",
                minLength: 3,
              },
            },
          },
        }}
        onConfigChange={vi.fn()}
      />
    );

    expect(screen.queryByText("至少需要 3 个字符")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Endpoint")).not.toHaveAttribute("aria-invalid", "true");
  });

  it("shows available data references and inserts a selected expression into the focused field", () => {
    const onConfigChange = vi.fn();
    const references: ExpressionReference[] = [
      {
        id: "node:request:success",
        group: "node",
        label: "request.success",
        expression: "{{ nodes.request.outputs.success }}",
        description: "HTTP 请求 的 success 输出",
      },
      {
        id: "variable:token",
        group: "variable",
        label: "token",
        expression: "{{ variables.token }}",
        description: "运行变量 token",
      },
      {
        id: "loop:item:url",
        group: "loop",
        label: "loop.item.url",
        expression: "{{ loop.item.url }}",
        description: "当前 CSV 行的 url 列",
      },
    ];
    render(
      <ConfigPanel
        expressionReferences={references}
        node={createNode("http.request")}
        nodeType={createNodeType("http.request")}
        onConfigChange={onConfigChange}
      />
    );

    expect(screen.getByText("可用数据")).toBeInTheDocument();
    expect(screen.getByText("节点输出")).toBeInTheDocument();
    expect(screen.getByText("运行变量")).toBeInTheDocument();
    expect(screen.getByText("循环数据")).toBeInTheDocument();
    expect(screen.queryByText("{{ loop.item.url }}")).not.toBeInTheDocument();

    fireEvent.focus(screen.getByLabelText("Value"));
    expect(screen.getByText("{{ loop.item.url }}")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "插入 {{ loop.item.url }}" }));

    expect(onConfigChange).toHaveBeenLastCalledWith("node_http_request", "value", "{{ loop.item.url }}");
  });

  it("focuses a config field requested by the parent", () => {
    const { rerender } = render(
      <ConfigPanel
        node={httpNode}
        nodeType={httpNodeType}
        fieldFocusRequest={{ field: "url", key: 0 }}
        onConfigChange={vi.fn()}
      />
    );

    expect(screen.getByLabelText("URL")).toHaveFocus();

    rerender(
      <ConfigPanel
        node={httpNode}
        nodeType={httpNodeType}
        fieldFocusRequest={{ field: "method", key: 1 }}
        onConfigChange={vi.fn()}
      />
    );

    expect(screen.getByLabelText("方法")).toHaveFocus();
  });

  it("separates workflow variables from runtime variables in expression references", () => {
    const references: ExpressionReference[] = [
      {
        id: "workflow-variable:baseUrl",
        group: "workflow-variable",
        label: "vars.baseUrl",
        expression: "{{ vars.baseUrl }}",
        description: "工作流变量 baseUrl",
      },
      {
        id: "variable:token",
        group: "variable",
        label: "token",
        expression: "{{ variables.token }}",
        description: "运行变量 token",
      },
    ];
    render(
      <ConfigPanel
        expressionReferences={references}
        node={createNode("http.request")}
        nodeType={createNodeType("http.request")}
        onConfigChange={vi.fn()}
      />
    );

    expect(screen.getByText("工作流变量")).toBeInTheDocument();
    expect(screen.getByText("运行变量")).toBeInTheDocument();
    expect(screen.getByText("vars.baseUrl")).toBeInTheDocument();
    expect(screen.getByText("token")).toBeInTheDocument();
  });

  it("prevents config form submission", () => {
    const onConfigChange = vi.fn();
    render(<ConfigPanel node={manualTriggerNode} nodeType={manualTriggerType} onConfigChange={onConfigChange} />);

    const form = screen.getByLabelText("配置字段");
    const submitEvent = new Event("submit", { bubbles: true, cancelable: true });

    form.dispatchEvent(submitEvent);

    expect(submitEvent.defaultPrevented).toBe(true);
  });

  it("renders dynamic output rules with a visual editor instead of a JSON textarea", () => {
    const onConfigChange = vi.fn();
    const switchType: NodeType = {
      ...manualTriggerType,
      id: "logic.switch",
      name: "路由分支",
      category: "logic",
      outputs: { fallback: { displayName: "未匹配" } },
      dynamicOutputs: {
        configKey: "rules",
        idKey: "id",
        labelKey: "label",
        output: {},
        defaultItems: [
          { id: "route_1", label: "匹配值 1", value: "value_1" },
          { id: "route_2", label: "匹配值 2", value: "value_2" },
        ],
      },
      configSchema: {
        type: "object",
        properties: { rules: { type: "array", items: { type: "object" } } },
      },
      form: {
        groups: [
          {
            id: "routes",
            label: "路由规则",
            fields: [{ key: "rules", control: "dynamic_output_list", label: "路由规则" }],
          },
        ],
      },
    };
    const switchNode: WorkflowNode = {
      ...manualTriggerNode,
      id: "node_switch",
      type: "logic.switch",
      config: {
        rules: [
          { id: "route_1", label: "匹配值 1", value: "value_1" },
          { id: "route_2", label: "匹配值 2", value: "value_2" },
        ],
      },
    };

    render(
      <ConfigPanel
        connectedOutputHandles={["route_1"]}
        node={switchNode}
        nodeType={switchType}
        onConfigChange={onConfigChange}
      />
    );

    expect(screen.getByLabelText("第 1 条规则的分支名称")).toHaveValue("匹配值 1");
    expect(screen.getByRole("button", { name: "删除 匹配值 1" })).toBeDisabled();
    expect(screen.queryByLabelText("路由规则 JSON")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "添加分支" }));
    expect(onConfigChange).toHaveBeenCalledWith("node_switch", "rules", [
      ...switchNode.config.rules,
      { id: "route_3", label: "新分支", value: "" },
    ]);
  });

  it("renders dynamic input ports with a visual editor and protects connected inputs", () => {
    const onConfigChange = vi.fn();
    const collectType: NodeType = {
      ...manualTriggerType,
      id: "data.collect",
      name: "命名汇聚",
      category: "data",
      inputs: {},
      outputs: { output: {} },
      dynamicInputs: {
        configKey: "sources",
        idKey: "id",
        labelKey: "label",
        input: { required: true },
      },
      configSchema: { type: "object", properties: { sources: { type: "array", items: { type: "object" } } } },
      form: {
        groups: [{ id: "sources", label: "输入端口", fields: [{ key: "sources", control: "dynamic_input_list", label: "命名输入" }] }],
      },
    };
    const collectNode: WorkflowNode = {
      ...manualTriggerNode,
      id: "node_collect",
      type: "data.collect",
      config: { sources: [{ id: "left", label: "左侧结果" }, { id: "right", label: "右侧结果" }] },
    };

    render(
      <ConfigPanel
        connectedInputHandles={["left"]}
        node={collectNode}
        nodeType={collectType}
        onConfigChange={onConfigChange}
      />
    );

    expect(screen.getByLabelText("第 1 个输入的名称")).toHaveValue("左侧结果");
    expect(screen.getByRole("button", { name: "删除 左侧结果" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "添加输入" }));
    expect(onConfigChange).toHaveBeenCalledWith("node_collect", "sources", [
      ...collectNode.config.sources,
      { id: "input_1", label: "新输入" },
    ]);
  });

  it("shows node input and output port definitions", () => {
    const portNodeType: NodeType = {
      ...manualTriggerType,
      id: "http.request",
      name: "HTTP Request",
      category: "network",
      inputs: {
        body: {
          displayName: "JSON 请求体",
          description: "发送给接口的 JSON 数据",
          required: true,
          schema: { type: "object" },
        },
      },
      outputs: {
        success: {
          displayName: "成功响应",
          description: "接口响应数据",
          schema: { type: "object" },
        },
        error: {
          displayName: "错误响应",
          description: "请求失败信息",
          schema: { type: "string" },
        },
      },
    };

    render(<ConfigPanel node={createNode("http.request")} nodeType={portNodeType} onConfigChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("tab", { name: "端口" }));

    expect(screen.getByText("输入端口")).toBeInTheDocument();
    expect(screen.getByText("输出端口")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "JSON 请求体" })).toBeInTheDocument();
    expect(screen.getByText("技术名：body")).toBeInTheDocument();
    expect(screen.getByText("必填")).toBeInTheDocument();
    expect(screen.getByText("发送给接口的 JSON 数据")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "成功响应" })).toBeInTheDocument();
    expect(screen.getByText("技术名：success")).toBeInTheDocument();
    expect(screen.getByText("接口响应数据")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "错误响应" })).toBeInTheDocument();
    expect(screen.getByText("技术名：error")).toBeInTheDocument();
    expect(screen.getByText("请求失败信息")).toBeInTheDocument();
    expect(screen.getAllByText("object").length).toBeGreaterThan(0);
    expect(screen.getByText("string")).toBeInTheDocument();
  });

  it("shows input port connection capacity in port definitions", () => {
    const portNodeType: NodeType = {
      ...manualTriggerType,
      id: "merge.inputs",
      name: "Merge Inputs",
      category: "transform",
      inputs: {
        payload: {
          description: "默认单连接输入",
          schema: { type: "object" },
        },
        rows: {
          description: "可合并多路行数据",
          maxConnections: null,
          schema: { type: "array", items: { type: "object" } },
        },
        candidates: {
          description: "候选数据",
          maxConnections: 3,
          schema: { type: "array", items: { type: "object" } },
        },
      },
      outputs: {},
    };

    render(<ConfigPanel node={createNode("merge.inputs")} nodeType={portNodeType} onConfigChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("tab", { name: "端口" }));

    expect(screen.getByText("连接：单连接")).toBeInTheDocument();
    expect(screen.getByText("连接：不限连接")).toBeInTheDocument();
    expect(screen.getByText("连接：最多 3 条连接")).toBeInTheDocument();
  });

  it("shows readable schema fields and required fields in port definitions", () => {
    const portNodeType: NodeType = {
      ...manualTriggerType,
      id: "http.request",
      name: "HTTP Request",
      category: "network",
      inputs: {},
      outputs: {
        success: {
          description: "响应数据",
          schema: {
            type: "object",
            properties: {
              status_code: { type: "integer", minimum: 100, maximum: 599 },
              headers: { type: "object", additionalProperties: { type: "string" } },
              body: { description: "Any JSON-compatible value." },
            },
            required: ["status_code", "headers", "body"],
          },
        },
        rows: {
          description: "CSV 行数据",
          schema: { type: "array", items: { type: "object" } },
        },
      },
    };

    render(<ConfigPanel node={createNode("http.request")} nodeType={portNodeType} onConfigChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("tab", { name: "端口" }));

    expect(screen.getByText("字段：status_code, headers, body")).toBeInTheDocument();
    expect(screen.getByText("必填：status_code, headers, body")).toBeInTheDocument();
    expect(screen.getByText("array<object>")).toBeInTheDocument();
  });

  it.each(guidanceNodeTypes)("shows Chinese guidance for %s nodes", (nodeTypeId, guidance) => {
    render(<ConfigPanel node={createNode(nodeTypeId)} nodeType={createNodeType(nodeTypeId)} onConfigChange={vi.fn()} />);

    expect(screen.getByText(guidance)).toBeInTheDocument();
  });

  it("does not show specific testing guidance for unknown nodes", () => {
    render(<ConfigPanel node={createNode("custom.unknown")} nodeType={createNodeType("custom.unknown")} onConfigChange={vi.fn()} />);

    for (const [, guidance] of guidanceNodeTypes) {
      expect(screen.queryByText(guidance)).not.toBeInTheDocument();
    }
  });

  it.each(["control.each_item", "control.foreach", "control.while"])("opens the body subflow for %s nodes", (nodeTypeId) => {
    const onOpenSubflow = vi.fn();
    render(
      <ConfigPanel
        node={{ ...forEachNode, type: nodeTypeId }}
        nodeType={{ ...forEachType, id: nodeTypeId }}
        onConfigChange={vi.fn()}
        onOpenSubflow={onOpenSubflow}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "编辑循环体" }));

    expect(onOpenSubflow).toHaveBeenCalledWith("node_loop", "body");
  });

  it("shows runtime details for the selected node", () => {
    render(
      <ConfigPanel
        node={manualTriggerNode}
        nodeType={manualTriggerType}
        runtimeNavigationScope={["each", "iteration:0"]}
        runtimeNavigationSource="run_event"
        runtimeState={{
          nodeId: "node_manual",
          status: "succeeded",
          inputs: { input: { name: "Alice" } },
          outputs: { success: { ok: true } },
          durationMs: 12.25,
          logs: [{ level: "info", message: "done", fields: { case: "smoke" } }],
          scopes: [[]],
          events: [
            {
              type: "node_started",
              timestamp: "2026-06-22T10:00:00Z",
              scope: [],
              inputs: { input: { name: "Alice" } },
            },
            {
              type: "node_succeeded",
              timestamp: "2026-06-22T10:00:01Z",
              scope: [],
              outputs: { success: { ok: true } },
              durationMs: 12.25,
            },
          ],
        }}
        onConfigChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("tab", { name: "运行详情" }));

    expect(screen.getByText("状态：成功")).toBeInTheDocument();
    expect(screen.getByText("来源：运行事件")).toBeInTheDocument();
    expect(screen.getByText("范围：each / 第 1 轮")).toBeInTheDocument();
    expect(screen.getByText("耗时：12.25 ms")).toBeInTheDocument();
    const runtimeTabs = screen.getByRole("tablist", { name: "运行详情分区" });
    expect(within(runtimeTabs).getByRole("tab", { name: "执行数据" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText("开始执行")).not.toBeInTheDocument();
    expect(screen.queryByText(/done/)).not.toBeInTheDocument();

    fireEvent.click(within(runtimeTabs).getByRole("tab", { name: "事件" }));

    expect(screen.getByText("开始执行")).toBeInTheDocument();
    expect(screen.getByText("执行成功")).toBeInTheDocument();
    expect(screen.getAllByText("主流程").length).toBeGreaterThan(0);

    fireEvent.click(within(runtimeTabs).getByRole("tab", { name: "日志" }));

    expect(screen.getByText(/done/)).toBeInTheDocument();
    expect(screen.getByText(/smoke/)).toBeInTheDocument();
    expect(screen.queryByText("开始执行")).not.toBeInTheDocument();

    fireEvent.click(within(runtimeTabs).getByRole("tab", { name: "原始数据" }));

    expect(screen.getByText(/Alice/)).toBeInTheDocument();
  });

  it("groups runtime details into focused Chinese sections", () => {
    render(
      <ConfigPanel
        node={manualTriggerNode}
        nodeType={manualTriggerType}
        runtimeState={{
          nodeId: "node_manual",
          status: "succeeded",
          inputs: { raw: "raw-root-input" },
          outputs: { success: { raw: "raw-root-output" } },
          durationMs: 9,
          logs: [{ level: "info", message: "panel-log-entry", fields: { trace: "log-trace" } }],
          scopes: [["each", "iteration:0"]],
          events: [
            {
              type: "node_started",
              timestamp: "2026-06-22T10:00:00Z",
              scope: ["each", "iteration:0"],
              inputs: { row: 1 },
            },
          ],
          executions: [
            {
              runIndex: 0,
              status: "succeeded",
              scope: ["each", "iteration:0"],
              inputs: { row: "selected-row" },
              outputs: {
                success: {
                  name: "success",
                  value: { ok: true },
                  items: [{ json: { ok: true } }],
                },
              },
              durationMs: 9,
              events: [],
            },
          ],
        }}
        onConfigChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("tab", { name: "运行详情" }));

    const runtimeTabs = screen.getByRole("tablist", { name: "运行详情分区" });
    expect(within(runtimeTabs).getByRole("tab", { name: "执行数据" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("执行记录")).toBeInTheDocument();
    expect(screen.getByText(/selected-row/)).toBeInTheDocument();
    expect(screen.queryByText("panel-log-entry")).not.toBeInTheDocument();
    expect(screen.queryByText("开始执行")).not.toBeInTheDocument();
    expect(screen.queryByText(/raw-root-input/)).not.toBeInTheDocument();

    fireEvent.click(within(runtimeTabs).getByRole("tab", { name: "日志" }));

    expect(within(runtimeTabs).getByRole("tab", { name: "日志" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("panel-log-entry")).toBeInTheDocument();
    expect(screen.queryByText("执行记录")).not.toBeInTheDocument();

    fireEvent.click(within(runtimeTabs).getByRole("tab", { name: "事件" }));

    expect(screen.getByText("开始执行")).toBeInTheDocument();
    expect(screen.queryByText("panel-log-entry")).not.toBeInTheDocument();

    fireEvent.click(within(runtimeTabs).getByRole("tab", { name: "原始数据" }));

    expect(screen.getByText(/raw-root-input/)).toBeInTheDocument();
    expect(screen.getByText(/raw-root-output/)).toBeInTheDocument();
    expect(screen.getByText("范围")).toBeInTheDocument();
    expect(screen.queryByText("开始执行")).not.toBeInTheDocument();
  });

  it("shows unified node run detail counters in runtime details", () => {
    render(
      <ConfigPanel
        node={manualTriggerNode}
        nodeType={manualTriggerType}
        runDetail={{
          nodeId: "node_manual",
          hasData: true,
          status: "succeeded",
          executionCount: 2,
          latestRunIndex: 1,
          latestScope: ["each", "iteration:1"],
          latestDurationMs: 6,
          inputItemCount: 3,
          outputItemCount: 4,
          latestInputItemCount: 1,
          latestOutputItemCount: 2,
          eventCount: 5,
          latestEventCount: 2,
          errorCount: 0,
        }}
        runtimeState={{
          nodeId: "node_manual",
          status: "succeeded",
          durationMs: 6,
          outputs: { success: [{ ok: false }, { ok: true }] },
          scopes: [["each", "iteration:1"]],
        }}
        onConfigChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("tab", { name: "运行详情" }));

    expect(screen.getByText("执行：2 次")).toBeInTheDocument();
    expect(screen.getByText("事件：5 条")).toBeInTheDocument();
    expect(screen.getByText("输入：3 项")).toBeInTheDocument();
    expect(screen.getByText("输出：4 项")).toBeInTheDocument();
  });

  it("shows per-execution output ports for nodes that run multiple times", () => {
    render(
      <ConfigPanel
        node={manualTriggerNode}
        nodeType={manualTriggerType}
        runtimeState={{
          nodeId: "node_manual",
          status: "succeeded",
          outputs: { success: { ok: false } },
          scopes: [
            ["each", "iteration:0"],
            ["each", "iteration:1"],
          ],
          executions: [
            {
              runIndex: 0,
              status: "succeeded",
              scope: ["each", "iteration:0"],
              inputs: { row: 1 },
              outputs: {
                success: {
                  name: "success",
                  value: { ok: true },
                  items: [{ json: { ok: true } }],
                },
              },
              durationMs: 4,
              events: [],
            },
            {
              runIndex: 1,
              status: "succeeded",
              scope: ["each", "iteration:1"],
              inputs: { row: 2 },
              outputs: {
                success: {
                  name: "success",
                  value: [{ ok: false }, { ok: true }],
                  items: [{ json: { ok: false } }, { json: { ok: true } }],
                },
              },
              durationMs: 6,
              events: [],
            },
          ],
        }}
        onConfigChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("tab", { name: "运行详情" }));

    expect(screen.getByText("执行记录")).toBeInTheDocument();
    const batchGroup = screen.getByRole("group", { name: "执行批次" });
    expect(within(batchGroup).getByRole("button", { name: "第 1 次" })).toBeInTheDocument();
    expect(within(batchGroup).getByRole("button", { name: "第 2 次" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("article", { name: "第 1 次执行" })).not.toBeInTheDocument();
    expect(screen.getByRole("article", { name: "第 2 次执行" })).toBeInTheDocument();
    expect(screen.queryByText("第 1 轮")).not.toBeInTheDocument();
    expect(screen.getByText("第 2 轮")).toBeInTheDocument();
    expect(screen.getAllByText("success")).toHaveLength(1);
    expect(screen.getByText("2 项")).toBeInTheDocument();

    fireEvent.click(within(batchGroup).getByRole("button", { name: "第 1 次" }));

    expect(screen.getByRole("article", { name: "第 1 次执行" })).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: "第 2 次执行" })).not.toBeInTheDocument();
    expect(screen.getByText("第 1 轮")).toBeInTheDocument();
    expect(screen.queryByText("第 2 轮")).not.toBeInTheDocument();
    expect(screen.getAllByText("success")).toHaveLength(1);
    expect(screen.getAllByText("1 项").length).toBeGreaterThan(0);
  });

  it("selects a specific execution batch in runtime details", () => {
    render(
      <ConfigPanel
        node={manualTriggerNode}
        nodeType={manualTriggerType}
        runtimeState={{
          nodeId: "node_manual",
          status: "succeeded",
          outputs: { success: { ok: false } },
          scopes: [
            ["each", "iteration:0"],
            ["each", "iteration:1"],
          ],
          executions: [
            {
              runIndex: 0,
              status: "succeeded",
              scope: ["each", "iteration:0"],
              inputs: { row: 1 },
              outputs: {
                success: {
                  name: "success",
                  value: { row: 1 },
                  items: [{ json: { row: 1 } }],
                },
              },
              durationMs: 4,
              events: [],
            },
            {
              runIndex: 1,
              status: "succeeded",
              scope: ["each", "iteration:1"],
              inputs: { row: 2 },
              outputs: {
                success: {
                  name: "success",
                  value: { row: 2 },
                  items: [{ json: { row: 2 } }],
                },
              },
              durationMs: 6,
              events: [],
            },
          ],
        }}
        onConfigChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("tab", { name: "运行详情" }));

    const batchGroup = screen.getByRole("group", { name: "执行批次" });
    expect(screen.getByText("当前查看：第 2 次执行")).toBeInTheDocument();
    expect(within(batchGroup).getByRole("button", { name: "第 2 次" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByText(/"row":2/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/"row":1/)).not.toBeInTheDocument();

    fireEvent.click(within(batchGroup).getByRole("button", { name: "第 1 次" }));

    expect(screen.getByText("当前查看：第 1 次执行")).toBeInTheDocument();
    expect(within(batchGroup).getByRole("button", { name: "第 1 次" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByText(/"row":1/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/"row":2/)).not.toBeInTheDocument();
  });
  it("shows item details for execution inputs in runtime details", () => {
    render(
      <ConfigPanel
        node={manualTriggerNode}
        nodeType={manualTriggerType}
        runtimeState={{
          nodeId: "node_manual",
          status: "succeeded",
          outputs: { success: { ok: true } },
          scopes: [[]],
          executions: [
            {
              runIndex: 0,
              status: "succeeded",
              scope: [],
              inputs: { raw: "summary only" },
              inputItems: [
                { json: { row: 1, name: "Alice" } },
                { json: { row: 2, name: "Bob" }, pairedItem: { item: 4 } },
              ],
              outputs: {
                success: {
                  name: "success",
                  value: { ok: true },
                  items: [{ json: { ok: true } }],
                },
              },
              durationMs: 5,
              events: [],
            },
          ],
        }}
        onConfigChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("tab", { name: "运行详情" }));
    fireEvent.click(screen.getByRole("button", { name: "查看输入的 2 项明细" }));

    const inputDetails = screen.getByRole("list", { name: "输入 item 明细" });
    expect(inputDetails).toBeInTheDocument();
    expect(within(inputDetails).getByText("第 1 项")).toBeInTheDocument();
    expect(within(inputDetails).getByText("第 2 项")).toBeInTheDocument();
    expect(within(inputDetails).getByText(/Alice/)).toBeInTheDocument();
    expect(within(inputDetails).getByText(/Bob/)).toBeInTheDocument();
    expect(within(inputDetails).getByText("元数据")).toBeInTheDocument();
    expect(within(inputDetails).getByText(/pairedItem/)).toBeInTheDocument();
  });
  it("shows item details for an output port in runtime details", () => {
    render(
      <ConfigPanel
        node={manualTriggerNode}
        nodeType={manualTriggerType}
        runtimeState={{
          nodeId: "node_manual",
          status: "succeeded",
          outputs: { success: [{ name: "Alice" }, { name: "Bob" }] },
          scopes: [[]],
          executions: [
            {
              runIndex: 0,
              status: "succeeded",
              scope: [],
              inputs: { source: "csv" },
              outputs: {
                success: {
                  name: "success",
                  value: [{ name: "Alice", status: 200 }, { name: "Bob", status: 500 }],
                  items: [
                    { json: { name: "Alice", status: 200 } },
                    { json: { name: "Bob", status: 500 }, pairedItem: { item: 1 } },
                  ],
                },
              },
              durationMs: 8,
              events: [],
            },
          ],
        }}
        onConfigChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("tab", { name: "运行详情" }));
    fireEvent.click(screen.getByRole("button", { name: "查看 success 的 2 项明细" }));

    const itemDetails = screen.getByRole("list", { name: "success item 明细" });
    expect(itemDetails).toBeInTheDocument();
    expect(within(itemDetails).getByText("第 1 项")).toBeInTheDocument();
    expect(within(itemDetails).getByText("第 2 项")).toBeInTheDocument();
    expect(within(itemDetails).getByText(/Alice/)).toBeInTheDocument();
    expect(within(itemDetails).getByText(/Bob/)).toBeInTheDocument();
    expect(within(itemDetails).getByText("元数据")).toBeInTheDocument();
    expect(within(itemDetails).getByText(/pairedItem/)).toBeInTheDocument();
  });
  it("filters runtime item details and logs by search text", () => {
    render(
      <ConfigPanel
        node={manualTriggerNode}
        nodeType={manualTriggerType}
        runtimeState={{
          nodeId: "node_manual",
          status: "succeeded",
          outputs: { success: [{ name: "Alice" }, { name: "Bob" }] },
          logs: [
            { level: "info", message: "request-ok" },
            { level: "error", message: "Bob status failed", fields: { status: 500 } },
          ],
          scopes: [[]],
          executions: [
            {
              runIndex: 0,
              status: "succeeded",
              scope: [],
              inputs: { source: "csv" },
              outputs: {
                success: {
                  name: "success",
                  value: [{ name: "Alice", status: 200 }, { name: "Bob", status: 500 }],
                  items: [
                    { json: { name: "Alice", status: 200 } },
                    { json: { name: "Bob", status: 500 } },
                  ],
                },
              },
              durationMs: 8,
              events: [],
            },
          ],
        }}
        onConfigChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("tab", { name: "运行详情" }));
    fireEvent.change(screen.getByLabelText("搜索运行数据"), { target: { value: "Bob" } });
    fireEvent.click(screen.getByRole("button", { name: "查看 success 的 2 项明细" }));

    expect(screen.getByText("找到 2 项匹配")).toBeInTheDocument();
    const itemDetails = screen.getByRole("list", { name: "success item 明细" });
    expect(within(itemDetails).queryByText(/Alice/)).not.toBeInTheDocument();
    expect(within(itemDetails).getByText(/Bob/)).toBeInTheDocument();
    expect(screen.queryByText("request-ok")).not.toBeInTheDocument();

    const runtimeTabs = screen.getByRole("tablist", { name: "运行详情分区" });
    fireEvent.click(within(runtimeTabs).getByRole("tab", { name: "日志" }));

    expect(screen.getByText("Bob status failed")).toBeInTheDocument();
    expect(screen.queryByText("request-ok")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("搜索运行数据"), { target: { value: "NoSuchValue" } });

    expect(screen.getByText("没有匹配的运行数据")).toBeInTheDocument();
  });
  it("summarizes CSV headers, row count, and columns in runtime details", () => {
    render(
      <ConfigPanel
        node={createNode("data.csv_read")}
        nodeType={createNodeType("data.csv_read")}
        runtimeState={{
          nodeId: "node_data_csv_read",
          status: "succeeded",
          outputs: {
            success: {
              headers: ["name", "age"],
              rows: [
                { name: "Alice", age: "30" },
                { name: "Bob", age: "31" },
              ],
              columns: {
                name: ["Alice", "Bob"],
                age: ["30", "31"],
              },
            },
          },
          scopes: [[]],
        }}
        onConfigChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("tab", { name: "运行详情" }));

    expect(screen.getByText("表头：name, age")).toBeInTheDocument();
    expect(screen.getByText("行数：2")).toBeInTheDocument();
    expect(screen.getByText("列：name, age")).toBeInTheDocument();
  });

  it.each([
    [{ done: { iterations: [{ index: 0, item: { name: "Alice" } }, { index: 1, item: { name: "Bob" } }] } }, 2, "done.iterations"],
    [{ success: { iteration_count: 3 } }, 3, "success.iteration_count fallback"],
  ])("summarizes ForEach iteration count from %s", (outputs, expectedCount) => {
    render(
      <ConfigPanel
        node={forEachNode}
        nodeType={forEachType}
        runtimeState={{
          nodeId: "node_loop",
          status: "succeeded",
          outputs,
          scopes: [[]],
        }}
        onConfigChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("tab", { name: "运行详情" }));

    expect(screen.getByText(`迭代次数：${expectedCount}`)).toBeInTheDocument();
  });

  it("does not show a runtime insight card when summary data is missing", () => {
    const { container } = render(
      <ConfigPanel
        node={createNode("data.csv_read")}
        nodeType={createNodeType("data.csv_read")}
        runtimeState={{
          nodeId: "node_data_csv_read",
          status: "succeeded",
          outputs: { success: { ok: true } },
          scopes: [[]],
        }}
        onConfigChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("tab", { name: "运行详情" }));

    expect(container.querySelector(".runtime-insight")).toBeNull();
    expect(screen.queryByText(/^表头：/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^行数：/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^列：/)).not.toBeInTheDocument();
  });

  it("pins the latest node output for manual debugging and can clear it", () => {
    const onPinnedDataChange = vi.fn();
    const node = { ...manualTriggerNode, type: "utility.transform" };
    const { rerender } = render(
      <ConfigPanel
        node={node}
        nodeType={createNodeType("utility.transform")}
        runtimeState={{
          nodeId: node.id,
          status: "succeeded",
          outputs: { success: { source: "recorded" } },
          scopes: [[]],
        }}
        onConfigChange={vi.fn()}
        onPinnedDataChange={onPinnedDataChange}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "固定最近一次输出" }));

    expect(onPinnedDataChange).toHaveBeenCalledWith(node.id, { success: { source: "recorded" } });

    rerender(
      <ConfigPanel
        node={{ ...node, pinnedData: { success: { source: "recorded" } } }}
        nodeType={createNodeType("utility.transform")}
        onConfigChange={vi.fn()}
        onPinnedDataChange={onPinnedDataChange}
      />
    );

    expect(screen.getByText("此节点会在手动运行中复用固定输出。Webhook 和子工作流不会使用它。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清除固定输出" }));
    expect(onPinnedDataChange).toHaveBeenLastCalledWith(node.id, undefined);
  });

  it("starts a manual run from the selected root-workflow node", () => {
    const onRunFromNode = vi.fn();
    render(
      <ConfigPanel
        node={manualTriggerNode}
        nodeType={manualTriggerType}
        onConfigChange={vi.fn()}
        onRunFromNode={onRunFromNode}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "从此节点开始运行" }));

    expect(onRunFromNode).toHaveBeenCalledWith("node_manual");
  });

  it("explains why a node with required input cannot start independently", () => {
    render(
      <ConfigPanel
        node={manualTriggerNode}
        nodeType={manualTriggerType}
        onConfigChange={vi.fn()}
        onRunFromNode={vi.fn()}
        runFromNodeUnavailableReason="此节点需要“响应”输入；请使用完整运行。"
      />
    );

    expect(screen.getByRole("button", { name: "从此节点开始运行" })).toBeDisabled();
    expect(screen.getByText("此节点需要“响应”输入；请使用完整运行。")).toBeInTheDocument();
  });

  it("creates and saves editable pinned output without a previous run", () => {
    const onPinnedDataChange = vi.fn();
    const nodeType: NodeType = {
      ...createNodeType("utility.transform"),
      outputs: { success: { description: "转换结果" }, error: { description: "错误信息" } },
    };
    const node = createNode("utility.transform");
    render(
      <ConfigPanel
        node={node}
        nodeType={nodeType}
        onConfigChange={vi.fn()}
        onPinnedDataChange={onPinnedDataChange}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "新建固定输出" }));
    const editor = screen.getByLabelText("固定输出 JSON");
    expect(editor).toHaveValue('{\n  "success": {}\n}');
    fireEvent.change(editor, { target: { value: '{"success":{"fixture":"ready"}}' } });
    fireEvent.click(screen.getByRole("button", { name: "保存固定输出" }));

    expect(onPinnedDataChange).toHaveBeenCalledWith(node.id, { success: { fixture: "ready" } });
  });

  it("keeps invalid pinned output drafts out of the workflow document", () => {
    const onPinnedDataChange = vi.fn();
    const nodeType: NodeType = {
      ...createNodeType("utility.transform"),
      outputs: { success: { description: "转换结果" } },
    };
    render(
      <ConfigPanel
        node={createNode("utility.transform")}
        nodeType={nodeType}
        onConfigChange={vi.fn()}
        onPinnedDataChange={onPinnedDataChange}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "新建固定输出" }));
    fireEvent.change(screen.getByLabelText("固定输出 JSON"), { target: { value: '{"missing":true}' } });

    expect(screen.getByText("输出端口“missing”不存在。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存固定输出" })).toBeDisabled();
    expect(onPinnedDataChange).not.toHaveBeenCalled();
  });

  it("selects a compatible local credential for an HTTP node", () => {
    const onConfigChange = vi.fn();
    const node: WorkflowNode = {
      ...httpNode,
      config: { ...httpNode.config, credential_id: "cred_bearer" },
    };
    const nodeType: NodeType = {
      ...httpNodeType,
      configSchema: {
        ...httpNodeType.configSchema,
        properties: {
          ...httpNodeType.configSchema.properties,
          credential_id: { title: "Credential", type: "string", default: null },
        },
      },
    };
    render(
      <ConfigPanel
        credentialTypes={httpCredentialTypes}
        credentials={httpCredentials}
        node={node}
        nodeType={nodeType}
        onConfigChange={onConfigChange}
      />
    );

    const selector = screen.getByLabelText("认证凭据");
    expect(selector).toHaveValue("cred_bearer");
    expect(screen.getByRole("option", { name: "HTTP Bearer 令牌：测试接口令牌" })).toBeInTheDocument();
    fireEvent.change(selector, { target: { value: "" } });

    expect(onConfigChange).toHaveBeenCalledWith(node.id, "credential_id", undefined);
  });

  it("renders a package-defined credential field with its own label", () => {
    const onConfigChange = vi.fn();
    const node: WorkflowNode = {
      ...manualTriggerNode,
      id: "node_package_credential",
      type: "example.request",
      config: { auth_credential_id: "cred_example" },
    };
    const nodeType: NodeType = {
      ...manualTriggerType,
      id: "example.request",
      configSchema: {
        type: "object",
        properties: { auth_credential_id: { title: "认证", type: "string" } },
      },
      form: {
        groups: [
          {
            id: "auth",
            label: "认证",
            fields: [
              {
                key: "auth_credential_id",
                control: "credential",
                label: "服务认证",
                credentialTypeIds: ["example.api_key"],
              },
            ],
          },
        ],
      },
    };
    render(
      <ConfigPanel
        credentialTypes={[
          {
            id: "example.api_key",
            display_name: "示例 API 密钥",
            fields: [{ id: "api_key", label: "API 密钥", secret: true }],
            node_type_ids: ["example.request"],
          },
        ]}
        credentials={[
          {
            id: "cred_example",
            type_id: "example.api_key",
            name: "测试环境",
            created_at: "2026-07-20T00:00:00Z",
            updated_at: "2026-07-20T00:00:00Z",
          },
        ]}
        node={node}
        nodeType={nodeType}
        onConfigChange={onConfigChange}
      />
    );

    const selector = screen.getByLabelText("服务认证");
    expect(selector).toHaveValue("cred_example");
    fireEvent.change(selector, { target: { value: "" } });

    expect(onConfigChange).toHaveBeenCalledWith(node.id, "auth_credential_id", undefined);
  });
});
