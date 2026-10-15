import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Select, selectChoices } from "./Select";

describe("shared select", () => {
  it("preserves empty values, implicit option labels and disabled choices", () => {
    const choices = selectChoices(createElement(Fragment, null,
      createElement("option", { value: "" }, "不使用配置档"),
      [createElement("option", { key: "a", value: "profile-a" }, "配置档 A"),
        createElement("option", { key: "implicit", disabled: true }, "隐式值")],
    ));
    expect(choices).toEqual([
      { value: "", label: "不使用配置档", disabled: undefined },
      { value: "profile-a", label: "配置档 A", disabled: undefined },
      { value: "隐式值", label: "隐式值", disabled: true },
    ]);
  });

  it("renders the selected label as an accessible non-submitting control", () => {
    const onValueChange = vi.fn();
    const html = renderToStaticMarkup(createElement(Select, {
      id: "run-mode", "aria-label": "运行方式", value: "preview", required: true, name: "mode", onValueChange,
      children: [createElement("option", { key: "p", value: "preview" }, "预演"), createElement("option", { key: "l", value: "live" }, "正式执行")],
    }));
    expect(html).toContain('role="combobox"');
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-label="运行方式"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("预演");
    expect(onValueChange).not.toHaveBeenCalled();
  });
});
