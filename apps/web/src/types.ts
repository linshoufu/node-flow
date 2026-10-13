export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type JsonSchema = {
  [key: string]: unknown;
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
  definitions?: Record<string, JsonSchema>;
  type?: string | string[];
  title?: string;
  default?: unknown;
  enum?: unknown[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema | JsonSchema[];
  additionalProperties?: boolean | JsonSchema;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  minimum?: number;
  maximum?: number;
  description?: string;
  format?: string;
  examples?: unknown[];
};

export type NodePort = {
  description?: string;
  displayName?: string;
  category?: string;
  filter?: {
    nodes?: string[];
    excludedNodes?: string[];
  };
  required?: boolean;
  schema?: JsonSchema;
  connectionKind?: string;
  maxConnections?: number | null;
  dataMode?: "value" | "items";
  /** Display-only metadata from the node presentation manifest. */
  collapsed?: boolean;
};

export type NodeFormControl =
  | "text"
  | "textarea"
  | "password"
  | "number"
  | "switch"
  | "select"
  | "json"
  | "dynamic_input_list"
  | "dynamic_output_list"
  | "url"
  | "credential"
  | "http_profile";

export type NodeFormExpressionMode = "allowed" | "disabled" | "required";

export type NodeFormSelectOption = {
  value: string;
  label: string;
};

export type NodeFormCondition = {
  field: string;
  equals?: unknown;
  oneOf?: unknown[];
  notEmpty?: boolean;
};

export type NodeFormField = {
  key: string;
  control: NodeFormControl;
  label?: string;
  description?: string;
  placeholder?: string;
  options?: NodeFormSelectOption[];
  visibleWhen?: NodeFormCondition;
  expression?: NodeFormExpressionMode;
  credentialTypeIds?: string[];
  placement?: "inline" | "panel";
};

export type NodeFormGroup = {
  id: string;
  label: string;
  description?: string;
  visibleWhen?: NodeFormCondition;
  fields: NodeFormField[];
};

export type NodeForm = {
  groups: NodeFormGroup[];
};

export type DynamicOutputList = {
  configKey: string;
  idKey: string;
  labelKey: string;
  output: NodePort;
  defaultItems?: Array<Record<string, unknown>>;
};

export type DynamicInputList = {
  configKey: string;
  idKey: string;
  labelKey: string;
  input: NodePort;
  defaultItems?: Array<Record<string, unknown>>;
};

export type NodeType = {
  id: string;
  name: string;
  displayName?: string;
  category: string;
  group?: string;
  icon?: string | null;
  tags?: string[];
  keywords?: string[];
  documentationUrl?: string | null;
  version?: number;
  description: string;
  inputs: Record<string, NodePort>;
  outputs: Record<string, NodePort>;
  configSchema: JsonSchema;
  form?: NodeForm | null;
  dynamicInputs?: DynamicInputList | null;
  dynamicOutputs?: DynamicOutputList | null;
  package?: NodePackageProvenance | null;
  sourcePath?: string | null;
};

export type NodePackageProvenance = {
  id: string;
  name: string;
  version: string;
};

export type NodePackageStatus = "loaded" | "partial" | "failed" | "disabled";
export type NodePackageCompatibilityStatus = "compatible" | "unverified" | "incompatible";

export type NodePackageSummary = NodePackageProvenance & {
  description?: string | null;
  documentationUrl?: string | null;
  icon?: string | null;
  author?: string | null;
  status: NodePackageStatus;
  nodeIds: string[];
  credentialTypeIds?: string[];
  engines?: {
    nodeflow?: string;
    python?: string;
  };
  pythonDependencies?: string[];
  compatibility?: {
    status: NodePackageCompatibilityStatus;
    nodeflowVersion: string | null;
    pythonVersion: string | null;
  };
  lifecycle?: {
    managed: boolean;
    enabled: boolean;
    lockedVersion: string | null;
    versionStatus: "unlocked" | "locked" | "mismatch";
    installManaged?: boolean;
  };
};

export type NodePackageSettingsUpdate = {
  enabled: boolean;
  locked_version: string | null;
};

export type NodePackageDiagnostic = {
  code: string;
  level: "error" | "warning";
  message: string;
  packageId?: string | null;
  path?: string | null;
  entrypoint?: string | null;
};

export type NodeAssetOpenSourceResult = {
  opened: boolean;
  sourcePath: string;
};

export type NodeFormManifest = {
  version: number;
  form?: NodeForm | null;
  defaults?: Record<string, unknown> | null;
  placements?: Record<string, "inline" | "panel"> | null;
  portPresentation?: Partial<Record<"inputs" | "outputs", Record<string, NodePortPresentation>>> | null;
  cardStyle?: NodeCardStyle | null;
  summaryTemplate?: NodeSummaryTemplate | null;
};

export type NodeSummaryTemplate = {
  badge?: string;
  primary?: string;
  secondary?: string;
};

export type NodeCardStyle = {
  /** A presentation-only accent for the node card; it never changes node execution. */
  accent?: string;
  density?: "compact" | "comfortable";
  /** Semantic summaries are generated from the node type and its current config. */
  summary?: "auto" | "hidden";
};

export type NodePortPresentation = {
  displayName?: string;
  description?: string;
  collapsed?: boolean;
  order?: number;
};

export type NodeTypeManifestSaveResult = {
  saved: boolean;
  nodeTypeId: string;
};

export type NodeTypeManifestDeleteResult = {
  deleted: boolean;
  nodeTypeId: string;
};

export type NodePackageRecoveryEvent = {
  transactionId: string;
  packageId: string;
  operation: "activate" | "uninstall";
  action: "rolled_back" | "completed";
  recoveredAt: string;
};

export type NodePackageScanResult = {
  packages: NodePackageSummary[];
  diagnostics: NodePackageDiagnostic[];
  legacyNodeCount: number;
  recoveries?: NodePackageRecoveryEvent[];
};

export type NodePackageInstallResult = {
  action: "installed" | "upgraded" | "reinstalled" | "rolled_back";
  package: NodePackageSummary;
  scan: NodePackageScanResult;
};

export type NodePackageRevision = {
  revisionId: string;
  packageId: string;
  version: string;
  sourceFilename: string | null;
  installedAt: string | null;
  archivedAt: string;
  checksum: string;
};

export type WorkflowNode = {
  id: string;
  type: string;
  disabled?: boolean;
  label?: string;
  notes?: string;
  typeVersion?: number;
  position: {
    x: number;
    y: number;
  };
  config: Record<string, unknown>;
  pinnedData?: Record<string, unknown>;
  execution?: NodeExecutionPolicy;
  subflows?: Record<string, WorkflowSubflow>;
};

export type NodeErrorMode = "stop" | "continue" | "errorOutput";

export type NodeExecutionPolicy = {
  onError: NodeErrorMode;
  retry: {
    maxAttempts: number;
    delaySeconds: number;
  };
};

export type WorkflowEdge = {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
};

export type CanvasAnnotationColor = "yellow" | "blue" | "green" | "pink";

export type CanvasAnnotation = {
  id: string;
  content: string;
  position: {
    x: number;
    y: number;
  };
  width: number;
  height: number;
  color: CanvasAnnotationColor;
};

export type WorkflowSubflow = {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  annotations?: CanvasAnnotation[];
};

export type WorkflowSettings = {
  timeout_seconds: number;
  variables?: Record<string, unknown>;
  error_workflow_id?: string | null;
  max_concurrent_runs?: number | null;
  environment_id?: string;
};

export type ProjectEnvironment = {
  id: string;
  name: string;
  variables: Record<string, JsonValue>;
  credential_overrides?: Record<string, string>;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

export type ProjectEnvironmentCreateRequest = {
  name: string;
  variables: Record<string, JsonValue>;
  credential_overrides?: Record<string, string>;
};

export type ProjectEnvironmentUpdateRequest = {
  name?: string;
  variables?: Record<string, JsonValue>;
  credential_overrides?: Record<string, string>;
};

export type HttpProfile = {
  id: string;
  name: string;
  base_url: string;
  headers: Record<string, string>;
  credential_id: string | null;
  timeout_seconds: number | null;
  authentication: Record<string, JsonValue>;
  created_at: string;
  updated_at: string;
};

export type HttpProfileCreateRequest = {
  name: string;
  base_url?: string;
  headers?: Record<string, string>;
  credential_id?: string | null;
  timeout_seconds?: number | null;
  authentication?: Record<string, JsonValue>;
};

export type HttpProfileUpdateRequest = Partial<HttpProfileCreateRequest>;

export type WorkflowDocument = {
  id: string;
  name: string;
  active?: boolean;
  description?: string;
  tags?: string[];
  version: number;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  annotations?: CanvasAnnotation[];
  settings?: WorkflowSettings;
};

export type WorkflowSummary = {
  id: string;
  name: string;
  active?: boolean;
  description?: string;
  tags?: string[];
  version: number;
  updated_at?: string | null;
  node_count?: number;
  last_run_status?: RunStatus | null;
};

export type WorkflowVersionSummary = {
  version: number;
  created_at: string;
  name: string;
  active: boolean;
  node_count: number;
  action: "save" | "restore" | "rollback";
  source_version: number | null;
};

export type WorkflowPublicationStatus = {
  workflow_id: string;
  draft_version: number;
  published_version: number | null;
  active: boolean;
  has_unpublished_changes: boolean;
};

export type CredentialField = {
  id: string;
  label: string;
  secret: boolean;
};

export type CredentialType = {
  id: string;
  display_name: string;
  fields: CredentialField[];
  node_type_ids: string[];
};

export type CredentialSummary = {
  id: string;
  type_id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

export type CredentialReference = {
  workflow_id: string;
  workflow_name: string;
  node_id: string;
  node_label: string;
};

export type CredentialCreateRequest = {
  type_id: string;
  name: string;
  data: Record<string, string>;
};

export type CredentialUpdateRequest = {
  name?: string;
  data?: Record<string, string>;
};

export type ProjectVariable = {
  name: string;
  value: JsonValue;
  created_at: string;
  updated_at: string;
};

export type ProjectVariableCreateRequest = {
  name: string;
  value: JsonValue;
};

export type ProjectVariableUpdateRequest = {
  value: JsonValue;
};

export type WorkflowTriggerStatus = {
  node_id: string;
  type: string;
  active: boolean;
  interval_seconds?: number | null;
  next_run_at?: string | null;
  details: Record<string, unknown>;
};

export type WebhookTestListener = {
  workflow_id: string;
  node_id: string;
  active: boolean;
  expires_at?: string | null;
};

export type ValidationIssue = {
  path: string;
  message: string;
  code?: string | null;
  details?: Record<string, unknown> | null;
};

export type ValidationResult = {
  valid: boolean;
  issues: ValidationIssue[];
};

export type NodeUpgradeSummary = {
  nodeId: string;
  path: string;
  nodeType: string;
  fromVersion: number;
  toVersion: number;
  configChanges: NodeConfigChange[];
  migrationNotes: string[];
};

export type NodeConfigChange = {
  path: string;
  kind: "added" | "changed" | "removed";
  before: unknown;
  after: unknown;
};

export type WorkflowUpgradePreview = {
  workflow: WorkflowDocument;
  upgrades: NodeUpgradeSummary[];
};

export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type RunHistoryStatusFilter = "all" | RunStatus;
export type RunExecutionMode = "manual" | "schedule" | "webhook" | "webhook_test" | "child" | "error";

export type RunRecord = {
  id: string;
  workflow_id: string;
  workflow_version: number;
  status: RunStatus;
  execution_mode?: RunExecutionMode;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  cancel_requested_at?: string | null;
  parent_run_id?: string | null;
  parent_node_id?: string | null;
};

export type RunQueueStatus = {
  run_id: string;
  state: "queued" | "running";
  position: number | null;
  active_count: number;
  concurrency_limit: number;
  workflow_active_count?: number | null;
  workflow_concurrency_limit?: number | null;

};

export type RunEvent = {
  id?: number | null;
  run_id: string;
  type: string;
  timestamp: string;
  node_id?: string | null;
  scope: string[];
  payload: Record<string, unknown>;
};
