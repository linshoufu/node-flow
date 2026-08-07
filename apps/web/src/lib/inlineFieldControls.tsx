/**
 * 画布卡片内联控件渲染逻辑。
 * 从 ConfigPanel 的 SchemaField 提取控件→组件映射，供 WorkflowNodeView 内联渲染使用。
 * 仅处理 placement="inline" 的字段，以紧凑样式渲染在节点卡片上。
 */
import type { NodeFormField, NodeType } from "../types";

/** 内联控件支持的控件类型 */
const INLINE_SUPPORTED_CONTROLS = new Set([
  "text",
  "textarea",
  "password",
  "url",
  "number",
  "switch",
  "select",
  "json",
]);

export type InlineFieldProps = {
  field: NodeFormField;
  value: unknown;
  disabled?: boolean;
  onChange: (value: unknown) => void;
};

/**
 * 获取节点类型中标记为 inline 的字段列表。
 * 按分组和字段顺序返回。
 */
export function getInlineFields(nodeType: NodeType | undefined): NodeFormField[] {
  if (!nodeType?.form?.groups) return [];
  const inlineFields: NodeFormField[] = [];
  for (const group of nodeType.form.groups) {
    if (!group.fields) continue;
    for (const field of group.fields) {
      if (
        field.placement === "inline" &&
        INLINE_SUPPORTED_CONTROLS.has(field.control)
      ) {
        inlineFields.push(field);
      }
    }
  }
  return inlineFields;
}

/** 紧凑内联文本/密码/URL 输入框 */
function InlineTextInput({ field, value, disabled, onChange }: InlineFieldProps) {
  const inputType =
    field.control === "password" ? "password" : field.control === "url" ? "url" : "text";
  return (
    <input
      aria-label={field.label ?? field.key}
      className="inline-field-input"
      disabled={disabled}
      placeholder={field.placeholder ?? field.label ?? field.key}
      type={inputType}
      value={typeof value === "string" ? value : String(value ?? "")}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** 紧凑内联多行文本/JSON 输入框 */
function InlineTextarea({ field, value, disabled, onChange }: InlineFieldProps) {
  return (
    <textarea
      aria-label={field.label ?? field.key}
      className="inline-field-textarea"
      disabled={disabled}
      placeholder={field.placeholder ?? field.label ?? field.key}
      rows={2}
      value={typeof value === "string" ? value : JSON.stringify(value, null, 2)}
      onChange={(e) => {
        const raw = e.target.value;
        if (field.control === "json") {
          try {
            onChange(JSON.parse(raw));
          } catch {
            // 输入中的 JSON 暂不提交，等有效时再触发
          }
        } else {
          onChange(raw);
        }
      }}
    />
  );
}

/** 紧凑内联数字输入框 */
function InlineNumberInput({ field, value, disabled, onChange }: InlineFieldProps) {
  return (
    <input
      aria-label={field.label ?? field.key}
      className="inline-field-input"
      disabled={disabled}
      placeholder={field.placeholder ?? field.label ?? field.key}
      type="number"
      value={typeof value === "number" ? value : 0}
      onChange={(e) => {
        const raw = e.target.value;
        onChange(raw === "" ? 0 : Number(raw));
      }}
    />
  );
}

/** 紧凑内联开关 */
function InlineSwitch({ field, value, disabled, onChange }: InlineFieldProps) {
  return (
    <label className="inline-field-switch">
      <input
        aria-label={field.label ?? field.key}
        checked={Boolean(value)}
        disabled={disabled}
        type="checkbox"
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{field.label ?? field.key}</span>
    </label>
  );
}

/** 紧凑内联下拉选择 */
function InlineSelect({ field, value, disabled, onChange }: InlineFieldProps) {
  const options = field.options ?? [];
  if (options.length === 0) {
    return (
      <input
        aria-label={field.label ?? field.key}
        className="inline-field-input"
        disabled={disabled}
        placeholder={field.label ?? field.key}
        type="text"
        value={typeof value === "string" ? value : String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  const selectedValue =
    typeof value === "string" && options.some((o) => o.value === value)
      ? value
      : options[0].value;
  return (
    <select
      aria-label={field.label ?? field.key}
      className="inline-field-select"
      disabled={disabled}
      value={selectedValue}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/**
 * 根据字段的 control 类型渲染对应的紧凑内联控件。
 * 控件类型不在支持范围内时返回 null。
 */
export function renderInlineField(
  field: NodeFormField,
  value: unknown,
  onChange: (value: unknown) => void,
  disabled = false,
): React.ReactNode {
  const props: InlineFieldProps = { field, value, disabled, onChange };

  switch (field.control) {
    case "switch":
      return <InlineSwitch key={field.key} {...props} />;
    case "select":
      return <InlineSelect key={field.key} {...props} />;
    case "number":
      return <InlineNumberInput key={field.key} {...props} />;
    case "textarea":
    case "json":
      return <InlineTextarea key={field.key} {...props} />;
    case "text":
    case "password":
    case "url":
      return <InlineTextInput key={field.key} {...props} />;
    default:
      return null;
  }
}
