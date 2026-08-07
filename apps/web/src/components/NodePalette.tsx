import { useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Plus, Search, X } from "lucide-react";
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
const COLLAPSED_CATEGORIES_STORAGE_KEY = "node-flow.palette-collapsed-categories";
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
  const [collapsedCategories, setCollapsedCategories] = useState<string[]>(readCollapsedCategories);
  const [activeIndex, setActiveIndex] = useState(0);
  // 悬浮详情卡：列表收成单行后，说明/端口/标签改为悬停或键盘聚焦时浮出
  const [previewNodeTypeId, setPreviewNodeTypeId] = useState<string | null>(null);
  const [previewPosition, setPreviewPosition] = useState<{ top: number; left: number } | null>(null);
  const previewTimerRef = useRef<number | null>(null);
  const previewAnchorRef = useRef<{ top: number; left: number; right: number } | null>(null);
  const previewCardRef = useRef<HTMLDivElement | null>(null);
  const nodeButtonRefs = useRef(new Map<string, HTMLButtonElement>());
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
  // 预构建小写化搜索索引：只在 nodeTypes 变化时重建，避免每次按键重新拼接/小写化
  const nodeTypeSearchIndex = useMemo(() => buildNodeTypeSearchIndex(nodeTypes), [nodeTypes]);
  // 搜索输入与过滤渲染分离，连续输入时不阻塞输入手感
  const deferredQuery = useDeferredValue(query);
  const filteredNodeTypes = useMemo(
    () => filterNodeTypes(groupedNodeTypes, deferredQuery, nodeTypeSearchIndex),
    [groupedNodeTypes, deferredQuery, nodeTypeSearchIndex],
  );
  const categories = useMemo(() => groupByCategory(filteredNodeTypes), [filteredNodeTypes]);
  const isSearching = query.trim().length > 0;
  const activeNodeTypeId =
    isSearching && filteredNodeTypes.length > 0
      ? filteredNodeTypes[Math.min(Math.max(activeIndex, 0), filteredNodeTypes.length - 1)].id
      : null;

  useEffect(() => {
    setActiveIndex(0);
  }, [query, activeGroupFilter]);

  useEffect(() => {
    return () => {
      clearPreviewTimer();
    };
  }, []);

  useEffect(() => {
    if (!previewNodeTypeId) {
      setPreviewPosition(null);
      return;
    }
    function positionPreviewCard() {
      const anchor = previewAnchorRef.current;
      const card = previewCardRef.current;
      if (!anchor || !card) {
        return;
      }
      const margin = 10;
      const gap = 8;
      const width = card.offsetWidth;
      const height = card.offsetHeight;
      // 默认在行右侧浮出；右侧放不下时改左侧，再不行夹紧到视口内
      let left = anchor.right + gap;
      if (left + width > window.innerWidth - margin) {
        left = anchor.left - width - gap;
      }
      left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
      let top = anchor.top;
      if (top + height > window.innerHeight - margin) {
        top = Math.max(margin, window.innerHeight - height - margin);
      }
      setPreviewPosition({ top, left });
    }
    positionPreviewCard();
    window.addEventListener("resize", positionPreviewCard);
    // 列表滚动时详情卡会错位，直接关闭
    window.addEventListener("scroll", closePreview, true);
    return () => {
      window.removeEventListener("resize", positionPreviewCard);
      window.removeEventListener("scroll", closePreview, true);
    };
  }, [previewNodeTypeId]);

  function clearPreviewTimer() {
    if (previewTimerRef.current !== null) {
      window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
  }

  function openPreview(nodeType: NodeType, element: HTMLElement) {
    const rect = element.getBoundingClientRect();
    previewAnchorRef.current = { top: rect.top, left: rect.left, right: rect.right };
    setPreviewNodeTypeId(nodeType.id);
  }

  function closePreview() {
    clearPreviewTimer();
    setPreviewNodeTypeId(null);
  }

  const previewNodeType = previewNodeTypeId ? nodeTypes.find((item) => item.id === previewNodeTypeId) : undefined;

  useEffect(() => {
    if (!activeNodeTypeId) {
      return;
    }
    nodeButtonRefs.current.get(activeNodeTypeId)?.scrollIntoView?.({ block: "nearest" });
  }, [activeNodeTypeId]);

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

  const toggleCategory = (category: string) => {
    setCollapsedCategories((currentCategories) => {
      const nextCategories = currentCategories.includes(category)
        ? currentCategories.filter((item) => item !== category)
        : [...currentCategories, category];
      writeCollapsedCategories(nextCategories);
      return nextCategories;
    });
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => Math.min(current + 1, filteredNodeTypes.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      const targetNode = filteredNodeTypes.find((nodeType) => nodeType.id === activeNodeTypeId);
      if (targetNode) {
        event.preventDefault();
        handleAddNode(targetNode);
      }
      return;
    }
    if (event.key === "Escape" && query) {
      event.preventDefault();
      setQuery("");
      setActiveIndex(0);
    }
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
          onKeyDown={handleSearchKeyDown}
          placeholder="搜索节点名称、类型、说明"
          type="search"
          value={query}
        />
        {query ? (
          <button
            aria-label="清空搜索"
            className="palette-search-clear"
            type="button"
            onClick={() => {
              setQuery("");
              setActiveIndex(0);
            }}
          >
            <X aria-hidden="true" size={13} strokeWidth={2.4} />
          </button>
        ) : null}
      </label>
      {isSearching ? <p className="palette-search-hint">↑↓ 选择 · Enter 添加 · Esc 清除</p> : null}
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
          <div className="palette-empty-state">
            <p className="palette-empty">没有匹配的节点。</p>
            {isSearching ? (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setActiveIndex(0);
                }}
              >
                清除搜索
              </button>
            ) : null}
          </div>
        ) : (
          categories.map(([category, items]) => {
            const isGroupCollapsed = !isSearching && collapsedCategories.includes(category);
            return (
              <section
                className="palette-group"
                data-category={category}
                data-collapsed={isGroupCollapsed ? "true" : undefined}
                key={category}
              >
                <div className="palette-group-header" onClick={() => toggleCategory(category)}>
                  <h3>{category}</h3>
                  <em className="palette-group-count">{items.length}</em>
                  <button
                    aria-expanded={!isGroupCollapsed}
                    aria-label={isGroupCollapsed ? `展开 ${category} 分组` : `折叠 ${category} 分组`}
                    className="palette-group-toggle"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleCategory(category);
                    }}
                  >
                    <ChevronDown aria-hidden="true" size={13} strokeWidth={2.4} />
                  </button>
                </div>
                {isGroupCollapsed ? null : (
                <div className="palette-list">
                {items.map((nodeType) => {
                  return (
                    <button
                      aria-label={nodeAccessibleName(nodeType)}
                      className="palette-node"
                      data-active={nodeType.id === activeNodeTypeId ? "true" : undefined}
                      data-category={nodeType.category || "其他"}
                      disabled={disabled}
                      draggable={!disabled}
                      key={nodeType.id}
                      ref={(element) => {
                        if (element) {
                          nodeButtonRefs.current.set(nodeType.id, element);
                        } else {
                          nodeButtonRefs.current.delete(nodeType.id);
                        }
                      }}
                      type="button"
                      onBlur={closePreview}
                      onClick={() => handleAddNode(nodeType)}
                      onFocus={(event) => openPreview(nodeType, event.currentTarget)}
                      onMouseEnter={(event) => {
                        const element = event.currentTarget;
                        clearPreviewTimer();
                        previewTimerRef.current = window.setTimeout(() => {
                          openPreview(nodeType, element);
                        }, PALETTE_PREVIEW_HOVER_DELAY_MS);
                      }}
                      onMouseLeave={closePreview}
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
                      <NodeTypeIcon className="palette-node-icon" icon={nodeType.icon} />
                      <span className="palette-node-body">
                        <span className="palette-node-name">{displayNodeName(nodeType)}</span>
                      </span>
                      <span aria-hidden="true" className="palette-node-add">
                        <Plus size={12} strokeWidth={2.6} />
                      </span>
                    </button>
                  );
                })}
                </div>
                )}
              </section>
            );
          })
        )}
      </div>
      {previewNodeType
        ? createPortal(
            <PaletteNodePreviewCard
              cardRef={previewCardRef}
              nodeType={previewNodeType}
              position={previewPosition}
            />,
            document.body,
          )
        : null}
    </aside>
  );
}

const PALETTE_PREVIEW_HOVER_DELAY_MS = 180;

function PaletteNodePreviewCard({
  cardRef,
  nodeType,
  position,
}: {
  cardRef: Ref<HTMLDivElement>;
  nodeType: NodeType;
  position: { top: number; left: number } | null;
}) {
  const portSummary = nodePortContractSummary(nodeType);
  return (
    <div
      ref={cardRef}
      aria-hidden="true"
      className="palette-node-preview"
      data-category={nodeType.category || "其他"}
      style={position ?? { top: 0, left: 0, visibility: "hidden" }}
    >
      <div className="palette-node-preview-header">
        <NodeTypeIcon className="palette-node-icon" icon={nodeType.icon} />
        <strong>{displayNodeName(nodeType)}</strong>
        <small>{nodePackageLabel(nodeType)}</small>
      </div>
      {nodeType.description ? <p className="palette-node-preview-desc">{nodeType.description}</p> : null}
      <small className="palette-node-preview-ports">{portSummary.text}</small>
      {nodeType.tags && nodeType.tags.length > 0 ? (
        <span className="palette-node-preview-tags">
          {nodeType.tags.map((tag) => (
            <em key={tag}>{tag}</em>
          ))}
        </span>
      ) : null}
    </div>
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

/** 为每个节点预拼接一份小写化可搜索文本，供索引构建与单次匹配共用 */
export function buildNodeTypeSearchText(nodeType: NodeType): string {
  return [
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
}

/** 预构建搜索索引（按节点对象引用缓存），nodeTypes 不变时可跨多次按键复用 */
export function buildNodeTypeSearchIndex(nodeTypes: NodeType[]): Map<NodeType, string> {
  const searchIndex = new Map<NodeType, string>();
  for (const nodeType of nodeTypes) {
    searchIndex.set(nodeType, buildNodeTypeSearchText(nodeType));
  }
  return searchIndex;
}

export function filterNodeTypes(nodeTypes: NodeType[], query: string, searchIndex?: Map<NodeType, string>): NodeType[] {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return nodeTypes;
  }

  return nodeTypes.filter((nodeType) => {
    // 优先查预建索引；未命中（如调用方传入子集外的节点）时回退到实时拼接
    const searchableText = searchIndex?.get(nodeType) ?? buildNodeTypeSearchText(nodeType);
    return searchableText.includes(normalizedQuery);
  });
}

export function displayNodeName(nodeType: NodeType): string {
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
  const storage = paletteLocalStorage();
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
  const storage = paletteLocalStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(RECENT_NODE_TYPES_STORAGE_KEY, JSON.stringify(nodeTypeIds.slice(0, RECENT_NODE_TYPES_LIMIT)));
  } catch {
    // localStorage can be unavailable in private browsing or constrained test shells.
  }
}

function readCollapsedCategories(): string[] {
  const storage = paletteLocalStorage();
  if (!storage) {
    return [];
  }

  try {
    const rawValue = storage.getItem(COLLAPSED_CATEGORIES_STORAGE_KEY);
    if (!rawValue) {
      return [];
    }
    const parsedValue: unknown = JSON.parse(rawValue);
    if (!Array.isArray(parsedValue)) {
      return [];
    }
    return parsedValue.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function writeCollapsedCategories(categories: string[]): void {
  const storage = paletteLocalStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(COLLAPSED_CATEGORIES_STORAGE_KEY, JSON.stringify(categories));
  } catch {
    // localStorage can be unavailable in private browsing or constrained test shells.
  }
}

function paletteLocalStorage(): Pick<Storage, "getItem" | "setItem"> | null {
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
