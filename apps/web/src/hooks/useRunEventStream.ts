import type { RunEvent } from "../types";

// 运行终态事件类型（与后端 executor 发出的 run_succeeded / run_failed / run_cancelled 对应）
const TERMINAL_RUN_EVENT_TYPES = new Set([
  "run_succeeded",
  "run_failed",
  "run_cancelled",
]);

// SSE 断线重连（含补齐）的默认最大连续失败次数，超过后通知调用方降级轮询
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 3;
// 重连退避基准延迟（毫秒）：随连续失败次数指数退避，避免断线后无退避重连造成请求风暴
const DEFAULT_RECONNECT_BASE_DELAY_MS = 500;
// 重连退避延迟上限（毫秒）
const DEFAULT_RECONNECT_MAX_DELAY_MS = 8000;
// 连续“连接被服务端关闭且未推送任何新事件”的熔断阈值：
// run 到达终态后服务端会关流，若回放事件已全部被去重过滤，盲目重连会形成
// 重连风暴；连续多次空连接后改为降级轮询，由轮询确认终态
const DEFAULT_MAX_EMPTY_RECONNECTS = 2;

export function isTerminalRunEvent(event: RunEvent): boolean {
  return TERMINAL_RUN_EVENT_TYPES.has(event.type);
}

// 测试环境（jsdom）没有 EventSource，直接判定不支持以便走轮询降级
export function isRunEventStreamSupported(): boolean {
  return typeof EventSource !== "undefined";
}

/** 取事件数组中最大的事件 id（用作增量游标），无 id 时返回 0 */
export function maxRunEventId(events: RunEvent[]): number {
  let maxId = 0;
  for (const event of events) {
    if (typeof event.id === "number" && event.id > maxId) {
      maxId = event.id;
    }
  }
  return maxId;
}

/**
 * 按 id 去重合并事件：保留已有顺序，追加未见过的增量事件，最终按 id 升序排列
 * （与后端全量查询的返回顺序一致）；无 id 的事件不参与去重、稳定排在尾部。
 */
export function mergeRunEvents(existing: RunEvent[], incoming: RunEvent[]): RunEvent[] {
  if (incoming.length === 0) {
    return existing;
  }
  const seenIds = new Set<number>();
  for (const event of existing) {
    if (typeof event.id === "number") {
      seenIds.add(event.id);
    }
  }
  const merged = [...existing];
  let appended = false;
  for (const event of incoming) {
    if (typeof event.id === "number") {
      if (seenIds.has(event.id)) {
        continue;
      }
      seenIds.add(event.id);
    }
    merged.push(event);
    appended = true;
  }
  if (!appended) {
    return existing;
  }
  return merged.sort(
    (left, right) =>
      (left.id ?? Number.MAX_SAFE_INTEGER) - (right.id ?? Number.MAX_SAFE_INTEGER),
  );
}

export type RunEventStreamOptions = {
  url: string;
  /** 断线重连前用 last event id 拉取缺口事件 */
  fetchEventsAfter: (afterId: number) => Promise<RunEvent[]>;
  /** 新增事件（已按游标去重，可能来自流帧或断线补齐） */
  onEvents: (events: RunEvent[]) => void;
  /** 需要降级到轮询时触发（连接建立失败、补齐失败或重连超限） */
  onFallback: (reason: string) => void;
  /** 初始游标：订阅前客户端已持有的最大事件 id */
  initialAfterId?: number;
  maxReconnectAttempts?: number;
  /** 重连退避基准延迟（毫秒），默认 500，随失败次数指数退避 */
  reconnectBaseDelayMs?: number;
  /** 重连退避延迟上限（毫秒），默认 8000 */
  reconnectMaxDelayMs?: number;
  /** 连续空连接（服务端关流且无新事件）熔断阈值，默认 2 */
  maxEmptyReconnects?: number;
  /** 允许注入 EventSource 实现（测试用 fake） */
  eventSourceImpl?: typeof EventSource;
};

export type RunEventStreamHandle = {
  close: () => void;
  getLastEventId: () => number;
};

/**
 * 打开运行事件 SSE 流。
 * - 逐帧解析 `id: {n}\ndata: {事件JSON}` 中的 data，按自增 id 游标去重后回调；
 * - 断线（onerror）时关闭当前连接，先调 fetchEventsAfter(lastId) 补齐缺口，
 *   再按指数退避重连（避免无退避立即重连造成连接风暴）；
 * - 补齐失败、连续重连失败超限，或连接反复被服务端关闭且无新增事件（通常是
 *   run 已终态）时，通过 onFallback 通知调用方降级轮询；
 * - 不支持 EventSource 的环境（如 jsdom）返回 null，调用方直接走轮询。
 */
export function openRunEventStream({
  url,
  fetchEventsAfter,
  onEvents,
  onFallback,
  initialAfterId = 0,
  maxReconnectAttempts = DEFAULT_MAX_RECONNECT_ATTEMPTS,
  reconnectBaseDelayMs = DEFAULT_RECONNECT_BASE_DELAY_MS,
  reconnectMaxDelayMs = DEFAULT_RECONNECT_MAX_DELAY_MS,
  maxEmptyReconnects = DEFAULT_MAX_EMPTY_RECONNECTS,
  eventSourceImpl,
}: RunEventStreamOptions): RunEventStreamHandle | null {
  const EventSourceImpl =
    eventSourceImpl ?? (isRunEventStreamSupported() ? EventSource : undefined);
  if (!EventSourceImpl) {
    return null;
  }

  let closedByCaller = false;
  let fallbackNotified = false;
  let reconnecting = false;
  let failedAttempts = 0;
  // 连续“连接成功建立后被服务端关闭、且期间未推送任何新事件”的次数
  let emptyReconnectStreak = 0;
  // 当前连接生命周期内的状态：是否建立成功过、是否推送过新事件
  let openedDuringConnection = false;
  let freshDuringConnection = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let lastEventId = initialAfterId;
  let source: EventSource | null = null;

  const notifyFallback = (reason: string) => {
    if (fallbackNotified || closedByCaller) {
      return;
    }
    fallbackNotified = true;
    onFallback(reason);
  };

  // 按游标去重后向调用方推送新事件，并推进 last event id
  const emit = (events: RunEvent[]) => {
    if (closedByCaller || events.length === 0) {
      return;
    }
    const fresh: RunEvent[] = [];
    for (const event of events) {
      if (typeof event.id === "number") {
        if (event.id <= lastEventId) {
          continue;
        }
        lastEventId = event.id;
      }
      fresh.push(event);
    }
    if (fresh.length > 0) {
      freshDuringConnection = true;
      onEvents(fresh);
    }
  };

  const connect = () => {
    if (closedByCaller || fallbackNotified) {
      return;
    }
    openedDuringConnection = false;
    freshDuringConnection = false;
    source = new EventSourceImpl(url);
    source.onopen = () => {
      openedDuringConnection = true;
      // 连接建立成功，重置连续失败计数
      failedAttempts = 0;
    };
    source.onmessage = (message) => {
      try {
        emit([JSON.parse(String(message.data)) as RunEvent]);
      } catch {
        // 无法解析的帧直接忽略，避免中断整个流
      }
    };
    source.onerror = () => {
      void handleError();
    };
  };

  // 计算指数退避延迟：随连续失败次数翻倍，封顶 reconnectMaxDelayMs
  const reconnectDelay = () =>
    Math.min(
      reconnectBaseDelayMs * 2 ** Math.max(failedAttempts - 1, 0),
      reconnectMaxDelayMs,
    );

  // 按退避延迟安排重连；close() 会取消尚未执行的重连定时器
  const scheduleReconnect = () => {
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectDelay());
  };

  // 断线处理：关闭当前连接 -> 增量补齐缺口 -> 退避重连；失败则降级
  const handleError = async () => {
    source?.close();
    source = null;
    if (closedByCaller || fallbackNotified || reconnecting) {
      return;
    }
    // 连接成功建立后被服务端关闭、且未推送任何新事件：run 到达终态后服务端
    // 会关流，此时回放事件全部被去重过滤。连续多次空连接说明继续重连只会
    // 形成连接风暴，改为降级轮询确认终态
    if (openedDuringConnection && !freshDuringConnection) {
      emptyReconnectStreak += 1;
      if (emptyReconnectStreak >= maxEmptyReconnects) {
        notifyFallback("SSE 流持续无新增事件即被关闭，已降级轮询");
        return;
      }
    } else if (freshDuringConnection) {
      emptyReconnectStreak = 0;
    }
    if (failedAttempts >= maxReconnectAttempts) {
      notifyFallback("SSE 重连失败次数超限，已降级轮询");
      return;
    }
    failedAttempts += 1;
    reconnecting = true;
    try {
      const missed = await fetchEventsAfter(lastEventId);
      if (closedByCaller || fallbackNotified) {
        return;
      }
      emit(missed);
      scheduleReconnect();
    } catch {
      notifyFallback("SSE 断线补齐失败，已降级轮询");
    } finally {
      reconnecting = false;
    }
  };

  connect();

  return {
    close: () => {
      closedByCaller = true;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      source?.close();
      source = null;
    },
    getLastEventId: () => lastEventId,
  };
}
