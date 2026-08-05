import { describe, expect, it } from "vitest";
import type { WorkflowSummary } from "../types";
import { buildWorkflowManagerItems, mergeWorkflowRunHistory, sortWorkflowRunsByRecent, workflowStatusFilterCounts } from "./workflowManager";

describe("workflow manager helpers", () => {
  const workflows: WorkflowSummary[] = [
    {
      id: "wf_csv_alpha",
      name: "CSV 参数化接口测试",
      version: 3,
      updated_at: "2026-06-24T01:30:00Z",
      node_count: 6,
      last_run_status: "succeeded",
    },
    {
      id: "wf_status",
      name: "单接口状态码断言",
      version: 2,
      updated_at: "2026-06-23T08:15:00Z",
      node_count: 3,
      last_run_status: "failed",
    },
    {
      id: "wf_empty",
      name: "   ",
      version: 1,
      updated_at: "2026-06-22T00:00:00Z",
      node_count: 0,
      last_run_status: null,
    },
  ];

  it("builds searchable workflow rows with active state and display metadata", () => {
    const items = buildWorkflowManagerItems(workflows, "wf_status", "接口");

    expect(items).toEqual([
      {
        workflow: workflows[0],
        isActive: false,
        title: "CSV 参数化接口测试",
        subtitle: "v3",
        metadata: "6 个节点 · 2026/06/24 01:30",
        statusLabel: "最近成功",
        statusKind: "succeeded",
      },
      {
        workflow: workflows[1],
        isActive: true,
        title: "单接口状态码断言",
        subtitle: "v2",
        metadata: "3 个节点 · 2026/06/23 08:15",
        statusLabel: "最近失败",
        statusKind: "failed",
      },
    ]);
  });

  it("filters by run status and sorts by recent updates", () => {
    const items = buildWorkflowManagerItems(workflows, "", "", {
      status: "failed",
      sort: "updated_desc",
    });

    expect(items.map((item) => item.workflow.id)).toEqual(["wf_status"]);
  });

  it("filters by successful and cancelled workflow runs", () => {
    const workflowsWithCancelled: WorkflowSummary[] = [
      ...workflows,
      {
        id: "wf_cancelled",
        name: "取消调试流程",
        version: 1,
        updated_at: "2026-06-24T03:00:00Z",
        node_count: 2,
        last_run_status: "cancelled",
      },
    ];

    expect(
      buildWorkflowManagerItems(workflowsWithCancelled, "", "", {
        status: "succeeded",
      }).map((item) => item.workflow.id)
    ).toEqual(["wf_csv_alpha"]);
    expect(
      buildWorkflowManagerItems(workflowsWithCancelled, "", "", {
        status: "cancelled",
      }).map((item) => item.workflow.id)
    ).toEqual(["wf_cancelled"]);
    expect(workflowStatusFilterCounts(workflowsWithCancelled)).toMatchObject({
      succeeded: 1,
      cancelled: 1,
    });
  });

  it("sorts by node count when requested", () => {
    const items = buildWorkflowManagerItems(workflows, "", "", {
      status: "all",
      sort: "node_count_desc",
    });

    expect(items.map((item) => item.workflow.id)).toEqual(["wf_csv_alpha", "wf_status", "wf_empty"]);
  });

  it("uses a Chinese unnamed label and matches by workflow id", () => {
    const items = buildWorkflowManagerItems(workflows, "", "empty");

    expect(items).toEqual([
      {
        workflow: workflows[2],
        isActive: false,
        title: "未命名工作流",
        subtitle: "v1",
        metadata: "0 个节点 · 2026/06/22 00:00",
        statusLabel: "未运行",
        statusKind: "idle",
      },
    ]);
  });

  it("matches workflow descriptions and tags in the catalog search", () => {
    const taggedWorkflow: WorkflowSummary = {
      id: "wf_release",
      name: "发布流程",
      description: "构建并发布生产制品",
      tags: ["发布", "自动化"],
      version: 1,
      updated_at: "2026-06-25T00:00:00Z",
      node_count: 4,
      last_run_status: null,
    };

    expect(buildWorkflowManagerItems([taggedWorkflow], "", "自动化")).toHaveLength(1);
    expect(buildWorkflowManagerItems([taggedWorkflow], "", "生产制品")).toHaveLength(1);
  });

  it("sorts workflow runs by newest creation time first", () => {
    const runs = [
      {
        id: "run_old",
        workflow_id: "wf_status",
        workflow_version: 2,
        status: "failed" as const,
        created_at: "2026-06-23T02:00:00Z",
        started_at: "2026-06-23T02:00:01Z",
        completed_at: "2026-06-23T02:00:04Z",
        error: "旧运行失败",
      },
      {
        id: "run_new",
        workflow_id: "wf_status",
        workflow_version: 2,
        status: "succeeded" as const,
        created_at: "2026-06-24T02:00:00Z",
        started_at: "2026-06-24T02:00:01Z",
        completed_at: "2026-06-24T02:00:02Z",
        error: null,
      },
      {
        id: "run_same_b",
        workflow_id: "wf_status",
        workflow_version: 2,
        status: "cancelled" as const,
        created_at: "2026-06-24T02:00:00Z",
        started_at: "2026-06-24T02:00:01Z",
        completed_at: "2026-06-24T02:00:02Z",
        error: null,
      },
    ];

    expect(sortWorkflowRunsByRecent(runs).map((run) => run.id)).toEqual(["run_same_b", "run_new", "run_old"]);
    expect(runs.map((run) => run.id)).toEqual(["run_old", "run_new", "run_same_b"]);
  });

  it("merges an older run page without duplicates and keeps newest-first ordering", () => {
    const current = run("run_current", "2026-07-23T02:00:00Z");
    const previous = run("run_previous", "2026-07-22T02:00:00Z");
    const older = run("run_older", "2026-07-21T02:00:00Z");

    expect(mergeWorkflowRunHistory([current, previous], [previous, older]).map((item) => item.id)).toEqual([
      "run_current",
      "run_previous",
      "run_older",
    ]);
  });
});

function run(id: string, createdAt: string) {
  return {
    id,
    workflow_id: "wf_status",
    workflow_version: 2,
    status: "succeeded" as const,
    created_at: createdAt,
    started_at: createdAt,
    completed_at: createdAt,
    error: null,
  };
}
