import type { NodeType, RunEvent, RunRecord, ValidationResult, WorkflowDocument } from "../types";

export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(baseUrl = "http://127.0.0.1:8000", fetchImpl: typeof fetch = fetch) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.fetchImpl = fetchImpl;
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
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, init);
    if (!response.ok) {
      throw new Error(`API ${response.status}: ${await response.text()}`);
    }
    return response.json() as Promise<T>;
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
