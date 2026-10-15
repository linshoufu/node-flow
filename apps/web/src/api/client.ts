import type {
  NodeType,
  CredentialCreateRequest,
  CredentialReference,
  CredentialSummary,
  CredentialType,
  CredentialUpdateRequest,
  ProjectVariable,
  ProjectVariableCreateRequest,
  ProjectVariableUpdateRequest,
  ProjectEnvironment,
  ProjectEnvironmentCreateRequest,
  ProjectEnvironmentUpdateRequest,
  HttpProfile,
  HttpProfileCreateRequest,
  HttpProfileUpdateRequest,
  NodeAssetOpenSourceResult,
  NodeFormManifest,
  NodeTypeManifestDeleteResult,
  NodeTypeManifestSaveResult,
  NodePackageScanResult,
  NodePackageInstallResult,
  NodePackageRevision,
  NodePackageSettingsUpdate,
  RunEvent,
  RunQueueStatus,
  RunRecord,
  RunStatus,
  ValidationResult,
  WorkflowDocument,
  WorkflowPublicationStatus,
  WorkflowSummary,
  WorkflowTriggerStatus,
  WorkflowUpgradePreview,
  WebhookTestListener,
} from "../types";
import { DEFAULT_REQUEST_TIMEOUT_MS, LOCAL_API_BASE_URL } from "../lib/projectConfig";

export const API_BASE_URL = getConfiguredBaseUrl();

type ViteImportMeta = ImportMeta & {
  env?: {
    VITE_API_BASE_URL?: string;
  };
};

type ApiClientOptions = {
  requestTimeoutMs?: number;
};

export class ApiClient {
  updateNodeTemplate(id: string, draft: import("../lib/templateLibrary").TemplateDraft, expectedRevision: number): Promise<import("../types").NodeTemplate> {
    return this.request(`/api/node-templates/${encodeURIComponent(id)}`, this.jsonInit("PUT", { ...draft, expected_revision: expectedRevision }));
  }
  renameNodeTemplate(id: string, name: string, description: string, expectedRevision: number): Promise<import("../types").NodeTemplate> {
    return this.request(`/api/node-templates/${encodeURIComponent(id)}`, this.jsonInit("PATCH", { name, description, expected_revision: expectedRevision }));
  }
  deleteNodeTemplate(id: string, expectedRevision: number): Promise<import("../types").NodeTemplate> {
    return this.request(`/api/node-templates/${encodeURIComponent(id)}?expected_revision=${expectedRevision}`, { method: "DELETE" });
  }
  restoreNodeTemplate(id: string, expectedRevision: number): Promise<import("../types").NodeTemplate> {
    return this.request(`/api/node-templates/${encodeURIComponent(id)}/restore?expected_revision=${expectedRevision}`, { method: "POST" });
  }
  createNodeTemplate(draft: import("../lib/templateLibrary").TemplateDraft): Promise<import("../types").NodeTemplate> {
    return this.request("/api/node-templates", this.jsonInit("POST", draft));
  }
  listNodeTemplates(includeDeleted = false): Promise<import("../types").NodeTemplate[]> {
    return this.request(`/api/node-templates${includeDeleted ? "?include_deleted=true" : ""}`);
  }
  listProfiles(): Promise<import("../types").ResourceProfile[]> {
    return this.request("/api/profiles");
  }

  listProfileTypes(): Promise<import("../types").ResourceProfileType[]> {
    return this.request("/api/profile-types");
  }

  saveProfile(profile: Omit<import("../types").ResourceProfile, "id">, id?: string): Promise<import("../types").ResourceProfile> {
    return this.request(id ? `/api/profiles/${encodeURIComponent(id)}` : "/api/profiles", this.jsonInit(id ? "PUT" : "POST", profile));
  }

  deleteProfile(id: string): Promise<void> {
    return this.request(`/api/profiles/${encodeURIComponent(id)}`, { method: "DELETE" });
  }
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly requestTimeoutMs: number;

  constructor(
    baseUrl = LOCAL_API_BASE_URL,
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

  reloadNodeTypes(): Promise<NodeType[]> {
    return this.request("/api/node-types/reload", { method: "POST" });
  }

  listNodePackages(): Promise<NodePackageScanResult> {
    return this.request("/api/node-packages");
  }

  openNodeAssetSource(sourcePath: string): Promise<NodeAssetOpenSourceResult> {
    return this.request(
      "/api/node-assets/open-source",
      this.jsonInit("POST", { source_path: sourcePath }),
    );
  }

  getNodeType(nodeTypeId: string): Promise<NodeType> {
    return this.request(`/api/node-types/${encodeURIComponent(nodeTypeId)}`);
  }

  getNodeTypeManifest(nodeTypeId: string): Promise<NodeFormManifest> {
    return this.request(`/api/node-types/${encodeURIComponent(nodeTypeId)}/manifest`);
  }

  saveNodeTypeManifest(
    nodeTypeId: string,
    manifest: NodeFormManifest,
  ): Promise<NodeTypeManifestSaveResult> {
    return this.request(
      `/api/node-types/${encodeURIComponent(nodeTypeId)}/manifest`,
      this.jsonInit("PUT", manifest),
    );
  }

  deleteNodeTypeManifest(nodeTypeId: string): Promise<NodeTypeManifestDeleteResult> {
    return this.request(
      `/api/node-types/${encodeURIComponent(nodeTypeId)}/manifest`,
      { method: "DELETE" },
    );
  }

  updateNodePackageSettings(
    packageId: string,
    request: NodePackageSettingsUpdate,
  ): Promise<NodePackageScanResult> {
    return this.request(
      `/api/node-packages/${encodeURIComponent(packageId)}/settings`,
      this.jsonInit("PUT", request),
    );
  }

  installNodePackage(file: File): Promise<NodePackageInstallResult> {
    const filename = encodeURIComponent(file.name);
    return this.request(`/api/node-packages/install?filename=${filename}`, {
      method: "POST",
      headers: { "Content-Type": "application/zip" },
      body: file,
    });
  }

  uninstallNodePackage(packageId: string): Promise<NodePackageScanResult> {
    return this.request(`/api/node-packages/${encodeURIComponent(packageId)}`, {
      method: "DELETE",
    });
  }

  listNodePackageRevisions(packageId: string): Promise<NodePackageRevision[]> {
    return this.request(
      `/api/node-packages/${encodeURIComponent(packageId)}/revisions`,
    );
  }

  activateNodePackageRevision(
    packageId: string,
    revisionId: string,
  ): Promise<NodePackageInstallResult> {
    return this.request(
      `/api/node-packages/${encodeURIComponent(packageId)}/revisions/${encodeURIComponent(revisionId)}/activate`,
      { method: "POST" },
    );
  }

  listCredentialTypes(): Promise<CredentialType[]> {
    return this.request("/api/credential-types");
  }

  listCredentials(): Promise<CredentialSummary[]> {
    return this.request("/api/credentials");
  }

  createCredential(request: CredentialCreateRequest): Promise<CredentialSummary> {
    return this.request("/api/credentials", this.jsonInit("POST", request));
  }

  updateCredential(credentialId: string, request: CredentialUpdateRequest): Promise<CredentialSummary> {
    return this.request(`/api/credentials/${encodeURIComponent(credentialId)}`, this.jsonInit("PATCH", request));
  }

  listCredentialReferences(credentialId: string): Promise<CredentialReference[]> {
    return this.request(`/api/credentials/${encodeURIComponent(credentialId)}/references`);
  }

  deleteCredential(credentialId: string): Promise<void> {
    return this.request(`/api/credentials/${encodeURIComponent(credentialId)}`, { method: "DELETE" });
  }

  listProjectVariables(): Promise<ProjectVariable[]> {
    return this.request("/api/project-variables");
  }

  createProjectVariable(request: ProjectVariableCreateRequest): Promise<ProjectVariable> {
    return this.request("/api/project-variables", this.jsonInit("POST", request));
  }

  updateProjectVariable(name: string, request: ProjectVariableUpdateRequest): Promise<ProjectVariable> {
    return this.request(`/api/project-variables/${encodeURIComponent(name)}`, this.jsonInit("PATCH", request));
  }

  deleteProjectVariable(name: string): Promise<void> {
    return this.request(`/api/project-variables/${encodeURIComponent(name)}`, { method: "DELETE" });
  }

  listProjectEnvironments(): Promise<ProjectEnvironment[]> {
    return this.request("/api/project-environments");
  }

  createProjectEnvironment(request: ProjectEnvironmentCreateRequest): Promise<ProjectEnvironment> {
    return this.request("/api/project-environments", this.jsonInit("POST", request));
  }

  updateProjectEnvironment(
    environmentId: string,
    request: ProjectEnvironmentUpdateRequest
  ): Promise<ProjectEnvironment> {
    return this.request(`/api/project-environments/${encodeURIComponent(environmentId)}`, this.jsonInit("PATCH", request));
  }

  deleteProjectEnvironment(environmentId: string): Promise<void> {
    return this.request(`/api/project-environments/${encodeURIComponent(environmentId)}`, { method: "DELETE" });
  }

  listHttpProfiles(): Promise<HttpProfile[]> {
    return this.request("/api/http-profiles");
  }

  createHttpProfile(request: HttpProfileCreateRequest): Promise<HttpProfile> {
    return this.request("/api/http-profiles", this.jsonInit("POST", request));
  }

  updateHttpProfile(profileId: string, request: HttpProfileUpdateRequest): Promise<HttpProfile> {
    return this.request(`/api/http-profiles/${encodeURIComponent(profileId)}`, this.jsonInit("PATCH", request));
  }

  deleteHttpProfile(profileId: string): Promise<void> {
    return this.request(`/api/http-profiles/${encodeURIComponent(profileId)}`, { method: "DELETE" });
  }

  listWorkflows(): Promise<WorkflowSummary[]> {
    return this.request("/api/workflows");
  }

  getWorkflow(id: string): Promise<WorkflowDocument> {
    return this.request(`/api/workflows/${encodeURIComponent(id)}`);
  }

  deleteWorkflow(id: string): Promise<void> {
    return this.request(`/api/workflows/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  listWorkflowVersions(workflowId: string): Promise<import("../types").WorkflowVersionSummary[]> {
    return this.request(`/api/workflows/${encodeURIComponent(workflowId)}/versions`);
  }

  getWorkflowVersion(workflowId: string, version: number): Promise<WorkflowDocument> {
    return this.request(`/api/workflows/${encodeURIComponent(workflowId)}/versions/${version}`);
  }

  restoreWorkflowVersion(
    workflowId: string,
    version: number,
    expectedVersion?: number,
  ): Promise<WorkflowDocument> {
    return this.request(
      `/api/workflows/${encodeURIComponent(workflowId)}/versions/${version}/restore`,
      this.withExpectedWorkflowVersion({ method: "POST" }, expectedVersion),
    );
  }

  rollbackWorkflowVersion(
    workflowId: string,
    version: number,
    expectedVersion?: number,
  ): Promise<WorkflowDocument> {
    return this.request(
      `/api/workflows/${encodeURIComponent(workflowId)}/versions/${version}/rollback`,
      this.withExpectedWorkflowVersion({ method: "POST" }, expectedVersion),
    );
  }

  saveWorkflow(workflow: WorkflowDocument, expectedVersion?: number): Promise<WorkflowDocument> {
    return this.request(
      "/api/workflows?draft=true",
      this.withExpectedWorkflowVersion(this.jsonInit("POST", workflow), expectedVersion),
    );
  }

  getWorkflowPublication(workflowId: string): Promise<WorkflowPublicationStatus> {
    return this.request(`/api/workflows/${encodeURIComponent(workflowId)}/publication`);
  }

  validateWorkflow(workflow: WorkflowDocument): Promise<ValidationResult> {
    return this.request("/api/workflows/validate", this.jsonInit("POST", workflow));
  }

  previewWorkflowUpgrades(workflowId: string): Promise<WorkflowUpgradePreview> {
    return this.request(`/api/workflows/${encodeURIComponent(workflowId)}/upgrades/preview`, { method: "POST" });
  }

  applyWorkflowUpgrades(workflowId: string, expectedVersion?: number): Promise<WorkflowDocument> {
    return this.request(
      `/api/workflows/${encodeURIComponent(workflowId)}/upgrades/apply`,
      this.withExpectedWorkflowVersion({ method: "POST" }, expectedVersion),
    );
  }

  setWorkflowActive(
    workflowId: string,
    active: boolean,
    expectedVersion?: number,
  ): Promise<WorkflowDocument> {
    return this.request(
      `/api/workflows/${encodeURIComponent(workflowId)}/activation`,
      this.withExpectedWorkflowVersion(this.jsonInit("POST", { active }), expectedVersion),
    );
  }

  listWorkflowTriggers(workflowId: string): Promise<WorkflowTriggerStatus[]> {
    return this.request(`/api/workflows/${encodeURIComponent(workflowId)}/triggers`);
  }

  startWebhookTestListener(workflowId: string, nodeId: string): Promise<WebhookTestListener> {
    return this.request(
      `/api/workflows/${encodeURIComponent(workflowId)}/webhook-test/listen`,
      this.jsonInit("POST", { node_id: nodeId })
    );
  }

  getWebhookTestListener(workflowId: string, nodeId: string): Promise<WebhookTestListener> {
    return this.request(
      `/api/workflows/${encodeURIComponent(workflowId)}/webhook-test/listen/${encodeURIComponent(nodeId)}`
    );
  }

  stopWebhookTestListener(workflowId: string, nodeId: string): Promise<WebhookTestListener> {
    return this.request(
      `/api/workflows/${encodeURIComponent(workflowId)}/webhook-test/listen/${encodeURIComponent(nodeId)}`,
      { method: "DELETE" }
    );
  }

  createRun(workflowId: string, entryNodeId?: string, initialInput?: unknown, environmentId?: string): Promise<RunRecord> {
    const path = `/api/workflows/${encodeURIComponent(workflowId)}/runs`;
    const body = {
      ...(entryNodeId ? { entry_node_id: entryNodeId } : {}),
      ...(initialInput !== undefined ? { initial_input: initialInput } : {}),
      ...(environmentId ? { environment_id: environmentId } : {}),
    };
    return Object.keys(body).length > 0
      ? this.request(path, this.jsonInit("POST", body))
      : this.request(path, { method: "POST" });
  }

  getRun(runId: string): Promise<RunRecord> {
    return this.request(`/api/runs/${encodeURIComponent(runId)}`);
  }

  getRunQueueStatus(runId: string): Promise<RunQueueStatus | null> {
    return this.request(`/api/runs/${encodeURIComponent(runId)}/queue`);
  }

  listWorkflowRuns(workflowId: string, limit = 5, offset = 0, status?: RunStatus): Promise<RunRecord[]> {
    const query = `limit=${encodeURIComponent(String(limit))}`;
    const offsetQuery = offset > 0 ? `&offset=${encodeURIComponent(String(offset))}` : "";
    const statusQuery = status ? `&status=${encodeURIComponent(status)}` : "";
    return this.request(
      `/api/workflows/${encodeURIComponent(workflowId)}/runs?${query}${offsetQuery}${statusQuery}`
    );
  }

  cancelRun(runId: string): Promise<RunRecord> {
    return this.request(`/api/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" });
  }

  retryRun(runId: string): Promise<RunRecord> {
    return this.request(`/api/runs/${encodeURIComponent(runId)}/retry`, { method: "POST" });
  }

  getRunEvents(runId: string): Promise<RunEvent[]> {
    return this.request(`/api/runs/${encodeURIComponent(runId)}/events`);
  }

  /** 澧為噺鎷夊彇娓告爣涔嬪悗鐨勮繍琛屼簨浠讹紙after_id 涓?run_events 鑷涓婚敭锛?*/
  eventsAfter(runId: string, afterId: number): Promise<RunEvent[]> {
    const cursor = encodeURIComponent(String(afterId));
    return this.request(
      `/api/runs/${encodeURIComponent(runId)}/events?after_id=${cursor}`,
    );
  }

  /** 鏋勯€犺繍琛屼簨浠?SSE 娴佸湴鍧€锛堜笌 baseUrl 鎷兼帴鏂瑰紡淇濇寔涓€鑷达級 */
  runEventStreamUrl(runId: string): string {
    return `${this.baseUrl}/api/runs/${encodeURIComponent(runId)}/events/stream`;
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
      if (response.status === 204) {
        return undefined as T;
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

  private jsonInit(method: "POST" | "PUT" | "PATCH", body: unknown): RequestInit {
    return {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    };
  }

  private withExpectedWorkflowVersion(init: RequestInit, expectedVersion?: number): RequestInit {
    if (expectedVersion === undefined) {
      return init;
    }
    return {
      ...init,
      headers: {
        ...init.headers,
        "X-Workflow-Expected-Version": String(expectedVersion),
      },
    };
  }
}

export const apiClient = new ApiClient(API_BASE_URL);

function getConfiguredBaseUrl() {
  return (import.meta as ViteImportMeta).env?.VITE_API_BASE_URL ?? LOCAL_API_BASE_URL;
}
