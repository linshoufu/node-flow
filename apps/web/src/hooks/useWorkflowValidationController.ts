import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ApiClient } from "../api/client";
import { apiClient } from "../api/client";
import { formatApiError } from "../lib/apiError";
import { buildValidationIssueItems, type ValidationIssueItem } from "../lib/validationIssueView";
import { formatValidationSummary } from "../lib/validationIssues";
import type { ValidationResult, WorkflowDocument } from "../types";

export type WorkflowValidationClient = Pick<ApiClient, "validateWorkflow">;

type UseWorkflowValidationControllerOptions = {
  blocked: boolean;
  client?: WorkflowValidationClient;
  documentKey: string;
  onBusyChange: (busy: boolean) => void;
  onMessage: (message: string) => void;
  workflow: WorkflowDocument;
};

type ActiveValidation = {
  documentKey: string;
  token: number;
};

export function useWorkflowValidationController({
  blocked,
  client = apiClient,
  documentKey,
  onBusyChange,
  onMessage,
  workflow,
}: UseWorkflowValidationControllerOptions) {
  const [issueItems, setIssueItems] = useState<ValidationIssueItem[]>([]);
  const mountedRef = useRef(true);
  const documentKeyRef = useRef(documentKey);
  const requestTokenRef = useRef(0);
  const activeValidationRef = useRef<ActiveValidation | null>(null);
  documentKeyRef.current = documentKey;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestTokenRef.current += 1;
      activeValidationRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    const activeValidation = activeValidationRef.current;
    requestTokenRef.current += 1;
    activeValidationRef.current = null;
    setIssueItems([]);
    if (activeValidation && mountedRef.current) {
      onBusyChange(false);
    }
  }, [documentKey, onBusyChange]);

  const clearValidationIssues = useCallback(() => {
    setIssueItems([]);
  }, []);

  const validateWorkflow = useCallback(async (): Promise<ValidationResult | null> => {
    if (blocked || activeValidationRef.current !== null) {
      return null;
    }

    const request = {
      documentKey: documentKeyRef.current,
      token: ++requestTokenRef.current,
    };
    activeValidationRef.current = request;
    onBusyChange(true);

    const isCurrent = () => mountedRef.current
      && documentKeyRef.current === request.documentKey
      && activeValidationRef.current?.token === request.token;

    try {
      const result = await client.validateWorkflow(workflow);
      if (!isCurrent()) {
        return null;
      }
      setIssueItems(result.valid ? [] : buildValidationIssueItems(result.issues));
      onMessage(result.valid ? "工作流验证通过。" : formatValidationSummary(result.issues));
      return result;
    } catch (error) {
      if (isCurrent()) {
        onMessage(`验证失败：${formatApiError(error)}`);
      }
      return null;
    } finally {
      if (activeValidationRef.current?.token === request.token) {
        activeValidationRef.current = null;
        if (mountedRef.current) {
          onBusyChange(false);
        }
      }
    }
  }, [blocked, client, onBusyChange, onMessage, workflow]);

  return {
    clearValidationIssues,
    issueItems,
    validateWorkflow,
  };
}
