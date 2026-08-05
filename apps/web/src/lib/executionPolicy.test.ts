import { describe, expect, it } from "vitest";
import {
  DEFAULT_NODE_EXECUTION_POLICY,
  nodeExecutionPolicy,
  updateNodeExecutionPolicy,
} from "./executionPolicy";
import type { WorkflowNode } from "../types";

const legacyNode: WorkflowNode = {
  id: "request",
  type: "http.request",
  position: { x: 0, y: 0 },
  config: { url: "https://example.com" },
};

describe("execution policy", () => {
  it("uses the default policy for a legacy node", () => {
    expect(nodeExecutionPolicy(legacyNode)).toEqual(DEFAULT_NODE_EXECUTION_POLICY);
  });

  it("does not materialize a default policy in legacy workflow JSON", () => {
    expect(updateNodeExecutionPolicy(legacyNode, DEFAULT_NODE_EXECUTION_POLICY)).toEqual(legacyNode);
  });

  it("writes a complete non-default policy", () => {
    expect(
      updateNodeExecutionPolicy(legacyNode, {
        onError: "continue",
        retry: { maxAttempts: 2, delaySeconds: 3 },
      })
    ).toMatchObject({
      execution: {
        onError: "continue",
        retry: { maxAttempts: 2, delaySeconds: 3 },
      },
    });
  });
});
