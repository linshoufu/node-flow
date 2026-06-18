import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunEvent } from "../types";
import { RunPanel } from "./RunPanel";

describe("RunPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("selects the event node when a node event is clicked", () => {
    const onSelectNode = vi.fn();
    const events: RunEvent[] = [
      {
        id: 1,
        run_id: "run_1",
        type: "node_succeeded",
        timestamp: "2026-06-18T00:00:00Z",
        node_id: "request",
        scope: ["each", "iteration:0"],
        payload: { duration_ms: 8, outputs: { success: { ok: true } } },
      },
    ];

    render(<RunPanel events={events} run={null} onSelectNode={onSelectNode} />);

    fireEvent.click(screen.getByRole("button", { name: /节点成功 request/ }));

    expect(onSelectNode).toHaveBeenCalledWith("request");
    expect(screen.getByText("each / iteration:0")).toBeInTheDocument();
  });
});
