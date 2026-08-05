import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WorkflowVersionDiffView } from "./WorkflowVersionDiffView";

describe("WorkflowVersionDiffView", () => {
  afterEach(() => cleanup());

  it("shows a compact Chinese summary with friendly changed node names", () => {
    render(
      <WorkflowVersionDiffView
        diff={{
          baselineVersion: 3,
          currentVersion: 5,
          changed: true,
          addedNodeIds: ["assert"],
          removedNodeIds: ["old_log"],
          changedNodeIds: ["request"],
          movedNodeIds: ["request"],
          addedEdgeCount: 2,
          removedEdgeCount: 1,
          metadataChanged: true,
          settingsChanged: true,
          annotationsChanged: false,
        }}
        nodeDisplayNames={{ assert: "状态断言", old_log: "旧日志", request: "登录请求" }}
      />
    );

    expect(screen.getByRole("heading", { name: "v3 与当前 v5 的差异" })).toBeInTheDocument();
    expect(screen.getByText("新增节点：状态断言")).toBeInTheDocument();
    expect(screen.getByText("删除节点：旧日志")).toBeInTheDocument();
    expect(screen.getByText("节点内容：登录请求")).toBeInTheDocument();
    expect(screen.getByText("节点位置：登录请求")).toBeInTheDocument();
    expect(screen.getByText("连线：新增 2，删除 1")).toBeInTheDocument();
    expect(screen.getByText("工作流信息已变化")).toBeInTheDocument();
    expect(screen.getByText("工作流设置已变化")).toBeInTheDocument();
  });

  it("explains when a selected version is identical to the current version", () => {
    render(
      <WorkflowVersionDiffView
        diff={{
          baselineVersion: 5,
          currentVersion: 5,
          changed: false,
          addedNodeIds: [],
          removedNodeIds: [],
          changedNodeIds: [],
          movedNodeIds: [],
          addedEdgeCount: 0,
          removedEdgeCount: 0,
          metadataChanged: false,
          settingsChanged: false,
          annotationsChanged: false,
        }}
        nodeDisplayNames={{}}
      />
    );

    expect(screen.getByText("与当前版本没有可见差异。" )).toBeInTheDocument();
  });
});
