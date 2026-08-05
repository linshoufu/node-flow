import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DynamicInputListEditor } from "./DynamicInputListEditor";

const definition = {
  configKey: "sources",
  idKey: "id",
  labelKey: "label",
  input: { required: true },
  defaultItems: [
    { id: "input_1", label: "输入 1" },
    { id: "input_2", label: "输入 2" },
  ],
};

afterEach(cleanup);

describe("DynamicInputListEditor", () => {
  it("edits display names without exposing internal input ids", () => {
    const onChange = vi.fn();
    render(
      <DynamicInputListEditor definition={definition} label="命名输入" value={definition.defaultItems} onChange={onChange} onFocus={vi.fn()} />
    );

    expect(screen.getByLabelText("第 1 个输入的名称")).toHaveValue("输入 1");
    expect(screen.queryByText("input_1")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("第 1 个输入的名称"), { target: { value: "订单数据" } });
    expect(onChange).toHaveBeenCalledWith([
      { id: "input_1", label: "订单数据" },
      { id: "input_2", label: "输入 2" },
    ]);
  });

  it("adds inputs and protects an input that is still connected", () => {
    const onChange = vi.fn();
    render(
      <DynamicInputListEditor
        connectedInputHandles={["input_1"]}
        definition={definition}
        label="命名输入"
        value={definition.defaultItems}
        onChange={onChange}
        onFocus={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "删除 输入 1" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "添加输入" }));
    expect(onChange).toHaveBeenCalledWith([
      ...definition.defaultItems,
      { id: "input_3", label: "新输入" },
    ]);
  });
});
