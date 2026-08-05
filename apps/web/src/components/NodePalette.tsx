import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { nodePortContractSummary } from "../lib/nodePortSummary";
import type { NodeType } from "../types";
import { NodeTypeIcon } from "./NodeTypeIcon";

type NodePaletteProps = {
  disabled?: boolean;
  isReloadingNodeTypes?: boolean;
  nodeTypes: NodeType[];
  onAddNode: (nodeType: NodeType) => void;
  onReloadNodeTypes?: () => void;
};

const GROUP_FILTERS = [
  { id: "all", label: "全部" },
  { id: "recent", label: "最近" },
  { id: "trigger", label: "触发器" },
  { id: "action", label: "操作" },
  { id: "control", label: "控制" },
] as const;

type GroupFilterId = (typeof GROUP_FILTERS)[number]["id"];
const RECENT_NODE_TYPES_STORAGE_KEY = "node-flow.recent-node-types";
const RECENT_NODE_TYPES_LIMIT = 12;
const CATEGORY_ORDER = ["触发器", "数据", "逻辑", "控制", "工具", "网络", "工作流", "断言", "测试"];

export function NodePalette({
  disabled = false,
  isReloadingNodeTypes = false,
  nodeTypes,
  onAddNode,
  onReloadNodeTypes,
}: NodePaletteProps) {
  const [query, setQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState<GroupFilterId>("all");
  const [recentNodeTypeIds, setRecentNodeTypeIds] = useState(readRecentNodeTypeIds);
  const groupCounts = useMemo(() => countNodeGroups(nodeTypes), [nodeTypes]);
  const recentNodeTypes = useMemo(
    () => resolveRecentNodeTypes(nodeTypes, recentNodeTypeIds),
    [nodeTypes, recentNodeTypeIds],
  );
  const activeGroupFilter = groupFilter === "recent" && recentNodeTypes.length === 0 ? "all" : groupFilter;
  const groupedNodeTypes = useMemo(
    () => filterNodeTypesByGroup(nodeTypes, activeGroupFilter, recentNodeTypes),
    [nodeTypes, activeGroupFilter, recentNodeTypes],
  );
  const filteredNodeTypes = useMemo(() => filterNodeTypes(groupedNodeTypes, query), [groupedNodeTypes, query]);
  const categories = groupByCategory(filteredNodeTypes);

  const handleAddNode = (nodeType: NodeType) => {
    if (disabled) {
      return;
    }

    setRecentNodeTypeIds((currentIds) => {
      const nextIds = rememberRecentNodeTypeId(currentIds, nodeType.id);
      writeRecentNodeTypeIds(nextIds);
      return nextIds;
    });
    onAddNode(nodeType);
  };

  return (
    <aside className="panel palette-panel" aria-label="节点库">
      <div className="panel-heading">
        <div>
          <h2>节点库</h2>
          <p>拖拽或点击添加到当前画布</p>
        </div>
        <div className="palette-heading-actions">
          <span>{filteredNodeTypes.length} 个</span>
          {onReloadNodeTypes ? (
            <button
              aria-label="刷新节点"
              disabled={disabled || isReloadingNodeTypes}
              title="重新扫描 Python 节点脚本"
              type="button"
              onClick={() => {
                if (!disabled) {
                  onReloadNodeTypes();
                }
              }}
            >
              刷新
            </button>
          ) : null}
        </div>
      </div>
      <label className="palette-search">
        <Search aria-hidden="true" className="palette-search-icon" size={14} strokeWidth={2.2} />
        <input
          aria-label="搜索节点"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索节点名称、类型、说明"
          type="search"
          value={query}
        />
      </label>
      <div className="palette-filter-tabs" role="group" aria-label="节点类型筛选">
        {GROUP_FILTERS.map((filter) => {
          const count = filter.id === "all" ? nodeTypes.length : filter.id === "recent" ? recentNodeTypes.length : groupCounts[filter.id] ?? 0;
          const disabled = filter.id === "recent" && count === 0;
          return (
            <button
              aria-pressed={activeGroupFilter === filter.id}
              disabled={disabled}
              key={filter.id}
              type="button"
              onClick={() => {
                if (!disabled) {
                  setGroupFilter(filter.id);
                }
              }}
            >
              <span>{filter.label}</span>
              <em>{count}</em>
            </button>
          );
        })}
      </div>
      <div className="palette-groups">
        {categories.length === 0 ? (
          <p className="palette-empty">没有匹配的节点。</p>
        ) : (
          categories.map(([category, items]) => (
            <section className="palette-group" data-category={category} key={category}>
              <h3>{category}</h3>
              <div className="palette-list">
                {items.map((nodeType) => {
                  const portSummary = nodePortContractSummary(nodeType);
                  return (
                    <button
                      aria-label={nodeAccessibleName(nodeType)}
                      className="palette-node"
                      data-category={nodeType.category || "其他"}
                      disabled={disabled}
                      draggable={!disabled}
                      key={nodeType.id}
                      type="button"
                      onClick={() => handleAddNode(nodeType)}
                      onDragStart={(event) => {
                        if (disabled) {
                          event.preventDefault();
                          return;
                        }
                        setRecentNodeTypeIds((currentIds) => {
                          const nextIds = rememberRecentNodeTypeId(currentIds, nodeType.id);
                          writeRecentNodeTypeIds(nextIds);
                          return nextIds;
                        });
                        event.dataTransfer.effectAllowed = "copy";
                        event.dataTransfer.setData("application/node-flow-node-type", nodeType.id);
                        event.dataTransfer.setData("text/plain", nodeType.id);
                      }}
                    >
                      <span className="palette-node-heading">
                        <NodeTypeIcon className="palette-node-icon" icon={nodeType.icon} />
                        <span>{displayNodeName(nodeType)}</span>
                      </span>
                      {nodeType.description ? <p>{nodeType.description}</p> : null}
                      <small className="palette-node-port-summary">{portSummary.text}</small>
                      <small className="palette-node-source">{nodePackageLabel(nodeType)}</small>
                      {nodeType.tags && nodeType.tags.length > 0 ? (
                        <span className="palette-node-tags">
                          {nodeType.tags.map((tag) => (
                            <em key={tag}>{tag}</em>
                          ))}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>
    </aside>
  );
}

function countNodeGroups(nodeTypes: NodeType[]): Record<string, number> {
  return nodeTypes.reduce<Record<string, number>>((counts, nodeType) => {
    const group = normalizeNodeGroup(nodeType);
    counts[group] = (counts[group] ?? 0) + 1;
    return counts;
  }, {});
}

function filterNodeTypesByGroup(
  nodeTypes: NodeType[],
  groupFilter: GroupFilterId,
  recentNodeTypes: NodeType[],
): NodeType[] {
  if (groupFilter === "all") {
    return nodeTypes;
  }
  if (groupFilter === "recent") {
    return recentNodeTypes;
  }
  return nodeTypes.filter((nodeType) => normalizeNodeGroup(nodeType) === groupFilter);
}

function filterNodeTypes(nodeTypes: NodeType[], query: string): NodeType[] {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return nodeTypes;
  }

  return nodeTypes.filter((nodeType) => {
    const searchableText = [
      nodeType.name,
      nodeType.displayName,
      nodeType.id,
      nodeType.category,
      nodeType.group,
      nodeType.description,
      nodePortContractSummary(nodeType).searchText,
      ...(nodeType.tags ?? []),
      ...(nodeType.keywords ?? []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return searchableText.includes(normalizedQuery);
  });
}

function displayNodeName(nodeType: NodeType): string {
  return nodeType.displayName || nodeType.name;
}

function nodePackageLabel(nodeType: NodeType): string {
  return nodeType.package ? `${nodeType.package.name} v${nodeType.package.version}` : "本地脚本";
}

function nodeAccessibleName(nodeType: NodeType): string {
  return [displayNodeName(nodeType), ...(nodeType.tags ?? [])].join(" ");
}

function normalizeNodeGroup(nodeType: NodeType): "trigger" | "action" | "control" {
  const group = nodeType.group?.toLowerCase();
  if (group === "trigger" || group === "control") {
    return group;
  }
  return "action";
}

function resolveRecentNodeTypes(nodeTypes: NodeType[], recentNodeTypeIds: string[]): NodeType[] {
  const nodeTypesById = new Map(nodeTypes.map((nodeType) => [nodeType.id, nodeType]));
  return recentNodeTypeIds
    .map((nodeTypeId) => nodeTypesById.get(nodeTypeId))
    .filter((nodeType): nodeType is NodeType => Boolean(nodeType));
}

function rememberRecentNodeTypeId(currentIds: string[], nodeTypeId: string): string[] {
  return [nodeTypeId, ...currentIds.filter((currentId) => currentId !== nodeTypeId)].slice(0, RECENT_NODE_TYPES_LIMIT);
}

function readRecentNodeTypeIds(): string[] {
  const storage = recentNodeStorage();
  if (!storage) {
    return [];
  }

  try {
    const rawValue = storage.getItem(RECENT_NODE_TYPES_STORAGE_KEY);
    if (!rawValue) {
      return [];
    }
    const parsedValue: unknown = JSON.parse(rawValue);
    if (!Array.isArray(parsedValue)) {
      return [];
    }
    return parsedValue.filter((item): item is string => typeof item === "string").slice(0, RECENT_NODE_TYPES_LIMIT);
  } catch {
    return [];
  }
}

function writeRecentNodeTypeIds(nodeTypeIds: string[]): void {
  const storage = recentNodeStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(RECENT_NODE_TYPES_STORAGE_KEY, JSON.stringify(nodeTypeIds.slice(0, RECENT_NODE_TYPES_LIMIT)));
  } catch {
    // localStorage can be unavailable in private browsing or constrained test shells.
  }
}

function recentNodeStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  if (typeof window === "undefined") {
    return null;
  }

  const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
  if (descriptor && "value" in descriptor) {
    return isRecentNodeStorage(descriptor.value) ? descriptor.value : null;
  }

  if (isNodeLikeRuntime()) {
    return null;
  }

  try {
    return isRecentNodeStorage(window.localStorage) ? window.localStorage : null;
  } catch {
    return null;
  }
}

function isRecentNodeStorage(value: unknown): value is Pick<Storage, "getItem" | "setItem"> {
  return Boolean(
    value &&
      typeof value === "object" &&
      "getItem" in value &&
      typeof value.getItem === "function" &&
      "setItem" in value &&
      typeof value.setItem === "function",
  );
}

function isNodeLikeRuntime(): boolean {
  const runtime = globalThis as typeof globalThis & {
    process?: {
      versions?: {
        node?: string;
      };
    };
  };
  return typeof runtime.process?.versions?.node === "string";
}

function groupByCategory(nodeTypes: NodeType[]): Array<[string, NodeType[]]> {
  const groups = new Map<string, NodeType[]>();

  for (const nodeType of nodeTypes) {
    const category = nodeType.category || "其他";
    groups.set(category, [...(groups.get(category) ?? []), nodeType]);
  }

  return [...groups.entries()].sort(([left], [right]) => compareCategories(left, right));
}

function compareCategories(left: string, right: string): number {
  const leftRank = categoryRank(left);
  const rightRank = categoryRank(right);

  return leftRank - rightRank || left.localeCompare(right);
}

function categoryRank(category: string): number {
  const rank = CATEGORY_ORDER.indexOf(category);
  return rank === -1 ? CATEGORY_ORDER.length : rank;
}
