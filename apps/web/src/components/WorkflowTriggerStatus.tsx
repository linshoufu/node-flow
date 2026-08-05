import type { NodeType, WorkflowTriggerStatus } from "../types";

type WorkflowTriggerStatusListProps = {
  nodeTypes: NodeType[];
  triggers: WorkflowTriggerStatus[];
};

export function WorkflowTriggerStatusList({ nodeTypes, triggers }: WorkflowTriggerStatusListProps) {
  const nodeTypeById = new Map(nodeTypes.map((nodeType) => [nodeType.id, nodeType]));

  if (triggers.length === 0) {
    return <p className="workflow-variables-empty">当前工作流没有配置触发器</p>;
  }

  return (
    <ul aria-label="工作流触发器状态" className="workflow-trigger-status-list">
      {triggers.map((trigger) => {
        const nodeType = nodeTypeById.get(trigger.type);
        const name = nodeType?.displayName ?? nodeType?.name ?? trigger.type;
        const details = triggerDetails(trigger);

        return (
          <li key={trigger.node_id}>
            <div>
              <strong>{name}</strong>
              <span className={trigger.active ? "workflow-trigger-state active" : "workflow-trigger-state inactive"}>
                {trigger.active ? "已启用" : "已停用"}
              </span>
              <small>{details}</small>
            </div>
            <code>{trigger.node_id}</code>
          </li>
        );
      })}
    </ul>
  );
}

function triggerDetails(trigger: WorkflowTriggerStatus): string {
  if (trigger.type === "schedule.trigger") {
    const interval = trigger.interval_seconds ?? 0;
    if (!trigger.active) {
      return `每 ${interval} 秒；启用后开始调度`;
    }
    if (!trigger.next_run_at) {
      return `每 ${interval} 秒；等待调度器`;
    }
    return `每 ${interval} 秒；下次执行：${formatDateTime(trigger.next_run_at)}`;
  }

  if (trigger.type === "webhook.trigger") {
    const method = stringDetail(trigger.details, "method") ?? "POST";
    const path = stringDetail(trigger.details, "path") ?? "";
    return `${method} /${path}`;
  }

  return trigger.active ? "由当前工作流启用" : "当前不可用";
}

function stringDetail(details: Record<string, unknown>, key: string): string | undefined {
  const value = details[key];
  return typeof value === "string" ? value : undefined;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}
