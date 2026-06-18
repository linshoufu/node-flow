import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "./client";

describe("ApiClient", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it("lists node types from the configured API base URL", async () => {
    const nodeTypes = [
      {
        id: "manual.trigger",
        name: "Manual Trigger",
        category: "Triggers",
        description: "Starts a workflow manually.",
        inputs: {},
        outputs: { success: { description: "Initial payload" } },
        configSchema: { type: "object", properties: {} },
      },
    ];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(nodeTypes),
    });
    const client = new ApiClient("http://api.test", fetchMock);

    await expect(client.listNodeTypes()).resolves.toEqual(nodeTypes);
    expect(fetchMock).toHaveBeenCalledWith("http://api.test/api/node-types", {
      signal: expect.any(AbortSignal),
    });
  });

  it("does not invoke the default global fetch as an ApiClient method", async () => {
    const nodeTypes = [
      {
        id: "manual.trigger",
        name: "Manual Trigger",
        category: "Triggers",
        description: "Starts a workflow manually.",
        inputs: {},
        outputs: { success: { description: "Initial payload" } },
        configSchema: { type: "object", properties: {} },
      },
    ];
    const fetchMock = vi.fn(function (this: unknown) {
      if (this instanceof ApiClient) {
        throw new TypeError("Illegal invocation");
      }
      return Promise.resolve({
        ok: true,
        json: vi.fn().mockResolvedValue(nodeTypes),
      } as Response);
    });
    globalThis.fetch = fetchMock;
    const client = new ApiClient("http://api.test");

    await expect(client.listNodeTypes()).resolves.toEqual(nodeTypes);
    expect(fetchMock).toHaveBeenCalledWith("http://api.test/api/node-types", {
      signal: expect.any(AbortSignal),
    });
  });

  it("throws status and response text when the API returns an error", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: vi.fn().mockResolvedValue("broken"),
    });
    const client = new ApiClient("http://api.test", fetchMock);

    await expect(client.listNodeTypes()).rejects.toThrow("API 500: broken");
  });

  it("saves workflows as JSON", async () => {
    const workflow = {
      id: "workflow_1",
      name: "Demo",
      version: 1,
      nodes: [],
      edges: [],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(workflow),
    });
    const client = new ApiClient("http://api.test", fetchMock);

    await expect(client.saveWorkflow(workflow)).resolves.toEqual(workflow);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/api/workflows",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(workflow),
        signal: expect.any(AbortSignal),
      })
    );
  });

  it("creates runs with POST and an encoded workflow id", async () => {
    const run = {
      id: "run_1",
      workflow_id: "workflow/with space",
      workflow_version: 1,
      status: "queued",
      created_at: "2026-06-16T00:00:00Z",
      started_at: null,
      completed_at: null,
      error: null,
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(run),
    });
    const client = new ApiClient("http://api.test", fetchMock);

    await expect(client.createRun("workflow/with space")).resolves.toEqual(run);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/api/workflows/workflow%2Fwith%20space/runs",
      expect.objectContaining({
        method: "POST",
        signal: expect.any(AbortSignal),
      })
    );
  });

  it("cancels runs with POST and an encoded run id", async () => {
    const run = {
      id: "run/with space",
      workflow_id: "workflow_1",
      workflow_version: 1,
      status: "cancelled",
      created_at: "2026-06-18T00:00:00Z",
      started_at: null,
      completed_at: "2026-06-18T00:00:01Z",
      error: null,
      cancel_requested_at: "2026-06-18T00:00:00Z",
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(run),
    });
    const client = new ApiClient("http://api.test", fetchMock);

    await expect(client.cancelRun("run/with space")).resolves.toEqual(run);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/api/runs/run%2Fwith%20space/cancel",
      expect.objectContaining({
        method: "POST",
        signal: expect.any(AbortSignal),
      })
    );
  });

  it("rejects requests that do not settle before the configured timeout", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => new Promise<Response>(() => undefined));
    const client = new ApiClient("http://api.test", fetchMock, { requestTimeoutMs: 25 });

    const request = client.listNodeTypes();
    const expectedTimeout = expect(request).rejects.toThrow("API request timed out after 25ms");
    await vi.advanceTimersByTimeAsync(25);

    await expectedTimeout;
  });
});
