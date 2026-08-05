import { useEffect, useState, type ReactNode } from "react";
import type { NodeRunDetail } from "../lib/nodeRunDetail";
import type { ExecutionConnection } from "../lib/executionData";
import {
  executionItemMetadata,
  normalizeExecutionItems,
  type ExecutionItem,
  type ExecutionItemContext,
} from "../lib/executionItems";
import {
  buildRuntimeInsight,
  eventTypeLabel,
  filterExecutionItems,
  filterRuntimeExecutions,
  formatCompactUnknown,
  formatRuntimeTime,
  formatScope,
  formatScopePart,
  formatUnknown,
  logFields,
  logLevel,
  logLevelClass,
  logMessage,
  logTimestamp,
  nodeRunStatusLabel,
  runtimeSearchMatchCount,
  runtimeValueMatches,
} from "../lib/runtimeDisplay";
import type { NodeRuntimeState } from "../lib/runState";
import type { NodeType } from "../types";

type NodeRuntimePanelProps = {
  nodeType?: NodeType;
  nodeTypeId: string;
  runtimeState: NodeRuntimeState;
  runDetail?: NodeRunDetail;
  sourceLabel?: string;
  navigationScope?: string[] | null;
};

type RuntimeDetailsSection = "data" | "logs" | "events" | "raw";

const RUNTIME_DETAIL_SECTIONS: Array<{ id: RuntimeDetailsSection; label: string }> = [
  { id: "data", label: "执行数据" },
  { id: "logs", label: "日志" },
  { id: "events", label: "事件" },
  { id: "raw", label: "原始数据" },
];

export function NodeRuntimePanel({
  nodeType,
  nodeTypeId,
  runtimeState,
  runDetail,
  sourceLabel,
  navigationScope,
}: NodeRuntimePanelProps) {
  const [searchText, setSearchText] = useState("");
  const [activeSection, setActiveSection] = useState<RuntimeDetailsSection>("data");
  const insightLines = buildRuntimeInsight(nodeTypeId, runtimeState.outputs);
  const searchQuery = searchText.trim();
  const searchMatchCount = runtimeSearchMatchCount(runtimeState, searchQuery);
  const hasNavigationScope = navigationScope !== undefined && navigationScope !== null;

  useEffect(() => {
    setActiveSection("data");
  }, [runtimeState.nodeId]);

  return (
    <div className="runtime-details">
      <div className="runtime-summary">
        <span>状态：{nodeRunStatusLabel(runtimeState.status)}</span>
        {sourceLabel ? <span>来源：{sourceLabel}</span> : null}
        {hasNavigationScope ? <span>范围：{formatScope(navigationScope)}</span> : null}
        {typeof runtimeState.durationMs === "number" ? <span>耗时：{runtimeState.durationMs} ms</span> : null}
        {runDetail ? <span>执行：{runDetail.executionCount} 次</span> : null}
        {runDetail ? <span>事件：{runDetail.eventCount} 条</span> : null}
        {runDetail ? <span>输入：{runDetail.inputItemCount} 项</span> : null}
        {runDetail ? <span>输出：{runDetail.outputItemCount} 项</span> : null}
      </div>
      <label className="runtime-search">
        <span>搜索运行数据</span>
        <input
          type="search"
          value={searchText}
          placeholder="字段、值、日志..."
          onChange={(event) => setSearchText(event.currentTarget.value)}
        />
      </label>
      {searchQuery ? (
        <p className={searchMatchCount > 0 ? "runtime-search-result" : "runtime-search-result is-empty"}>
          {searchMatchCount > 0 ? `找到 ${searchMatchCount} 项匹配` : "没有匹配的运行数据"}
        </p>
      ) : null}
      <div className="runtime-detail-tabs" role="tablist" aria-label="运行详情分区">
        {RUNTIME_DETAIL_SECTIONS.map((section) => (
          <button
            aria-selected={activeSection === section.id}
            key={section.id}
            role="tab"
            type="button"
            onClick={() => setActiveSection(section.id)}
          >
            {section.label}
          </button>
        ))}
      </div>
      {activeSection === "data" ? (
        <>
          {insightLines.length > 0 ? (
            <div className="runtime-insight" aria-label="运行摘要">
              <strong>摘要</strong>
              <div>
                {insightLines.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            </div>
          ) : null}
          <RuntimeExecutionList executions={runtimeState.executions ?? []} nodeType={nodeType} searchQuery={searchQuery} />
        </>
      ) : null}
      {activeSection === "logs" ? <RuntimeLogList logs={runtimeState.logs} searchQuery={searchQuery} /> : null}
      {activeSection === "events" ? <RuntimeEventTimeline events={runtimeState.events ?? []} /> : null}
      {activeSection === "raw" ? (
        <>
          <RuntimeBlock title="输入" value={runtimeState.inputs} />
          <RuntimeBlock title="输出" value={runtimeState.outputs} />
          <RuntimeBlock title="错误" value={runtimeState.error} />
          {runtimeState.scopes.length > 0 ? (
            <div className="runtime-block">
              <strong>范围</strong>
              <pre>{runtimeState.scopes.map(formatScope).join("\n")}</pre>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function RuntimeExecutionList({
  executions,
  nodeType,
  searchQuery,
}: {
  executions: NonNullable<NodeRuntimeState["executions"]>;
  nodeType?: NodeType;
  searchQuery: string;
}) {
  const latestRunIndex = executions[executions.length - 1]?.runIndex ?? 0;
  const [selectedRunIndex, setSelectedRunIndex] = useState(latestRunIndex);

  useEffect(() => {
    setSelectedRunIndex(latestRunIndex);
  }, [latestRunIndex, executions.length]);

  if (executions.length === 0) {
    return (
      <div className="runtime-block">
        <strong>执行记录</strong>
        <p className="runtime-muted">这个节点还没有运行记录。</p>
      </div>
    );
  }

  const visibleExecutions = filterRuntimeExecutions(executions, searchQuery);

  if (visibleExecutions.length === 0) {
    return (
      <div className="runtime-block">
        <strong>执行记录</strong>
        <p className="runtime-muted">没有匹配的执行记录。</p>
      </div>
    );
  }

  const selectedExecution =
    visibleExecutions.find((execution) => execution.runIndex === selectedRunIndex) ?? visibleExecutions[visibleExecutions.length - 1];
  const outputConnections = Object.values(selectedExecution.outputs);

  return (
    <div className="runtime-block">
      <strong>执行记录</strong>
      {visibleExecutions.length > 1 ? (
        <div className="runtime-execution-picker" role="group" aria-label="执行批次">
          <div>
            {visibleExecutions.map((execution) => (
              <button
                aria-pressed={execution.runIndex === selectedExecution.runIndex}
                key={execution.runIndex}
                type="button"
                onClick={() => setSelectedRunIndex(execution.runIndex)}
              >
                {execution.attempt ? `第 ${execution.attempt} 次尝试` : `第 ${execution.runIndex + 1} 次`}
              </button>
            ))}
          </div>
          <p>当前查看：{selectedExecution.attempt ? `第 ${selectedExecution.attempt} 次尝试` : `第 ${selectedExecution.runIndex + 1} 次执行`}</p>
        </div>
      ) : null}
      <div className="runtime-execution-list">
        <article
          aria-current="true"
          aria-label={selectedExecution.attempt ? `第 ${selectedExecution.attempt} 次尝试` : `第 ${selectedExecution.runIndex + 1} 次执行`}
          className="runtime-execution-card is-selected"
          key={selectedExecution.runIndex}
        >
          <div className="runtime-execution-head">
            <span>{selectedExecution.attempt ? `第 ${selectedExecution.attempt} 次尝试` : `第 ${selectedExecution.runIndex + 1} 次执行`}</span>
            <em className={`runtime-execution-status status-${selectedExecution.status}`}>{nodeRunStatusLabel(selectedExecution.status)}</em>
            {typeof selectedExecution.durationMs === "number" ? <small>{selectedExecution.durationMs} ms</small> : null}
            <RuntimeScopeChips scope={selectedExecution.scope} />
          </div>
          {selectedExecution.itemContext ? (
            <RuntimeLoopItemContext itemContext={selectedExecution.itemContext} searchQuery={searchQuery} />
          ) : null}
          <RuntimeExecutionSection title="输入">
            {selectedExecution.inputs !== undefined ? (
              <RuntimeInputConnection items={selectedExecution.inputItems} searchQuery={searchQuery} value={selectedExecution.inputs} />
            ) : (
              <p className="runtime-muted">这次执行没有输入数据。</p>
            )}
          </RuntimeExecutionSection>
          <RuntimeExecutionSection title="输出">
            {outputConnections.length > 0 ? (
              <div className="runtime-port-list" aria-label={`第 ${selectedExecution.runIndex + 1} 次输出端口`}>
                {outputConnections.map((connection) => (
                  <RuntimeOutputConnection
                    connection={connection}
                    displayName={outputPortDisplayName(connection.name, nodeType)}
                    key={connection.name}
                    searchQuery={searchQuery}
                  />
                ))}
              </div>
            ) : (
              <p className="runtime-muted">这次执行没有输出端口数据。</p>
            )}
          </RuntimeExecutionSection>
          <RuntimeExecutionDiagnostics
            error={selectedExecution.error}
            logs={selectedExecution.logs}
            searchQuery={searchQuery}
          />
        </article>
      </div>
    </div>
  );
}

function RuntimeExecutionSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section aria-label={`本次${title}`} className="runtime-execution-section" role="region">
      <div className="runtime-execution-section-head">
        <strong>{title}</strong>
      </div>
      {children}
    </section>
  );
}

function RuntimeExecutionDiagnostics({
  error,
  logs,
  searchQuery,
}: {
  error: unknown;
  logs: unknown;
  searchQuery: string;
}) {
  if (logs === undefined && error === undefined) {
    return null;
  }

  return (
    <RuntimeExecutionSection title="诊断">
      <div className="runtime-execution-diagnostics">
      {logs !== undefined ? <RuntimeLogList logs={logs} searchQuery={searchQuery} /> : null}
      <RuntimeBlock title="错误" value={error} />
      </div>
    </RuntimeExecutionSection>
  );
}

function RuntimeLoopItemContext({
  itemContext,
  searchQuery,
}: {
  itemContext: ExecutionItemContext;
  searchQuery: string;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const itemLabel = `第 ${itemContext.index + 1} 项`;

  return (
    <div className="runtime-loop-item-context">
      <button
        aria-expanded={isExpanded}
        aria-label={`查看${itemLabel}循环数据`}
        className="runtime-port-row runtime-port-toggle"
        type="button"
        onClick={() => setIsExpanded((current) => !current)}
      >
        <strong>循环数据项</strong>
        <span>{itemLabel}</span>
        <code>{formatCompactUnknown(itemContext.item.json)}</code>
      </button>
      {isExpanded ? <RuntimeItemList connectionName={itemLabel} items={[itemContext.item]} searchQuery={searchQuery} /> : null}
    </div>
  );
}

function RuntimeInputConnection({
  items: providedItems,
  searchQuery,
  value,
}: {
  items?: ExecutionItem[];
  searchQuery: string;
  value: unknown;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const items = providedItems ?? normalizeExecutionItems(value);
  const itemCount = items.length;
  const hasItems = itemCount > 0;

  return (
    <div className="runtime-input-entry">
      <button
        aria-expanded={isExpanded}
        aria-label={hasItems ? `查看输入的 ${itemCount} 项明细` : "输入没有 item 明细"}
        className="runtime-execution-json runtime-input-toggle"
        disabled={!hasItems}
        type="button"
        onClick={() => setIsExpanded((current) => !current)}
      >
        <span>输入</span>
        <code>{formatCompactUnknown(value)}</code>
      </button>
      {isExpanded && hasItems ? <RuntimeItemList connectionName="输入" items={items} searchQuery={searchQuery} /> : null}
    </div>
  );
}
function RuntimeOutputConnection({
  connection,
  displayName,
  searchQuery,
}: {
  connection: ExecutionConnection;
  displayName: string;
  searchQuery: string;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const itemCount = connection.items.length;
  const hasItems = itemCount > 0;

  return (
    <div className="runtime-port-entry">
      <button
        aria-expanded={isExpanded}
        aria-label={hasItems ? `查看 ${displayName} 的 ${itemCount} 项明细` : `${displayName} 没有 item 明细`}
        className="runtime-port-row runtime-port-toggle"
        disabled={!hasItems}
        type="button"
        onClick={() => setIsExpanded((current) => !current)}
      >
        <strong>{displayName}</strong>
        <span>{itemCount} 项</span>
        <code>{formatCompactUnknown(connection.value)}</code>
      </button>
      {isExpanded && hasItems ? (
        <RuntimeItemList connectionName={displayName} items={connection.items} searchQuery={searchQuery} />
      ) : null}
    </div>
  );
}

function outputPortDisplayName(connectionName: string, nodeType?: NodeType): string {
  return nodeType?.outputs[connectionName]?.displayName || connectionName;
}

function RuntimeItemList({
  connectionName,
  items,
  searchQuery,
}: {
  connectionName: string;
  items: ExecutionItem[];
  searchQuery: string;
}) {
  const visibleItems = filterExecutionItems(items, searchQuery);

  if (visibleItems.length === 0) {
    return <p className="runtime-muted">没有匹配的 item 明细。</p>;
  }

  return (
    <ol className="runtime-item-list" aria-label={`${connectionName} item 明细`}>
      {visibleItems.map(({ item, originalIndex }) => {
        const metadata = executionItemMetadata(item);

        return (
          <li className="runtime-item-card" key={originalIndex}>
            <div className="runtime-item-head">
              <strong>第 {originalIndex + 1} 项</strong>
              {metadata ? <span>含元数据</span> : null}
              <RuntimeCopyButton
                label={`${connectionName} 第 ${originalIndex + 1} 项`}
                text={formatUnknown(item.json)}
              />
            </div>
            <pre>{formatUnknown(item.json)}</pre>
            {metadata ? (
              <div className="runtime-item-metadata">
                <span>元数据</span>
                <pre>{formatUnknown(metadata)}</pre>
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function RuntimeScopeChips({ scope }: { scope: string[] }) {
  const parts = scope.length > 0 ? scope.map(formatScopePart) : ["主流程"];

  return (
    <div className="runtime-scope-chips" aria-label="执行范围">
      {parts.map((part, index) => (
        <span key={`${part}-${index}`}>{part}</span>
      ))}
    </div>
  );
}

function RuntimeEventTimeline({ events }: { events: NonNullable<NodeRuntimeState["events"]> }) {
  if (events.length === 0) {
    return (
      <div className="runtime-block">
        <strong>执行时间线</strong>
        <p className="runtime-muted">这个节点在本次运行中还没有执行事件。</p>
      </div>
    );
  }

  return (
    <div className="runtime-block">
      <strong>执行时间线</strong>
      <ol className="runtime-event-list">
        {events.map((event, index) => (
          <li key={`${event.type}-${event.timestamp}-${index}`}>
            <div className="runtime-event-head">
              <span>{eventTypeLabel(event.type)}</span>
              <time>{formatRuntimeTime(event.timestamp)}</time>
            </div>
            <div className="runtime-event-meta">
              {typeof event.durationMs === "number" ? <span>{event.durationMs} ms</span> : null}
              {event.nextAttempt ? <span>第 {event.nextAttempt} 次尝试</span> : null}
              {typeof event.delayMs === "number" ? <span>等待 {event.delayMs} ms</span> : null}
              {event.mode === "continue" ? <span>失败后继续</span> : null}
              {event.mode === "errorOutput" ? <span>走错误端口</span> : null}
              <span>{formatScope(event.scope)}</span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function RuntimeLogList({ logs, searchQuery }: { logs: unknown; searchQuery: string }) {
  if (logs === undefined) {
    return (
      <div className="runtime-block">
        <strong>日志</strong>
        <p className="runtime-muted">这个节点没有写入日志。</p>
      </div>
    );
  }

  if (!Array.isArray(logs)) {
    return <RuntimeBlock title="日志" value={logs} />;
  }

  if (logs.length === 0) {
    return (
      <div className="runtime-block">
        <strong>日志</strong>
        <p className="runtime-muted">这个节点没有写入日志。</p>
      </div>
    );
  }

  const visibleLogs = logs
    .map((log, originalIndex) => ({ log, originalIndex }))
    .filter(({ log }) => !searchQuery || runtimeValueMatches(log, searchQuery));

  if (visibleLogs.length === 0) {
    return (
      <div className="runtime-block">
        <strong>日志</strong>
        <p className="runtime-muted">没有匹配的日志。</p>
      </div>
    );
  }

  return (
    <div className="runtime-block">
      <strong>日志</strong>
      <ul className="runtime-log-list">
        {visibleLogs.map(({ log, originalIndex }) => (
          <li key={originalIndex}>
            <span className={`runtime-log-level ${logLevelClass(log)}`}>{logLevel(log)}</span>
            <div>
              <p>{logMessage(log)}</p>
              {logTimestamp(log) ? <time>{formatRuntimeTime(logTimestamp(log) ?? "")}</time> : null}
              {logFields(log) ? <pre>{formatUnknown(logFields(log))}</pre> : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RuntimeCopyButton({ label, text }: { label: string; text: string }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <button aria-label={`复制 ${label}`} className="runtime-copy-button" type="button" onClick={handleCopy}>
      {copyState === "copied" ? "已复制" : copyState === "failed" ? "复制失败" : "复制"}
    </button>
  );
}

function RuntimeBlock({ title, value }: { title: string; value: unknown }) {
  if (value === undefined) {
    return null;
  }

  const text = formatUnknown(value);

  return (
    <div className="runtime-block">
      <div className="runtime-block-head">
        <strong>{title}</strong>
        <RuntimeCopyButton label={title} text={text} />
      </div>
      <pre>{text}</pre>
    </div>
  );
}
