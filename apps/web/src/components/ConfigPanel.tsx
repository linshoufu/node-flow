import { useEffect, useRef, useState } from "react";
import { MousePointerClick } from "lucide-react";
import { translateCategory } from "../lib/display";
import type { NodeRunDetail } from "../lib/nodeRunDetail";
import { nodeRuntimeSourceLabel, type NodeRuntimeNavigationSource } from "../lib/nodeRuntimeNavigation";
import type { ExpressionReference, ExpressionReferenceGroup } from "../lib/expressionReferences";
import { effectiveSchema, schemaFieldTypes } from "../lib/jsonSchema";
import { workflowNodeDisplayName } from "../lib/nodeDisplayNames";
import { API_BASE_URL } from "../api/client";
import { validateSchemaField } from "../lib/schemaFieldValidation";
import { inputCapacityLabel, portDataModeLabel, portDisplayName, schemaSummary } from "../lib/schemaDisplay";
import { nodeExecutionPolicy } from "../lib/executionPolicy";
import { resolveNodeInputPorts, resolveNodeOutputPorts } from "../lib/nodePorts";
import { createPinnedDataDraft, parsePinnedDataDraft } from "../lib/pinnedData";
import type { NodeRuntimeState } from "../lib/runState";
import { NodeConfigForm } from "./NodeConfigForm";
import { DynamicOutputListEditor } from "./DynamicOutputListEditor";
import { DynamicInputListEditor } from "./DynamicInputListEditor";
import { NodeRuntimePanel } from "./NodeRuntimePanel";
import type {
  JsonSchema,
  CredentialSummary,
  CredentialType,
  NodeExecutionPolicy,
  NodeFormField,
  NodePort,
  NodeType,
  WorkflowNode,
  WorkflowSummary,
  WebhookTestListener,
} from "../types";

type ConfigPanelTab = "config" | "ports" | "runtime";

type ConfigPanelProps = {
  disabled?: boolean;
  node?: WorkflowNode;
  nodeType?: NodeType;
  connectedOutputHandles?: string[];
  connectedInputHandles?: string[];
  expressionReferences?: ExpressionReference[];
  runtimeState?: NodeRuntimeState;
  runDetail?: NodeRunDetail;
  runtimeNavigationScope?: string[] | null;
  runtimeNavigationSource?: NodeRuntimeNavigationSource | null;
  initialTab?: ConfigPanelTab;
  tabRequestKey?: number;
  fieldFocusRequest?: { field: string; key: number };
  workflowOptions?: WorkflowSummary[];
  credentialTypes?: CredentialType[];
  credentials?: CredentialSummary[];
  onOpenCredentialManager?: () => void;
  currentWorkflowId?: string;
  webhookTestListener?: WebhookTestListener | null;
  webhookTestListenerChanging?: boolean;
  onStartWebhookTestListener?: (nodeId: string) => void;
  onStopWebhookTestListener?: (nodeId: string) => void;
  onConfigChange: (nodeId: string, key: string, value: unknown) => void;
  onLabelChange?: (nodeId: string, label: string) => void;
  onNotesChange?: (nodeId: string, notes: string) => void;
  onDisabledChange?: (nodeId: string, disabled: boolean) => void;
  onPinnedDataChange?: (nodeId: string, pinnedData: Record<string, unknown> | undefined) => void;
  onExecutionPolicyChange?: (nodeId: string, policy: NodeExecutionPolicy) => void;
  onConfigRemove?: (nodeId: string, key: string) => void;
  onOpenSubflow?: (nodeId: string, subflowName: string) => void;
  onRunFromNode?: (nodeId: string) => void;
  runFromNodeUnavailableReason?: string;
};
const LOOP_NODE_TYPES = new Set(["control.each_item", "control.foreach", "control.while"]);

const CONFIG_GUIDANCE_BY_NODE_TYPE: Record<string, string> = {
  "http.request": "填写请求方法和 URL。",
  "data.csv_read": "填写 CSV 文件路径，确认分隔符和表头设置。运行后可在运行详情查看表头和行数。",
  "data.map_items": "填写 JSON 对象，为每个数据项构造新的字段。对象内可用 {{ item.字段名 }} 读取当前项。",
  "data.filter_items": "填写要比较的数据项值、比较方式和期望值。例如用 {{ item.enabled }} 筛选已启用的数据。",
  "data.merge_items": "连接两条或更多数据项流，节点会按上游到达顺序追加它们。",
  "logic.switch": "按顺序检查每条规则；第一条命中的分支会继续执行，未命中时走“未匹配”端口。",
  "control.each_item": "连接数据项输入后，循环体内可以用 {{ loop.item }} 读取当前项。",
  "control.foreach": "填写循环数据来源。循环体内可以用 {{ loop.item.column_name }} 引用当前 CSV 行字段。",
  "assert.status_code": "填写期望状态码。",
  "test.write_report": "填写测试报告输出路径。",
};

export function ConfigPanel({
  disabled = false,
  node,
  nodeType,
  connectedOutputHandles = [],
  connectedInputHandles = [],
  expressionReferences = [],
  runtimeState,
  runDetail,
  runtimeNavigationScope = null,
  runtimeNavigationSource = null,
  initialTab = "config",
  tabRequestKey = 0,
  fieldFocusRequest,
  workflowOptions = [],
  credentialTypes = [],
  credentials = [],
  onOpenCredentialManager,
  currentWorkflowId,
  webhookTestListener = null,
  webhookTestListenerChanging = false,
  onStartWebhookTestListener,
  onStopWebhookTestListener,
  onConfigChange,
  onLabelChange,
  onNotesChange,
  onDisabledChange,
  onPinnedDataChange,
  onExecutionPolicyChange,
  onConfigRemove,
  onOpenSubflow,
  onRunFromNode,
  runFromNodeUnavailableReason,
}: ConfigPanelProps) {
  const [activeTab, setActiveTab] = useState<ConfigPanelTab>("config");
  const [focusedConfigKey, setFocusedConfigKey] = useState<string | null>(null);
  const [expressionInsertionAllowed, setExpressionInsertionAllowed] = useState(true);
  const panelRef = useRef<HTMLElement | null>(null);
  const properties = nodeType?.configSchema.properties ?? {};
  const entries = Object.entries(properties);
  const requiredConfigFields = new Set(nodeType?.configSchema.required ?? []);
  const canOpenBody = Boolean(node && nodeType && LOOP_NODE_TYPES.has(nodeType.id) && onOpenSubflow);
  const configGuidance = nodeType ? CONFIG_GUIDANCE_BY_NODE_TYPE[nodeType.id] : undefined;
  const staleConfigKeys = node && nodeType ? staleConfigKeysForNode(node, nodeType) : [];
  const hasRuntimeDetails = Boolean(runtimeState);
  const runtimeSourceLabel = runtimeNavigationSource ? nodeRuntimeSourceLabel(runtimeNavigationSource) : undefined;
  const selectedNodeName = node && nodeType ? workflowNodeDisplayName(node, nodeType) : null;
  const webhookUrls = nodeType?.id === "webhook.trigger" ? webhookUrlsFor(node?.config.path, currentWorkflowId) : null;
  const isWebhookTestListenerActive = Boolean(
    webhookTestListener?.active && webhookTestListener.workflow_id === currentWorkflowId && webhookTestListener.node_id === node?.id
  );

  useEffect(() => {
    setActiveTab(initialVisibleTab(initialTab, hasRuntimeDetails));
    setFocusedConfigKey(null);
    setExpressionInsertionAllowed(true);
  }, [hasRuntimeDetails, initialTab, node?.id, tabRequestKey]);

  useEffect(() => {
    if (!node || !fieldFocusRequest?.field) {
      return;
    }

    setActiveTab("config");
    setFocusedConfigKey(fieldFocusRequest.field);
  }, [fieldFocusRequest?.field, fieldFocusRequest?.key, node]);

  useEffect(() => {
    if (activeTab !== "config" || !fieldFocusRequest?.field) {
      return;
    }

    const target = Array.from(panelRef.current?.querySelectorAll<HTMLElement>("[data-config-field]") ?? []).find(
      (element) => element.dataset.configField === fieldFocusRequest.field
    );
    target?.focus();
  }, [activeTab, fieldFocusRequest?.field, fieldFocusRequest?.key]);

  function insertExpression(expression: string) {
    if (disabled || !expressionInsertionAllowed || !node || !focusedConfigKey) {
      return;
    }

    onConfigChange(node.id, focusedConfigKey, expression);
  }

  function focusConfigField(key: string, formField?: NodeFormField) {
    setFocusedConfigKey(key);
    setExpressionInsertionAllowed(formField?.expression !== "disabled" && formField?.control !== "password");
  }

  return (
    <aside
      className="panel config-panel"
      data-empty={!node || !nodeType ? "true" : undefined}
      aria-label="配置面板"
      ref={panelRef}
    >
      <div className="panel-heading">
        <div>
          <h2>配置</h2>
          <p>编辑所选节点参数</p>
        </div>
        {nodeType ? <span>{nodeType.category}</span> : null}
      </div>

      {!node || !nodeType ? (
        <div className="config-empty-state">
          <span aria-hidden="true" className="config-empty-icon">
            <MousePointerClick size={22} strokeWidth={2} />
          </span>
          <h3>还没有选中节点</h3>
          <p className="empty-state">选择一个节点后，在这里编辑它的参数。</p>
          <p className="config-empty-hint">提示：从左侧节点库拖拽节点到画布，或点击画布中的节点开始配置。</p>
        </div>
      ) : (
        <div className="config-content">
          <div className="selected-node">
            <strong>{selectedNodeName}</strong>
            <div className="selected-node-meta">
              <small>{translateCategory(nodeType.category)}</small>
              {nodeType.version ? <span className="node-version">v{nodeType.version}</span> : null}
              {nodeType.documentationUrl ? (
                <a className="node-doc-link" href={nodeType.documentationUrl} rel="noreferrer" target="_blank">
                  打开文档
                </a>
              ) : null}
            </div>
            {nodeType.description ? <p>{nodeType.description}</p> : null}
            {nodeType.tags && nodeType.tags.length > 0 ? (
              <div className="selected-node-tags" aria-label="节点标签">
                {nodeType.tags.map((tag) => (
                  <em key={tag}>{tag}</em>
                ))}
              </div>
            ) : null}
          </div>

          <label className="field node-label-field">
            <span className="field-label">节点名称</span>
            <input
              aria-label="节点名称"
              disabled={disabled || !onLabelChange}
              maxLength={120}
              placeholder="留空时显示节点类型"
              value={node.label ?? ""}
              onChange={(event) => onLabelChange?.(node.id, event.currentTarget.value)}
            />
            <small>用于画布、运行日志和表达式引用的显示名称。</small>
          </label>

          <label className="field node-notes-field">
            <span className="field-label">节点备注</span>
            <textarea
              aria-label="节点备注"
              disabled={disabled || !onNotesChange}
              maxLength={2000}
              placeholder="记录处理约束、背景或交接信息"
              value={node.notes ?? ""}
              onChange={(event) => onNotesChange?.(node.id, event.currentTarget.value)}
            />
          </label>

          {onRunFromNode ? (
            <button
              className="node-run-action"
              disabled={disabled || Boolean(runFromNodeUnavailableReason)}
              title={runFromNodeUnavailableReason ?? "仅执行此节点及其下游节点"}
              type="button"
              onClick={() => onRunFromNode(node.id)}
            >
              从此节点开始运行
            </button>
          ) : null}
          {runFromNodeUnavailableReason ? (
            <p className="node-run-unavailable" role="status">
              {runFromNodeUnavailableReason}
            </p>
          ) : null}

          <div className="config-tabs" role="tablist" aria-label="节点面板">
            <button
              aria-selected={activeTab === "config"}
              role="tab"
              type="button"
              onClick={() => setActiveTab("config")}
            >
              配置
            </button>
            <button
              aria-selected={activeTab === "ports"}
              role="tab"
              type="button"
              onClick={() => setActiveTab("ports")}
            >
              端口
            </button>
            {hasRuntimeDetails ? (
              <button
                aria-selected={activeTab === "runtime"}
                role="tab"
                type="button"
                onClick={() => setActiveTab("runtime")}
              >
                运行详情
              </button>
            ) : null}
          </div>

          {activeTab === "config" && configGuidance ? <p className="config-guidance">{configGuidance}</p> : null}

          {activeTab === "config" && webhookUrls ? (
            <section className="webhook-url-preview" aria-label="Webhook 地址">
              <div>
                <strong>生产地址</strong>
                <p>启用工作流后，向此地址发送配置的方法即可启动工作流。</p>
                <p>选择验证请求头后，未携带匹配值的请求不会创建运行记录。</p>
              </div>
              <code>{webhookUrls.production}</code>
              {webhookUrls.test ? (
                <div className="webhook-test-url">
                  <strong>调试地址</strong>
                  <p>点击“开始监听”后，可用此地址调试已保存的工作流；生产触发器无需启用。</p>
                  <code>{webhookUrls.test}</code>
                  {onStartWebhookTestListener && onStopWebhookTestListener && node ? (
                    <div className="webhook-test-listener" role="status">
                      <span>
                        {isWebhookTestListenerActive
                          ? "监听中：下一条请求会启动调试运行，随后自动结束。"
                          : "未监听：调试地址不会接收请求。"}
                      </span>
                      <button
                        disabled={disabled || webhookTestListenerChanging}
                        type="button"
                        onClick={() =>
                          isWebhookTestListenerActive
                            ? onStopWebhookTestListener(node.id)
                            : onStartWebhookTestListener(node.id)
                        }
                      >
                        {isWebhookTestListenerActive ? "停止监听" : "开始监听"}
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}

          {activeTab === "runtime" && runtimeState ? (
            <NodeRuntimePanel
              nodeType={nodeType}
              nodeTypeId={nodeType.id}
              runtimeState={runtimeState}
              runDetail={runDetail}
              navigationScope={runtimeNavigationScope}
              sourceLabel={runtimeSourceLabel}
            />
          ) : activeTab === "ports" ? (
            <PortDetails node={node} nodeType={nodeType} />
          ) : entries.length === 0 ? (
            <p className="empty-state">这个节点没有可配置字段。</p>
          ) : (
            <NodeConfigForm
              node={node}
              nodeType={nodeType}
              renderField={(key, schema, formField) =>
                nodeType.id === "workflow.execute" && key === "workflow_id" ? (
                  <WorkflowSelector
                    currentWorkflowId={currentWorkflowId}
                    disabled={disabled}
                    key={key}
                    options={workflowOptions}
                    value={node.config[key]}
                    onChange={(value) => onConfigChange(node.id, key, value)}
                    onFocus={() => focusConfigField(key, formField)}
                  />
                ) : formField?.control === "credential" || (nodeType.id === "http.request" && key === "credential_id") ? (
                  <CredentialSelector
                    credentialTypes={credentialTypes}
                    credentials={credentials}
                    disabled={disabled}
                    key={key}
                    fieldName={key}
                    label={
                      key === "credential_id"
                        ? "认证凭据"
                        : formField?.label ?? (typeof schema.title === "string" ? schema.title : key)
                    }
                    nodeTypeId={nodeType.id}
                    credentialTypeIds={formField?.credentialTypeIds}
                    value={node.config[key]}
                    onChange={(value) => onConfigChange(node.id, key, value || undefined)}
                    onFocus={() => focusConfigField(key, formField)}
                    onOpenCredentialManager={onOpenCredentialManager}
                  />
                ) : formField?.control === "dynamic_output_list" && nodeType.dynamicOutputs ? (
                  <DynamicOutputListEditor
                    definition={nodeType.dynamicOutputs}
                    description={formField.description}
                    disabled={disabled}
                    connectedOutputHandles={connectedOutputHandles}
                    key={key}
                    label={formField.label ?? (typeof schema.title === "string" ? schema.title : key)}
                    value={node.config[key]}
                    onChange={(value) => onConfigChange(node.id, key, value)}
                    onFocus={() => focusConfigField(key, formField)}
                  />
                ) : formField?.control === "dynamic_input_list" && nodeType.dynamicInputs ? (
                  <DynamicInputListEditor
                    connectedInputHandles={connectedInputHandles}
                    definition={nodeType.dynamicInputs}
                    description={formField.description}
                    disabled={disabled}
                    key={key}
                    label={formField.label ?? (typeof schema.title === "string" ? schema.title : key)}
                    value={node.config[key]}
                    onChange={(value) => onConfigChange(node.id, key, value)}
                    onFocus={() => focusConfigField(key, formField)}
                  />
                ) : (
                  <SchemaField
                    key={key}
                    name={key}
                    isRequired={requiredConfigFields.has(key)}
                    schema={schema}
                    rootSchema={nodeType.configSchema}
                    value={node.config[key]}
                    disabled={disabled}
                    formField={formField}
                    onFocus={() => focusConfigField(key, formField)}
                    onChange={(value) => onConfigChange(node.id, key, value)}
                  />
                )
              }
            />
          )}

          {activeTab === "config" && node && staleConfigKeys.length > 0 ? (
            <StaleConfigKeyPanel
              disabled={disabled}
              node={node}
              keys={staleConfigKeys}
              onConfigRemove={onConfigRemove}
            />
          ) : null}

          {activeTab === "config" ? (
            <NodeDisabledToggle disabled={disabled} node={node} onChange={onDisabledChange} />
          ) : null}

          {activeTab === "config" ? (
            <FailurePolicyEditor
              disabled={disabled}
              node={node}
              nodeType={nodeType}
              onChange={onExecutionPolicyChange}
            />
          ) : null}

          {activeTab === "config" ? (
            <PinnedDataEditor
              disabled={disabled}
              node={node}
              nodeType={nodeType}
              runtimeState={runtimeState}
              onChange={onPinnedDataChange}
            />
          ) : null}

          {activeTab === "config" ? (
            <ExpressionReferencePanel
               activeFieldName={expressionInsertionAllowed ? focusedConfigKey : null}
              disabled={disabled}
              references={expressionReferences}
              onInsert={insertExpression}
            />
          ) : null}

          {activeTab === "config" && canOpenBody ? (
            <div className="subflow-actions">
              <button
                className="open-subflow-button"
                disabled={disabled}
                type="button"
                onClick={() => {
                  if (!disabled) {
                    onOpenSubflow?.(node.id, "body");
                  }
                }}
              >
                编辑循环体
              </button>
            </div>
          ) : null}
        </div>
      )}
    </aside>
  );
}

function NodeDisabledToggle({
  disabled,
  node,
  onChange,
}: {
  disabled: boolean;
  node: WorkflowNode;
  onChange?: (nodeId: string, disabled: boolean) => void;
}) {
  return (
    <fieldset className="node-disabled-toggle" disabled={disabled}>
      <legend>执行状态</legend>
      <label>
        <input
          aria-label="禁用节点"
          checked={Boolean(node.disabled)}
          type="checkbox"
          onChange={(event) => onChange?.(node.id, event.currentTarget.checked)}
        />
        禁用节点
      </label>
      <p>运行时跳过此节点，并将输入透传到主输出端口。</p>
    </fieldset>
  );
}

function CredentialSelector({
  credentialTypes,
  credentials,
  disabled,
  fieldName,
  label,
  nodeTypeId,
  credentialTypeIds,
  value,
  onChange,
  onFocus,
  onOpenCredentialManager,
}: {
  credentialTypes: CredentialType[];
  credentials: CredentialSummary[];
  disabled: boolean;
  fieldName: string;
  label: string;
  nodeTypeId: string;
  credentialTypeIds?: string[];
  value: unknown;
  onChange: (value: string) => void;
  onFocus: () => void;
  onOpenCredentialManager?: () => void;
}) {
  const compatibleTypeIds = new Set(
    credentialTypeIds?.length
      ? credentialTypeIds
      : credentialTypes
          .filter((credentialType) => credentialType.node_type_ids.includes(nodeTypeId))
          .map((credentialType) => credentialType.id)
  );
  const compatibleCredentials = credentials.filter((credential) => compatibleTypeIds.has(credential.type_id));
  const typeNameById = new Map(credentialTypes.map((credentialType) => [credentialType.id, credentialType.display_name]));
  const selectedValue =
    typeof value === "string" && compatibleCredentials.some((credential) => credential.id === value) ? value : "";

  return (
    <label className="schema-field credential-selector" data-config-field={fieldName}>
      <span>{label}</span>
      <select
        aria-label={label}
        disabled={disabled}
        value={selectedValue}
        onChange={(event) => onChange(event.currentTarget.value)}
        onFocus={onFocus}
      >
        <option value="">不使用本地凭据</option>
        {compatibleCredentials.map((credential) => (
          <option key={credential.id} value={credential.id}>
            {typeNameById.get(credential.type_id) ?? credential.type_id}：{credential.name}
          </option>
        ))}
      </select>
      {compatibleCredentials.length === 0 ? <small className="field-help">暂无可用于此节点的凭据。</small> : null}
      {onOpenCredentialManager ? (
        <button className="credential-selector-manage" disabled={disabled} type="button" onClick={onOpenCredentialManager}>
          管理凭据
        </button>
      ) : null}
    </label>
  );
}

function webhookUrlsFor(value: unknown, workflowId?: string): { production: string; test?: string } | null {
  if (typeof value !== "string") {
    return null;
  }

  const path = value.trim().replace(/^\/+|\/+$/g, "");
  if (!path) {
    return null;
  }

  return {
    production: `${API_BASE_URL}/webhooks/${path}`,
    test: workflowId ? `${API_BASE_URL}/webhooks-test/${encodeURIComponent(workflowId)}/${path}` : undefined,
  };
}

function WorkflowSelector({
  currentWorkflowId,
  disabled,
  options,
  value,
  onChange,
  onFocus,
}: {
  currentWorkflowId?: string;
  disabled: boolean;
  options: WorkflowSummary[];
  value: unknown;
  onChange: (value: string) => void;
  onFocus: () => void;
}) {
  const availableOptions = options.filter((option) => option.id !== currentWorkflowId);
  const selectedValue = typeof value === "string" && availableOptions.some((option) => option.id === value) ? value : "";

  return (
    <label className="schema-field" data-config-field="workflow_id">
      <span>目标工作流</span>
      <select
        aria-label="目标工作流"
        disabled={disabled || availableOptions.length === 0}
        value={selectedValue}
        onChange={(event) => onChange(event.currentTarget.value)}
        onFocus={onFocus}
      >
        <option value="">{availableOptions.length === 0 ? "暂无可调用的已保存工作流" : "请选择工作流"}</option>
        {availableOptions.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}（v{option.version}）
          </option>
        ))}
      </select>
      {value && !selectedValue ? <small className="field-help">当前目标工作流已不可用，请重新选择。</small> : null}
    </label>
  );
}

function FailurePolicyEditor({
  disabled,
  node,
  nodeType,
  onChange,
}: {
  disabled: boolean;
  node: WorkflowNode;
  nodeType: NodeType;
  onChange?: (nodeId: string, policy: NodeExecutionPolicy) => void;
}) {
  const policy = nodeExecutionPolicy(node);
  const canRouteError = Boolean(nodeType.outputs.error);
  const emit = (next: NodeExecutionPolicy) => {
    if (!disabled) {
      onChange?.(node.id, next);
    }
  };

  return (
    <fieldset className="failure-policy-editor" disabled={disabled}>
      <legend>失败处理</legend>
      <div role="radiogroup" aria-label="失败处理" className="failure-policy-modes">
        <label>
          <input
            checked={policy.onError === "stop"}
            name={`failure-policy-${node.id}`}
            type="radio"
            onChange={() => emit({ ...policy, onError: "stop" })}
          />
          失败即停止
        </label>
        <label>
          <input
            checked={policy.onError === "continue"}
            name={`failure-policy-${node.id}`}
            type="radio"
            onChange={() => emit({ ...policy, onError: "continue" })}
          />
          失败后继续
        </label>
        <label>
          <input
            checked={policy.onError === "errorOutput"}
            disabled={!canRouteError}
            name={`failure-policy-${node.id}`}
            type="radio"
            onChange={() => emit({ ...policy, onError: "errorOutput" })}
          />
          走错误端口
        </label>
      </div>
      {!canRouteError ? <p>该节点没有 error 输出端口，不能路由执行异常。</p> : null}
      <div className="failure-policy-retry">
        <label>
          最多尝试次数
          <input
            aria-label="最多尝试次数"
            max={5}
            min={1}
            type="number"
            value={policy.retry.maxAttempts}
            onChange={(event) =>
              emit({
                ...policy,
                retry: { ...policy.retry, maxAttempts: Math.max(1, Math.min(5, Number(event.currentTarget.value) || 1)) },
              })
            }
          />
        </label>
        <label>
          重试间隔（秒）
          <input
            aria-label="重试间隔（秒）"
            max={60}
            min={0}
            step="any"
            type="number"
            value={policy.retry.delaySeconds}
            onChange={(event) =>
              emit({
                ...policy,
                retry: { ...policy.retry, delaySeconds: Math.max(0, Math.min(60, Number(event.currentTarget.value) || 0)) },
              })
            }
          />
        </label>
      </div>
    </fieldset>
  );
}

function PinnedDataEditor({
  disabled,
  node,
  nodeType,
  runtimeState,
  onChange,
}: {
  disabled: boolean;
  node: WorkflowNode;
  nodeType: NodeType;
  runtimeState?: NodeRuntimeState;
  onChange?: (nodeId: string, pinnedData: Record<string, unknown> | undefined) => void;
}) {
  const latestOutputs = recordValue(runtimeState?.outputs);
  const outputPorts = resolveNodeOutputPorts(node, nodeType);
  const outputHandles = Object.keys(outputPorts);
  const hasPinnedData = Boolean(node.pinnedData && Object.keys(node.pinnedData).length > 0);
  const [isEditing, setIsEditing] = useState(hasPinnedData);
  const [draftText, setDraftText] = useState(() => pinnedDataText(node.pinnedData ?? createPinnedDataDraft(outputHandles)));
  const draftResult = parsePinnedDataDraft(draftText, outputHandles);
  const canSave = Boolean(draftResult.pinnedData) && !disabled && Boolean(onChange);

  useEffect(() => {
    setIsEditing(hasPinnedData);
    setDraftText(pinnedDataText(node.pinnedData ?? createPinnedDataDraft(outputHandles)));
  }, [hasPinnedData, node.id, node.pinnedData, outputHandles.join("|")]);

  function openEditor(value: Record<string, unknown>) {
    setDraftText(pinnedDataText(value));
    setIsEditing(true);
  }

  function saveDraft() {
    if (draftResult.pinnedData && !disabled) {
      onChange?.(node.id, clonePinnedData(draftResult.pinnedData));
      setIsEditing(true);
    }
  }

  return (
    <fieldset className="pinned-data-editor" disabled={disabled}>
      <legend>固定调试输出</legend>
      {hasPinnedData ? (
        <p>此节点会在手动运行中复用固定输出。Webhook 和子工作流不会使用它。</p>
      ) : (
        <p>固定输出后，手动调试时不会重复执行这个节点。可从最近一次运行捕获，也可手工编写 Mock 数据。</p>
      )}
      {outputHandles.length > 0 ? (
        <small>可用输出端口：{outputHandles.map((handle) => portDisplayName(handle, outputPorts[handle])).join("、")}</small>
      ) : (
        <small>该节点没有输出端口，不能固定输出。</small>
      )}
      <div className="pinned-data-actions">
        {latestOutputs ? (
          <button
            type="button"
            onClick={() => {
              onChange?.(node.id, clonePinnedData(latestOutputs));
              openEditor(latestOutputs);
            }}
          >
            固定最近一次输出
          </button>
        ) : null}
        {!hasPinnedData && outputHandles.length > 0 ? (
          <button type="button" onClick={() => openEditor(createPinnedDataDraft(outputHandles))}>
            新建固定输出
          </button>
        ) : null}
        {hasPinnedData ? (
          <button type="button" onClick={() => onChange?.(node.id, undefined)}>
            清除固定输出
          </button>
        ) : null}
      </div>
      {isEditing ? (
        <div className="pinned-data-draft">
          <label>
            <span>固定输出 JSON</span>
            <textarea
              aria-label="固定输出 JSON"
              spellCheck={false}
              value={draftText}
              onChange={(event) => setDraftText(event.currentTarget.value)}
            />
          </label>
          {draftResult.errors.map((error) => (
            <p className="pinned-data-error" key={error} role="alert">
              {error}
            </p>
          ))}
          <button disabled={!canSave} type="button" onClick={saveDraft}>
            保存固定输出
          </button>
        </div>
      ) : null}
      {!latestOutputs && !hasPinnedData ? <small>不需要先运行节点，直接新建固定输出即可构造调试数据。</small> : null}
    </fieldset>
  );
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function clonePinnedData(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function pinnedDataText(value: Record<string, unknown>): string {
  return JSON.stringify(value, null, 2);
}

function staleConfigKeysForNode(node: WorkflowNode, nodeType: NodeType): string[] {
  if (nodeType.configSchema.additionalProperties !== false) {
    return [];
  }

  const declaredKeys = new Set(Object.keys(nodeType.configSchema.properties ?? {}));
  return Object.keys(node.config).filter((key) => !declaredKeys.has(key));
}

function StaleConfigKeyPanel({
  disabled,
  keys,
  node,
  onConfigRemove,
}: {
  disabled?: boolean;
  keys: string[];
  node: WorkflowNode;
  onConfigRemove?: (nodeId: string, key: string) => void;
}) {
  return (
    <section className="stale-config-panel" aria-label="已移除的配置字段">
      <div>
        <strong>已移除的配置字段</strong>
        <p>这些字段不在当前节点脚本定义中，清理后再保存工作流。</p>
      </div>
      <ul>
        {keys.map((key) => (
          <li key={key}>
            <code>{key}</code>
            {onConfigRemove ? (
              <button
                disabled={disabled}
                type="button"
                onClick={() => {
                  if (!disabled) {
                    onConfigRemove(node.id, key);
                  }
                }}
              >
                清理 {key}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function initialVisibleTab(tab: ConfigPanelTab, hasRuntimeDetails: boolean): ConfigPanelTab {
  return tab === "runtime" && !hasRuntimeDetails ? "config" : tab;
}
type ExpressionReferencePanelProps = {
  activeFieldName: string | null;
  disabled?: boolean;
  references: ExpressionReference[];
  onInsert: (expression: string) => void;
};

type PortDetailsProps = {
  node: WorkflowNode;
  nodeType: NodeType;
};

function PortDetails({ node, nodeType }: PortDetailsProps) {
  const inputs = resolveNodeInputPorts(node, nodeType);
  const outputs = resolveNodeOutputPorts(node, nodeType);
  return (
    <div className="port-details">
      <PortGroup direction="input" ports={inputs} title="输入端口" />
      <PortGroup direction="output" ports={outputs} title="输出端口" />
    </div>
  );
}

type PortGroupProps = {
  direction: "input" | "output";
  ports: Record<string, NodePort>;
  title: string;
};

function PortGroup({ direction, ports, title }: PortGroupProps) {
  const entries = Object.entries(ports);

  return (
    <section className="port-group" aria-label={title}>
      <h3>{title}</h3>
      {entries.length === 0 ? (
        <p className="runtime-muted">这个节点没有{direction === "input" ? "输入" : "输出"}端口。</p>
      ) : (
        <div className="port-list">
          {entries.map(([name, port]) => {
            const summary = schemaSummary(port.schema);
            const capacityLabel = inputCapacityLabel(direction, port, { includeDefault: true });
            const dataModeLabel = direction === "input" ? portDataModeLabel(port) : null;
            const displayName = portDisplayName(name, port);

            return (
              <article className="port-row" key={name}>
                <div>
                  <div className="port-title">
                    <h4>{displayName}</h4>
                    {displayName !== name ? <small className="port-technical-name">技术名：{name}</small> : null}
                  </div>
                  {direction === "input" ? <span>{port.required ? "必填" : "可选"}</span> : null}
                </div>
                <code>{summary.typeLabel}</code>
                {capacityLabel ? <small className="port-schema-line">连接：{capacityLabel}</small> : null}
                {dataModeLabel ? <small className="port-schema-line">{dataModeLabel}</small> : null}
                {summary.fieldLabel ? <small className="port-schema-line">{summary.fieldLabel}</small> : null}
                {summary.requiredLabel ? <small className="port-schema-line is-required">{summary.requiredLabel}</small> : null}
                <p>{port.description ?? "暂无说明"}</p>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

const EXPRESSION_GROUP_LABELS: Record<ExpressionReferenceGroup, string> = {
  loop: "循环数据",
  node: "节点输出",
  "project-variable": "项目变量",
  "workflow-variable": "工作流变量",
  variable: "运行变量",
};

function ExpressionReferencePanel({
  activeFieldName,
  disabled = false,
  references,
  onInsert,
}: ExpressionReferencePanelProps) {
  if (references.length === 0) {
    return (
      <section className="expression-reference-panel" aria-label="可用数据">
        <div className="expression-reference-heading">
          <strong>可用数据</strong>
          <span>暂无可用表达式</span>
        </div>
      </section>
    );
  }

  return (
    <section className="expression-reference-panel" aria-label="可用数据">
      <div className="expression-reference-heading">
        <strong>可用数据</strong>
        <span>{activeFieldName ? `将插入到：${activeFieldName}` : "先点击一个配置字段"}</span>
      </div>
      {(["node", "project-variable", "workflow-variable", "variable", "loop"] as const).map((group) => {
        const groupReferences = references.filter((reference) => reference.group === group);
        if (groupReferences.length === 0) {
          return null;
        }

        return (
          <div className="expression-reference-group" key={group}>
            <h3>{EXPRESSION_GROUP_LABELS[group]}</h3>
            <ul>
              {groupReferences.map((reference) => (
                <li key={reference.id}>
                  <div>
                    <strong>{reference.label}</strong>
                    {activeFieldName ? (
                      <code>{reference.expression}</code>
                    ) : (
                      <p className="expression-reference-hint">选择配置字段后显示可插入表达式</p>
                    )}
                    <p>{reference.description}</p>
                  </div>
                  <button
                    disabled={disabled || !activeFieldName}
                    type="button"
                    aria-label={`插入 ${reference.expression}`}
                    onClick={() => {
                      if (!disabled) {
                        onInsert(reference.expression);
                      }
                    }}
                  >
                    插入
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

type SchemaFieldProps = {
  disabled?: boolean;
  formField?: NodeFormField;
  name: string;
  isRequired: boolean;
  schema: JsonSchema;
  rootSchema: JsonSchema;
  value: unknown;
  onFocus: () => void;
  onChange: (value: unknown) => void;
};
function SchemaField({ disabled = false, formField, name, isRequired, schema, rootSchema, value, onFocus, onChange }: SchemaFieldProps) {
  const activeSchema = effectiveSchema(schema, rootSchema);
  const label = formField?.label || activeSchema.title || name;
  const schemaType = schemaFieldTypes(activeSchema, rootSchema)[0];
  const description = formField?.description || schemaDescription(activeSchema);
  const descriptionId = description ? `config-field-${fieldDomId(name)}-description` : undefined;
  const fieldErrors = validateSchemaField({ value, schema, rootSchema, isRequired });
  const hasFieldError = fieldErrors.length > 0;
  const errorId = hasFieldError ? `config-field-${fieldDomId(name)}-error` : undefined;
  const describedBy = fieldDescribedBy(descriptionId, errorId);
  const placeholder = formField?.placeholder || fieldPlaceholder(activeSchema);

  if (formField?.control === "select" && formField.options?.length) {
    const selectedValue =
      typeof value === "string" && formField.options.some((option) => option.value === value)
        ? value
        : formField.options[0].value;
    return (
      <label className="field">
        <FieldLabel isRequired={isRequired} label={label} />
        <select
          aria-label={label}
          aria-describedby={describedBy}
          aria-invalid={fieldErrors.length ? "true" : undefined}
          aria-required={isRequired}
          data-config-field={name}
          disabled={disabled}
          required={isRequired}
          value={selectedValue}
          onFocus={onFocus}
          onChange={(event) => onChange(event.currentTarget.value)}
        >
          {formField.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <FieldDescription description={description} id={descriptionId} />
        <FieldValidationErrors errors={fieldErrors} id={errorId} />
      </label>
    );
  }

  if (activeSchema.enum?.length) {
    const selectedIndex = Math.max(
      0,
      activeSchema.enum.findIndex((option) => Object.is(option, value))
    );

    return (
      <label className="field">
        <FieldLabel isRequired={isRequired} label={label} />
        <select
          aria-label={label}
          aria-describedby={describedBy}
          aria-invalid={fieldErrors.length ? "true" : undefined}
          aria-required={isRequired}
          data-config-field={name}
          disabled={disabled}
          required={isRequired}
          value={String(selectedIndex)}
          onFocus={onFocus}
          onChange={(event) => {
            if (disabled) {
              return;
            }
            onChange(activeSchema.enum?.[Number(event.currentTarget.value)] ?? activeSchema.enum?.[0]);
          }}
        >
          {activeSchema.enum.map((option, index) => (
            <option key={`${String(option)}-${index}`} value={String(index)}>
              {enumOptionLabel(activeSchema, option)}
            </option>
          ))}
        </select>
        <FieldDescription description={description} id={descriptionId} />
        <FieldValidationErrors errors={fieldErrors} id={errorId} />
      </label>
    );
  }

  if (formField?.control === "switch" || schemaType === "boolean") {
    return (
      <label className="field field-checkbox">
        <input
          aria-label={label}
          aria-describedby={describedBy}
          aria-invalid={fieldErrors.length ? "true" : undefined}
          aria-required={isRequired}
          checked={Boolean(value)}
          data-config-field={name}
          disabled={disabled}
          required={isRequired}
          type="checkbox"
          onFocus={onFocus}
          onChange={(event) => {
            if (disabled) {
              return;
            }
            onChange(event.currentTarget.checked);
          }}
        />
        <FieldLabel isRequired={isRequired} label={label} />
        <FieldDescription description={description} id={descriptionId} />
        <FieldValidationErrors errors={fieldErrors} id={errorId} />
      </label>
    );
  }

  if (formField?.control === "number" || schemaType === "number" || schemaType === "integer") {
    return (
      <label className="field">
        <FieldLabel isRequired={isRequired} label={label} />
        <input
          aria-label={label}
          aria-describedby={describedBy}
          aria-invalid={fieldErrors.length ? "true" : undefined}
          aria-required={isRequired}
          data-config-field={name}
          disabled={disabled}
          max={activeSchema.maximum}
          min={activeSchema.minimum}
          placeholder={placeholder}
          required={isRequired}
          step={schemaType === "integer" ? 1 : "any"}
          type="number"
          value={typeof value === "number" ? value : 0}
          onFocus={onFocus}
          onChange={(event) => {
            if (disabled) {
              return;
            }
            const nextValue = event.currentTarget.value;
            onChange(schemaType === "integer" ? Number.parseInt(nextValue || "0", 10) : Number(nextValue || 0));
          }}
        />
        <FieldDescription description={description} id={descriptionId} />
        <FieldValidationErrors errors={fieldErrors} id={errorId} />
      </label>
    );
  }

  if (schemaType === "object" || schemaType === "array") {
    return (
      <JsonField
        description={description}
        descriptionId={descriptionId}
        describedBy={describedBy}
        expectedType={schemaType}
        isRequired={isRequired}
        label={label}
        name={name}
        placeholder={placeholder}
        fieldErrors={fieldErrors}
        errorId={errorId}
        value={value}
        disabled={disabled}
        onFocus={onFocus}
        onChange={onChange}
      />
    );
  }

  if (formField?.control === "json" || formField?.control === "textarea" || !schemaType) {
    return (
      <FlexibleValueField
        description={description}
        descriptionId={descriptionId}
        describedBy={describedBy}
        isRequired={isRequired}
        label={label}
        name={name}
        placeholder={placeholder}
        fieldErrors={fieldErrors}
        errorId={errorId}
        value={value}
        disabled={disabled}
        onFocus={onFocus}
        onChange={onChange}
      />
    );
  }

  return (
    <label className="field">
      <FieldLabel isRequired={isRequired} label={label} />
      <input
        aria-label={label}
        aria-describedby={describedBy}
        aria-invalid={fieldErrors.length ? "true" : undefined}
        aria-required={isRequired}
        data-config-field={name}
        disabled={disabled}
        placeholder={placeholder}
        required={isRequired}
        value={String(value ?? "")}
        type={formField?.control === "password" ? "password" : formField?.control === "url" ? "url" : "text"}
        onFocus={onFocus}
        onChange={(event) => {
          if (disabled) {
            return;
          }
          onChange(event.currentTarget.value);
        }}
      />
      <FieldDescription description={description} id={descriptionId} />
      <FieldValidationErrors errors={fieldErrors} id={errorId} />
    </label>
  );
}

function enumOptionLabel(schema: JsonSchema, option: unknown): string {
  const labels = schema.enumLabels;
  if (typeof option !== "string" || !labels || typeof labels !== "object" || Array.isArray(labels)) {
    return String(option);
  }

  const label = (labels as Record<string, unknown>)[option];
  return typeof label === "string" ? label : String(option);
}

function FieldLabel({ isRequired, label }: { isRequired: boolean; label: string }) {
  return (
    <span className="field-label">
      <span>{label}</span>
      {isRequired ? <em>必填</em> : null}
    </span>
  );
}

function FieldDescription({ description, id }: { description: string | undefined; id: string | undefined }) {
  return description ? (
    <small className="field-description" id={id}>
      {description}
    </small>
  ) : null;
}

function FieldValidationErrors({ errors, id }: { errors: string[]; id: string | undefined }) {
  return errors.length ? (
    <small className="field-error field-validation-error" id={id}>
      {errors.join("；")}
    </small>
  ) : null;
}

function schemaDescription(schema: JsonSchema): string | undefined {
  return typeof schema.description === "string" && schema.description.trim() ? schema.description : undefined;
}

function fieldDomId(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]+/g, "-");
}

function fieldPlaceholder(schema: JsonSchema): string | undefined {
  if (schema.examples?.length) {
    return formatPlaceholderValue(schema.examples[0]);
  }

  if ("default" in schema && schema.default !== "" && schema.default !== null && schema.default !== undefined) {
    return formatPlaceholderValue(schema.default);
  }

  return undefined;
}

function formatPlaceholderValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(value, null, 2);
}

function fieldDescribedBy(...ids: Array<string | undefined>): string | undefined {
  const existingIds = ids.filter((id): id is string => Boolean(id));
  return existingIds.length ? existingIds.join(" ") : undefined;
}

type FlexibleValueFieldProps = {
  description: string | undefined;
  descriptionId: string | undefined;
  describedBy: string | undefined;
  disabled?: boolean;
  fieldErrors: string[];
  errorId: string | undefined;
  isRequired: boolean;
  label: string;
  name: string;
  placeholder: string | undefined;
  value: unknown;
  onFocus: () => void;
  onChange: (value: unknown) => void;
};

function FlexibleValueField({
  description,
  descriptionId,
  describedBy,
  disabled = false,
  fieldErrors,
  errorId,
  isRequired,
  label,
  name,
  placeholder,
  value,
  onFocus,
  onChange,
}: FlexibleValueFieldProps) {
  const [text, setText] = useState(() => formatFlexibleValue(value));

  useEffect(() => {
    setText(formatFlexibleValue(value));
  }, [value]);

  return (
    <label className="field">
      <FieldLabel isRequired={isRequired} label={label} />
      <textarea
        aria-label={label}
        aria-describedby={describedBy}
        aria-invalid={fieldErrors.length ? "true" : undefined}
        aria-required={isRequired}
        data-config-field={name}
        disabled={disabled}
        placeholder={placeholder}
        required={isRequired}
        value={text}
        onFocus={onFocus}
        onChange={(event) => {
          if (disabled) {
            return;
          }
          const nextText = event.currentTarget.value;
          setText(nextText);
          onChange(parseFlexibleValue(nextText));
        }}
      />
      <FieldDescription description={description} id={descriptionId} />
      <FieldValidationErrors errors={fieldErrors} id={errorId} />
    </label>
  );
}

type JsonFieldProps = {
  description: string | undefined;
  descriptionId: string | undefined;
  describedBy: string | undefined;
  disabled?: boolean;
  expectedType: "object" | "array";
  fieldErrors: string[];
  errorId: string | undefined;
  isRequired: boolean;
  label: string;
  name: string;
  placeholder: string | undefined;
  value: unknown;
  onFocus: () => void;
  onChange: (value: unknown) => void;
};

function JsonField({
  description,
  descriptionId,
  describedBy,
  disabled = false,
  expectedType,
  fieldErrors,
  errorId,
  isRequired,
  label,
  name,
  placeholder,
  value,
  onFocus,
  onChange,
}: JsonFieldProps) {
  const [text, setText] = useState(() => formatJson(value, expectedType));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setText(formatJson(value, expectedType));
    setError(null);
  }, [expectedType, value]);

  return (
    <label className="field">
      <FieldLabel isRequired={isRequired} label={label} />
      <textarea
        aria-label={label}
        aria-describedby={describedBy}
        aria-invalid={error || fieldErrors.length ? "true" : "false"}
        aria-required={isRequired}
        className={error || fieldErrors.length ? "json-editor has-error" : "json-editor"}
        data-config-field={name}
        disabled={disabled}
        placeholder={placeholder}
        required={isRequired}
        value={text}
        onFocus={onFocus}
        onChange={(event) => {
          if (disabled) {
            return;
          }
          const nextText = event.currentTarget.value;
          setText(nextText);
          try {
            const nextValue = JSON.parse(nextText) as unknown;
            const shapeError = validateJsonShape(nextValue, expectedType);
            if (shapeError) {
              setError(shapeError);
              return;
            }

            setError(null);
            onChange(nextValue);
          } catch {
            setError("JSON 格式无效");
          }
        }}
      />
      <FieldDescription description={description} id={descriptionId} />
      <FieldValidationErrors errors={fieldErrors} id={errorId} />
      {error ? <small className="field-error">{error}</small> : null}
    </label>
  );
}

function formatJson(value: unknown, expectedType: "object" | "array"): string {
  return JSON.stringify(value ?? (expectedType === "array" ? [] : {}), null, 2);
}

function formatFlexibleValue(value: unknown): string {
  if (typeof value === "string" || value === undefined || value === null) {
    return String(value ?? "");
  }

  return JSON.stringify(value, null, 2);
}

function formatUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
}


function parseFlexibleValue(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function validateJsonShape(value: unknown, expectedType: "object" | "array"): string | null {
  if (expectedType === "array") {
    return Array.isArray(value) ? null : "需要 JSON 数组";
  }

  return isPlainObject(value) ? null : "需要 JSON 对象";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// default 导出适配：供 React.lazy 懒加载使用，不改变组件内部逻辑
export default ConfigPanel;
