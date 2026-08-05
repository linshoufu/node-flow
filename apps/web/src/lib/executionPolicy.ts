import type { NodeExecutionPolicy, WorkflowNode } from "../types";

export const DEFAULT_NODE_EXECUTION_POLICY: NodeExecutionPolicy = {
  onError: "stop",
  retry: {
    maxAttempts: 1,
    delaySeconds: 0,
  },
};

export function nodeExecutionPolicy(node: WorkflowNode): NodeExecutionPolicy {
  return node.execution ?? DEFAULT_NODE_EXECUTION_POLICY;
}

export function updateNodeExecutionPolicy(
  node: WorkflowNode,
  policy: NodeExecutionPolicy
): WorkflowNode {
  if (policiesEqual(policy, DEFAULT_NODE_EXECUTION_POLICY)) {
    const { execution: _execution, ...legacyNode } = node;
    return legacyNode;
  }

  return {
    ...node,
    execution: {
      onError: policy.onError,
      retry: {
        maxAttempts: policy.retry.maxAttempts,
        delaySeconds: policy.retry.delaySeconds,
      },
    },
  };
}

function policiesEqual(left: NodeExecutionPolicy, right: NodeExecutionPolicy): boolean {
  return (
    left.onError === right.onError &&
    left.retry.maxAttempts === right.retry.maxAttempts &&
    left.retry.delaySeconds === right.retry.delaySeconds
  );
}
