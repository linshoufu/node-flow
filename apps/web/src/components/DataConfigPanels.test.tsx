import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ComposeConfigEditor } from "./ComposeConfigEditor";
import { DataRulesEditor } from "./DataRulesEditor";
import { GroupFieldsEditor } from "./GroupFieldsEditor";

describe("simplified data configuration panels", () => {
  it("renders a single common-field list and preserves legacy bindings until explicitly changed", () => {
    const onChange = vi.fn();
    const config = { by: ["key"], header_fields: ["key", "currency"] };
    const html = renderToStaticMarkup(createElement(GroupFieldsEditor, { config, onChange }));
    expect(html).toContain("公共字段");
    expect(html).toContain("差异处理");
    expect(html).not.toContain("表头字段");
    expect(html).not.toContain("textarea");
    expect(onChange).not.toHaveBeenCalled();
    const bound = renderToStaticMarkup(createElement(GroupFieldsEditor, { config, bindings: { by: { source: "workflow", key: "keys" } }, onChange }));
    expect(bound).toContain("仍引用旧版分组配置");
    expect(bound).not.toContain("添加公共字段");
  });
  it("presents a legacy object expression as output fields without showing source", () => {
    const onChange = vi.fn();
    const config = { output: "{'menuCode': inputs.input.header.menu, 'size': 200}", rules: [], fields: [] };
    const before = structuredClone(config);
    const html = renderToStaticMarkup(createElement(ComposeConfigEditor, { config, onChange }));
    expect(html).toContain("menuCode");
    expect(html).toContain("编辑输出内容");
    expect(html).toContain("2 个字段");
    expect(html).not.toContain("inputs.input.header.menu");
    expect(html).not.toContain("textarea");
    expect(onChange).not.toHaveBeenCalled();
    expect(config).toEqual(before);
  });

  it("shows CSV names and types instead of expanded implementation fields", () => {
    const html = renderToStaticMarkup(createElement(DataRulesEditor, { columns: true, label: "字段映射", value: [{ name: "posting_date", expression: "row.get('过账日期', '')", type: "date", required: true }], onChange: vi.fn() }));
    expect(html).toContain("过账日期");
    expect(html).toContain("日期");
    expect(html).not.toContain("posting_date");
    expect(html).not.toContain("textarea");
    expect(html).toContain('aria-expanded="false"');
  });
});
