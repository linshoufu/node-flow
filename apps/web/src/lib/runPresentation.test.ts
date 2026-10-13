import { describe, expect, it } from "vitest";
import type { RunEvent } from "@/types";
import { collectRunReport, resultMessage } from "./runPresentation";

const result = (index: number, status = "passed") => ({ name: "订单提交", assertion: "status_code", index, row: { reference: `row-${index}` }, status, expected: 201, actual: status === "passed" ? 201 : 404 });
const event = (id: number, node_id: string, success: unknown, scope: string[] = []): RunEvent => ({ id, run_id: "run_test", node_id, type: "node_succeeded", timestamp: "2026-10-13T10:00:00Z", scope, payload: { outputs: { success } } });
const report = (results: unknown[]) => ({ summary: { total: results.length }, results });

describe("run report presentation", () => {
  it("counts the final report once and links each row to its own preceding HTTP response", () => {
    const first = result(0);
    const second = { ...result(1, "failed"), assertion: "http_request", actual: { status_code: 404, body: '{"detail":"商品不存在"}' } };
    const response = event(1, "request", { status_code: 201, body: { id: "first" } }, ["loop", "iteration:0"]);
    const failure = { ...event(3, "request", null, ["loop", "iteration:1"]), payload: { outputs: { error: second.actual } } };
    const events = [response, event(2, "record", first, response.scope), failure, event(4, "record", second, failure.scope), event(5, "summary", report([first, second])), event(6, "write", { report: report([first, second]) })];
    const view = collectRunReport(events, { request: "http.request", record: "test.record_result", summary: "test.summary", write: "test.write_report" });
    expect(view).toMatchObject({ total: 2, passed: 1, failed: 1, complete: true });
    expect(view?.results.map((item) => item.responseEvent?.id)).toEqual([1, 3]);
    expect(view?.results[1]).toMatchObject({ statusCode: 404, message: "商品不存在", event: { id: 4 } });
  });
  it("shows incremental records while running without counting ordinary assertion outputs", () => {
    const view = collectRunReport([event(1, "assert", { status: "passed", actual: 201 }), event(2, "record", result(0))]);
    expect(view).toMatchObject({ total: 1, passed: 1, failed: 0, complete: false });
    expect(collectRunReport([event(1, "other", result(0))], { other: "utility.transform" })).toBeNull();
  });
  it("prefers a root report over a later nested summary and respects an empty final report", () => {
    const events = [event(1, "record", result(0)), event(2, "summary", report([result(0)])), event(3, "nested", report([result(1, "failed")]), ["child"])];
    expect(collectRunReport(events)).toMatchObject({ total: 1, passed: 1, failed: 0 });
    expect(collectRunReport([...events, event(4, "summary", report([]))])).toMatchObject({ total: 0, passed: 0, failed: 0, complete: true });
  });
  it("retains duplicate result records without linking them to a future response", () => {
    const same = result(0);
    const events = [event(1, "record", same), event(2, "record", same), event(3, "request", { status_code: 500 }), event(4, "summary", report([same, same]))];
    expect(collectRunReport(events)?.results.map((item) => [item.event?.id, item.responseEvent])).toEqual([[1, null], [2, null]]);
  });
  it("presents validation details and keeps generic numeric assertions separate from HTTP status", () => {
    expect(resultMessage({ status: "failed", actual: { body: { detail: [{ type: "greater_than_equal", loc: ["body", "quantity"], msg: "raw", ctx: { ge: 1 } }] } } })).toBe("quantity：需大于或等于 1");
    expect(collectRunReport([event(1, "record", { name: "数量", status: "passed", assertion: "equals", actual: 7 })])?.results[0].statusCode).toBeNull();
    expect(resultMessage({ status: "failed", actual: { body: "not JSON" }, message: "网络异常" })).toBe("网络异常");
  });
});
