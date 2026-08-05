import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  NodePackageRevision,
  NodePackageScanResult,
  NodePackageSummary,
  NodeType,
} from "../types";
import {
  useNodeCatalogController,
  type NodeCatalogClient,
} from "./useNodeCatalogController";

function nodeType(id = "test.node"): NodeType {
  return {
    id,
    name: id,
    category: "test",
    description: "Test node",
    inputs: {},
    outputs: {},
    configSchema: { type: "object", properties: {} },
  };
}

function packageSummary(overrides: Partial<NodePackageSummary> = {}): NodePackageSummary {
  return {
    id: "example.tools",
    name: "工具集",
    version: "1.0.0",
    status: "loaded",
    nodeIds: ["test.node"],
    lifecycle: {
      managed: true,
      enabled: true,
      lockedVersion: null,
      versionStatus: "unlocked",
      installManaged: true,
    },
    ...overrides,
  };
}

function packageScan(
  packages: NodePackageSummary[] = [packageSummary()],
  overrides: Partial<NodePackageScanResult> = {},
): NodePackageScanResult {
  return {
    packages,
    diagnostics: [],
    legacyNodeCount: 0,
    ...overrides,
  };
}

function revision(overrides: Partial<NodePackageRevision> = {}): NodePackageRevision {
  return {
    revisionId: "rev-1",
    packageId: "example.tools",
    version: "0.9.0",
    sourceFilename: "tools.zip",
    installedAt: "2026-08-01T00:00:00Z",
    archivedAt: "2026-08-01T01:00:00Z",
    checksum: "abc",
    ...overrides,
  };
}

function client(overrides: Partial<NodeCatalogClient> = {}): NodeCatalogClient {
  const scan = packageScan();
  return {
    activateNodePackageRevision: vi.fn().mockResolvedValue({
      action: "rolled_back",
      package: packageSummary(),
      scan,
    }),
    installNodePackage: vi.fn().mockResolvedValue({
      action: "installed",
      package: packageSummary(),
      scan,
    }),
    listNodePackageRevisions: vi.fn().mockResolvedValue([]),
    listNodePackages: vi.fn().mockResolvedValue(scan),
    listNodeTypes: vi.fn().mockResolvedValue([nodeType()]),
    reloadNodeTypes: vi.fn().mockResolvedValue([nodeType()]),
    uninstallNodePackage: vi.fn().mockResolvedValue(packageScan([])),
    updateNodePackageSettings: vi.fn().mockResolvedValue(scan),
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("useNodeCatalogController", () => {
  it("loads node types, package state, and recovery status", async () => {
    const onMessage = vi.fn();
    const scan = packageScan(undefined, {
      recoveries: [{
        transactionId: "tx-1",
        packageId: "example.tools",
        operation: "activate",
        action: "rolled_back",
        recoveredAt: "2026-08-01T00:00:00Z",
      }],
    });
    const catalogClient = client({ listNodePackages: vi.fn().mockResolvedValue(scan) });
    const { result } = renderHook(() => useNodeCatalogController({
      client: catalogClient,
      onMessage,
    }));

    await waitFor(() => expect(result.current.nodePackageScan).toEqual(scan));
    expect(result.current.nodeTypes).toEqual([nodeType()]);
    expect(onMessage).toHaveBeenLastCalledWith(
      "已加载 1 个节点，并恢复 1 个中断的节点包事务。",
    );
  });

  it("keeps a manual reload when the older initial request finishes later", async () => {
    const initialTypes = deferred<NodeType[]>();
    const catalogClient = client({
      listNodeTypes: vi.fn().mockReturnValue(initialTypes.promise),
      reloadNodeTypes: vi.fn().mockResolvedValue([nodeType("new.node")]),
    });
    const { result } = renderHook(() => useNodeCatalogController({
      client: catalogClient,
      onMessage: vi.fn(),
    }));
    await waitFor(() => expect(catalogClient.listNodeTypes).toHaveBeenCalledTimes(1));

    await act(async () => result.current.reloadNodeTypes());
    expect(result.current.nodeTypes).toEqual([nodeType("new.node")]);

    initialTypes.resolve([nodeType("old.node")]);
    await act(async () => initialTypes.promise);
    expect(result.current.nodeTypes).toEqual([nodeType("new.node")]);
  });

  it("retains the last package snapshot when reload diagnostics fail", async () => {
    const onMessage = vi.fn();
    const existingScan = packageScan();
    const catalogClient = client({
      listNodePackages: vi.fn()
        .mockResolvedValueOnce(existingScan)
        .mockRejectedValueOnce(new Error("scan offline")),
      reloadNodeTypes: vi.fn().mockResolvedValue([nodeType("new.node")]),
    });
    const { result } = renderHook(() => useNodeCatalogController({
      client: catalogClient,
      onMessage,
    }));
    await waitFor(() => expect(result.current.nodePackageScan).toEqual(existingScan));

    await act(async () => result.current.reloadNodeTypes());

    expect(result.current.nodeTypes).toEqual([nodeType("new.node")]);
    expect(result.current.nodePackageScan).toEqual(existingScan);
    expect(onMessage).toHaveBeenLastCalledWith(
      "已重新加载 1 个节点，但未能获取节点包诊断：scan offline",
    );
  });

  it("serializes package mutations even before React commits busy state", async () => {
    const mutationResult = deferred<NodePackageScanResult>();
    const disabledPackage = packageSummary({
      lifecycle: {
        managed: true,
        enabled: false,
        lockedVersion: null,
        versionStatus: "unlocked",
        installManaged: true,
      },
    });
    const updateSettings = vi.fn().mockReturnValue(mutationResult.promise);
    const catalogClient = client({ updateNodePackageSettings: updateSettings });
    const onMessage = vi.fn();
    const { result } = renderHook(() => useNodeCatalogController({
      client: catalogClient,
      onMessage,
    }));
    await waitFor(() => expect(result.current.nodePackageScan).not.toBeNull());

    let firstMutation!: Promise<void>;
    act(() => {
      firstMutation = result.current.updateNodePackageSettings("example.tools", {
        enabled: false,
        locked_version: null,
      });
      void result.current.updateNodePackageSettings("example.tools", {
        enabled: true,
        locked_version: null,
      });
    });
    expect(updateSettings).toHaveBeenCalledTimes(1);
    expect(result.current.updatingNodePackageId).toBe("example.tools");

    mutationResult.resolve(packageScan([disabledPackage]));
    await act(async () => firstMutation);
    expect(result.current.updatingNodePackageId).toBeNull();
    expect(onMessage).toHaveBeenLastCalledWith("已停用节点包“工具集”。");
  });

  it("does not install an untrusted package when confirmation is declined", async () => {
    const confirmAction = vi.fn().mockReturnValue(false);
    const catalogClient = client();
    const { result } = renderHook(() => useNodeCatalogController({
      client: catalogClient,
      confirmAction,
      onMessage: vi.fn(),
    }));
    await waitFor(() => expect(result.current.nodePackageScan).not.toBeNull());
    const file = new File(["zip"], "tools.zip", { type: "application/zip" });

    await act(async () => result.current.installNodePackage(file));

    expect(confirmAction).toHaveBeenCalledWith(
      "节点包“tools.zip”包含会在本机执行的 Python 代码。请只导入你信任的文件。是否继续？",
    );
    expect(catalogClient.installNodePackage).not.toHaveBeenCalled();
  });

  it("drops a revision response invalidated by a catalog reload", async () => {
    const revisionRequest = deferred<NodePackageRevision[]>();
    const catalogClient = client({
      listNodePackageRevisions: vi.fn().mockReturnValue(revisionRequest.promise),
    });
    const { result } = renderHook(() => useNodeCatalogController({
      client: catalogClient,
      onMessage: vi.fn(),
    }));
    await waitFor(() => expect(result.current.nodePackageScan).not.toBeNull());

    let loadPromise!: Promise<void>;
    act(() => {
      loadPromise = result.current.loadNodePackageRevisions("example.tools");
    });
    expect(result.current.loadingNodePackageRevisionId).toBe("example.tools");
    await act(async () => result.current.reloadNodeTypes());
    expect(result.current.loadingNodePackageRevisionId).toBeNull();

    revisionRequest.resolve([revision()]);
    await act(async () => loadPromise);
    expect(result.current.nodePackageRevisions["example.tools"]).toBeUndefined();
  });
});
