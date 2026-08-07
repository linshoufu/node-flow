import { describe, expect, it } from "vitest";
import { formatApiError, isWorkflowVersionConflict, parseApiError } from "./apiError";

describe("formatApiError", () => {
  it("extracts Chinese API detail messages", () => {
    expect(formatApiError(new Error('API 409: {"detail":{"message":"资源正在使用中。"}}'))).toBe(
      "资源正在使用中。",
    );
    expect(formatApiError(new Error('API 422: {"detail":[{"message":"名称无效"},{"message":"值无效"}]}'))).toBe(
      "名称无效；值无效",
    );
  });

  it("keeps ordinary and malformed errors readable", () => {
    expect(formatApiError(new Error("网络连接失败"))).toBe("网络连接失败");
    expect(formatApiError(new Error("API 500: not-json"))).toBe(
      "服务暂时不可用，请稍后重试（API 500: not-json）",
    );
  });

  it("parses structured workflow version conflicts", () => {
    const error = new Error('API 409: {"detail":{"code":"workflow_version_conflict","message":"版本冲突","expected_version":3,"current_version":4}}');

    expect(parseApiError(error)).toEqual({
      code: "workflow_version_conflict",
      currentVersion: 4,
      expectedVersion: 3,
      message: "版本冲突",
      status: 409,
    });
    expect(isWorkflowVersionConflict(error)).toBe(true);
    expect(isWorkflowVersionConflict(new Error("API 409: conflict"))).toBe(false);
  });
});

describe("网络层错误兜底文案", () => {
  it("为 Failed to fetch 错误附加中文友好提示", () => {
    expect(formatApiError(new Error("Failed to fetch"))).toBe(
      "无法连接到服务，请检查后端是否已启动（Failed to fetch）",
    );
  });

  it("为 Safari 风格的 Load failed 错误附加中文友好提示", () => {
    expect(formatApiError(new Error("Load failed"))).toBe(
      "无法连接到服务，请检查后端是否已启动（Load failed）",
    );
  });

  it("为 NetworkError 风格的错误附加中文友好提示", () => {
    expect(formatApiError(new Error("NetworkError when attempting to fetch resource."))).toBe(
      "无法连接到服务，请检查后端是否已启动（NetworkError when attempting to fetch resource.）",
    );
  });

  it("保持普通无前缀错误原样透出", () => {
    expect(formatApiError(new Error("offline"))).toBe("offline");
  });

  it("网络层错误解析结果的 status 保持为 null", () => {
    expect(parseApiError(new Error("Failed to fetch")).status).toBeNull();
  });
});

describe("5xx 兜底文案", () => {
  it("为响应体无法解析的 5xx 错误提供服务不可用提示", () => {
    expect(formatApiError(new Error("API 503: upstream exploded"))).toBe(
      "服务暂时不可用，请稍后重试（API 503: upstream exploded）",
    );
  });

  it("保持 4xx 非结构化错误的原始文案", () => {
    expect(formatApiError(new Error("API 404: not-json"))).toBe("API 404: not-json");
  });

  it("保持 5xx 结构化 detail 文案不变", () => {
    expect(formatApiError(new Error('API 500: {"detail":{"message":"内部处理异常。"}}'))).toBe(
      "内部处理异常。",
    );
  });

  it("5xx 兜底分支仍保留解析出的状态码", () => {
    expect(parseApiError(new Error("API 502: bad-gateway")).status).toBe(502);
  });
});
