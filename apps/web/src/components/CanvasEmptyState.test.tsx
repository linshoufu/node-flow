import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasEmptyState, type CanvasTemplateCard } from "./CanvasEmptyState";

const templateCards: CanvasTemplateCard[] = [
  {
    category: "testing",
    id: "single-api-status-code",
    name: "单接口状态码断言",
    description: "发送一次 HTTP 请求，并断言响应状态码为 200。",
    tags: ["API", "HTTP"],
    nodeCount: 6,
    available: true,
  },
  {
    category: "testing",
    id: "csv-parameterized-api",
    name: "CSV 参数化接口测试",
    description: "读取 CSV 用例列表，逐行请求对应 URL。",
    tags: ["API", "CSV"],
    nodeCount: 8,
    available: false,
    unavailableReason: "即将开放",
  },
];

describe("CanvasEmptyState", () => {
  afterEach(cleanup);

  it("renders the Chinese title and template cards", () => {
    render(<CanvasEmptyState templates={templateCards} onApplyTemplate={vi.fn()} />);

    expect(screen.getByText("从模板开始")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "测试工作流" })).toBeInTheDocument();
    expect(screen.getByText("单接口状态码断言")).toBeInTheDocument();
    expect(screen.getByText("CSV 参数化接口测试")).toBeInTheDocument();
    expect(screen.getByText("6 个节点")).toBeInTheDocument();
    expect(screen.getByText("8 个节点")).toBeInTheDocument();
    expect(screen.getByText("即将开放")).toBeInTheDocument();
  });

  it("分开呈现通用与测试模板", () => {
    render(
      <CanvasEmptyState
        templates={[
          {
            category: "general",
            id: "manual-data-flow",
            name: "手动处理数据",
            description: "从手动输入开始处理数据。",
            tags: ["通用"],
            nodeCount: 2,
            available: true,
          },
          ...templateCards,
        ]}
        onApplyTemplate={vi.fn()}
      />
    );

    expect(screen.getByRole("heading", { name: "通用工作流" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "测试工作流" })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "手动处理数据" })).toBeInTheDocument();
  });

  it("applies an available template from its card button", () => {
    const onApplyTemplate = vi.fn();
    render(<CanvasEmptyState templates={templateCards} onApplyTemplate={onApplyTemplate} />);

    const card = screen.getByRole("article", { name: "单接口状态码断言" });
    fireEvent.click(within(card).getByRole("button", { name: "使用模板" }));

    expect(onApplyTemplate).toHaveBeenCalledWith("single-api-status-code");
  });

  it("disables unavailable template buttons and shows the reason", () => {
    render(<CanvasEmptyState templates={templateCards} onApplyTemplate={vi.fn()} />);

    const card = screen.getByRole("article", { name: "CSV 参数化接口测试" });
    expect(within(card).getByRole("button", { name: "即将开放" })).toBeDisabled();
  });

  it("呈现双击搜索节点的高效操作提示", () => {
    render(<CanvasEmptyState templates={templateCards} onApplyTemplate={vi.fn()} />);

    expect(
      screen.getByText("高效操作：双击画布空白处可快速搜索并添加节点，按 Ctrl+K 可打开命令面板。"),
    ).toBeInTheDocument();
  });
});
