import { describe, expect, it } from "vitest";
import { describeSaveFailure } from "./saveFailure";

const conflictBody = 'API 409: {"detail":{"code":"workflow_version_conflict","message":"工作流已被其他操作更新，请重新加载后再继续。","expected_version":3,"current_version":5}}';

describe("describeSaveFailure", () => {
  it("classifies a workflow version conflict and keeps both versions", () => {
    const failure = describeSaveFailure(new Error(conflictBody));
    expect(failure.kind).toBe("conflict");
    expect(failure.status).toBe(409);
    expect(failure.expectedVersion).toBe(3);
    expect(failure.currentVersion).toBe(5);
    expect(failure.message).toBe("工作流已被其他操作更新，请重新加载后再继续。");
  });

  it("uses a plain-text detail from the API instead of the raw response", () => {
    const failure = describeSaveFailure(new Error('API 409: {"detail":"Webhook endpoint is already used by workflow: 订单"}'));
    expect(failure.kind).toBe("unknown");
    expect(failure.message).toBe("Webhook endpoint is already used by workflow: 订单");
  });

  it("falls back to the status code for a non-JSON response body", () => {
    const failure = describeSaveFailure(new Error("API 500: <html>Internal Server Error</html>"));
    expect(failure.kind).toBe("unknown");
    expect(failure.message).toBe("保存失败（HTTP 500）");
  });

  it("explains an unreachable backend and a timeout without exposing internals", () => {
    expect(describeSaveFailure(new Error("Failed to fetch")).kind).toBe("unreachable");
    expect(describeSaveFailure(new Error("Failed to fetch")).message).toContain("无法连接");
    const timeout = describeSaveFailure(new Error("API request timed out after 20000ms"));
    expect(timeout.kind).toBe("timeout");
    expect(timeout.message).toContain("超时");
  });

  it("clips an over-long server message", () => {
    const failure = describeSaveFailure(new Error(`API 400: {"detail":{"message":"${"错".repeat(400)}"}}`));
    expect(failure.message.length).toBeLessThanOrEqual(201);
  });
});
