export type WorkflowRoute =
  | { kind: "new" }
  | { kind: "workflow"; workflowId: string; nodeId?: string }
  | { kind: "execution"; workflowId: string; executionId: string; nodeId?: string };

export function parseWorkflowRoute(pathname: string): WorkflowRoute {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0 || (segments.length === 2 && segments[0] === "workflow" && segments[1] === "new")) {
    return { kind: "new" };
  }

  if (segments[0] !== "workflow" || segments.length < 2) {
    return { kind: "new" };
  }

  const workflowId = decodeRouteSegment(segments[1]);
  if (!workflowId || workflowId === "new") {
    return { kind: "new" };
  }

  if (segments[2] === "executions") {
    if (segments.length < 4 || segments.length > 5) {
      return { kind: "workflow", workflowId };
    }
    const executionId = decodeRouteSegment(segments[3]);
    const nodeId = segments[4] ? decodeRouteSegment(segments[4]) : undefined;
    if (!executionId) {
      return { kind: "workflow", workflowId };
    }
    return {
      kind: "execution",
      workflowId,
      executionId,
      ...(nodeId ? { nodeId } : {}),
    };
  }

  if (segments.length > 3) {
    return { kind: "new" };
  }

  const nodeId = segments[2] ? decodeRouteSegment(segments[2]) : undefined;

  return {
    kind: "workflow",
    workflowId,
    ...(nodeId ? { nodeId } : {}),
  };
}

export function workflowRoutePath(route: WorkflowRoute): string {
  if (route.kind === "new") {
    return "/workflow/new";
  }

  const workflowPath = `/workflow/${encodeURIComponent(route.workflowId)}`;
  if (route.kind === "execution") {
    const executionPath = `${workflowPath}/executions/${encodeURIComponent(route.executionId)}`;
    return route.nodeId ? `${executionPath}/${encodeURIComponent(route.nodeId)}` : executionPath;
  }
  return route.nodeId ? `${workflowPath}/${encodeURIComponent(route.nodeId)}` : workflowPath;
}

export function workflowRoutesEqual(left: WorkflowRoute, right: WorkflowRoute): boolean {
  return workflowRoutePath(left) === workflowRoutePath(right);
}

function decodeRouteSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return "";
  }
}
