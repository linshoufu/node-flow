import type { NodeType, NodeUpgradeSummary } from "../types";

export type NodeUpgradeDetails = {
  changes: string[];
  migrationNotes: string[];
};

export function formatNodeUpgradeSummary(upgrades: NodeUpgradeSummary[], nodeTypes: NodeType[]): string[] {
  const displayNameByType = new Map(
    nodeTypes.map((nodeType) => [nodeType.id, nodeType.displayName ?? nodeType.name])
  );

  return upgrades.map((upgrade) => {
    const name = displayNameByType.get(upgrade.nodeType) ?? upgrade.nodeType;
    return `${name}：v${upgrade.fromVersion} 升级到 v${upgrade.toVersion}`;
  });
}

export function formatNodeUpgradeDetails(upgrade: NodeUpgradeSummary): NodeUpgradeDetails {
  return {
    changes: (upgrade.configChanges ?? []).map((change) => {
      if (change.kind === "added") {
        return `新增 ${change.path}：${formatConfigValue(change.after)}`;
      }
      if (change.kind === "removed") {
        return `删除 ${change.path}：${formatConfigValue(change.before)}`;
      }
      return `修改 ${change.path}：${formatConfigValue(change.before)} -> ${formatConfigValue(change.after)}`;
    }),
    migrationNotes: upgrade.migrationNotes ?? [],
  };
}

function formatConfigValue(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const normalized = text === undefined ? "未设置" : text;
  return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized;
}
