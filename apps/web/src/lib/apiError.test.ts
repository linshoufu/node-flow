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
    expect(formatApiError(new Error("API 500: not-json"))).toBe("API 500: not-json");
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
