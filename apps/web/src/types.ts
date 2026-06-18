export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type JsonSchema = {
  [key: string]: unknown;
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
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
  required?: boolean;
  schema?: JsonSchema;
};

export type NodeType = {
  id: string;
  name: string;
  category: string;
  description: string;
  inputs: Record<string, NodePort>;
  outputs: Record<string, NodePort>;
  configSchema: JsonSchema;
};

export type WorkflowNode = {
  id: string;
  type: string;
  position: {
    x: number;
    y: number;
  };
  config: Record<string, unknown>;
  subflows?: Record<string, WorkflowSubflow>;
};

export type WorkflowEdge = {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
};

export type WorkflowSubflow = {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
};

export type WorkflowSettings = {
  timeout_seconds: number;
};

export type WorkflowDocument = {
  id: string;
  name: string;
  version: number;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  settings?: WorkflowSettings;
};

export type ValidationIssue = {
  path: string;
  message: string;
};

export type ValidationResult = {
  valid: boolean;
  issues: ValidationIssue[];
};

export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type RunRecord = {
  id: string;
  workflow_id: string;
  workflow_version: number;
  status: RunStatus;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  cancel_requested_at?: string | null;
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
