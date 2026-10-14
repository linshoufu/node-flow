import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import type { SaveFailure } from "@/lib/saveFailure";
import { useWorkflowStore } from "@/store/workflow";
import { SaveFailureNotice, SaveFailureNoticeView } from "./SaveFailureNotice";

const noop = () => {};
const view = (failure: SaveFailure) => renderToStaticMarkup(createElement(SaveFailureNoticeView, {
  failure,
  onRetrySave: noop,
  onReloadFromServer: noop,
  onSaveAsCopy: noop,
  onDismiss: noop,
}));

describe("save failure notice", () => {
  beforeEach(() => {
    useWorkflowStore.setState({ saveError: null });
  });

  it("stays hidden while nothing has failed", () => {
    expect(renderToStaticMarkup(createElement(SaveFailureNotice))).toBe("");
  });

  it("explains a version conflict and offers both recovery paths", () => {
    const html = view({
      kind: "conflict",
      message: "工作流已被其他操作更新，请重新加载后再保存。",
      status: 409,
      expectedVersion: 6,
      currentVersion: 7,
    });

    expect(html).toContain("保存失败：版本冲突");
    expect(html).toContain("工作流已被其他操作更新，请重新加载后再保存。");
    expect(html).toContain("服务器当前版本 v7");
    expect(html).toContain("重新加载服务器版本");
    expect(html).toContain("另存为副本");
    expect(html).not.toContain("重试保存");
  });

  it("offers a retry for non-conflict failures", () => {
    const html = view({ kind: "unreachable", message: "无法连接到后端服务，请确认 API 正在运行后重试。" });

    expect(html).toContain("保存失败<");
    expect(html).toContain("无法连接到后端服务，请确认 API 正在运行后重试。");
    expect(html).toContain("重试保存");
    expect(html).not.toContain("另存为副本");
  });

  it("omits the version suffix when the server did not report one", () => {
    const html = view({ kind: "conflict", message: "工作流已被其他操作更新。" });

    expect(html).not.toContain("服务器当前版本");
    expect(html).toContain("另存为副本");
  });
});
