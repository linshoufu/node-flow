import { describe, expect, it } from "vitest";
import { columnTitle, expressionShape, fieldExpression, fromDataLiteral, objectExpression, replaceColumn, splitExpression, toDataLiteral } from "./dataExpressionPresentation";

describe("data expression presentation", () => {
  it("round-trips fixed workflow values while rejecting executable references", () => {
    const value = { location: { id: "仓库", enabled: true }, categories: [1, null, false], literal: "{{ secrets.password }}" };
    expect(fromDataLiteral(toDataLiteral(value))).toEqual(value);
    for (const expression of ["inputs.input", "decimal('1')", "__import__('os')", "1 + 2"]) {
      expect(() => fromDataLiteral(expression)).toThrow("固定值");
    }
  });
  it("reads object fields without executing or changing nested calculations", () => {
    const expression = "{'menuCode': inputs.input.header.menu, 'size': 200, 'filters': [{'key': 'code', 'value': inputs.input.header.code}], 'enabled': True}";
    const shape = expressionShape(expression);
    expect(shape.kind).toBe("object");
    if (shape.kind !== "object") throw new Error("Expected object");
    expect(shape.entries[0]).toEqual({ key: "menuCode", expression: "inputs.input.header.menu" });
    expect(expressionShape(shape.entries[2].expression).kind).toBe("array");
    expect(expressionShape(objectExpression(shape.entries))).toEqual(shape);
  });

  it("keeps commas, colons, brackets and escaped quotes inside strings", () => {
    const expression = String.raw`{'text': 'a,b:c[1] \'yes\'', 'path': 'C:\\data\\a.csv'}`;
    const shape = expressionShape(expression);
    expect(shape.kind).toBe("object");
    if (shape.kind !== "object") throw new Error("Expected object");
    expect(expressionShape(shape.entries[0].expression)).toEqual({ kind: "string", value: "a,b:c[1] 'yes'" });
    expect(expressionShape(shape.entries[1].expression)).toEqual({ kind: "string", value: "C:\\data\\a.csv" });
  });

  it("preserves CSV fallback values when editing source columns", () => {
    const shape = expressionShape("row.get('过账日期', None)");
    expect(shape).toEqual({ kind: "field", root: "row", path: "过账日期", fallback: "None" });
    expect(fieldExpression("row", "单据日期", "None")).toBe('row.get("单据日期", None)');
    expect(columnTitle("quantity", "decimal(row.get('数量')) if ensure(True) else None")).toBe("数量");
  });

  it("leaves unsupported or ambiguous syntax opaque", () => {
    for (const expression of ["{'x': 1, 'x': 2}", "{**inputs}", "[x for x in inputs.input]", "__import__('os')", "{'a': foo(1, 2)", "{'a': 1} or {'b': 2}", "{'a': 1, # keep comment\n'b': 2}"]) {
      expect(expressionShape(expression), expression).toEqual({ kind: "expression" });
    }
    expect(splitExpression("a, (b, c")).toBeNull();
  });

  it("keeps large identifiers and decimals as text", () => {
    expect(expressionShape("2102948214127009794")).toEqual({ kind: "number", value: "2102948214127009794" });
    expect(expressionShape("0.123456789012345678")).toEqual({ kind: "number", value: "0.123456789012345678" });
    expect(expressionShape("'None'")).toEqual({ kind: "string", value: "None" });
  });

  it("changes repeated CSV references while preserving validation and quoted messages", () => {
    const expression = `decimal(row.get('数量')) if ensure(decimal(row.get('数量')) > 0, "row.get('数量') must be positive") else None`;
    expect(replaceColumn(expression, "数量", "入库数量")).toBe(`decimal(row.get("入库数量")) if ensure(decimal(row.get("入库数量")) > 0, "row.get('数量') must be positive") else None`);
  });
});
