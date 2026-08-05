import { useCallback, useEffect, useRef, useState } from "react";
import { apiClient, ApiClient } from "../api/client";
import type { WorkspaceResourceKind } from "../lib/workspaceResources";
import { formatApiError } from "../lib/apiError";
import type {
  CredentialCreateRequest,
  CredentialSummary,
  CredentialType,
  CredentialUpdateRequest,
  ProjectEnvironment,
  ProjectEnvironmentCreateRequest,
  ProjectEnvironmentUpdateRequest,
  ProjectVariable,
  ProjectVariableCreateRequest,
  ProjectVariableUpdateRequest,
} from "../types";

export type WorkspaceResourceClient = Pick<
  ApiClient,
  | "listCredentialTypes"
  | "listCredentials"
  | "createCredential"
  | "updateCredential"
  | "deleteCredential"
  | "listProjectVariables"
  | "createProjectVariable"
  | "updateProjectVariable"
  | "deleteProjectVariable"
  | "listProjectEnvironments"
  | "createProjectEnvironment"
  | "updateProjectEnvironment"
  | "deleteProjectEnvironment"
>;

type UseWorkspaceResourcesOptions = {
  client?: WorkspaceResourceClient;
  onMessage: (message: string) => void;
};

export function useWorkspaceResources({
  client = apiClient,
  onMessage,
}: UseWorkspaceResourcesOptions) {
  const mountedRef = useRef(true);
  const [activeResourceManager, setActiveResourceManager] = useState<WorkspaceResourceKind | null>(null);
  const [credentialTypes, setCredentialTypes] = useState<CredentialType[]>([]);
  const [credentials, setCredentials] = useState<CredentialSummary[]>([]);
  const [projectVariables, setProjectVariables] = useState<ProjectVariable[]>([]);
  const [projectEnvironments, setProjectEnvironments] = useState<ProjectEnvironment[]>([]);
  const [isCredentialManagerLoading, setIsCredentialManagerLoading] = useState(false);
  const [isProjectVariableManagerLoading, setIsProjectVariableManagerLoading] = useState(false);
  const [isEnvironmentManagerLoading, setIsEnvironmentManagerLoading] = useState(false);

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void client.listProjectEnvironments().then((items) => {
      if (!cancelled) {
        setProjectEnvironments(items);
      }
    }).catch(() => {
      // Environment management is optional while an older API server is running.
    });
    void client.listProjectVariables().then((items) => {
      if (!cancelled) {
        setProjectVariables(items);
      }
    }).catch(() => {
      // Project variables are optional while an older API server is running.
    });
    return () => {
      cancelled = true;
    };
  }, [client]);

  const refreshCredentials = useCallback(async () => {
    setIsCredentialManagerLoading(true);
    try {
      const [types, savedCredentials] = await Promise.all([
        client.listCredentialTypes(),
        client.listCredentials(),
      ]);
      if (mountedRef.current) {
        setCredentialTypes(types);
        setCredentials(savedCredentials);
      }
    } catch (error: unknown) {
      if (mountedRef.current) {
        onMessage(`凭据加载失败：${formatApiError(error)}`);
      }
    } finally {
      if (mountedRef.current) {
        setIsCredentialManagerLoading(false);
      }
    }
  }, [client, onMessage]);

  const refreshProjectVariables = useCallback(async () => {
    setIsProjectVariableManagerLoading(true);
    try {
      const items = await client.listProjectVariables();
      if (mountedRef.current) {
        setProjectVariables(items);
      }
    } catch (error: unknown) {
      if (mountedRef.current) {
        onMessage(`项目变量加载失败：${formatApiError(error)}`);
      }
    } finally {
      if (mountedRef.current) {
        setIsProjectVariableManagerLoading(false);
      }
    }
  }, [client, onMessage]);

  const refreshProjectEnvironments = useCallback(async () => {
    setIsEnvironmentManagerLoading(true);
    try {
      const items = await client.listProjectEnvironments();
      if (mountedRef.current) {
        setProjectEnvironments(items);
      }
    } catch (error: unknown) {
      if (mountedRef.current) {
        onMessage(`运行环境加载失败：${formatApiError(error)}`);
      }
    } finally {
      if (mountedRef.current) {
        setIsEnvironmentManagerLoading(false);
      }
    }
  }, [client, onMessage]);

  const openResource = useCallback(async (kind: WorkspaceResourceKind) => {
    setActiveResourceManager(kind);
    if (kind === "credentials") {
      await refreshCredentials();
    } else if (kind === "variables") {
      await refreshProjectVariables();
    } else if (kind === "environments") {
      await Promise.all([refreshProjectEnvironments(), refreshCredentials()]);
    }
  }, [refreshCredentials, refreshProjectEnvironments, refreshProjectVariables]);

  const closeResource = useCallback(() => setActiveResourceManager(null), []);

  const createCredential = useCallback(async (request: CredentialCreateRequest) => {
    await client.createCredential(request);
    await refreshCredentials();
    onMessage("已保存本地凭据。");
  }, [client, onMessage, refreshCredentials]);

  const updateCredential = useCallback(async (credentialId: string, request: CredentialUpdateRequest) => {
    await client.updateCredential(credentialId, request);
    await refreshCredentials();
    onMessage("已更新本地凭据。");
  }, [client, onMessage, refreshCredentials]);

  const deleteCredential = useCallback(async (credentialId: string) => {
    await client.deleteCredential(credentialId);
    await refreshCredentials();
    onMessage("已删除本地凭据。");
  }, [client, onMessage, refreshCredentials]);

  const createProjectVariable = useCallback(async (request: ProjectVariableCreateRequest) => {
    await client.createProjectVariable(request);
    await refreshProjectVariables();
    onMessage("已保存项目变量。");
  }, [client, onMessage, refreshProjectVariables]);

  const updateProjectVariable = useCallback(async (name: string, request: ProjectVariableUpdateRequest) => {
    await client.updateProjectVariable(name, request);
    await refreshProjectVariables();
    onMessage("已更新项目变量。");
  }, [client, onMessage, refreshProjectVariables]);

  const deleteProjectVariable = useCallback(async (name: string) => {
    await client.deleteProjectVariable(name);
    await refreshProjectVariables();
    onMessage("已删除项目变量。");
  }, [client, onMessage, refreshProjectVariables]);

  const createProjectEnvironment = useCallback(async (request: ProjectEnvironmentCreateRequest) => {
    await client.createProjectEnvironment(request);
    await refreshProjectEnvironments();
    onMessage("已创建运行环境。");
  }, [client, onMessage, refreshProjectEnvironments]);

  const updateProjectEnvironment = useCallback(async (environmentId: string, request: ProjectEnvironmentUpdateRequest) => {
    await client.updateProjectEnvironment(environmentId, request);
    await refreshProjectEnvironments();
    onMessage("已更新运行环境。");
  }, [client, onMessage, refreshProjectEnvironments]);

  const deleteProjectEnvironment = useCallback(async (environmentId: string) => {
    await client.deleteProjectEnvironment(environmentId);
    await refreshProjectEnvironments();
    onMessage("已删除运行环境。");
  }, [client, onMessage, refreshProjectEnvironments]);

  return {
    activeResourceManager,
    closeResource,
    credentialTypes,
    credentials,
    createCredential,
    createProjectEnvironment,
    createProjectVariable,
    deleteCredential,
    deleteProjectEnvironment,
    deleteProjectVariable,
    isCredentialManagerLoading,
    isEnvironmentManagerLoading,
    isProjectVariableManagerLoading,
    openResource,
    projectEnvironments,
    projectVariables,
    refreshCredentials,
    refreshProjectEnvironments,
    refreshProjectVariables,
    updateCredential,
    updateProjectEnvironment,
    updateProjectVariable,
  };
}
