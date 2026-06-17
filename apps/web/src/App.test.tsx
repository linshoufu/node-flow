import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

describe("App", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      })
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders the editor shell", () => {
    render(<App />);

    expect(screen.getByText("Node Flow")).toBeInTheDocument();
    expect(screen.getByLabelText("Canvas workspace")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Validate" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run" })).toBeInTheDocument();
  });

  it("loads the saved workflow list on startup", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows")) {
        return jsonResponse([{ id: "wf_saved", name: "Saved Import", version: 4 }]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    const selector = await screen.findByLabelText("Saved workflows");
    expect(selector).toHaveValue("");
    expect(screen.getByRole("option", { name: "Saved Import v4" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/api/workflows",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("loads a selected saved workflow into the editor", async () => {
    const savedWorkflow = workflowDocument({ id: "wf_saved", name: "Customer Intake", version: 3 });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows")) {
        return jsonResponse([{ id: "wf_saved", name: "Customer Intake", version: 3 }]);
      }
      if (url.endsWith("/api/workflows/wf_saved")) {
        return jsonResponse(savedWorkflow);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.change(await screen.findByLabelText("Saved workflows"), { target: { value: "wf_saved" } });

    await screen.findByText("Loaded Customer Intake v3.");
    expect(screen.getByLabelText("Workflow name")).toHaveValue("Customer Intake");
  });

  it("starts a new empty workflow after a saved workflow is loaded", async () => {
    const savedWorkflow = workflowDocument({
      id: "wf_saved",
      name: "Customer Intake",
      version: 3,
      nodes: [
        {
          id: "node_1",
          type: "manual.trigger",
          position: { x: 80, y: 80 },
          config: {},
        },
      ],
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([
          {
            id: "manual.trigger",
            name: "Manual Trigger",
            category: "Triggers",
            description: "Starts a workflow manually.",
            inputs: {},
            outputs: {},
            configSchema: { type: "object", properties: {} },
          },
        ]);
      }
      if (url.endsWith("/api/workflows")) {
        return jsonResponse([{ id: "wf_saved", name: "Customer Intake", version: 3 }]);
      }
      if (url.endsWith("/api/workflows/wf_saved")) {
        return jsonResponse(savedWorkflow);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.change(await screen.findByLabelText("Saved workflows"), { target: { value: "wf_saved" } });
    await screen.findByText("Loaded Customer Intake v3.");
    expect(within(screen.getByLabelText("Canvas workspace")).getByText("Manual Trigger")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "New" }));

    expect(screen.getByLabelText("Workflow name")).toHaveValue("Untitled Workflow");
    expect(screen.getByLabelText("Saved workflows")).toHaveValue("");
    expect(within(screen.getByLabelText("Canvas workspace")).queryByText("Manual Trigger")).not.toBeInTheDocument();
    expect(screen.getByText("Started a new workflow.")).toBeInTheDocument();
  });

  it("updates the saved workflow selector after saving", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows") && init?.method !== "POST") {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows") && init?.method === "POST") {
        return jsonResponse({ ...(JSON.parse(String(init.body)) as object), id: "wf_saved", version: 2 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.change(screen.getByLabelText("Workflow name"), { target: { value: "Saved From Editor" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("Saved version 2.");
    expect(screen.getByLabelText("Saved workflows")).toHaveValue("wf_saved");
    expect(screen.getByRole("option", { name: "Saved From Editor v2" })).toBeInTheDocument();
  });

  it("saves the workflow, creates a run, and loads initial run events", async () => {
    const nodeType = {
      id: "manual.trigger",
      name: "Manual Trigger",
      category: "Triggers",
      description: "Starts a workflow manually.",
      inputs: {},
      outputs: { success: { description: "Initial payload" } },
      configSchema: { type: "object", properties: {} },
    };
    const run = {
      id: "run_1",
      workflow_id: "wf_1",
      workflow_version: 2,
      status: "succeeded",
      created_at: "2026-06-16T00:00:00Z",
      started_at: "2026-06-16T00:00:01Z",
      completed_at: "2026-06-16T00:00:02Z",
      error: null,
    };
    const event = {
      id: 1,
      run_id: "run_1",
      type: "workflow.completed",
      timestamp: "2026-06-16T00:00:02Z",
      node_id: null,
      scope: [],
      payload: {},
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([nodeType]);
      }
      if (url.endsWith("/api/workflows") && init?.method !== "POST") {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows") && init?.method === "POST") {
        return jsonResponse({ ...(JSON.parse(String(init.body)) as object), id: "wf_1", version: 2 });
      }
      if (url.endsWith("/api/workflows/wf_1/runs") && init?.method === "POST") {
        return jsonResponse(run);
      }
      if (url.endsWith("/api/runs/run_1/events")) {
        return jsonResponse([event]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <StrictMode>
        <App />
      </StrictMode>
    );

    fireEvent.click(await screen.findByRole("button", { name: /Manual Trigger\s+manual\.trigger/i }));
    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    await screen.findByText("Run run_1 succeeded.");
    expect(screen.getByText("workflow.completed")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Run" })).toBeEnabled());
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/api/workflows/wf_1/runs",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/api/runs/run_1/events",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("edits a structured loop body subflow from the frontend", async () => {
    const forEachType = {
      id: "control.foreach",
      name: "For Each",
      category: "Control",
      description: "Runs body nodes for each item.",
      inputs: { items: { description: "Items" } },
      outputs: { done: { description: "Done" } },
      configSchema: {
        type: "object",
        properties: {
          items_path: { title: "Items Path", type: "string", default: "$.items" },
        },
      },
    };
    const logType = {
      id: "action.log",
      name: "Log",
      category: "Actions",
      description: "Writes a log entry.",
      inputs: { input: { description: "Input" } },
      outputs: { done: { description: "Done" } },
      configSchema: {
        type: "object",
        properties: {
          message: { title: "Message", type: "string", default: "hello" },
        },
      },
    };
    const savedWorkflows: unknown[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([forEachType, logType]);
      }
      if (url.endsWith("/api/workflows") && init?.method !== "POST") {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        savedWorkflows.push(body);
        return jsonResponse({ ...body, id: "wf_saved", version: 2 });
      }
      if (url.endsWith("/api/workflows/validate") && init?.method === "POST") {
        return jsonResponse({ valid: true, issues: [] });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /For Each\s+control\.foreach/i }));
    const canvas = screen.getByLabelText("Canvas workspace");
    expect(within(canvas).getByText("For Each")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open Body" }));

    expect(screen.getByText("/ For Each.body")).toBeInTheDocument();
    expect(within(canvas).queryByText("For Each")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Log\s+action\.log/i }));
    expect(within(canvas).getByText("Log")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Main" }));
    expect(within(canvas).getByText("For Each")).toBeInTheDocument();
    expect(within(canvas).queryByText("Log")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("Saved version 2.");
    const savedWorkflow = savedWorkflows.at(-1) as {
      nodes: Array<{ type: string; subflows?: { body?: { nodes: Array<{ type: string }> } } }>;
    };
    expect(savedWorkflow.nodes).toHaveLength(1);
    expect(savedWorkflow.nodes[0].type).toBe("control.foreach");
    expect(savedWorkflow.nodes[0].subflows?.body?.nodes).toEqual([expect.objectContaining({ type: "action.log" })]);

    fireEvent.click(screen.getByRole("button", { name: "Validate" }));
    await screen.findByText("Workflow is valid.");
  });

  it("edits nested structured loop body subflows from the frontend", async () => {
    const forEachType = {
      id: "control.foreach",
      name: "For Each",
      category: "Control",
      description: "Runs body nodes for each item.",
      inputs: { items: { description: "Items" } },
      outputs: { done: { description: "Done" } },
      configSchema: { type: "object", properties: {} },
    };
    const whileType = {
      id: "control.while",
      name: "While",
      category: "Control",
      description: "Runs body nodes while a condition is true.",
      inputs: { input: { description: "Input" } },
      outputs: { done: { description: "Done" } },
      configSchema: { type: "object", properties: {} },
    };
    const logType = {
      id: "action.log",
      name: "Log",
      category: "Actions",
      description: "Writes a log entry.",
      inputs: { input: { description: "Input" } },
      outputs: { done: { description: "Done" } },
      configSchema: { type: "object", properties: {} },
    };
    const savedWorkflows: unknown[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node-types")) {
        return jsonResponse([forEachType, whileType, logType]);
      }
      if (url.endsWith("/api/workflows") && init?.method !== "POST") {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/workflows") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        savedWorkflows.push(body);
        return jsonResponse({ ...body, id: "wf_saved", version: 2 });
      }
      if (url.endsWith("/api/workflows/validate") && init?.method === "POST") {
        return jsonResponse({ valid: true, issues: [] });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /For Each\s+control\.foreach/i }));
    fireEvent.click(screen.getByRole("button", { name: "Open Body" }));
    expect(screen.getByText("/ For Each.body")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /While\s+control\.while/i }));
    fireEvent.click(screen.getByRole("button", { name: "Open Body" }));
    expect(screen.getByText("/ For Each.body / While.body")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Log\s+action\.log/i }));
    const canvas = screen.getByLabelText("Canvas workspace");
    expect(within(canvas).getByText("Log")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Main" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("Saved version 2.");
    const savedWorkflow = savedWorkflows.at(-1) as {
      nodes: Array<{
        type: string;
        subflows?: { body?: { nodes: Array<{ type: string; subflows?: { body?: { nodes: Array<{ type: string }> } } }> } };
      }>;
    };
    const whileNode = savedWorkflow.nodes[0].subflows?.body?.nodes[0];
    expect(savedWorkflow.nodes[0].type).toBe("control.foreach");
    expect(whileNode?.type).toBe("control.while");
    expect(whileNode?.subflows?.body?.nodes).toEqual([expect.objectContaining({ type: "action.log" })]);

    fireEvent.click(screen.getByRole("button", { name: "Validate" }));
    await screen.findByText("Workflow is valid.");
  });
});

function jsonResponse(body: unknown) {
  return {
    ok: true,
    json: () => Promise.resolve(body),
  } as Response;
}

function workflowDocument(overrides: Partial<import("./types").WorkflowDocument> = {}): import("./types").WorkflowDocument {
  return {
    id: "wf_1",
    name: "Untitled Workflow",
    version: 1,
    nodes: [],
    edges: [],
    ...overrides,
  };
}
