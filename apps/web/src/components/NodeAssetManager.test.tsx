import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NodePackageScanResult, NodeType } from "../types";
import { NodeAssetManager } from "./NodeAssetManager";
import { NodeFlowMantineProvider } from "./NodeFlowMantineProvider";

function nodeType(id: string, name: string, category: string, options: Partial<NodeType> = {}): NodeType {
  return {
    id,
    name,
    category,
    description: `${name}的说明。`,
    inputs: {},
    outputs: { success: { description: "success" } },
    configSchema: { type: "object", properties: {} },
    ...options,
  };
}

const nodeTypes: NodeType[] = [
  nodeType("local.weather", "查询天气", "本地", { sourcePath: "local/weather.py" }),
  nodeType("pkg.http_request", "HTTP 请求", "网络", {
    package: { id: "pkg-a", name: "Tools Pack", version: "1.2.0" },
    sourcePath: "packages/tools/http_request.py",
  }),
  nodeType("pkg.csv_read", "读取 CSV", "数据", {
    package: { id: "pkg-a", name: "Tools Pack", version: "1.2.0" },
    sourcePath: "packages/tools/csv_read.py",
  }),
];

const scan: NodePackageScanResult = {
  packages: [
    { id: "pkg-a", name: "Tools Pack", version: "1.2.0", status: "loaded", nodeIds: ["pkg.http_request", "pkg.csv_read"] },
    {
      id: "pkg-b",
      name: "Beta Pack",
      version: "0.9.0",
      status: "disabled",
      nodeIds: [],
      lifecycle: { managed: true, enabled: false, lockedVersion: null, versionStatus: "unlocked" },
    },
  ],
  diagnostics: [
    { code: "import_error", level: "error", message: "ImportError: 找不到模块 foo", path: "broken/legacy.py" },
  ],
  legacyNodeCount: 1,
};

function renderManager(overrides: Record<string, unknown> = {}) {
  const props = {
    nodeTypes,
    scan,
    onClose: vi.fn(),
    onRefresh: vi.fn(),
    onOpenSource: vi.fn(),
    ...overrides,
  };
  render(
    <NodeFlowMantineProvider>
      <NodeAssetManager {...props} />
    </NodeFlowMantineProvider>,
  );
  return props;
}

describe("NodeAssetManager", () => {
  afterEach(() => {
    cleanup();
  });

  it("groups local scripts and node packages with header metadata", () => {
    renderManager();

    const dialog = screen.getByRole("dialog", { name: "节点资产管理" });
    expect(within(dialog).getByText("3 个节点")).toBeInTheDocument();
    const localGroup = within(dialog).getByRole("region", { name: "本地脚本" });
    expect(within(localGroup).getAllByText("查询天气").length).toBeGreaterThan(0);
    const packageGroup = within(dialog).getByRole("region", { name: /Tools Pack/ });
    expect(within(packageGroup).getAllByText("HTTP 请求").length).toBeGreaterThan(0);
    expect(within(packageGroup).getAllByText("读取 CSV").length).toBeGreaterThan(0);
    expect(within(packageGroup).getByText("v1.2.0")).toBeInTheDocument();
  });

  it("filters nodes through the shared catalog search", () => {
    renderManager();

    fireEvent.change(screen.getByLabelText("搜索节点资产"), { target: { value: "CSV" } });
    expect(screen.getAllByText("读取 CSV").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("查询天气").length).toBe(0);
    expect(screen.queryAllByText("HTTP 请求").length).toBe(0);
  });

  it("shows only local scripts under the local tab", () => {
    renderManager();

    fireEvent.click(screen.getByRole("button", { name: /本地脚本 1/ }));
    expect(screen.getAllByText("查询天气").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("HTTP 请求").length).toBe(0);
  });

  it("lists diagnostics with open-file actions under the attention tab", () => {
    const { onOpenSource } = renderManager();

    fireEvent.click(screen.getByRole("button", { name: /有问题 1/ }));
    expect(screen.getByText("ImportError: 找不到模块 foo")).toBeInTheDocument();
    expect(screen.getByText("broken/legacy.py")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    expect(onOpenSource).toHaveBeenCalledWith("broken/legacy.py");
  });

  it("pins diagnostics on top in the all view and opens node sources", () => {
    const { onOpenSource } = renderManager();

    expect(screen.getByText("1 个脚本加载失败")).toBeInTheDocument();
    const openButtons = screen.getAllByRole("button", { name: "打开源文件" });
    fireEvent.click(openButtons[0]);
    expect(onOpenSource).toHaveBeenCalledWith("local/weather.py");
  });

  it("marks nodes without source files and supports rescanning", () => {
    const { onRefresh } = renderManager({
      nodeTypes: [nodeType("legacy.node", "遗留节点", "本地", { sourcePath: null })],
      scan: { packages: [], diagnostics: [], legacyNodeCount: 1 },
    });

    expect(screen.getByText("无源文件")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "打开源文件" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新扫描节点库" }));
    expect(onRefresh).toHaveBeenCalled();
  });

  it("closes via the close button", () => {
    const { onClose } = renderManager();
    fireEvent.click(screen.getByRole("button", { name: "关闭节点资产管理" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("selects nodes in the embedded asset workspace without navigating away", () => {
    const onSelectNode = vi.fn();
    renderManager({ embedded: true, selectedNodeTypeId: "local.weather", onSelectNode });

    const manager = screen.getByRole("region", { name: "节点资产管理" });
    const localNode = within(manager).getAllByText("查询天气")[0].closest("li");
    expect(localNode).toHaveAttribute("aria-current", "true");

    fireEvent.click(within(manager).getAllByText("HTTP 请求")[0]);
    expect(onSelectNode).toHaveBeenCalledWith("pkg.http_request");
  });
});
