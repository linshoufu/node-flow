import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  useWorkspaceResources,
  type WorkspaceResourceClient,
} from "./useWorkspaceResources";

function createClient(): WorkspaceResourceClient {
  return {
    listCredentialTypes: vi.fn().mockResolvedValue([{ id: "http.bearer", display_name: "Bearer", node_type_ids: [], fields: [] }]),
    listCredentials: vi.fn().mockResolvedValue([]),
    createCredential: vi.fn().mockResolvedValue({}),
    updateCredential: vi.fn().mockResolvedValue({}),
    deleteCredential: vi.fn().mockResolvedValue(undefined),
    listProjectVariables: vi.fn().mockResolvedValue([{ name: "baseUrl", value: "https://example.test", updated_at: "2026-08-01" }]),
    createProjectVariable: vi.fn().mockResolvedValue({}),
    updateProjectVariable: vi.fn().mockResolvedValue({}),
    deleteProjectVariable: vi.fn().mockResolvedValue(undefined),
    listProjectEnvironments: vi.fn().mockResolvedValue([{ id: "env_test", name: "测试", variables: {}, credential_overrides: {}, is_default: false, created_at: "2026-08-01", updated_at: "2026-08-01" }]),
    createProjectEnvironment: vi.fn().mockResolvedValue({}),
    updateProjectEnvironment: vi.fn().mockResolvedValue({}),
    deleteProjectEnvironment: vi.fn().mockResolvedValue(undefined),
  } as WorkspaceResourceClient;
}

describe("useWorkspaceResources", () => {
  it("loads optional project resources and opens one manager at a time", async () => {
    const client = createClient();
    const { result } = renderHook(() => useWorkspaceResources({ client, onMessage: vi.fn() }));

    await waitFor(() => expect(result.current.projectVariables).toHaveLength(1));
    expect(result.current.projectEnvironments).toHaveLength(1);
    await act(() => result.current.openResource("credentials"));
    expect(result.current.activeResourceManager).toBe("credentials");
    expect(result.current.credentialTypes[0]?.id).toBe("http.bearer");
    act(() => result.current.closeResource());
    expect(result.current.activeResourceManager).toBeNull();

    await act(() => result.current.openResource("environments"));
    expect(result.current.activeResourceManager).toBe("environments");
    expect(client.listCredentials).toHaveBeenCalledTimes(2);
  });

  it("owns mutations, refreshes state and publishes Chinese status messages", async () => {
    const client = createClient();
    const onMessage = vi.fn();
    const { result } = renderHook(() => useWorkspaceResources({ client, onMessage }));
    await waitFor(() => expect(result.current.projectVariables).toHaveLength(1));

    await act(() => result.current.createProjectVariable({ name: "region", value: "cn" }));
    expect(client.createProjectVariable).toHaveBeenCalledWith({ name: "region", value: "cn" });
    expect(client.listProjectVariables).toHaveBeenCalledTimes(2);
    expect(onMessage).toHaveBeenLastCalledWith("已保存项目变量。");
  });

  it("formats resource loading errors without leaking API wrappers", async () => {
    const client = createClient();
    vi.mocked(client.listCredentials).mockRejectedValueOnce(
      new Error('API 500: {"detail":{"message":"凭据仓库不可用。"}}'),
    );
    const onMessage = vi.fn();
    const { result } = renderHook(() => useWorkspaceResources({ client, onMessage }));

    await act(() => result.current.openResource("credentials"));
    expect(onMessage).toHaveBeenCalledWith("凭据加载失败：凭据仓库不可用。");
    expect(result.current.isCredentialManagerLoading).toBe(false);
  });
});
