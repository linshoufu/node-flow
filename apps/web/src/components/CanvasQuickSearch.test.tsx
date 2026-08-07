import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NodeType } from "../types";
import { CanvasQuickSearch } from "./CanvasQuickSearch";

const nodeTypes: NodeType[] = [
  nodeType("manual.trigger", "手动触发", "触发器", "手动启动工作流。", "trigger"),
  nodeType("http.request", "HTTP 请求", "网络", "发送 HTTP 请求。"),
  nodeType("data.csv_read", "读取 CSV", "数据", "读取 CSV 行。"),
];

function renderQuickSearch(overrides: Partial<ComponentProps<typeof CanvasQuickSearch>> = {}) {
  const onAdd = vi.fn();
  const onClose = vi.fn();
  render(
    <CanvasQuickSearch
      nodeTypes={nodeTypes}
      screenPosition={{ x: 200, y: 160 }}
      onAdd={onAdd}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { onAdd, onClose };
}

describe("CanvasQuickSearch", () => {
  afterEach(() => {
    cleanup();
  });

  it("focuses the search input and lists node candidates", () => {
    renderQuickSearch();

    const input = screen.getByRole("searchbox", { name: "搜索节点" });
    expect(input).toHaveFocus();
    expect(screen.getByRole("button", { name: "手动触发" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "HTTP 请求" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "读取 CSV" })).toBeInTheDocument();
  });

  it("filters candidates while typing and shows an empty state", () => {
    renderQuickSearch();

    const input = screen.getByRole("searchbox", { name: "搜索节点" });
    fireEvent.change(input, { target: { value: "HTTP" } });

    expect(screen.getByRole("button", { name: "HTTP 请求" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "手动触发" })).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "不存在" } });
    expect(screen.getByText("没有匹配的节点。")).toBeInTheDocument();
  });

  it("adds the active result with Enter and closes", () => {
    const { onAdd, onClose } = renderQuickSearch();

    const input = screen.getByRole("searchbox", { name: "搜索节点" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onAdd).toHaveBeenCalledWith(nodeTypes[0]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("moves the selection with arrow keys", () => {
    const { onAdd } = renderQuickSearch();

    const input = screen.getByRole("searchbox", { name: "搜索节点" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onAdd).toHaveBeenCalledWith(nodeTypes[1]);
  });

  it("closes with Escape", () => {
    const { onAdd, onClose } = renderQuickSearch();

    fireEvent.keyDown(screen.getByRole("searchbox", { name: "搜索节点" }), { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("adds a candidate on click", () => {
    const { onAdd, onClose } = renderQuickSearch();

    fireEvent.click(screen.getByRole("button", { name: "读取 CSV" }));

    expect(onAdd).toHaveBeenCalledWith(nodeTypes[2]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when clicking outside the panel", () => {
    const { onClose } = renderQuickSearch();

    fireEvent.pointerDown(document.body);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the panel inside the viewport when the double-click point is near the edge", () => {
    renderQuickSearch({ screenPosition: { x: 5000, y: 5000 } });

    const panel = screen.getByRole("dialog", { name: "快速添加节点" });
    const left = Number.parseInt(panel.style.left, 10);
    const top = Number.parseInt(panel.style.top, 10);

    expect(left).toBeLessThan(window.innerWidth);
    expect(top).toBeLessThan(window.innerHeight);
  });
});

function nodeType(id: string, name: string, category: string, description: string, group?: string): NodeType {
  return {
    id,
    name,
    category,
    group,
    description,
    inputs: {},
    outputs: { success: { description: "success" } },
    configSchema: { type: "object", properties: {} },
  };
}
