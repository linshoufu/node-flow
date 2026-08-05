import { afterEach, describe, expect, it, vi } from "vitest";
import { LOCAL_API_BASE_URL } from "../lib/projectConfig";
import { ApiClient } from "./client";

describe("ApiClient", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it("uses port 8150 as the default local API base URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue([]),
    });
    const client = new ApiClient(undefined, fetchMock);

    await expect(client.listNodeTypes()).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith(`${LOCAL_API_BASE_URL}/api/node-types`, {
      signal: expect.any(AbortSignal),
    });
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

  it("reloads node types with POST", async () => {
    const nodeTypes = [
      {
        id: "demo.reload",
        name: "Reload Demo",
        category: "Demo",
        description: "Loaded after reload.",
        inputs: {},
        outputs: { success: { description: "Done" } },
        configSchema: { type: "object", properties: {} },
      },
    ];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(nodeTypes),
    });
    const client = new ApiClient("http://api.test", fetchMock);

    await expect(client.reloadNodeTypes()).resolves.toEqual(nodeTypes);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/api/node-types/reload",
      expect.objectContaining({
        method: "POST",
        signal: expect.any(AbortSignal),
      })
    );
  });

  it("gets node package diagnostics", async () => {
    const scan = { packages: [], diagnostics: [], legacyNodeCount: 3 };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(scan),
    });
    const client = new ApiClient("http://api.test", fetchMock);

    await expect(client.listNodePackages()).resolves.toEqual(scan);
    expect(fetchMock).toHaveBeenCalledWith("http://api.test/api/node-packages", {
      signal: expect.any(AbortSignal),
    });
  });

  it("updates node package lifecycle settings with an encoded package id", async () => {
    const scan = { packages: [], diagnostics: [], legacyNodeCount: 0 };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(scan),
    });
    const client = new ApiClient("http://api.test", fetchMock);

    await expect(
      client.updateNodePackageSettings("example/tools", {
        enabled: false,
        locked_version: "1.2.0",
      }),
    ).resolves.toEqual(scan);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/api/node-packages/example%2Ftools/settings",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ enabled: false, locked_version: "1.2.0" }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("installs a ZIP node package and uninstalls an encoded package id", async () => {
    const installResult = {
      action: "installed",
      package: { id: "example/tools", name: "Tools", version: "1.0.0" },
      scan: { packages: [], diagnostics: [], legacyNodeCount: 0 },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(installResult),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(installResult.scan),
      });
    const client = new ApiClient("http://api.test", fetchMock);
    const file = new File(["zip-content"], "工具 包.zip", {
      type: "application/zip",
    });

    await expect(client.installNodePackage(file)).resolves.toEqual(installResult);
    await expect(client.uninstallNodePackage("example/tools")).resolves.toEqual(
      installResult.scan,
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://api.test/api/node-packages/install?filename=%E5%B7%A5%E5%85%B7%20%E5%8C%85.zip",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/zip" },
        body: file,
        signal: expect.any(AbortSignal),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://api.test/api/node-packages/example%2Ftools",
      expect.objectContaining({
        method: "DELETE",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("lists and activates an encoded node package revision", async () => {
    const revisions = [
      {
        revisionId: "rev_123",
        packageId: "example/tools",
        version: "1.0.0",
        sourceFilename: "tools.zip",
        installedAt: "2026-07-31T10:00:00Z",
        archivedAt: "2026-07-31T11:00:00Z",
        checksum: "abc",
      },
    ];
    const restoreResult = {
      action: "rolled_back",
      package: { id: "example/tools", name: "Tools", version: "1.0.0" },
      scan: { packages: [], diagnostics: [], legacyNodeCount: 0 },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(revisions),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(restoreResult),
      });
    const client = new ApiClient("http://api.test", fetchMock);

    await expect(client.listNodePackageRevisions("example/tools")).resolves.toEqual(
      revisions,
    );
    await expect(
      client.activateNodePackageRevision("example/tools", "rev/123"),
    ).resolves.toEqual(restoreResult);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://api.test/api/node-packages/example%2Ftools/revisions",
      { signal: expect.any(AbortSignal) },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://api.test/api/node-packages/example%2Ftools/revisions/rev%2F123/activate",
      expect.objectContaining({ method: "POST", signal: expect.any(AbortSignal) }),
    );
  });

  it("manages project variables with JSON requests", async () => {
    const variable = { name: "base_url", value: "https://api.example.com" };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue(variable), status: 200 });
    const client = new ApiClient("http://api.test", fetchMock);

    await client.listProjectVariables();
    await client.createProjectVariable(variable);
    await client.updateProjectVariable("base/url", { value: { region: "staging" } });
    await client.deleteProjectVariable("base/url");

    expect(fetchMock).toHaveBeenNthCalledWith(1, "http://api.test/api/project-variables", { signal: expect.any(AbortSignal) });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://api.test/api/project-variables",
      expect.objectContaining({ method: "POST", body: JSON.stringify(variable) })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "http://api.test/api/project-variables/base%2Furl",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ value: { region: "staging" } }) })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "http://api.test/api/project-variables/base%2Furl",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("manages named runtime environments with JSON requests", async () => {
    const environment = { id: "env_staging", name: "测试环境", variables: { base_url: "https://staging.example.com" } };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue(environment), status: 200 });
    const client = new ApiClient("http://api.test", fetchMock);

    await client.listProjectEnvironments();
    await client.createProjectEnvironment({
      name: "测试环境",
      variables: { base_url: "https://staging.example.com" },
      credential_overrides: { cred_default: "cred_staging" },
    });
    await client.updateProjectEnvironment("env/staging", {
      variables: { base_url: "https://changed.example.com" },
      credential_overrides: { cred_default: "cred_preprod" },
    });
    await client.deleteProjectEnvironment("env/staging");

    expect(fetchMock).toHaveBeenNthCalledWith(1, "http://api.test/api/project-environments", { signal: expect.any(AbortSignal) });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://api.test/api/project-environments",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "测试环境",
          variables: { base_url: "https://staging.example.com" },
          credential_overrides: { cred_default: "cred_staging" },
        }),
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "http://api.test/api/project-environments/env%2Fstaging",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          variables: { base_url: "https://changed.example.com" },
          credential_overrides: { cred_default: "cred_preprod" },
        }),
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(4, "http://api.test/api/project-environments/env%2Fstaging", {
      method: "DELETE",
      signal: expect.any(AbortSignal),
    });
  });

  it("loads trigger status for a workflow", async () => {
    const triggers = [
      {
        node_id: "schedule",
        type: "schedule.trigger",
        active: true,
        interval_seconds: 60,
        next_run_at: "2026-07-20T01:01:00+00:00",
        details: {},
      },
    ];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(triggers),
    });
    const client = new ApiClient("http://api.test", fetchMock);

    await expect(client.listWorkflowTriggers("workflow_1")).resolves.toEqual(triggers);
    expect(fetchMock).toHaveBeenCalledWith("http://api.test/api/workflows/workflow_1/triggers", {
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
      "http://api.test/api/workflows?draft=true",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(workflow),
        signal: expect.any(AbortSignal),
      })
    );
  });

  it("binds an existing workflow save to its expected version", async () => {
    const workflow = {
      id: "workflow/with space",
      name: "Demo",
      version: 4,
      nodes: [],
      edges: [],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ ...workflow, version: 5 }),
    });
    const client = new ApiClient("http://api.test", fetchMock);

    await client.saveWorkflow(workflow, 4);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/api/workflows?draft=true",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(workflow),
        headers: {
          "Content-Type": "application/json",
          "X-Workflow-Expected-Version": "4",
        },
      }),
    );
  });

  it("loads the draft and production publication status", async () => {
    const publication = {
      workflow_id: "workflow/with space",
      draft_version: 4,
      published_version: 3,
      active: true,
      has_unpublished_changes: true,
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(publication),
    });
    const client = new ApiClient("http://api.test", fetchMock);

    await expect(client.getWorkflowPublication("workflow/with space")).resolves.toEqual(publication);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/api/workflows/workflow%2Fwith%20space/publication",
      { signal: expect.any(AbortSignal) }
    );
  });

  it("deletes a workflow with an encoded identifier", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    const client = new ApiClient("http://api.test", fetchMock);

    await expect(client.deleteWorkflow("workflow/with space")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith("http://api.test/api/workflows/workflow%2Fwith%20space", {
      method: "DELETE",
      signal: expect.any(AbortSignal),
    });
  });

  it("updates workflow activation with POST", async () => {
    const workflow = {
      id: "workflow_1",
      name: "Demo",
      active: true,
      version: 2,
      nodes: [],
      edges: [],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(workflow),
    });
    const client = new ApiClient("http://api.test", fetchMock);

    await expect(client.setWorkflowActive("workflow/with space", true, 1)).resolves.toEqual(workflow);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/api/workflows/workflow%2Fwith%20space/activation",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Workflow-Expected-Version": "1",
        },
        body: JSON.stringify({ active: true }),
        signal: expect.any(AbortSignal),
      })
    );
  });

  it("starts and stops a scoped webhook test listener", async () => {
    const listener = { workflow_id: "workflow/with space", node_id: "webhook", active: true, expires_at: "2026-07-23T00:02:00Z" };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue(listener) });
    const client = new ApiClient("http://api.test", fetchMock);

    await client.startWebhookTestListener("workflow/with space", "webhook/node");
    await client.getWebhookTestListener("workflow/with space", "webhook/node");
    await client.stopWebhookTestListener("workflow/with space", "webhook/node");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://api.test/api/workflows/workflow%2Fwith%20space/webhook-test/listen",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ node_id: "webhook/node" }) })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://api.test/api/workflows/workflow%2Fwith%20space/webhook-test/listen/webhook%2Fnode",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "http://api.test/api/workflows/workflow%2Fwith%20space/webhook-test/listen/webhook%2Fnode",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("creates a scoped manual run with the selected entry node", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ id: "run_1" }),
    });
    const client = new ApiClient("http://api.test", fetchMock);

    await expect(client.createRun("workflow/with space", "node_selected")).resolves.toEqual({ id: "run_1" });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/api/workflows/workflow%2Fwith%20space/runs",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entry_node_id: "node_selected" }),
        signal: expect.any(AbortSignal),
      })
    );
  });

  it("creates a manual run with one-time JSON input", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ id: "run_1" }),
    });
    const client = new ApiClient("http://api.test", fetchMock);

    await expect(client.createRun("workflow/with space", undefined, { case_id: 17 })).resolves.toEqual({ id: "run_1" });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/api/workflows/workflow%2Fwith%20space/runs",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initial_input: { case_id: 17 } }),
        signal: expect.any(AbortSignal),
      })
    );
  });

  it("lists, loads, restores, and rolls back versioned workflow documents", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue([]),
    });
    const client = new ApiClient("http://api.test", fetchMock);

    await client.listWorkflowVersions("workflow/with space");
    await client.getWorkflowVersion("workflow/with space", 3);
    await client.restoreWorkflowVersion("workflow/with space", 2, 4);
    await client.rollbackWorkflowVersion("workflow/with space", 1, 5);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://api.test/api/workflows/workflow%2Fwith%20space/versions",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://api.test/api/workflows/workflow%2Fwith%20space/versions/3",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "http://api.test/api/workflows/workflow%2Fwith%20space/versions/2/restore",
      expect.objectContaining({
        method: "POST",
        headers: { "X-Workflow-Expected-Version": "4" },
        signal: expect.any(AbortSignal),
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "http://api.test/api/workflows/workflow%2Fwith%20space/versions/1/rollback",
      expect.objectContaining({
        method: "POST",
        headers: { "X-Workflow-Expected-Version": "5" },
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

  it("loads the live queue status for a run", async () => {
    const queueStatus = {
      run_id: "run/with space",
      state: "queued",
      position: 2,
      active_count: 1,
      concurrency_limit: 4,
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(queueStatus),
    });
    const client = new ApiClient("http://api.test", fetchMock);

    await expect(client.getRunQueueStatus("run/with space")).resolves.toEqual(queueStatus);
    expect(fetchMock).toHaveBeenCalledWith("http://api.test/api/runs/run%2Fwith%20space/queue", {
      signal: expect.any(AbortSignal),
    });
  });

  it("lists workflow runs with an encoded workflow id and limit", async () => {
    const runs = [
      {
        id: "run_1",
        workflow_id: "workflow/with space",
        workflow_version: 2,
        status: "succeeded",
        created_at: "2026-06-24T01:00:00Z",
        started_at: "2026-06-24T01:00:01Z",
        completed_at: "2026-06-24T01:00:02Z",
        error: null,
      },
    ];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(runs),
    });
    const client = new ApiClient("http://api.test", fetchMock);

    await expect(client.listWorkflowRuns("workflow/with space", 5)).resolves.toEqual(runs);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/api/workflows/workflow%2Fwith%20space/runs?limit=5",
      { signal: expect.any(AbortSignal) }
    );
  });

  it("lists an older workflow run page with an offset", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue([]) });
    const client = new ApiClient("http://api.test", fetchMock);

    await client.listWorkflowRuns("workflow_1", 5, 10);

    expect(fetchMock).toHaveBeenCalledWith("http://api.test/api/workflows/workflow_1/runs?limit=5&offset=10", {
      signal: expect.any(AbortSignal),
    });
  });

  it("filters a workflow run page by status", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue([]) });
    const client = new ApiClient("http://api.test", fetchMock);

    await client.listWorkflowRuns("workflow_1", 5, 0, "failed");

    expect(fetchMock).toHaveBeenCalledWith("http://api.test/api/workflows/workflow_1/runs?limit=5&status=failed", {
      signal: expect.any(AbortSignal),
    });
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

  it("retries a historical run with POST and an encoded run id", async () => {
    const run = {
      id: "run_retry",
      workflow_id: "workflow_1",
      workflow_version: 1,
      status: "queued",
      created_at: "2026-06-18T00:00:00Z",
      started_at: null,
      completed_at: null,
      error: null,
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(run),
    });
    const client = new ApiClient("http://api.test", fetchMock);

    await expect(client.retryRun("run/with space")).resolves.toEqual(run);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/api/runs/run%2Fwith%20space/retry",
      expect.objectContaining({
        method: "POST",
        signal: expect.any(AbortSignal),
      })
    );
  });

  it("manages local credentials without fetching secret values", async () => {
    const credential = {
      id: "cred/with space",
      type_id: "http.bearer",
      name: "测试令牌",
      created_at: "2026-07-20T00:00:00Z",
      updated_at: "2026-07-20T00:00:00Z",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue([]) })
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue([credential]) })
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue(credential) })
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue(credential) })
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue([]) })
      .mockResolvedValueOnce({
        ok: true,
        status: 204,
        json: vi.fn(() => {
          throw new Error("204 响应不应解析 JSON");
        }),
      });
    const client = new ApiClient("http://api.test", fetchMock);

    await client.listCredentialTypes();
    await client.listCredentials();
    await client.createCredential({ type_id: "http.bearer", name: "测试令牌", data: { token: "secret" } });
    await client.updateCredential("cred/with space", { name: "新名称" });
    await client.listCredentialReferences("cred/with space");
    await client.deleteCredential("cred/with space");

    expect(fetchMock).toHaveBeenNthCalledWith(1, "http://api.test/api/credential-types", {
      signal: expect.any(AbortSignal),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(3, "http://api.test/api/credentials", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ type_id: "http.bearer", name: "测试令牌", data: { token: "secret" } }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(4, "http://api.test/api/credentials/cred%2Fwith%20space", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ name: "新名称" }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(5, "http://api.test/api/credentials/cred%2Fwith%20space/references", {
      signal: expect.any(AbortSignal),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(6, "http://api.test/api/credentials/cred%2Fwith%20space", expect.objectContaining({
      method: "DELETE",
    }));
  });

  it("previews and applies workflow node upgrades with encoded workflow ids", async () => {
    const preview = {
      workflow: { id: "workflow/with space", name: "Demo", version: 1, nodes: [], edges: [] },
      upgrades: [],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue(preview) })
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue(preview.workflow) });
    const client = new ApiClient("http://api.test", fetchMock);

    await expect(client.previewWorkflowUpgrades("workflow/with space")).resolves.toEqual(preview);
    await expect(client.applyWorkflowUpgrades("workflow/with space", 1)).resolves.toEqual(preview.workflow);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://api.test/api/workflows/workflow%2Fwith%20space/upgrades/preview",
      expect.objectContaining({ method: "POST", signal: expect.any(AbortSignal) })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://api.test/api/workflows/workflow%2Fwith%20space/upgrades/apply",
      expect.objectContaining({
        method: "POST",
        headers: { "X-Workflow-Expected-Version": "1" },
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
