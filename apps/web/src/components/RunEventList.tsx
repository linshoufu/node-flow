import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type UIEvent } from "react";
import type { RunEvent } from "../types";
import { translateEventType } from "../lib/display";
import { buildNodeRuntimeTarget } from "../lib/nodeRuntimeNavigation";
import { filterRunEvents } from "../lib/runEventsView";
import { formatScope } from "../lib/runtimeDisplay";
import { formatTime, nodeDisplayName, type NodeSelectionTarget } from "./runPanelShared";

/** 窗口化开关：auto 表示按事件数量与环境自动判断，on/off 用于外部强制开启/关闭（如 jsdom 测试） */
export type RunEventListVirtualization = "auto" | "on" | "off";

export type RunEventListProps = {
  events: RunEvent[];
  nodeDisplayNames: Record<string, string>;
  onOpenChildRun?: (runId: string) => void;
  onSelectNode?: (target: NodeSelectionTarget) => void;
  virtualization?: RunEventListVirtualization;
};

// 窗口化参数：事件超过阈值才启用，固定行高 + 上下缓冲行，纯 scrollTop 计算可视区
const VIRTUALIZATION_THRESHOLD = 200;
const VIRTUAL_ROW_HEIGHT = 36;
const VIRTUAL_BUFFER_ROWS = 8;
// jsdom 等无法测量容器高度时的视口估算值（px）
const VIRTUAL_VIEWPORT_FALLBACK_HEIGHT = 420;
// 距离底部小于该像素值视为“贴底”，新事件到达时继续自动滚动
const AUTO_SCROLL_STICK_DISTANCE = 48;
// payload 默认截断长度（与 runPanelShared.formatValue 的 240 字符口径保持一致）
const PAYLOAD_PREVIEW_LIMIT = 240;

function isJsdomEnvironment(): boolean {
  return typeof window !== "undefined" && window.navigator.userAgent.toLowerCase().includes("jsdom");
}

export function RunEventList({
  events,
  nodeDisplayNames,
  onOpenChildRun,
  onSelectNode,
  virtualization = "auto",
}: RunEventListProps) {
  const [query, setQuery] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(VIRTUAL_VIEWPORT_FALLBACK_HEIGHT);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  // 用户手动上滚查看历史时不再强制贴底，避免打断阅读
  const stickToBottomRef = useRef(true);
  const filteredEvents = useMemo(() => filterRunEvents(events, query, nodeDisplayNames), [events, nodeDisplayNames, query]);
  const isVirtualized = useMemo(() => {
    if (virtualization === "off") {
      return false;
    }
    if (virtualization === "on") {
      return true;
    }
    return filteredEvents.length > VIRTUALIZATION_THRESHOLD && !isJsdomEnvironment();
  }, [virtualization, filteredEvents.length]);

  // 新事件到达且仍处于贴底状态时，自动滚动到最新日志
  useEffect(() => {
    if (!stickToBottomRef.current) {
      return;
    }
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }
    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
    container.scrollTop = maxScrollTop;
    setScrollTop(maxScrollTop);
  }, [events.length]);

  if (events.length === 0) {
    return <p className="empty-state">还没有运行事件。</p>;
  }

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    const container = event.currentTarget;
    setScrollTop(container.scrollTop);
    if (container.clientHeight > 0) {
      setViewportHeight(container.clientHeight);
    }
    stickToBottomRef.current =
      container.scrollHeight - container.scrollTop - container.clientHeight <= AUTO_SCROLL_STICK_DISTANCE;
  }

  const rowList = isVirtualized
    ? renderVirtualizedRows(filteredEvents, scrollTop, viewportHeight, nodeDisplayNames, onOpenChildRun, onSelectNode)
    : filteredEvents.map((event, index) => (
        <MemoizedRunEventRow
          event={event}
          key={event.id ?? `${event.run_id}-${index}`}
          nodeDisplayNames={nodeDisplayNames}
          onOpenChildRun={onOpenChildRun}
          onSelectNode={onSelectNode}
        />
      ));

  return (
    <div className="run-events" data-virtualized={isVirtualized ? "true" : undefined} ref={scrollContainerRef} onScroll={handleScroll}>
      <label className="run-event-search">
        <span>搜索运行事件</span>
        <input
          aria-label="搜索运行事件"
          placeholder="节点、事件类型、作用域或数据"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      {filteredEvents.length === 0 ? <p className="empty-state">没有匹配的运行事件</p> : null}

      {rowList}
    </div>
  );
}

/** 简单窗口化：固定行高 + scrollTop 纯计算，只渲染可视区 ± buffer 的行，不引入第三方依赖 */
function renderVirtualizedRows(
  filteredEvents: RunEvent[],
  scrollTop: number,
  viewportHeight: number,
  nodeDisplayNames: Record<string, string>,
  onOpenChildRun?: (runId: string) => void,
  onSelectNode?: (target: NodeSelectionTarget) => void,
) {
  const totalHeight = filteredEvents.length * VIRTUAL_ROW_HEIGHT;
  const startIndex = Math.max(0, Math.floor(scrollTop / VIRTUAL_ROW_HEIGHT) - VIRTUAL_BUFFER_ROWS);
  const endIndex = Math.min(
    filteredEvents.length,
    Math.ceil((scrollTop + viewportHeight) / VIRTUAL_ROW_HEIGHT) + VIRTUAL_BUFFER_ROWS,
  );
  const visibleEvents = filteredEvents.slice(startIndex, endIndex);

  return (
    <div aria-label="运行事件窗口" className="run-event-virtual-spacer" role="list" style={{ height: totalHeight }}>
      {visibleEvents.map((event, index) => {
        const rowIndex = startIndex + index;
        return (
          <div
            className="run-event-virtual-row"
            key={event.id ?? `${event.run_id}-${rowIndex}`}
            role="listitem"
            style={{ top: rowIndex * VIRTUAL_ROW_HEIGHT, height: VIRTUAL_ROW_HEIGHT }}
          >
            <MemoizedRunEventRow
              event={event}
              nodeDisplayNames={nodeDisplayNames}
              onOpenChildRun={onOpenChildRun}
              onSelectNode={onSelectNode}
            />
          </div>
        );
      })}
    </div>
  );
}

type RunEventRowProps = {
  event: RunEvent;
  nodeDisplayNames: Record<string, string>;
  onOpenChildRun?: (runId: string) => void;
  onSelectNode?: (target: NodeSelectionTarget) => void;
};

function RunEventRow({ event, nodeDisplayNames, onOpenChildRun, onSelectNode }: RunEventRowProps) {
  const eventLabel = translateEventType(event.type);
  const nodeLabel = event.node_id ? nodeDisplayName(event.node_id, nodeDisplayNames) : "工作流";
  const content = (
    <>
      <time>{formatTime(event.timestamp)}</time>
      <strong>{eventLabel}</strong>
      <span>{nodeLabel}</span>
      {event.scope.length > 0 ? <em>{formatScope(event.scope)}</em> : null}
      <RunEventPayload payload={event.payload} />
    </>
  );
  const childRunId = typeof event.payload.child_run_id === "string" ? event.payload.child_run_id : null;
  const errorRunId = typeof event.payload.error_run_id === "string" ? event.payload.error_run_id : null;
  const retryRunId = typeof event.payload.retry_run_id === "string" ? event.payload.retry_run_id : null;
  const sourceRunId = typeof event.payload.source_run_id === "string" ? event.payload.source_run_id : null;
  const linkedRunId = childRunId ?? errorRunId ?? retryRunId ?? sourceRunId;
  const linkedRunLabel = errorRunId
    ? "查看错误处理运行"
    : retryRunId
      ? "查看重试运行"
      : sourceRunId
        ? "查看原运行"
        : "查看子运行";

  if (linkedRunId && onOpenChildRun) {
    return (
      <div className="run-event run-event-child-link">
        {content}
        <button type="button" onClick={() => onOpenChildRun(linkedRunId)}>
          {linkedRunLabel}
        </button>
      </div>
    );
  }

  if (event.node_id && onSelectNode) {
    // 行内还有展开/复制按钮，外层改用 role="button" 的 div，避免按钮嵌套按钮
    function handleRowKeyDown(keyboardEvent: KeyboardEvent<HTMLDivElement>) {
      if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
        keyboardEvent.preventDefault();
        onSelectNode?.(buildNodeRuntimeTarget(event.node_id as string, "run_event", event.scope));
      }
    }

    return (
      <div
        aria-label={`${eventLabel} ${nodeLabel}`}
        className="run-event run-event-button"
        role="button"
        tabIndex={0}
        onClick={() => onSelectNode(buildNodeRuntimeTarget(event.node_id as string, "run_event", event.scope))}
        onKeyDown={handleRowKeyDown}
      >
        {content}
      </div>
    );
  }

  return <div className="run-event">{content}</div>;
}

// 事件行数据在运行期间只增不变，用 memo 避免大量事件到达时整列表重渲染
const MemoizedRunEventRow = memo(RunEventRow);

/** payload 默认截断展示，超长可展开查看或复制完整 JSON */
function RunEventPayload({ payload }: { payload: RunEvent["payload"] }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const fullJson = useMemo(() => {
    try {
      return JSON.stringify(payload);
    } catch {
      return String(payload);
    }
  }, [payload]);
  const isOverflow = fullJson.length > PAYLOAD_PREVIEW_LIMIT;
  const displayText = isOverflow && !isExpanded ? `${fullJson.slice(0, PAYLOAD_PREVIEW_LIMIT)}...` : fullJson;

  function handleToggle(mouseEvent: MouseEvent<HTMLButtonElement>) {
    mouseEvent.stopPropagation();
    setIsExpanded((current) => !current);
  }

  async function handleCopy(mouseEvent: MouseEvent<HTMLButtonElement>) {
    mouseEvent.stopPropagation();
    try {
      await navigator.clipboard.writeText(fullJson);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <span className={isExpanded ? "run-event-payload is-expanded" : "run-event-payload"}>
      <code>{displayText}</code>
      {isOverflow ? (
        <span className="run-event-payload-actions">
          <button aria-expanded={isExpanded} type="button" onClick={handleToggle}>
            {isExpanded ? "收起" : "展开"}
          </button>
          <button type="button" onClick={handleCopy}>
            {copyState === "copied" ? "已复制" : copyState === "failed" ? "复制失败" : "复制完整 JSON"}
          </button>
        </span>
      ) : null}
    </span>
  );
}
