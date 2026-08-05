import { describe, expect, it } from "vitest";
import {
  buildRuntimeInsight,
  eventTypeLabel,
  formatCompactUnknown,
  formatRuntimeTime,
  formatScope,
  formatScopePart,
  formatUnknown,
  isPlainObject,
  logFields,
  logLevel,
  logLevelClass,
  logMessage,
  logTimestamp,
  nodeRunStatusLabel,
  runtimeSearchMatchCount,
  runtimeValueMatches,
} from "./runtimeDisplay";
import type { NodeRuntimeState } from "./runState";

describe("runtimeDisplay", () => {
  it("formats runtime status, scope, time, and JSON values", () => {
    expect(nodeRunStatusLabel("running")).toBe("运行中");
    expect(nodeRunStatusLabel("cancelled")).toBe("已取消");
    expect(eventTypeLabel("node_pinned_data_used")).toBe("已使用固定输出");
    expect(formatScopePart("iteration:2")).toBe("第 3 轮");
    expect(formatScopePart("branch:true")).toBe("branch:true");
    expect(formatScope([])).toBe("主流程");
    expect(formatScope(["loop", "iteration:0"])).toBe("loop / 第 1 轮");
    expect(formatRuntimeTime("not-a-date")).toBe("not-a-date");
    expect(formatUnknown({ ok: true })).toBe(`{\n  "ok": true\n}`);
    expect(formatCompactUnknown({ ok: true })).toBe('{"ok":true}');
    expect(isPlainObject({ ok: true })).toBe(true);
    expect(isPlainObject(["no"])).toBe(false);
  });

  it("extracts log display fields from structured and unstructured logs", () => {
    const structured = {
      level: "warning",
      message: "slow request",
      timestamp: "2026-06-22T10:00:00Z",
      fields: { status: 408 },
    };

    expect(logLevel(structured)).toBe("warning");
    expect(logLevelClass(structured)).toBe("is-warning");
    expect(logMessage(structured)).toBe("slow request");
    expect(logTimestamp(structured)).toBe("2026-06-22T10:00:00Z");
    expect(logFields(structured)).toEqual({ status: 408 });
    expect(logLevel("plain log")).toBe("log");
    expect(logMessage("plain log")).toBe("plain log");
  });

  it("counts runtime search matches across executions, logs, and errors", () => {
    const runtimeState: NodeRuntimeState = {
      nodeId: "request",
      status: "failed",
      logs: [
        { level: "info", message: "Alice passed" },
        { level: "error", message: "Bob failed", fields: { status: 500 } },
      ],
      error: { message: "Bob error" },
      outputs: { success: [{ name: "Alice" }, { name: "Bob" }] },
      scopes: [[]],
      executions: [
        {
          runIndex: 0,
          status: "failed",
          scope: [],
          inputs: { source: "csv" },
          outputs: {
            success: {
              name: "success",
              value: [{ name: "Alice" }, { name: "Bob" }],
              items: [{ json: { name: "Alice" } }, { json: { name: "Bob" } }],
            },
          },
          durationMs: 10,
          events: [],
        },
        {
          runIndex: 1,
          status: "succeeded",
          scope: ["each", "iteration:0"],
          inputs: { source: "csv" },
          outputs: {
            success: {
              name: "success",
              value: { ok: true },
              items: [{ json: { ok: true } }],
            },
          },
          logs: [{ level: "info", message: "scoped execution log" }],
          durationMs: 8,
          events: [
            {
              type: "node_started",
              timestamp: "2026-06-22T10:00:00Z",
              scope: ["each", "iteration:0"],
            },
          ],
        },
      ],
    };

    expect(runtimeSearchMatchCount(runtimeState, "Bob")).toBe(3);
    expect(runtimeSearchMatchCount(runtimeState, "\u7b2c 1 \u8f6e")).toBe(1);
    expect(runtimeSearchMatchCount(runtimeState, "node_started")).toBe(1);
    expect(runtimeSearchMatchCount(runtimeState, "scoped execution log")).toBe(1);
    expect(runtimeValueMatches({ message: "CaseSensitive" }, "sensitive")).toBe(true);
    expect(runtimeValueMatches(undefined, "anything")).toBe(false);
  });

  it("builds node-specific runtime insight lines", () => {
    expect(
      buildRuntimeInsight("data.csv_read", {
        success: {
          headers: ["name", "age"],
          rows: [{ name: "Alice" }, { name: "Bob" }],
          columns: { name: ["Alice", "Bob"], age: ["30", "31"] },
        },
      })
    ).toEqual(["表头：name, age", "行数：2", "列：name, age"]);

    expect(buildRuntimeInsight("control.foreach", { done: { iterations: [{ index: 0 }, { index: 1 }] } })).toEqual([
      "迭代次数：2",
    ]);
    expect(buildRuntimeInsight("control.each_item", { done: { iterations: [{ index: 0 }, { index: 1 }] } })).toEqual([
      "迭代次数：2",
    ]);
    expect(buildRuntimeInsight("unknown.node", {})).toEqual([]);
  });
});
