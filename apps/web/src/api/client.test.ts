import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "./client";

describe("ApiClient", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
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
    expect(fetchMock).toHaveBeenCalledWith("http://api.test/api/node-types", undefined);
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
    expect(fetchMock).toHaveBeenCalledWith("http://api.test/api/node-types", undefined);
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
    expect(fetchMock).toHaveBeenCalledWith("http://api.test/api/workflows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(workflow),
    });
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
    expect(fetchMock).toHaveBeenCalledWith("http://api.test/api/workflows/workflow%2Fwith%20space/runs", {
      method: "POST",
    });
  });
});
