import { useEffect, useState } from "react";
import type { NodeRuntimeState } from "../lib/runState";
import type { JsonSchema, NodeType, WorkflowNode } from "../types";

type ConfigPanelProps = {
  node?: WorkflowNode;
  nodeType?: NodeType;
  runtimeState?: NodeRuntimeState;
  onConfigChange: (nodeId: string, key: string, value: unknown) => void;
  onOpenSubflow?: (nodeId: string, subflowName: string) => void;
};

const LOOP_NODE_TYPES = new Set(["control.foreach", "control.while"]);

const CONFIG_GUIDANCE_BY_NODE_TYPE: Record<string, string> = {
  "http.request": "填写请求方法和 URL。",
  "data.csv_read": "填写 CSV 文件路径，确认分隔符和表头设置。运行后可在运行详情查看表头和行数。",
  "control.foreach": "填写循环数据来源。循环体内可以用 {{ loop.item.column_name }} 引用当前 CSV 行字段。",
  "assert.status_code": "填写期望状态码。",
  "test.write_report": "填写测试报告输出路径。",
};

export function ConfigPanel({ node, nodeType, runtimeState, onConfigChange, onOpenSubflow }: ConfigPanelProps) {
  const [activeTab, setActiveTab] = useState<"config" | "runtime">("config");
  const properties = nodeType?.configSchema.properties ?? {};
  const entries = Object.entries(properties);
  const canOpenBody = Boolean(node && nodeType && LOOP_NODE_TYPES.has(nodeType.id) && onOpenSubflow);
  const configGuidance = nodeType ? CONFIG_GUIDANCE_BY_NODE_TYPE[nodeType.id] : undefined;
  const hasRuntimeDetails = Boolean(runtimeState && runtimeState.status !== "pending");

  useEffect(() => {
    setActiveTab("config");
  }, [node?.id]);

  return (
    <aside className="panel config-panel" aria-label="配置面板">
      <div className="panel-heading">
        <div>
          <h2>配置</h2>
          <p>编辑所选节点参数</p>
        </div>
        {nodeType ? <span>{nodeType.category}</span> : null}
      </div>

      {!node || !nodeType ? (
        <p className="empty-state">选择一个节点后，在这里编辑它的参数。</p>
      ) : (
        <div className="config-content">
          <div className="selected-node">
            <strong>{nodeType.name}</strong>
            <small>{nodeType.id}</small>
          </div>

          {hasRuntimeDetails ? (
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
                aria-selected={activeTab === "runtime"}
                role="tab"
                type="button"
                onClick={() => setActiveTab("runtime")}
              >
                运行详情
              </button>
            </div>
          ) : null}

          {activeTab === "config" && configGuidance ? <p className="config-guidance">{configGuidance}</p> : null}

          {activeTab === "runtime" && runtimeState ? (
            <RuntimeDetails nodeTypeId={nodeType.id} runtimeState={runtimeState} />
          ) : entries.length === 0 ? (
            <p className="empty-state">这个节点没有可配置字段。</p>
          ) : (
            <form
              aria-label="配置字段"
              className="field-list"
              onSubmit={(event) => event.preventDefault()}
            >
              {entries.map(([key, schema]) => (
                <SchemaField
                  key={key}
                  name={key}
                  schema={schema}
                  value={node.config[key]}
                  onChange={(value) => onConfigChange(node.id, key, value)}
                />
              ))}
            </form>
          )}

          {activeTab === "config" && canOpenBody ? (
            <div className="subflow-actions">
              <button
                className="open-subflow-button"
                type="button"
                onClick={() => onOpenSubflow?.(node.id, "body")}
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

type RuntimeDetailsProps = {
  nodeTypeId: string;
  runtimeState: NodeRuntimeState;
};

function RuntimeDetails({ nodeTypeId, runtimeState }: RuntimeDetailsProps) {
  const insightLines = buildRuntimeInsight(nodeTypeId, runtimeState.outputs);

  return (
    <div className="runtime-details">
      <div className="runtime-summary">
        <span>状态：{runStatusLabel(runtimeState.status)}</span>
        {typeof runtimeState.durationMs === "number" ? <span>耗时：{runtimeState.durationMs} ms</span> : null}
      </div>
      {insightLines.length > 0 ? (
        <div className="runtime-insight" aria-label="运行摘要">
          <strong>摘要</strong>
          <div>
            {insightLines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        </div>
      ) : null}
      <RuntimeBlock title="输入" value={runtimeState.inputs} />
      <RuntimeBlock title="输出" value={runtimeState.outputs} />
      <RuntimeBlock title="日志" value={runtimeState.logs} />
      <RuntimeBlock title="错误" value={runtimeState.error} />
      {runtimeState.scopes.length > 0 ? (
        <div className="runtime-block">
          <strong>范围</strong>
          <pre>{runtimeState.scopes.map((scope) => (scope.length ? scope.join(" / ") : "主流程")).join("\n")}</pre>
        </div>
      ) : null}
    </div>
  );
}

function buildRuntimeInsight(nodeTypeId: string, outputs: unknown): string[] {
  if (nodeTypeId === "data.csv_read") {
    return buildCsvRuntimeInsight(outputs);
  }

  if (nodeTypeId === "control.foreach") {
    return buildForEachRuntimeInsight(outputs);
  }

  return [];
}

function buildCsvRuntimeInsight(outputs: unknown): string[] {
  if (!isPlainObject(outputs) || !isPlainObject(outputs.success)) {
    return [];
  }

  const lines: string[] = [];
  const { headers, rows, columns } = outputs.success;

  if (Array.isArray(headers)) {
    lines.push(`表头：${headers.map(String).join(", ")}`);
  }

  if (Array.isArray(rows)) {
    lines.push(`行数：${rows.length}`);
  }

  if (isPlainObject(columns)) {
    lines.push(`列：${Object.keys(columns).join(", ")}`);
  }

  return lines;
}

function buildForEachRuntimeInsight(outputs: unknown): string[] {
  if (!isPlainObject(outputs)) {
    return [];
  }

  for (const outputName of ["success", "done", "error"]) {
    const output = outputs[outputName];
    if (!isPlainObject(output)) {
      continue;
    }

    for (const countKey of ["iteration_count", "iterations", "count", "total_items"]) {
      const value = output[countKey];
      if (typeof value === "number" && Number.isFinite(value)) {
        return [`迭代次数：${value}`];
      }
    }
  }

  return [];
}

function RuntimeBlock({ title, value }: { title: string; value: unknown }) {
  if (value === undefined) {
    return null;
  }

  return (
    <div className="runtime-block">
      <strong>{title}</strong>
      <pre>{formatUnknown(value)}</pre>
    </div>
  );
}

function runStatusLabel(status: NodeRuntimeState["status"]) {
  switch (status) {
    case "running":
      return "运行中";
    case "succeeded":
      return "成功";
    case "failed":
      return "失败";
    case "skipped":
      return "已跳过";
    case "cancelled":
      return "已取消";
    case "pending":
      return "等待";
  }
}

type SchemaFieldProps = {
  name: string;
  schema: JsonSchema;
  value: unknown;
  onChange: (value: unknown) => void;
};

function SchemaField({ name, schema, value, onChange }: SchemaFieldProps) {
  const label = schema.title || name;
  const schemaType = Array.isArray(schema.type) ? schema.type.find((type) => type !== "null") : schema.type;

  if (schema.enum?.length) {
    const selectedIndex = Math.max(
      0,
      schema.enum.findIndex((option) => Object.is(option, value))
    );

    return (
      <label className="field">
        <span>{label}</span>
        <select
          value={String(selectedIndex)}
          onChange={(event) => onChange(schema.enum?.[Number(event.currentTarget.value)] ?? schema.enum?.[0])}
        >
          {schema.enum.map((option, index) => (
            <option key={`${String(option)}-${index}`} value={String(index)}>
              {String(option)}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (schemaType === "boolean") {
    return (
      <label className="field field-checkbox">
        <input checked={Boolean(value)} type="checkbox" onChange={(event) => onChange(event.currentTarget.checked)} />
        <span>{label}</span>
      </label>
    );
  }

  if (schemaType === "number" || schemaType === "integer") {
    return (
      <label className="field">
        <span>{label}</span>
        <input
          max={schema.maximum}
          min={schema.minimum}
          step={schemaType === "integer" ? 1 : "any"}
          type="number"
          value={typeof value === "number" ? value : 0}
          onChange={(event) => {
            const nextValue = event.currentTarget.value;
            onChange(schemaType === "integer" ? Number.parseInt(nextValue || "0", 10) : Number(nextValue || 0));
          }}
        />
      </label>
    );
  }

  if (schemaType === "object" || schemaType === "array") {
    return <JsonField expectedType={schemaType} label={label} value={value} onChange={onChange} />;
  }

  if (!schemaType) {
    return <FlexibleValueField label={label} value={value} onChange={onChange} />;
  }

  return (
    <label className="field">
      <span>{label}</span>
      <input value={String(value ?? "")} type="text" onChange={(event) => onChange(event.currentTarget.value)} />
    </label>
  );
}

type FlexibleValueFieldProps = {
  label: string;
  value: unknown;
  onChange: (value: unknown) => void;
};

function FlexibleValueField({ label, value, onChange }: FlexibleValueFieldProps) {
  const [text, setText] = useState(() => formatFlexibleValue(value));

  useEffect(() => {
    setText(formatFlexibleValue(value));
  }, [value]);

  return (
    <label className="field">
      <span>{label}</span>
      <textarea
        value={text}
        onChange={(event) => {
          const nextText = event.currentTarget.value;
          setText(nextText);
          onChange(parseFlexibleValue(nextText));
        }}
      />
    </label>
  );
}

type JsonFieldProps = {
  expectedType: "object" | "array";
  label: string;
  value: unknown;
  onChange: (value: unknown) => void;
};

function JsonField({ expectedType, label, value, onChange }: JsonFieldProps) {
  const [text, setText] = useState(() => formatJson(value, expectedType));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setText(formatJson(value, expectedType));
    setError(null);
  }, [expectedType, value]);

  return (
    <label className="field">
      <span>{label}</span>
      <textarea
        aria-invalid={error ? "true" : "false"}
        className={error ? "json-editor has-error" : "json-editor"}
        value={text}
        onChange={(event) => {
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
