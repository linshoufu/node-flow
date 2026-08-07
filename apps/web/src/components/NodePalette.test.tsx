import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localizeNodeType } from "../lib/display";
import type { NodeType } from "../types";
import { NodePalette, buildNodeTypeSearchIndex, filterNodeTypes } from "./NodePalette";

const nodeTypes: NodeType[] = [
  nodeType("http.request", "HTTP 请求", "网络", "发送 HTTP 请求。"),
  nodeType("assert.status_code", "状态码断言", "断言", "检查响应状态码。"),
  nodeType("data.csv_read", "读取 CSV", "数据", "读取 CSV 行。"),
];

describe("NodePalette", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        clear: vi.fn(() => storage.clear()),
        getItem: vi.fn((key: string) => storage.get(key) ?? null),
        removeItem: vi.fn((key: string) => storage.delete(key)),
        setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
      },
    });
  });

  afterEach(() => {
    cleanup();
    const localStorageDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    if ("value" in (localStorageDescriptor ?? {}) && typeof localStorageDescriptor?.value?.clear === "function") {
      localStorageDescriptor.value.clear();
    }
  });

  it("offers a node library refresh action", () => {
    const onReloadNodeTypes = vi.fn();
    render(<NodePalette nodeTypes={nodeTypes} onAddNode={vi.fn()} onReloadNodeTypes={onReloadNodeTypes} />);

    fireEvent.click(screen.getByRole("button", { name: "刷新节点" }));

    expect(onReloadNodeTypes).toHaveBeenCalledTimes(1);
  });

  it("shows package provenance without exposing internal package ids", () => {
    render(
      <NodePalette
        nodeTypes={[
          {
            ...nodeTypes[0],
            package: { id: "example.tools", name: "工具集", version: "1.2.0" },
          },
        ]}
        onAddNode={vi.fn()}
      />,
    );

    // 包来源改在详情卡里展示：聚焦节点行后出现
    fireEvent.focus(screen.getByRole("button", { name: "HTTP 请求" }));
    expect(screen.getByText("工具集 v1.2.0")).toBeInTheDocument();
    expect(screen.queryByText("example.tools")).not.toBeInTheDocument();
  });

  it("labels nodes without package provenance as local scripts", () => {
    render(<NodePalette nodeTypes={nodeTypes} onAddNode={vi.fn()} />);

    fireEvent.focus(screen.getByRole("button", { name: "HTTP 请求" }));

    expect(screen.getAllByText("本地脚本").length).toBeGreaterThan(0);
  });

  it("disables the refresh action while node types are reloading", () => {
    render(
      <NodePalette
        isReloadingNodeTypes
        nodeTypes={nodeTypes}
        onAddNode={vi.fn()}
        onReloadNodeTypes={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "刷新节点" })).toBeDisabled();
  });

  it("disables node adding and refresh while the editor is locked", () => {
    const onAddNode = vi.fn();
    const onReloadNodeTypes = vi.fn();
    render(
      <NodePalette
        disabled
        nodeTypes={nodeTypes}
        onAddNode={onAddNode}
        onReloadNodeTypes={onReloadNodeTypes}
      />
    );

    expect(screen.getByRole("button", { name: "刷新节点" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "HTTP 请求" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "刷新节点" }));
    fireEvent.click(screen.getByRole("button", { name: "HTTP 请求" }));

    expect(onReloadNodeTypes).not.toHaveBeenCalled();
    expect(onAddNode).not.toHaveBeenCalled();
  });

  it("filters nodes by name, id, category, and description while keeping click add working", () => {
    const onAddNode = vi.fn();
    render(<NodePalette nodeTypes={nodeTypes} onAddNode={onAddNode} />);

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索节点" }), { target: { value: "HTTP" } });

    expect(screen.getByText("1 个")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "HTTP 请求" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "状态码断言" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "HTTP 请求" }));
    expect(onAddNode).toHaveBeenCalledWith(nodeTypes[0]);

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索节点" }), { target: { value: "断言" } });

    expect(screen.getByText("1 个")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "状态码断言" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "HTTP 请求" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索节点" }), { target: { value: "响应状态码" } });
    expect(screen.getByRole("button", { name: "状态码断言" })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索节点" }), { target: { value: "http.request" } });
    expect(screen.getByRole("button", { name: "HTTP 请求" })).toBeInTheDocument();
  });

  it("shows an empty state when no node matches the search", () => {
    render(<NodePalette nodeTypes={nodeTypes} onAddNode={vi.fn()} />);

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索节点" }), { target: { value: "不存在" } });

    expect(screen.getByText("0 个")).toBeInTheDocument();
    expect(screen.getByText("没有匹配的节点。")).toBeInTheDocument();
  });

  it("shows product metadata and searches tags and keywords", () => {
    render(
      <NodePalette
        nodeTypes={[
          {
            ...nodeTypes[0],
            displayName: "接口请求",
            group: "action",
            icon: "globe",
            tags: ["推荐", "网络"],
            keywords: ["rest", "api"],
          },
          nodeTypes[1],
        ]}
        onAddNode={vi.fn()}
      />,
    );

    expect(screen.getByText("接口请求")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "接口请求 推荐 网络" })).toBeInTheDocument();

    // 单行化后，标签等详情在悬停/聚焦的详情卡里展示
    const productNode = screen.getByRole("button", { name: "接口请求 推荐 网络" });
    fireEvent.focus(productNode);
    expect(screen.getByText("推荐")).toBeInTheDocument();
    fireEvent.blur(productNode);
    expect(screen.queryByText("推荐")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索节点" }), { target: { value: "rest" } });

    expect(screen.getByText("1 个")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "接口请求 推荐 网络" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "状态码断言" })).not.toBeInTheDocument();
  });

  it("renders node type icons from product metadata without changing the node button name", () => {
    render(
      <NodePalette
        nodeTypes={[
          {
            ...nodeTypes[0],
            displayName: "接口请求",
            group: "action",
            icon: "globe",
            tags: ["网络"],
          },
          {
            ...nodeTypes[1],
            icon: "vendor-custom",
          },
        ]}
        onAddNode={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "接口请求 网络" })).toBeInTheDocument();
    expect(screen.getByTitle("节点图标：globe")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "状态码断言" })).toBeInTheDocument();
    expect(screen.getByTitle("节点图标：vendor-custom")).toBeInTheDocument();
  });

  it("searches raw metadata aliases after node labels are localized for display", () => {
    render(
      <NodePalette
        nodeTypes={[
          localizeNodeType({
            ...nodeTypes[0],
            category: "Network",
            tags: ["http", "api", "network"],
            keywords: ["request", "rest"],
          }),
          localizeNodeType({
            ...nodeTypes[1],
            category: "Assertions",
            tags: ["assertion", "testing"],
            keywords: ["status"],
          }),
        ]}
        onAddNode={vi.fn()}
      />,
    );

    const httpNode = screen.getByRole("button", { name: "HTTP 请求 HTTP 接口 网络" });
    fireEvent.focus(httpNode);
    const previewCard = document.querySelector(".palette-node-preview");
    expect(previewCard).not.toBeNull();
    expect(within(previewCard as HTMLElement).getByText("HTTP")).toBeInTheDocument();
    expect(within(previewCard as HTMLElement).getByText("接口")).toBeInTheDocument();
    expect(within(previewCard as HTMLElement).getByText("网络")).toBeInTheDocument();
    fireEvent.blur(httpNode);

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索节点" }), { target: { value: "network" } });

    expect(screen.getByText("1 个")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "HTTP 请求 HTTP 接口 网络" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "状态码断言 断言 测试" })).not.toBeInTheDocument();
  });

  it("shows node port contract summaries before adding nodes", () => {
    render(
      <NodePalette
        nodeTypes={[
          {
            ...nodeTypes[0],
            group: "action",
            inputs: {
              body: { required: true, description: "请求体" },
              headers: { maxConnections: null, description: "多个请求头来源" },
            },
            outputs: {
              success: { description: "响应" },
              error: { description: "错误" },
            },
          },
          nodeType("manual.trigger", "手动触发", "触发器", "手动启动工作流。", "trigger"),
        ]}
        onAddNode={vi.fn()}
      />
    );

    // 端口契约摘要改在详情卡里展示：聚焦对应节点行后出现
    fireEvent.focus(screen.getByRole("button", { name: "HTTP 请求" }));
    expect(screen.getByText("动作 · 输入 2 · 输出 2 · 必填输入 1 · 支持多连接")).toBeInTheDocument();
    fireEvent.focus(screen.getByRole("button", { name: "手动触发" }));
    expect(screen.getByText("触发器 · 输入 0 · 输出 1")).toBeInTheDocument();
  });

  it("将通用编排类别排在测试类别之前", () => {
    render(
      <NodePalette
        nodeTypes={[
          nodeType("test.record", "记录测试结果", "测试", "记录测试结果。"),
          nodeType("manual.trigger", "手动触发", "触发器", "手动启动工作流。"),
          nodeType("data.extract", "提取值", "数据", "从输入数据中提取值。"),
        ]}
        onAddNode={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual([
      "触发器",
      "数据",
      "测试",
    ]);
  });

  it("searches node port contract summary text", () => {
    render(
      <NodePalette
        nodeTypes={[
          {
            ...nodeTypes[0],
            group: "action",
            inputs: {
              input: { required: true, maxConnections: 2 },
            },
            outputs: {
              success: { description: "success" },
            },
          },
          nodeType("manual.trigger", "手动触发", "触发器", "手动启动工作流。", "trigger"),
        ]}
        onAddNode={vi.fn()}
      />
    );

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索节点" }), { target: { value: "多连接" } });

    expect(screen.getByText("1 个")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "HTTP 请求" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "手动触发" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索节点" }), { target: { value: "触发器" } });

    expect(screen.getByText("1 个")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "手动触发" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "HTTP 请求" })).not.toBeInTheDocument();
  });

  it("does not expose internal node type ids as visible palette card text", () => {
    render(<NodePalette nodeTypes={nodeTypes} onAddNode={vi.fn()} />);

    expect(screen.getByRole("button", { name: "HTTP 请求" })).toBeInTheDocument();
    expect(screen.queryByText("http.request")).not.toBeInTheDocument();
  });

  it("filters nodes by product group and combines the group filter with search", () => {
    render(
      <NodePalette
        nodeTypes={[
          { ...nodeTypes[0], group: "action", tags: ["网络"], keywords: ["rest"] },
          { ...nodeTypes[1], group: "action", tags: ["断言"], keywords: ["status"] },
          nodeType("manual.trigger", "手动触发", "触发器", "手动启动工作流。", "trigger"),
          nodeType("control.foreach", "遍历循环", "控制", "逐项执行循环体。", "control"),
        ]}
        onAddNode={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "触发器 1" }));

    expect(screen.getByText("1 个")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "手动触发" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "HTTP 请求 网络" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "控制 1" }));

    expect(screen.getByRole("button", { name: "遍历循环" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "手动触发" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "操作 2" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索节点" }), { target: { value: "status" } });

    expect(screen.getByText("1 个")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "状态码断言 断言" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "HTTP 请求 网络" })).not.toBeInTheDocument();
  });

  it("collapses and expands category groups and persists the preference", () => {
    render(<NodePalette nodeTypes={nodeTypes} onAddNode={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "折叠 网络 分组" }));

    expect(screen.queryByRole("button", { name: "HTTP 请求" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "展开 网络 分组" })).toHaveAttribute("aria-expanded", "false");
    expect(window.localStorage.getItem("node-flow.palette-collapsed-categories")).toBe(JSON.stringify(["网络"]));

    fireEvent.click(screen.getByRole("button", { name: "展开 网络 分组" }));

    expect(screen.getByRole("button", { name: "HTTP 请求" })).toBeInTheDocument();
    expect(window.localStorage.getItem("node-flow.palette-collapsed-categories")).toBe(JSON.stringify([]));
  });

  it("keeps matching nodes visible while searching even if their category is collapsed", () => {
    window.localStorage.setItem("node-flow.palette-collapsed-categories", JSON.stringify(["网络"]));
    render(<NodePalette nodeTypes={nodeTypes} onAddNode={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "HTTP 请求" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索节点" }), { target: { value: "HTTP" } });

    expect(screen.getByRole("button", { name: "HTTP 请求" })).toBeInTheDocument();
  });

  it("adds the selected node from search results with keyboard navigation", () => {
    const onAddNode = vi.fn();
    render(<NodePalette nodeTypes={nodeTypes} onAddNode={onAddNode} />);

    const searchInput = screen.getByRole("searchbox", { name: "搜索节点" });
    fireEvent.change(searchInput, { target: { value: "e" } });
    fireEvent.keyDown(searchInput, { key: "ArrowDown" });
    fireEvent.keyDown(searchInput, { key: "Enter" });

    expect(onAddNode).toHaveBeenCalledWith(nodeTypes[1]);
  });

  it("clears the search with the dedicated clear button", () => {
    render(<NodePalette nodeTypes={nodeTypes} onAddNode={vi.fn()} />);

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索节点" }), { target: { value: "HTTP" } });
    expect(screen.getByText("1 个")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "清空搜索" }));

    expect(screen.getByText("3 个")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "读取 CSV" })).toBeInTheDocument();
  });

  it("records recently used nodes and filters them with search", () => {
    const onAddNode = vi.fn();
    render(<NodePalette nodeTypes={nodeTypes} onAddNode={onAddNode} />);

    expect(screen.getByRole("button", { name: "最近 0" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "读取 CSV" }));
    fireEvent.click(screen.getByRole("button", { name: "HTTP 请求" }));
    fireEvent.click(screen.getByRole("button", { name: "最近 2" }));

    expect(screen.getByText("2 个")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "HTTP 请求" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "读取 CSV" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "状态码断言" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索节点" }), { target: { value: "CSV" } });

    expect(screen.getByText("1 个")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "读取 CSV" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "HTTP 请求" })).not.toBeInTheDocument();
    expect(onAddNode).toHaveBeenCalledTimes(2);
  });

  it("keeps the full node list visible when recent storage only contains stale node type ids", () => {
    window.localStorage.setItem("node-flow.recent-node-types", JSON.stringify(["old.removed_node"]));

    render(<NodePalette nodeTypes={nodeTypes} onAddNode={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "最近 0" }));

    expect(screen.getByRole("button", { name: "全部 3" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("3 个")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "HTTP 请求" })).toBeInTheDocument();
    expect(screen.queryByText("没有匹配的节点。")).not.toBeInTheDocument();
  });

  it("does not touch Node experimental WebStorage in test-like runtimes", () => {
    const emitWarning = vi.spyOn(process, "emitWarning").mockImplementation(() => false);
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        process.emitWarning("`--localstorage-file` was provided without a valid path", "Warning");
        return {
          clear: vi.fn(),
          getItem: vi.fn(() => null),
          removeItem: vi.fn(),
          setItem: vi.fn(),
        };
      },
    });

    render(<NodePalette nodeTypes={nodeTypes} onAddNode={vi.fn()} />);

    expect(screen.getByRole("button", { name: "最近 0" })).toBeInTheDocument();
    expect(emitWarning).not.toHaveBeenCalled();
    emitWarning.mockRestore();
  });

  it("filters with a prebuilt search index exactly like the on-demand path", () => {
    const searchIndex = buildNodeTypeSearchIndex(nodeTypes);

    // 预建索引与实时拼接路径的过滤结果保持一致（含大小写归一化）
    expect(filterNodeTypes(nodeTypes, "HTTP", searchIndex)).toEqual([nodeTypes[0]]);
    expect(filterNodeTypes(nodeTypes, "状态码", searchIndex)).toEqual([nodeTypes[1]]);
    expect(filterNodeTypes(nodeTypes, "  ", searchIndex)).toEqual(nodeTypes);
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
