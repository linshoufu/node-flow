import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DynamicOutputListEditor } from "./DynamicOutputListEditor";

const definition = {
  configKey: "rules",
  idKey: "id",
  labelKey: "label",
  output: {},
  defaultItems: [
    { id: "route_1", label: "匹配值 1", value: "value_1" },
    { id: "route_2", label: "匹配值 2", value: "value_2" },
  ],
};

afterEach(cleanup);

describe("DynamicOutputListEditor", () => {
  it("renders rule names and values without exposing internal port ids", () => {
    render(
      <DynamicOutputListEditor
        definition={definition}
        label="路由规则"
        value={definition.defaultItems}
        onChange={vi.fn()}
        onFocus={vi.fn()}
      />
    );

    expect(screen.getByLabelText("第 1 条规则的分支名称")).toHaveValue("匹配值 1");
    expect(screen.getByLabelText("第 2 条规则的匹配值")).toHaveValue("value_2");
    expect(screen.queryByText("route_1")).not.toBeInTheDocument();
  });

  it("updates a rule while preserving its stable port id", () => {
    const onChange = vi.fn();
    render(
      <DynamicOutputListEditor
        definition={definition}
        label="路由规则"
        value={definition.defaultItems}
        onChange={onChange}
        onFocus={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("第 1 条规则的分支名称"), { target: { value: "已批准" } });
    fireEvent.change(screen.getByLabelText("第 2 条规则的匹配值"), { target: { value: "42" } });

    expect(onChange).toHaveBeenNthCalledWith(1, [
      { id: "route_1", label: "已批准", value: "value_1" },
      { id: "route_2", label: "匹配值 2", value: "value_2" },
    ]);
    expect(onChange).toHaveBeenNthCalledWith(2, [
      { id: "route_1", label: "匹配值 1", value: "value_1" },
      { id: "route_2", label: "匹配值 2", value: 42 },
    ]);
  });

  it("adds an available branch id and keeps at least one rule", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <DynamicOutputListEditor
        definition={definition}
        label="路由规则"
        value={definition.defaultItems}
        onChange={onChange}
        onFocus={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "添加分支" }));
    expect(onChange).toHaveBeenLastCalledWith([
      ...definition.defaultItems,
      { id: "route_3", label: "新分支", value: "" },
    ]);

    rerender(
      <DynamicOutputListEditor
        definition={definition}
        label="路由规则"
        value={[definition.defaultItems[0]]}
        onChange={onChange}
        onFocus={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: "删除 匹配值 1" })).toBeDisabled();
  });

  it("protects a branch that is still connected on the canvas", () => {
    render(
      <DynamicOutputListEditor
        connectedOutputHandles={["route_1"]}
        definition={definition}
        label="路由规则"
        value={definition.defaultItems}
        onChange={vi.fn()}
        onFocus={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "删除 匹配值 1" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "删除 匹配值 1" })).toHaveAttribute(
      "title",
      "该分支已连接到下游节点，请先删除或改接连线"
    );
    expect(screen.getByText("已连接的分支不能删除，请先在画布上删除或改接相关连线。")).toBeInTheDocument();
  });
});
