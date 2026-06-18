import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasEmptyState, type CanvasTemplateCard } from "./CanvasEmptyState";

const templateCards: CanvasTemplateCard[] = [
  {
    id: "single-api-status-code",
    name: "单接口状态码断言",
    description: "发送一次 HTTP 请求，并断言响应状态码为 200。",
    tags: ["API", "HTTP"],
    nodeCount: 6,
    available: true,
  },
  {
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

    expect(screen.getByText("从测试模板开始")).toBeInTheDocument();
    expect(screen.getByText("单接口状态码断言")).toBeInTheDocument();
    expect(screen.getByText("CSV 参数化接口测试")).toBeInTheDocument();
    expect(screen.getByText("6 个节点")).toBeInTheDocument();
    expect(screen.getByText("8 个节点")).toBeInTheDocument();
    expect(screen.getByText("即将开放")).toBeInTheDocument();
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
});
