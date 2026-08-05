import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../api/client";
import { apiClient } from "../api/client";
import { formatApiError } from "../lib/apiError";
import type {
  NodePackageRevision,
  NodePackageScanResult,
  NodePackageSettingsUpdate,
  NodeType,
} from "../types";

export type NodeCatalogClient = Pick<
  ApiClient,
  | "activateNodePackageRevision"
  | "installNodePackage"
  | "listNodePackageRevisions"
  | "listNodePackages"
  | "listNodeTypes"
  | "reloadNodeTypes"
  | "uninstallNodePackage"
  | "updateNodePackageSettings"
>;

type UseNodeCatalogControllerOptions = {
  client?: NodeCatalogClient;
  confirmAction?: (message: string) => boolean;
  onMessage: (message: string) => void;
};

type ActivePackageMutation = {
  kind: "install" | "package";
  packageId: string | null;
  token: number;
};

export function useNodeCatalogController({
  client = apiClient,
  confirmAction = defaultConfirmAction,
  onMessage,
}: UseNodeCatalogControllerOptions) {
  const [nodeTypes, setNodeTypes] = useState<NodeType[]>([]);
  const [nodePackageScan, setNodePackageScan] = useState<NodePackageScanResult | null>(null);
  const [nodePackageRevisions, setNodePackageRevisions] = useState<
    Record<string, NodePackageRevision[] | undefined>
  >({});
  const [isNodeTypesReloading, setIsNodeTypesReloading] = useState(false);
  const [isInstallingNodePackage, setIsInstallingNodePackage] = useState(false);
  const [updatingNodePackageId, setUpdatingNodePackageId] = useState<string | null>(null);
  const [loadingNodePackageRevisionId, setLoadingNodePackageRevisionId] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const onMessageRef = useRef(onMessage);
  const catalogRequestTokenRef = useRef(0);
  const reloadActiveRef = useRef(false);
  const packageMutationTokenRef = useRef(0);
  const activePackageMutationRef = useRef<ActivePackageMutation | null>(null);
  const revisionRequestTokenRef = useRef(0);
  const activeRevisionPackageRef = useRef<string | null>(null);
  onMessageRef.current = onMessage;

  const emitMessage = useCallback((message: string) => {
    onMessageRef.current(message);
  }, []);

  const isCatalogRequestCurrent = useCallback((token: number) => (
    mountedRef.current && catalogRequestTokenRef.current === token
  ), []);

  const invalidateRevisionRequest = useCallback(() => {
    revisionRequestTokenRef.current += 1;
    activeRevisionPackageRef.current = null;
    if (mountedRef.current) {
      setLoadingNodePackageRevisionId(null);
    }
  }, []);

  const loadInitialCatalog = useCallback(async () => {
    const requestToken = ++catalogRequestTokenRef.current;
    try {
      const types = await client.listNodeTypes();
      if (!isCatalogRequestCurrent(requestToken)) {
        return;
      }
      setNodeTypes(types);
      emitMessage(types.length === 0 ? "没有可用节点。" : `已加载 ${types.length} 个节点类型。`);
      try {
        const packageScan = validateNodePackageScan(await client.listNodePackages());
        if (!isCatalogRequestCurrent(requestToken)) {
          return;
        }
        setNodePackageScan(packageScan);
        emitMessage(initialCatalogMessage(types.length, packageScan));
      } catch (error: unknown) {
        if (isCatalogRequestCurrent(requestToken)) {
          emitMessage(`已加载 ${types.length} 个节点，但未能获取节点包状态：${formatApiError(error)}`);
        }
      }
    } catch (error: unknown) {
      if (isCatalogRequestCurrent(requestToken)) {
        emitMessage(`节点类型加载失败：${formatApiError(error)}`);
      }
    }
  }, [client, emitMessage, isCatalogRequestCurrent]);

  useEffect(() => {
    mountedRef.current = true;
    void loadInitialCatalog();
    return () => {
      mountedRef.current = false;
      catalogRequestTokenRef.current += 1;
      packageMutationTokenRef.current += 1;
      revisionRequestTokenRef.current += 1;
      reloadActiveRef.current = false;
      activePackageMutationRef.current = null;
      activeRevisionPackageRef.current = null;
    };
  }, [loadInitialCatalog]);

  const reloadNodeTypes = useCallback(async () => {
    if (reloadActiveRef.current || activePackageMutationRef.current) {
      return;
    }

    reloadActiveRef.current = true;
    setIsNodeTypesReloading(true);
    invalidateRevisionRequest();
    const requestToken = ++catalogRequestTokenRef.current;
    emitMessage("正在重新扫描 Python 节点...");

    try {
      const types = await client.reloadNodeTypes();
      if (!isCatalogRequestCurrent(requestToken)) {
        return;
      }
      setNodeTypes(types);
      try {
        const packageScan = validateNodePackageScan(await client.listNodePackages());
        if (!isCatalogRequestCurrent(requestToken)) {
          return;
        }
        setNodePackageScan(packageScan);
        emitMessage(reloadedCatalogMessage(types.length, packageScan));
      } catch (error: unknown) {
        if (isCatalogRequestCurrent(requestToken)) {
          emitMessage(`已重新加载 ${types.length} 个节点，但未能获取节点包诊断：${formatApiError(error)}`);
        }
      }
    } catch (error: unknown) {
      if (isCatalogRequestCurrent(requestToken)) {
        emitMessage(`节点类型重新加载失败：${formatApiError(error)}`);
      }
    } finally {
      if (catalogRequestTokenRef.current === requestToken) {
        reloadActiveRef.current = false;
        if (mountedRef.current) {
          setIsNodeTypesReloading(false);
        }
      }
    }
  }, [client, emitMessage, invalidateRevisionRequest, isCatalogRequestCurrent]);

  const beginPackageMutation = useCallback((
    kind: ActivePackageMutation["kind"],
    packageId: string | null,
  ): ActivePackageMutation | null => {
    if (reloadActiveRef.current || activePackageMutationRef.current) {
      return null;
    }

    catalogRequestTokenRef.current += 1;
    invalidateRevisionRequest();
    const mutation = {
      kind,
      packageId,
      token: ++packageMutationTokenRef.current,
    };
    activePackageMutationRef.current = mutation;
    if (kind === "install") {
      setIsInstallingNodePackage(true);
    } else {
      setUpdatingNodePackageId(packageId);
    }
    return mutation;
  }, [invalidateRevisionRequest]);

  const isPackageMutationCurrent = useCallback((mutation: ActivePackageMutation) => (
    mountedRef.current
    && activePackageMutationRef.current?.token === mutation.token
    && packageMutationTokenRef.current === mutation.token
  ), []);

  const finishPackageMutation = useCallback((mutation: ActivePackageMutation) => {
    if (activePackageMutationRef.current?.token !== mutation.token) {
      return;
    }
    activePackageMutationRef.current = null;
    if (!mountedRef.current) {
      return;
    }
    if (mutation.kind === "install") {
      setIsInstallingNodePackage(false);
    } else {
      setUpdatingNodePackageId(null);
    }
  }, []);

  const updateNodePackageSettings = useCallback(async (
    packageId: string,
    request: NodePackageSettingsUpdate,
  ) => {
    const mutation = beginPackageMutation("package", packageId);
    if (!mutation) {
      return;
    }

    try {
      const packageScan = validateNodePackageScan(
        await client.updateNodePackageSettings(packageId, request),
      );
      const types = await client.listNodeTypes();
      if (!isPackageMutationCurrent(mutation)) {
        return;
      }
      setNodePackageScan(packageScan);
      setNodeTypes(types);
      const updatedPackage = packageScan.packages.find((nodePackage) => nodePackage.id === packageId);
      const lifecycle = updatedPackage?.lifecycle;
      emitMessage(
        lifecycle?.enabled === false
          ? `已停用节点包“${updatedPackage?.name ?? packageId}”。`
          : lifecycle?.lockedVersion
            ? `节点包“${updatedPackage?.name ?? packageId}”已锁定到 v${lifecycle.lockedVersion}。`
            : `已启用节点包“${updatedPackage?.name ?? packageId}”，未锁定版本。`,
      );
    } catch (error: unknown) {
      if (isPackageMutationCurrent(mutation)) {
        emitMessage(`更新节点包失败：${formatApiError(error)}`);
      }
    } finally {
      finishPackageMutation(mutation);
    }
  }, [
    beginPackageMutation,
    client,
    finishPackageMutation,
    isPackageMutationCurrent,
    emitMessage,
  ]);

  const installNodePackage = useCallback(async (file: File) => {
    if (reloadActiveRef.current || activePackageMutationRef.current) {
      return;
    }
    if (!confirmAction(
      `节点包“${file.name}”包含会在本机执行的 Python 代码。请只导入你信任的文件。是否继续？`,
    )) {
      return;
    }

    const mutation = beginPackageMutation("install", null);
    if (!mutation) {
      return;
    }
    emitMessage(`正在预检并导入“${file.name}”...`);
    try {
      const result = await client.installNodePackage(file);
      const packageScan = validateNodePackageScan(result.scan);
      const types = await client.listNodeTypes();
      if (!isPackageMutationCurrent(mutation)) {
        return;
      }
      setNodePackageScan(packageScan);
      setNodeTypes(types);
      setNodePackageRevisions((current) => omitPackageRevisions(current, result.package.id));
      const actionLabel = {
        installed: "已安装",
        upgraded: "已升级",
        reinstalled: "已重新安装",
        rolled_back: "已恢复",
      }[result.action];
      emitMessage(
        `${actionLabel}节点包“${result.package.name}” v${result.package.version}，当前可用节点 ${types.length} 个。`,
      );
    } catch (error: unknown) {
      if (isPackageMutationCurrent(mutation)) {
        emitMessage(`节点包导入失败：${formatApiError(error)}`);
      }
    } finally {
      finishPackageMutation(mutation);
    }
  }, [
    beginPackageMutation,
    client,
    confirmAction,
    finishPackageMutation,
    isPackageMutationCurrent,
    emitMessage,
  ]);

  const uninstallNodePackage = useCallback(async (packageId: string) => {
    if (reloadActiveRef.current || activePackageMutationRef.current) {
      return;
    }
    const nodePackage = nodePackageScan?.packages.find((candidate) => candidate.id === packageId);
    if (!confirmAction(`确认卸载节点包“${nodePackage?.name ?? packageId}”吗？`)) {
      return;
    }

    const mutation = beginPackageMutation("package", packageId);
    if (!mutation) {
      return;
    }
    try {
      const packageScan = validateNodePackageScan(await client.uninstallNodePackage(packageId));
      const types = await client.listNodeTypes();
      if (!isPackageMutationCurrent(mutation)) {
        return;
      }
      setNodePackageScan(packageScan);
      setNodeTypes(types);
      setNodePackageRevisions((current) => omitPackageRevisions(current, packageId));
      emitMessage(`已卸载节点包“${nodePackage?.name ?? packageId}”。`);
    } catch (error: unknown) {
      if (isPackageMutationCurrent(mutation)) {
        emitMessage(`卸载节点包失败：${formatApiError(error)}`);
      }
    } finally {
      finishPackageMutation(mutation);
    }
  }, [
    beginPackageMutation,
    client,
    confirmAction,
    finishPackageMutation,
    isPackageMutationCurrent,
    nodePackageScan?.packages,
    emitMessage,
  ]);

  const loadNodePackageRevisions = useCallback(async (packageId: string) => {
    if (
      reloadActiveRef.current
      || activePackageMutationRef.current
      || activeRevisionPackageRef.current
    ) {
      return;
    }

    const requestToken = ++revisionRequestTokenRef.current;
    activeRevisionPackageRef.current = packageId;
    setLoadingNodePackageRevisionId(packageId);
    try {
      const revisions = await client.listNodePackageRevisions(packageId);
      if (!mountedRef.current || revisionRequestTokenRef.current !== requestToken) {
        return;
      }
      setNodePackageRevisions((current) => ({ ...current, [packageId]: revisions }));
      emitMessage(
        revisions.length > 0
          ? `已加载 ${revisions.length} 个节点包历史版本。`
          : "当前节点包还没有可恢复的历史版本。",
      );
    } catch (error: unknown) {
      if (mountedRef.current && revisionRequestTokenRef.current === requestToken) {
        emitMessage(`节点包历史加载失败：${formatApiError(error)}`);
      }
    } finally {
      if (revisionRequestTokenRef.current === requestToken) {
        activeRevisionPackageRef.current = null;
        if (mountedRef.current) {
          setLoadingNodePackageRevisionId(null);
        }
      }
    }
  }, [client, emitMessage]);

  const activateNodePackageRevision = useCallback(async (
    packageId: string,
    revisionId: string,
  ) => {
    if (reloadActiveRef.current || activePackageMutationRef.current) {
      return;
    }
    const nodePackage = nodePackageScan?.packages.find((candidate) => candidate.id === packageId);
    const revision = nodePackageRevisions[packageId]?.find(
      (candidate) => candidate.revisionId === revisionId,
    );
    if (!confirmAction(
      `确认将节点包“${nodePackage?.name ?? packageId}”恢复到 v${revision?.version ?? "未知版本"}吗？当前版本会保留到历史记录。`,
    )) {
      return;
    }

    const mutation = beginPackageMutation("package", packageId);
    if (!mutation) {
      return;
    }
    try {
      const result = await client.activateNodePackageRevision(packageId, revisionId);
      const packageScan = validateNodePackageScan(result.scan);
      const [types, revisions] = await Promise.all([
        client.listNodeTypes(),
        client.listNodePackageRevisions(packageId),
      ]);
      if (!isPackageMutationCurrent(mutation)) {
        return;
      }
      setNodePackageScan(packageScan);
      setNodeTypes(types);
      setNodePackageRevisions((current) => ({ ...current, [packageId]: revisions }));
      emitMessage(`已将节点包“${result.package.name}”恢复到 v${result.package.version}。`);
    } catch (error: unknown) {
      if (isPackageMutationCurrent(mutation)) {
        emitMessage(`恢复节点包失败：${formatApiError(error)}`);
      }
    } finally {
      finishPackageMutation(mutation);
    }
  }, [
    beginPackageMutation,
    client,
    confirmAction,
    finishPackageMutation,
    isPackageMutationCurrent,
    nodePackageRevisions,
    nodePackageScan?.packages,
    emitMessage,
  ]);

  return {
    activateNodePackageRevision,
    installNodePackage,
    isInstallingNodePackage,
    isNodeTypesReloading,
    loadNodePackageRevisions,
    loadingNodePackageRevisionId,
    nodePackageRevisions,
    nodePackageScan,
    nodeTypes,
    reloadNodeTypes,
    uninstallNodePackage,
    updateNodePackageSettings,
    updatingNodePackageId,
  };
}

function defaultConfirmAction(message: string): boolean {
  return window.confirm(message);
}

function validateNodePackageScan(scan: NodePackageScanResult): NodePackageScanResult {
  if (!Array.isArray(scan.packages) || !Array.isArray(scan.diagnostics)) {
    throw new Error("节点包状态响应格式无效。");
  }
  return scan;
}

function initialCatalogMessage(typeCount: number, scan: NodePackageScanResult): string {
  const recoveryCount = scan.recoveries?.length ?? 0;
  if (recoveryCount > 0) {
    return `已加载 ${typeCount} 个节点，并恢复 ${recoveryCount} 个中断的节点包事务。`;
  }
  return catalogMessage(typeCount, scan, "已加载");
}

function reloadedCatalogMessage(typeCount: number, scan: NodePackageScanResult): string {
  return catalogMessage(typeCount, scan, "已重新加载");
}

function catalogMessage(
  typeCount: number,
  scan: NodePackageScanResult,
  successPrefix: "已加载" | "已重新加载",
): string {
  if (scan.diagnostics.length > 0) {
    return `已加载 ${typeCount} 个节点，发现 ${scan.diagnostics.length} 个节点包问题。`;
  }
  if (typeCount === 0) {
    return "没有可用节点。";
  }
  return `${successPrefix} ${typeCount} 个节点类型。`;
}

function omitPackageRevisions(
  revisions: Record<string, NodePackageRevision[] | undefined>,
  packageId: string,
): Record<string, NodePackageRevision[] | undefined> {
  const next = { ...revisions };
  delete next[packageId];
  return next;
}
