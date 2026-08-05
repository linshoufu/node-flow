import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  PackagePlus,
  RefreshCw,
  Search,
  Upload,
  X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type {
  NodePackageDiagnostic,
  NodePackageRevision,
  NodePackageScanResult,
  NodePackageSettingsUpdate,
  NodePackageSummary,
} from "../types";
import { nodePackageIdsNeedingAttention } from "../lib/nodePackageDisplay";
import {
  DiagnosticList,
  PackageContractSummary,
  PackageLifecycleActions,
  PackageRevisionHistory,
  PackageStateBadge,
} from "./NodePackageDiagnostics";

type PackageFilter = "all" | "managed" | "attention";

type NodePackageManagerProps = {
  scan: NodePackageScanResult | null;
  updatingPackageId?: string | null;
  installing?: boolean;
  refreshing?: boolean;
  revisionsByPackageId?: Record<string, NodePackageRevision[] | undefined>;
  loadingRevisionPackageId?: string | null;
  onClose: () => void;
  onRefresh?: () => void;
  onInstall?: (file: File) => void;
  onUninstall?: (packageId: string) => void;
  onLoadRevisions?: (packageId: string) => void;
  onActivateRevision?: (packageId: string, revisionId: string) => void;
  onUpdateSettings?: (packageId: string, request: NodePackageSettingsUpdate) => void;
};

export function NodePackageManager({
  scan,
  updatingPackageId = null,
  installing = false,
  refreshing = false,
  revisionsByPackageId = {},
  loadingRevisionPackageId = null,
  onClose,
  onRefresh,
  onInstall,
  onUninstall,
  onLoadRevisions,
  onActivateRevision,
  onUpdateSettings,
}: NodePackageManagerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PackageFilter>("all");
  const packages = scan?.packages ?? [];
  const diagnostics = scan?.diagnostics ?? [];
  const diagnosticsByPackage = useMemo(() => groupDiagnostics(diagnostics), [diagnostics]);
  const managedCount = packages.filter((item) => item.lifecycle?.managed).length;
  const attentionPackageIds = useMemo(
    () => nodePackageIdsNeedingAttention(packages, diagnostics),
    [diagnostics, packages],
  );
  const visiblePackages = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
    return packages.filter((nodePackage) => {
      const lifecycle = nodePackage.lifecycle;
      if (filter === "managed" && !lifecycle?.managed) {
        return false;
      }
      if (filter === "attention" && !attentionPackageIds.has(nodePackage.id)) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      return [
        nodePackage.name,
        nodePackage.description,
        nodePackage.author,
        nodePackage.id,
        ...nodePackage.nodeIds,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase("zh-CN").includes(normalizedQuery));
    });
  }, [attentionPackageIds, filter, packages, query]);
  const orphanDiagnostics = diagnostics.filter(
    (diagnostic) => !diagnostic.packageId || !packages.some((item) => item.id === diagnostic.packageId),
  );
  const isBusy = installing || refreshing || updatingPackageId !== null;

  function selectImportFile(file: File | undefined) {
    if (file && onInstall) {
      onInstall(file);
    }
  }

  return (
    <section aria-label="节点包管理" aria-modal="true" className="node-package-manager" role="dialog">
      <header className="node-package-manager-header">
        <div className="node-package-manager-title">
          <Boxes aria-hidden="true" size={21} />
          <div>
            <h2>节点包管理</h2>
            <p>管理本机可用的 Python 节点包、兼容性和历史版本。</p>
          </div>
        </div>
        <div className="node-package-manager-header-actions">
          {onRefresh ? (
            <button
              aria-label="刷新节点包"
              className="icon-button"
              disabled={isBusy}
              title="刷新节点包"
              type="button"
              onClick={onRefresh}
            >
              <RefreshCw aria-hidden="true" className={refreshing ? "is-spinning" : undefined} size={16} />
            </button>
          ) : null}
          <button
            aria-label="关闭节点包管理"
            className="icon-button"
            type="button"
            onClick={onClose}
          >
            <X aria-hidden="true" size={17} />
          </button>
        </div>
      </header>

      <div className="node-package-manager-toolbar">
        <label className="node-package-manager-search">
          <Search aria-hidden="true" size={16} />
          <input
            aria-label="搜索节点包"
            placeholder="搜索名称、作者或节点"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <div aria-label="节点包筛选" className="node-package-manager-filters" role="group">
          <button aria-pressed={filter === "all"} type="button" onClick={() => setFilter("all")}>
            全部 {packages.length}
          </button>
          <button aria-pressed={filter === "managed"} type="button" onClick={() => setFilter("managed")}>
            可管理 {managedCount}
          </button>
          <button aria-pressed={filter === "attention"} type="button" onClick={() => setFilter("attention")}>
            需处理 {attentionPackageIds.size}
          </button>
        </div>
        {onInstall ? (
          <>
            <button
              className="primary-button node-package-import-button"
              disabled={isBusy}
              type="button"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload aria-hidden="true" size={15} />
              {installing ? "正在导入" : "导入 ZIP"}
            </button>
            <input
              ref={fileInputRef}
              accept=".zip,application/zip"
              aria-label="选择节点包 ZIP"
              hidden
              type="file"
              onChange={(event) => {
                selectImportFile(event.currentTarget.files?.[0]);
                event.currentTarget.value = "";
              }}
            />
          </>
        ) : null}
      </div>

      <div className="node-package-manager-summary" aria-label="节点包概览">
        <PackageMetric label="节点包" value={packages.length} />
        <PackageMetric label="可用节点" value={packages.reduce((sum, item) => sum + item.nodeIds.length, 0)} />
        <PackageMetric label="可管理" value={managedCount} />
        <PackageMetric attention={attentionPackageIds.size > 0} label="需处理" value={attentionPackageIds.size} />
      </div>

      <div className="node-package-manager-content">
        {(scan?.recoveries?.length ?? 0) > 0 ? (
          <div className="node-package-recovery-notice" role="status">
            <CheckCircle2 aria-hidden="true" size={17} />
            <div>
              <strong>已恢复中断的节点包事务</strong>
              <span>启动时已处理 {scan?.recoveries?.length} 个未完成事务，节点目录已重新校验。</span>
            </div>
          </div>
        ) : null}

        {!scan ? (
          <div className="node-package-manager-empty">
            <RefreshCw aria-hidden="true" size={24} />
            <strong>正在读取节点包</strong>
          </div>
        ) : visiblePackages.length === 0 ? (
          <div className="node-package-manager-empty">
            <PackagePlus aria-hidden="true" size={26} />
            <strong>{packages.length === 0 ? "还没有节点包" : "没有符合条件的节点包"}</strong>
            <span>{packages.length === 0 ? "导入 ZIP 后，节点会出现在左侧节点库。" : "调整搜索词或筛选条件后重试。"}</span>
          </div>
        ) : (
          <div className="node-package-manager-list">
            {visiblePackages.map((nodePackage) => {
              const packageDiagnostics = diagnosticsByPackage.get(nodePackage.id) ?? [];
              const lifecycle = nodePackage.lifecycle;
              return (
                <article className="node-package-manager-item" key={nodePackage.id}>
                  <div className="node-package-manager-item-heading">
                    <div>
                      <div className="node-package-manager-item-name">
                        <h3>{nodePackage.name}</h3>
                        <span>v{nodePackage.version}</span>
                        <PackageStateBadge nodePackage={nodePackage} />
                      </div>
                      <p>{nodePackage.description || packageSourceLabel(nodePackage)}</p>
                    </div>
                    <div className="node-package-manager-item-facts">
                      <span>{packageSourceLabel(nodePackage)}</span>
                      <span>{nodePackage.nodeIds.length} 个节点</span>
                      {nodePackage.author ? <span>{nodePackage.author}</span> : null}
                    </div>
                  </div>
                  <PackageContractSummary nodePackage={nodePackage} />
                  <PackageLifecycleActions
                    disabled={updatingPackageId === nodePackage.id}
                    loadingRevisions={loadingRevisionPackageId === nodePackage.id}
                    nodePackage={nodePackage}
                    onLoadRevisions={onLoadRevisions}
                    onUpdateSettings={onUpdateSettings}
                    onUninstall={onUninstall}
                    revisions={revisionsByPackageId[nodePackage.id]}
                  />
                  <PackageRevisionHistory
                    disabled={updatingPackageId === nodePackage.id}
                    nodePackage={nodePackage}
                    onActivateRevision={onActivateRevision}
                    revisions={revisionsByPackageId[nodePackage.id]}
                  />
                  {packageDiagnostics.length > 0 ? (
                    <div className="node-package-manager-diagnostics">
                      <DiagnosticList diagnostics={packageDiagnostics} />
                    </div>
                  ) : null}
                  {lifecycle?.enabled === false ? (
                    <p className="node-package-manager-disabled-note">此节点包已停用，不会出现在节点库中。</p>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}

        {orphanDiagnostics.length > 0 ? (
          <section aria-label="其他节点包问题" className="node-package-manager-orphan-diagnostics">
            <h3>其他加载问题</h3>
            <DiagnosticList diagnostics={orphanDiagnostics} />
          </section>
        ) : null}
      </div>
    </section>
  );
}

export function NodePackageAttentionNotice({
  scan,
  onOpen,
}: {
  scan: NodePackageScanResult | null;
  onOpen: () => void;
}) {
  const diagnostics = scan?.diagnostics.length ?? 0;
  const recoveries = scan?.recoveries?.length ?? 0;
  if (diagnostics === 0 && recoveries === 0) {
    return null;
  }
  return (
    <aside aria-label="节点包通知" className="node-package-attention-notice">
      {diagnostics > 0 ? <AlertTriangle aria-hidden="true" size={17} /> : <CheckCircle2 aria-hidden="true" size={17} />}
      <div>
        {diagnostics > 0 ? (
          <span>发现 {diagnostics} 个节点包加载问题，其他可用节点不受影响。</span>
        ) : (
          <>
            <strong>已恢复中断的节点包事务</strong>
            <span>已处理 {recoveries} 个未完成事务。</span>
          </>
        )}
      </div>
      <button type="button" onClick={onOpen}>查看节点包</button>
    </aside>
  );
}

function PackageMetric({
  attention = false,
  label,
  value,
}: {
  attention?: boolean;
  label: string;
  value: number;
}) {
  return (
    <div className={attention ? "is-attention" : undefined}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function groupDiagnostics(diagnostics: NodePackageDiagnostic[]): Map<string, NodePackageDiagnostic[]> {
  const groups = new Map<string, NodePackageDiagnostic[]>();
  for (const diagnostic of diagnostics) {
    if (diagnostic.packageId) {
      groups.set(diagnostic.packageId, [...(groups.get(diagnostic.packageId) ?? []), diagnostic]);
    }
  }
  return groups;
}

function packageSourceLabel(nodePackage: NodePackageSummary): string {
  if (!nodePackage.lifecycle?.managed) {
    return "系统内置";
  }
  return nodePackage.lifecycle.installManaged ? "本地导入" : "工作区扩展";
}
