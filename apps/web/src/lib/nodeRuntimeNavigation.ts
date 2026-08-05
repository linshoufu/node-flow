export type NodeRuntimeNavigationSource =
  | "canvas"
  | "execution_data"
  | "run_comparison"
  | "run_event"
  | "test_report"
  | "focused_node";

export type NodeRuntimeNavigationTarget = {
  nodeId: string;
  scope: string[];
  source: NodeRuntimeNavigationSource;
};

const SOURCE_LABELS: Record<NodeRuntimeNavigationSource, string> = {
  canvas: "画布节点",
  execution_data: "执行数据",
  run_comparison: "运行对比",
  run_event: "运行事件",
  test_report: "测试报告",
  focused_node: "当前节点详情",
};

export function buildNodeRuntimeTarget(
  nodeId: string,
  source: NodeRuntimeNavigationSource,
  scope: string[] = []
): NodeRuntimeNavigationTarget {
  return {
    nodeId,
    scope: [...scope],
    source,
  };
}

export function nodeRuntimeSourceLabel(source: NodeRuntimeNavigationSource): string {
  return SOURCE_LABELS[source];
}
