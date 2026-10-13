import { applyNodeChanges, type Node } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { reconcileCanvasNodes } from "./canvasNodes";

const node = (): Node => ({ id: "request", type: "workflowNode", position: { x: 40, y: 60 }, data: { highlighted: false } });
const measured = () => applyNodeChanges([{ type: "dimensions", id: "request", dimensions: { width: 280, height: 300 } }], [node()]);

describe("canvas presentation updates", () => {
  it("keeps React Flow's measured dimensions through repeated hover updates", () => {
    let current = measured();
    for (const highlighted of [true, false, true, false]) {
      current = reconcileCanvasNodes(current, [{ ...node(), data: { highlighted } }]);
      // React Flow hides nodes while either measured dimension is absent.
      expect(current[0].measured).toEqual({ width: 280, height: 300 });
      expect(current[0].data.highlighted).toBe(highlighted);
    }
  });

  it("preserves drag position and measurement while updating presentation", () => {
    const dragging = applyNodeChanges([{ type: "position", id: "request", position: { x: 90, y: 110 }, dragging: true }], measured());
    const [updated] = reconcileCanvasNodes(dragging, [{ ...node(), data: { highlighted: true } }]);
    expect(updated.position).toEqual({ x: 90, y: 110 });
    expect(updated.dragging).toBe(true);
    expect(updated.measured).toEqual({ width: 280, height: 300 });
    expect(updated.data.highlighted).toBe(true);
  });

  it("uses saved position after dragging and leaves new nodes available for measurement", () => {
    const next = { ...node(), position: { x: 160, y: 200 } };
    const fresh = { ...node(), id: "new-node" };
    const result = reconcileCanvasNodes(measured(), [next, fresh]);
    expect(result[0].position).toEqual(next.position);
    expect(result[1].measured).toBeUndefined();
    expect(reconcileCanvasNodes(result, [fresh]).map((node) => node.id)).toEqual(["new-node"]);
  });
});
