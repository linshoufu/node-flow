import { describe, expect, it } from "vitest";
import { detectToastTone } from "./toastTone";

describe("detectToastTone", () => {
  it("将包含“失败”的文案判定为 error", () => {
    expect(detectToastTone("节点类型加载失败：无法连接到服务。")).toBe("error");
  });

  it("将包含“错误”的文案判定为 error", () => {
    expect(detectToastTone("保存时发生错误，请重试。")).toBe("error");
  });

  it("将包含“无法”的文案判定为 error", () => {
    expect(detectToastTone("无法打开源文件“demo.py”。")).toBe("error");
  });

  it("将包含“冲突”的文案判定为 error", () => {
    expect(detectToastTone("保存冲突，请先拉取最新版本。")).toBe("error");
  });

  it("将包含“未能”的文案判定为 error", () => {
    expect(detectToastTone("已加载 2 个节点，但未能获取节点包状态。")).toBe("error");
  });

  it("将包含“成功”的文案判定为 success", () => {
    expect(detectToastTone("验证成功，未发现配置问题。")).toBe("success");
  });

  it("将包含“已保存”的文案判定为 success", () => {
    expect(detectToastTone("已保存 v3。")).toBe("success");
  });

  it("将包含“已完成”的文案判定为 success", () => {
    expect(detectToastTone("节点扫描已完成。")).toBe("success");
  });

  it("将包含“已加载”的文案判定为 success", () => {
    expect(detectToastTone("已加载 8 个节点类型。")).toBe("success");
  });

  it("错误关键词优先于成功关键词", () => {
    expect(detectToastTone("已加载 2 个节点，但加载节点包失败。")).toBe("error");
  });

  it("将不含任何关键词的文案判定为 info", () => {
    expect(detectToastTone("正在重新扫描 Python 节点...")).toBe("info");
  });

  it("将普通引导文案判定为 info", () => {
    expect(detectToastTone("请先复制 Node Flow 节点。")).toBe("info");
  });
});
