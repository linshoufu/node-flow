import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ParameterDefinitionsEditor } from "./ParameterDefinitionsEditor";

describe("parameter definition form", () => {
  it("renders existing file and choice parameters as editable controls", () => {
    const html = renderToStaticMarkup(createElement(ParameterDefinitionsEditor, {
      value: [{ name: "csv_path", label: "采购文件", type: "file", default: "purchase.csv" },
        { name: "mode", label: "执行模式", type: "string", default: "preview", options: ["preview"] }],
      onChange: () => {},
    }));
    expect(html).toContain('value="purchase.csv"');
    expect(html).toContain('value="csv_path"');
    expect(html).toContain("添加参数");
    expect(html).toContain("添加选项");
    expect(html).toContain('value="preview"');
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain('&quot;name&quot;');
  });
});
