import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkflowTriggerStatusList } from "./WorkflowTriggerStatus";

describe("WorkflowTriggerStatusList", () => {
  it("shows an enabled schedule trigger with its next run time", () => {
    render(
      <WorkflowTriggerStatusList
        nodeTypes={[{ id: "schedule.trigger", name: "定时触发", description: "", inputs: {}, outputs: {}, configSchema: {} }]}
        triggers={[
          {
            node_id: "schedule",
            type: "schedule.trigger",
            active: true,
            interval_seconds: 60,
            next_run_at: "2026-07-20T01:01:00+00:00",
            details: {},
          },
        ]}
      />
    );

    expect(screen.getByText("定时触发")).toBeInTheDocument();
    expect(screen.getByText("已启用")).toBeInTheDocument();
    expect(screen.getByText(/每 60 秒/)).toBeInTheDocument();
    expect(screen.getByText(/下次执行：2026/)).toBeInTheDocument();
  });

  it("shows Webhook binding details and inactive state", () => {
    render(
      <WorkflowTriggerStatusList
        nodeTypes={[{ id: "webhook.trigger", name: "Webhook 触发", description: "", inputs: {}, outputs: {}, configSchema: {} }]}
        triggers={[
          {
            node_id: "webhook",
            type: "webhook.trigger",
            active: false,
            details: { method: "POST", path: "hooks/orders" },
          },
        ]}
      />
    );

    expect(screen.getByText("Webhook 触发")).toBeInTheDocument();
    expect(screen.getByText("已停用")).toBeInTheDocument();
    expect(screen.getByText("POST /hooks/orders")).toBeInTheDocument();
  });
});
