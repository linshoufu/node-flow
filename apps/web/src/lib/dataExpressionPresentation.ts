/** Read-only syntax presentation. Unknown expressions remain opaque; never evaluate code. */
export type ExpressionEntry = { key: string; expression: string };
export type ExpressionShape =
  | { kind: "object"; entries: ExpressionEntry[] }
  | { kind: "array"; items: string[] }
  | { kind: "string"; value: string }
  | { kind: "number"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "null" }
  | { kind: "field"; root: string; path: string; fallback?: string }
  | { kind: "expression" };

export const DATA_SOURCES = [
  ["row", "表格列"], ["inputs.input", "输入数据"], ["inputs.context", "关联数据"],
  ["inputs.options", "组装选项"], ["options", "映射选项"], ["values", "已映射字段"], ["item", "当前数据项"],
] as const;

export function isDataNumber(value: string): boolean {
  return /^-?(?:(?:0|[1-9]\d*)(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value);
}

export function splitExpression(source: string, separator = ","): string[] | null {
  const parts: string[] = [];
  const stack: string[] = [];
  let quote = "", start = 0;
  const closing: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quote) {
      if (char === "\\") i++;
      else if (char === quote) quote = "";
    } else if (char === "#") return null;
    else if (char === "'" || char === '"') quote = char;
    else if (closing[char]) stack.push(closing[char]);
    else if ([")", "]", "}"].includes(char)) { if (stack.pop() !== char) return null; }
    else if (!stack.length && char === separator) { parts.push(source.slice(start, i).trim()); start = i + 1; }
  }
  if (quote || stack.length) return null;
  parts.push(source.slice(start).trim());
  return parts;
}

function stringLiteral(source: string): string | null {
  const quote = source[0];
  if (!["'", '"'].includes(quote) || source.at(-1) !== quote) return null;
  let result = "";
  for (let i = 1; i < source.length - 1; i++) {
    const char = source[i];
    if (char === quote || char === "\n" || char === "\r") return null;
    if (char !== "\\") { result += char; continue; }
    const escaped = source[++i];
    const basic: Record<string, string> = { "\\": "\\", "'": "'", '"': '"', n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" };
    if (escaped in basic) result += basic[escaped];
    else if (escaped === "u" || escaped === "x") {
      const length = escaped === "u" ? 4 : 2;
      const hex = source.slice(i + 1, i + 1 + length);
      if (!new RegExp(`^[0-9a-fA-F]{${length}}$`).test(hex)) return null;
      result += String.fromCharCode(parseInt(hex, 16)); i += length;
    } else return null;
  }
  return result;
}

export function expressionShape(expression: string): ExpressionShape {
  const source = expression.trim();
  const literal = stringLiteral(source);
  if (literal !== null) return { kind: "string", value: literal };
  if (isDataNumber(source)) return { kind: "number", value: source };
  if (source === "True" || source === "False") return { kind: "boolean", value: source === "True" };
  if (source === "None") return { kind: "null" };
  if (source.startsWith("{") && source.endsWith("}")) {
    const pairs = splitExpression(source.slice(1, -1));
    if (pairs) {
      const entries: ExpressionEntry[] = [];
      for (const pair of pairs.filter(Boolean)) {
        const parts = splitExpression(pair, ":");
        if (!parts || parts.length !== 2) return { kind: "expression" };
        const key = stringLiteral(parts[0]);
        if (key === null || !parts[1] || entries.some((entry) => entry.key === key)) return { kind: "expression" };
        entries.push({ key, expression: parts[1] });
      }
      return { kind: "object", entries };
    }
  }
  if (source.startsWith("[") && source.endsWith("]")) {
    const items = splitExpression(source.slice(1, -1));
    // Comprehensions are calculations, not literal arrays.
    if (items && !items.some((item) => /\bfor\b/.test(item))) return { kind: "array", items: items.filter(Boolean) };
  }
  const csv = /^row\.get\((.*)\)$/.exec(source);
  if (csv) {
    const args = splitExpression(csv[1]);
    const key = args?.length && args.length <= 2 ? stringLiteral(args[0]) : null;
    if (key !== null) return { kind: "field", root: "row", path: key, fallback: args?.[1] };
  }
  const column = /^row\[(.*)\]$/.exec(source);
  if (column) {
    const key = stringLiteral(column[1]);
    if (key !== null) return { kind: "field", root: "row", path: key };
  }
  for (const [root] of DATA_SOURCES) {
    if (source.startsWith(`${root}.`) && /^[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*$/.test(source.slice(root.length + 1))) return { kind: "field", root, path: source.slice(root.length + 1) };
  }
  return { kind: "expression" };
}

export function fieldExpression(root: string, path: string, fallback?: string): string {
  return root === "row" ? `row.get(${JSON.stringify(path)}, ${fallback ?? "''"})` : `${root}.${path}`;
}

export function objectExpression(entries: ExpressionEntry[]): string {
  return `{${entries.map((entry) => `${JSON.stringify(entry.key)}: ${entry.expression}`).join(", ")}}`;
}

export function expressionSummary(expression: string): string {
  const shape = expressionShape(expression);
  switch (shape.kind) {
    case "field": return `${DATA_SOURCES.find(([root]) => root === shape.root)?.[1]} · ${shape.path}`;
    case "string": return shape.value || "空文本";
    case "number": return shape.value;
    case "boolean": return shape.value ? "是" : "否";
    case "null": return "未设置";
    case "object": return `对象 · ${shape.entries.length} 个字段`;
    case "array": return `列表 · ${shape.items.length} 项`;
    default: return "按计算规则生成";
  }
}

export function columnTitle(name: string, expression: string): string {
  return columnReferences(expression)[0]?.name ?? (name || "新字段");
}

export function columnReferences(expression: string): { name: string; start: number; end: number }[] {
  const result: { name: string; start: number; end: number }[] = [];
  for (let i = 0; i < expression.length; i++) {
    if ((i === 0 || !/\w/.test(expression[i - 1])) && expression.startsWith("row", i)) {
      const match = /^row(?:\.get\(\s*|\[\s*)('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/.exec(expression.slice(i));
      const name = match ? stringLiteral(match[1]) : null;
      if (match && name !== null) {
        const end = i + match[0].length;
        result.push({ name, start: end - match[1].length, end });
        i = end - 1;
        continue;
      }
    }
    if (expression[i] === "'" || expression[i] === '"') {
      const quote = expression[i++];
      for (; i < expression.length; i++) {
        if (expression[i] === "\\") i++;
        else if (expression[i] === quote) break;
      }
    }
  }
  return result;
}

export function replaceColumn(expression: string, oldName: string, newName: string): string {
  let result = expression;
  for (const ref of columnReferences(expression).reverse()) {
    if (ref.name === oldName) result = result.slice(0, ref.start) + JSON.stringify(newName) + result.slice(ref.end);
  }
  return result;
}

export function toDataLiteral(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (Array.isArray(value)) return `[${value.map(toDataLiteral).join(", ")}]`;
  if (typeof value === "object") return objectExpression(Object.entries(value).map(([key, item]) => ({ key, expression: toDataLiteral(item) })));
  return JSON.stringify(value);
}

export function fromDataLiteral(expression: string): unknown {
  const shape = expressionShape(expression);
  switch (shape.kind) {
    case "null": return null;
    case "string": case "boolean": return shape.value;
    case "number": { const value = Number(shape.value); if (!Number.isFinite(value)) throw new Error("配置数值必须有限"); return value; }
    case "array": return shape.items.map(fromDataLiteral);
    case "object": return Object.fromEntries(shape.entries.map((entry) => [entry.key, fromDataLiteral(entry.expression)]));
    default: throw new Error("工作流配置只能填写固定值，不能引用运行数据或执行表达式");
  }
}
