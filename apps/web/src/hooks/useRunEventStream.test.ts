import { describe, expect, it, vi } from "vitest";
import type { RunEvent } from "../types";
import {
  isRunEventStreamSupported,
  isTerminalRunEvent,
  maxRunEventId,
  mergeRunEvents,
  openRunEventStream,
} from "./useRunEventStream";

function event(id: number, type = "node_started"): RunEvent {
  return {
    id,
    run_id: "run-1",
    type,
    timestamp: "2026-08-01T00:00:00Z",
    scope: [],
    payload: {},
  };
}

// 可注入的 EventSource 假实现：手动触发 open/message/error 模拟服务端行为
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  closed = false;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  open() {
    this.onopen?.(new Event("open"));
  }

  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }

  fail() {
    this.onerror?.(new Event("error"));
  }

  static reset() {
    FakeEventSource.instances = [];
  }

  static get latest(): FakeEventSource {
    return FakeEventSource.instances[FakeEventSource.instances.length - 1];
  }
}

const fakeEventSourceImpl = FakeEventSource as unknown as typeof EventSource;
const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));
// 重连改为 setTimeout 退避后，需要连续两个零延迟定时周期：
// 第一 tick 冲刷微任务（补齐请求）并排入重连定时器，第二 tick 让重连定时器执行
const flushReconnect = async () => {
  await flushMicrotasks();
  await flushMicrotasks();
};

describe("mergeRunEvents", () => {
  it("按 id 去重合并增量事件并保持升序", () => {
    const merged = mergeRunEvents([event(2)], [event(1), event(2), event(3)]);

    expect(merged.map((item) => item.id)).toEqual([1, 2, 3]);
  });

  it("增量全部重复时返回原数组引用", () => {
    const existing = [event(1), event(2)];

    expect(mergeRunEvents(existing, [event(1)])).toBe(existing);
    expect(mergeRunEvents(existing, [])).toBe(existing);
  });

  it("无 id 的事件不参与去重并追加到尾部", () => {
    const noId: RunEvent = { ...event(0), id: undefined };
    const merged = mergeRunEvents([event(1), noId], [noId, event(2)]);

    expect(merged.length).toBe(4);
    expect(merged[merged.length - 2]).toEqual(noId);
  });
});

describe("isTerminalRunEvent", () => {
  it("识别运行终态事件类型", () => {
    expect(isTerminalRunEvent(event(1, "run_succeeded"))).toBe(true);
    expect(isTerminalRunEvent(event(2, "run_failed"))).toBe(true);
    expect(isTerminalRunEvent(event(3, "run_cancelled"))).toBe(true);
    expect(isTerminalRunEvent(event(4, "node_started"))).toBe(false);
    expect(isTerminalRunEvent(event(5, "child_run_succeeded"))).toBe(false);
  });
});

describe("maxRunEventId", () => {
  it("返回最大事件 id，空数组返回 0", () => {
    expect(maxRunEventId([event(1), event(5), event(3)])).toBe(5);
    expect(maxRunEventId([])).toBe(0);
  });
});

describe("openRunEventStream", () => {
  it("环境不支持 EventSource 时返回 null 供调用方降级", () => {
    expect(isRunEventStreamSupported()).toBe(false);
    expect(openRunEventStream({
      url: "http://127.0.0.1:8150/api/runs/run-1/events/stream",
      fetchEventsAfter: vi.fn(),
      onEvents: vi.fn(),
      onFallback: vi.fn(),
    })).toBeNull();
  });

  it("解析流帧并按游标推送新事件", () => {
    FakeEventSource.reset();
    const onEvents = vi.fn();
    openRunEventStream({
      url: "http://test/stream",
      fetchEventsAfter: vi.fn(),
      onEvents,
      onFallback: vi.fn(),
      eventSourceImpl: fakeEventSourceImpl,
    });

    FakeEventSource.latest.emit(event(1));
    FakeEventSource.latest.emit(event(2));

    expect(onEvents).toHaveBeenNthCalledWith(1, [event(1)]);
    expect(onEvents).toHaveBeenNthCalledWith(2, [event(2)]);
  });

  it("忽略 id 不大于游标的重复帧（服务端重连会全量回放）", () => {
    FakeEventSource.reset();
    const onEvents = vi.fn();
    openRunEventStream({
      url: "http://test/stream",
      fetchEventsAfter: vi.fn(),
      onEvents,
      onFallback: vi.fn(),
      eventSourceImpl: fakeEventSourceImpl,
    });

    FakeEventSource.latest.emit(event(1));
    FakeEventSource.latest.emit(event(2));
    FakeEventSource.latest.emit(event(2));

    expect(onEvents).toHaveBeenCalledTimes(2);
  });

  it("跳过订阅前客户端已持有的事件（initialAfterId 之前的回放）", () => {
    FakeEventSource.reset();
    const onEvents = vi.fn();
    openRunEventStream({
      url: "http://test/stream",
      fetchEventsAfter: vi.fn(),
      onEvents,
      onFallback: vi.fn(),
      initialAfterId: 2,
      eventSourceImpl: fakeEventSourceImpl,
    });

    FakeEventSource.latest.emit(event(1));
    FakeEventSource.latest.emit(event(2));
    FakeEventSource.latest.emit(event(3));

    expect(onEvents).toHaveBeenCalledTimes(1);
    expect(onEvents).toHaveBeenCalledWith([event(3)]);
  });

  it("忽略无法解析的帧且不中断流", () => {
    FakeEventSource.reset();
    const onEvents = vi.fn();
    openRunEventStream({
      url: "http://test/stream",
      fetchEventsAfter: vi.fn(),
      onEvents,
      onFallback: vi.fn(),
      eventSourceImpl: fakeEventSourceImpl,
    });

    FakeEventSource.latest.onmessage?.({ data: "not-json" } as MessageEvent);
    FakeEventSource.latest.emit(event(1));

    expect(onEvents).toHaveBeenCalledTimes(1);
  });

  it("断线时用 last event id 补齐缺口后退避重连", async () => {
    FakeEventSource.reset();
    const onEvents = vi.fn();
    const fetchEventsAfter = vi.fn().mockResolvedValue([event(3)]);
    const handle = openRunEventStream({
      url: "http://test/stream",
      fetchEventsAfter,
      onEvents,
      onFallback: vi.fn(),
      reconnectBaseDelayMs: 0,
      eventSourceImpl: fakeEventSourceImpl,
    });
    const first = FakeEventSource.latest;
    first.emit(event(1));
    first.emit(event(2));

    first.fail();
    await flushReconnect();

    expect(first.closed).toBe(true);
    expect(fetchEventsAfter).toHaveBeenCalledWith(2);
    expect(onEvents).toHaveBeenLastCalledWith([event(3)]);
    expect(FakeEventSource.instances.length).toBe(2);
    handle!.close();
  });

  it("断线补齐失败时触发降级", async () => {
    FakeEventSource.reset();
    const onFallback = vi.fn();
    const handle = openRunEventStream({
      url: "http://test/stream",
      fetchEventsAfter: vi.fn().mockRejectedValue(new Error("API 404")),
      onEvents: vi.fn(),
      onFallback,
      eventSourceImpl: fakeEventSourceImpl,
    });

    FakeEventSource.latest.fail();
    await flushReconnect();

    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(FakeEventSource.instances.length).toBe(1);
    handle!.close();
  });

  it("连续重连失败超过上限时触发降级", async () => {
    FakeEventSource.reset();
    const onFallback = vi.fn();
    const handle = openRunEventStream({
      url: "http://test/stream",
      fetchEventsAfter: vi.fn().mockResolvedValue([]),
      onEvents: vi.fn(),
      onFallback,
      maxReconnectAttempts: 2,
      reconnectBaseDelayMs: 0,
      eventSourceImpl: fakeEventSourceImpl,
    });

    FakeEventSource.latest.fail();
    await flushReconnect();
    FakeEventSource.latest.fail();
    await flushReconnect();
    FakeEventSource.latest.fail();
    await flushReconnect();

    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(FakeEventSource.instances.length).toBe(3);
    handle!.close();
  });

  it("连接成功建立后重置连续失败计数", async () => {
    FakeEventSource.reset();
    const onFallback = vi.fn();
    const handle = openRunEventStream({
      url: "http://test/stream",
      fetchEventsAfter: vi.fn().mockResolvedValue([]),
      onEvents: vi.fn(),
      onFallback,
      maxReconnectAttempts: 1,
      reconnectBaseDelayMs: 0,
      eventSourceImpl: fakeEventSourceImpl,
    });

    // 第一次断线 -> 重连成功（计数清零）-> 再次断线仍允许重连而不是降级
    FakeEventSource.latest.fail();
    await flushReconnect();
    FakeEventSource.latest.open();
    FakeEventSource.latest.fail();
    await flushReconnect();

    expect(onFallback).not.toHaveBeenCalled();
    expect(FakeEventSource.instances.length).toBe(3);
    handle!.close();
  });

  it("close 后不再推送事件且不再重连", async () => {
    FakeEventSource.reset();
    const onEvents = vi.fn();
    const handle = openRunEventStream({
      url: "http://test/stream",
      fetchEventsAfter: vi.fn().mockResolvedValue([event(5)]),
      onEvents,
      onFallback: vi.fn(),
      reconnectBaseDelayMs: 0,
      eventSourceImpl: fakeEventSourceImpl,
    });

    handle!.close();
    FakeEventSource.latest.emit(event(1));
    FakeEventSource.latest.fail();
    await flushReconnect();

    expect(onEvents).not.toHaveBeenCalled();
    expect(FakeEventSource.instances.length).toBe(1);
  });

  it("getLastEventId 返回当前游标", () => {
    FakeEventSource.reset();
    const handle = openRunEventStream({
      url: "http://test/stream",
      fetchEventsAfter: vi.fn(),
      onEvents: vi.fn(),
      onFallback: vi.fn(),
      eventSourceImpl: fakeEventSourceImpl,
    });

    FakeEventSource.latest.emit(event(7));

    expect(handle!.getLastEventId()).toBe(7);
  });

  it("重连延迟随连续失败指数退避并封顶", async () => {
    vi.useFakeTimers();
    try {
      FakeEventSource.reset();
      openRunEventStream({
        url: "http://test/stream",
        fetchEventsAfter: vi.fn().mockResolvedValue([]),
        onEvents: vi.fn(),
        onFallback: vi.fn(),
        maxReconnectAttempts: 10,
        reconnectBaseDelayMs: 100,
        reconnectMaxDelayMs: 150,
        eventSourceImpl: fakeEventSourceImpl,
      });

      // 第一次断线：退避 100ms（100 * 2^0）
      FakeEventSource.latest.fail();
      await vi.advanceTimersByTimeAsync(99);
      expect(FakeEventSource.instances.length).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(FakeEventSource.instances.length).toBe(2);

      // 第二次断线：理论 200ms，被上限封顶为 150ms
      FakeEventSource.latest.fail();
      await vi.advanceTimersByTimeAsync(149);
      expect(FakeEventSource.instances.length).toBe(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(FakeEventSource.instances.length).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("连接建立后被服务端关闭且无新事件，连续多次后降级轮询", async () => {
    FakeEventSource.reset();
    const onFallback = vi.fn();
    const handle = openRunEventStream({
      url: "http://test/stream",
      fetchEventsAfter: vi.fn().mockResolvedValue([]),
      onEvents: vi.fn(),
      onFallback,
      initialAfterId: 5,
      reconnectBaseDelayMs: 0,
      eventSourceImpl: fakeEventSourceImpl,
    });

    // 第一条连接：建立成功，回放事件全部被去重过滤，服务端关流 -> 空连接 1
    const first = FakeEventSource.latest;
    first.open();
    first.emit(event(4));
    first.emit(event(5));
    first.fail();
    await flushReconnect();
    expect(onFallback).not.toHaveBeenCalled();
    expect(FakeEventSource.instances.length).toBe(2);

    // 第二条连接：仍然只有重复回放后关流 -> 空连接达阈值，降级不再重连
    const second = FakeEventSource.latest;
    second.open();
    second.emit(event(5));
    second.fail();
    await flushReconnect();

    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(FakeEventSource.instances.length).toBe(2);
    handle!.close();
  });

  it("推送过新事件的连接断开后重置空连接计数", async () => {
    FakeEventSource.reset();
    const onFallback = vi.fn();
    const handle = openRunEventStream({
      url: "http://test/stream",
      fetchEventsAfter: vi.fn().mockResolvedValue([]),
      onEvents: vi.fn(),
      onFallback,
      reconnectBaseDelayMs: 0,
      eventSourceImpl: fakeEventSourceImpl,
    });

    // 第一条连接推送了新事件后断开：计入失败但不计入空连接
    const first = FakeEventSource.latest;
    first.open();
    first.emit(event(1));
    first.fail();
    await flushReconnect();

    // 第二条连接同样推送新事件后断开：仍允许继续重连
    const second = FakeEventSource.latest;
    second.open();
    second.emit(event(2));
    second.fail();
    await flushReconnect();

    expect(onFallback).not.toHaveBeenCalled();
    expect(FakeEventSource.instances.length).toBe(3);
    handle!.close();
  });

  it("close 会取消尚未执行的退避重连定时器", async () => {
    vi.useFakeTimers();
    try {
      FakeEventSource.reset();
      const handle = openRunEventStream({
        url: "http://test/stream",
        fetchEventsAfter: vi.fn().mockResolvedValue([]),
        onEvents: vi.fn(),
        onFallback: vi.fn(),
        reconnectBaseDelayMs: 1000,
        eventSourceImpl: fakeEventSourceImpl,
      });

      FakeEventSource.latest.fail();
      await vi.advanceTimersByTimeAsync(0);
      handle!.close();
      await vi.advanceTimersByTimeAsync(5000);

      expect(FakeEventSource.instances.length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
