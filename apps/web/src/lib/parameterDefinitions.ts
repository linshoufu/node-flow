import type { RunParameter } from "./runParameters";

export const parameterTypes: { value: NonNullable<RunParameter["type"]>; label: string }[] = [
  { value: "string", label: "文本" }, { value: "file", label: "文件路径" },
  { value: "integer", label: "整数" }, { value: "number", label: "小数" },
  { value: "boolean", label: "是 / 否" }, { value: "date", label: "日期" },
  { value: "json", label: "结构化数据" },
];

export function newParameter(fields: RunParameter[]): RunParameter {
  let index = 1;
  while (fields.some((field) => field.name === `parameter_${index}`)) index++;
  return { name: `parameter_${index}`, label: "新参数", type: "string", required: true };
}

export function changeParameterType(field: RunParameter, type: NonNullable<RunParameter["type"]>): RunParameter {
  const next = { ...field, type };
  const value = field.default;
  const compatible = value == null || type === "json"
    || ((type === "string" || type === "file") && typeof value === "string")
    || (type === "date" && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value))
    || (type === "boolean" && typeof value === "boolean")
    || (type === "number" && typeof value === "number")
    || (type === "integer" && typeof value === "number" && Number.isInteger(value));
  if (!compatible) delete next.default;
  if (type !== "string") delete next.options;
  return next;
}

export function parameterDefinitionIssue(field: RunParameter, fields: RunParameter[], index: number): string | null {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(field.name)) return "参数名以字母或下划线开头，只能包含字母、数字和下划线。";
  if (fields.some((other, otherIndex) => otherIndex !== index && other.name === field.name)) return "参数名已存在，请使用不同名称。";
  if (field.name === "success") return "success 是保留的输出端口名，请使用其他参数名。";
  if (["__proto__", "constructor", "prototype", "password", "secret", "token", "access_token", "refresh_token", "api_key", "private_key"].includes(field.name)) return "此名称不能用作运行参数，敏感信息请使用凭据。";
  if (field.options?.length) {
    if (field.options.some((option) => !option.trim())) return "请填写选项内容或删除空选项。";
    if (new Set(field.options).size !== field.options.length) return "选项不能重复。";
    if (field.default != null && !field.options.includes(String(field.default))) return "默认值需要是可选值之一。";
  }
  return null;
}
