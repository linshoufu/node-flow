import { describe, expect, it } from "vitest";

import type { RunRecord } from "../types";
import {
  initialRunDrawerState,
  reduceRunDrawer,
  runDrawerSummary,
} from "./workbenchLayout";

function createRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "12",
    workflow_id: "3",
    workflow_version: 4,
    status: "queued",
    created_at: "2026-07-14T08:00:00Z",
    started_at: null,
    completed_at: null,
    cancel_requested_at: null,
    error: null,
    ...overrides,
  };
}

describe("run drawer layout", () => {
  it("opens for a new active run when the user has not pinned it", () => {
    expect(
      reduceRunDrawer(initialRunDrawerState, {
        type: "run-updated",
        status: "running",
        hasError: false,
      }),
    ).toEqual({ expanded: true, manuallyPinned: false });
  });

  it("keeps the user's collapsed choice while run updates arrive", () => {
    const automaticallyOpened = reduceRunDrawer(initialRunDrawerState, {
      type: "run-updated",
      status: "running",
      hasError: false,
    });
    const manuallyCollapsed = reduceRunDrawer(automaticallyOpened, { type: "toggle" });

    expect(
      reduceRunDrawer(manuallyCollapsed, {
        type: "run-updated",
        status: "failed",
        hasError: true,
      }),
    ).toEqual({ expanded: false, manuallyPinned: true });
  });

  it("opens for terminal problems and reset clears the manual choice", () => {
    const failed = reduceRunDrawer(initialRunDrawerState, {
      type: "run-updated",
      status: "cancelled",
      hasError: false,
    });

    expect(failed).toEqual({ expanded: true, manuallyPinned: false });
    expect(reduceRunDrawer(failed, { type: "reset" })).toEqual(initialRunDrawerState);
  });

  it("formats Chinese idle and run summaries", () => {
    expect(runDrawerSummary(null)).toEqual({
      statusLabel: "空闲",
      detail: "暂无运行结果",
    });
    expect(runDrawerSummary(createRun({ status: "succeeded" }))).toEqual({
      statusLabel: "成功",
      detail: "本次运行",
    });
  });
});
