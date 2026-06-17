import type { NodeType, RunEvent, RunRecord, ValidationResult, WorkflowDocument } from "../types";

const DEFAULT_REQUEST_TIMEOUT_MS = 10000;

type ApiClientOptions = {
  requestTimeoutMs?: number;
};

export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly requestTimeoutMs: number;

  constructor(
    baseUrl = "http://127.0.0.1:8000",
    fetchImpl: typeof fetch = (input, init) => fetch(input, init),
    options: ApiClientOptions = {}
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.fetchImpl = fetchImpl;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  listNodeTypes(): Promise<NodeType[]> {
    return this.request("/api/node-types");
  }

  listWorkflows(): Promise<Array<{ id: string; name: string; version: number }>> {
    return this.request("/api/workflows");
  }

  getWorkflow(id: string): Promise<WorkflowDocument> {
    return this.request(`/api/workflows/${encodeURIComponent(id)}`);
  }

  saveWorkflow(workflow: WorkflowDocument): Promise<WorkflowDocument> {
    return this.request("/api/workflows", this.jsonInit("POST", workflow));
  }

  validateWorkflow(workflow: WorkflowDocument): Promise<ValidationResult> {
    return this.request("/api/workflows/validate", this.jsonInit("POST", workflow));
  }

  createRun(workflowId: string): Promise<RunRecord> {
    return this.request(`/api/workflows/${encodeURIComponent(workflowId)}/runs`, { method: "POST" });
  }

  getRun(runId: string): Promise<RunRecord> {
    return this.request(`/api/runs/${encodeURIComponent(runId)}`);
  }

  getRunEvents(runId: string): Promise<RunEvent[]> {
    return this.request(`/api/runs/${encodeURIComponent(runId)}/events`);
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timeoutError = new Error(`API request timed out after ${this.requestTimeoutMs}ms`);
    let didTimeout = false;
    let timeoutId: ReturnType<typeof window.setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = window.setTimeout(() => {
        didTimeout = true;
        controller.abort();
        reject(timeoutError);
      }, this.requestTimeoutMs);
    });

    try {
      const response = await Promise.race([
        this.fetchImpl(`${this.baseUrl}${path}`, { ...init, signal: controller.signal }),
        timeout,
      ]);
      if (!response.ok) {
        const errorText = await Promise.race([response.text(), timeout]);
        throw new Error(`API ${response.status}: ${errorText}`);
      }
      return (await Promise.race([response.json() as Promise<T>, timeout])) as T;
    } catch (error) {
      if (didTimeout) {
        throw timeoutError;
      }
      throw error;
    } finally {
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    }
  }

  private jsonInit(method: "POST", body: unknown): RequestInit {
    return {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    };
  }
}

export const apiClient = new ApiClient();
