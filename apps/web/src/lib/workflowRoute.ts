// 资源页面支持的分区，对应路径 /resources/{section}
export const RESOURCE_ROUTE_SECTIONS = [
  "assets",
  "packages",
  "credentials",
  "variables",
  "environments",
  "editor",
] as const;

export type ResourceRouteSection = (typeof RESOURCE_ROUTE_SECTIONS)[number];

export type WorkflowRoute =
  | { kind: "new" }
  | { kind: "workflow"; workflowId: string; nodeId?: string }
  | { kind: "execution"; workflowId: string; executionId: string; nodeId?: string }
  | { kind: "resources"; section: ResourceRouteSection; nodeTypeId?: string };

export function parseWorkflowRoute(pathname: string): WorkflowRoute {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0 || (segments.length === 2 && segments[0] === "workflow" && segments[1] === "new")) {
    return { kind: "new" };
  }

  // 资源页面路由：未知分区或缺少分区时回落到新建工作流，保持既有容错模式
  if (segments[0] === "resources") {
    if (
      segments.length >= 2
      && (RESOURCE_ROUTE_SECTIONS as readonly string[]).includes(segments[1])
    ) {
      const section = segments[1] as ResourceRouteSection;
      // 编辑器分区额外携带节点类型 ID（/resources/editor/{nodeTypeId}），仅此分区允许三段路径
      if (section === "editor" && segments.length === 3) {
        const nodeTypeId = decodeRouteSegment(segments[2]);
        return { kind: "resources", section, nodeTypeId };
      }
      // 其他分区超过两段或编辑器分区超过三段均回退
      if (segments.length > 2) {
        return { kind: "new" };
      }
      return { kind: "resources", section };
    }
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

  // 资源页面分区名是固定字面量，无需编码
  if (route.kind === "resources") {
    const basePath = `/resources/${route.section}`;
    return route.nodeTypeId
      ? `${basePath}/${encodeURIComponent(route.nodeTypeId)}`
      : basePath;
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
