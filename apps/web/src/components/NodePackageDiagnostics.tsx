import { History, RotateCcw, Trash2, Upload } from "lucide-react";
import { useRef } from "react";
import type {
  NodePackageCompatibilityStatus,
  NodePackageDiagnostic,
  NodePackageRevision,
  NodePackageScanResult,
  NodePackageSettingsUpdate,
  NodePackageSummary,
} from "../types";
import { nodePackageDisplayStatus } from "../lib/nodePackageDisplay";

type NodePackageDiagnosticsProps = {
  scan: NodePackageScanResult | null;
  updatingPackageId?: string | null;
  installing?: boolean;
  onInstall?: (file: File) => void;
  onUninstall?: (packageId: string) => void;
  revisionsByPackageId?: Record<string, NodePackageRevision[] | undefined>;
  loadingRevisionPackageId?: string | null;
  onLoadRevisions?: (packageId: string) => void;
  onActivateRevision?: (packageId: string, revisionId: string) => void;
  onUpdateSettings?: (packageId: string, request: NodePackageSettingsUpdate) => void;
};

export function NodePackageDiagnostics({
  scan,
  updatingPackageId = null,
  installing = false,
  onInstall,
  onUninstall,
  revisionsByPackageId = {},
  loadingRevisionPackageId = null,
  onLoadRevisions,
  onActivateRevision,
  onUpdateSettings,
}: NodePackageDiagnosticsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  if (
    !scan ||
    (scan.packages.length === 0 &&
      scan.diagnostics.length === 0 &&
      (scan.recoveries?.length ?? 0) === 0)
  ) {
    return null;
  }

  const packagesById = new Map(scan.packages.map((nodePackage) => [nodePackage.id, nodePackage]));
  const diagnosticGroups = groupDiagnostics(scan.diagnostics);
  const diagnosticsByPackage = new Map(diagnosticGroups);
  const unknownDiagnosticGroups = diagnosticGroups.filter(
    ([packageId]) => !packagesById.has(packageId),
  );
  const errorCount = scan.diagnostics.filter((diagnostic) => diagnostic.level === "error").length;
  const warningCount = scan.diagnostics.length - errorCount;
  const attentionCount = scan.packages.filter(
    (nodePackage) => nodePackageDisplayStatus(nodePackage) !== "compatible",
  ).length;
  const healthy = scan.diagnostics.length === 0 && attentionCount === 0;
  const compatibilityOnly = scan.diagnostics.length === 0 && attentionCount > 0;

  return (
    <section
      aria-label={healthy || compatibilityOnly ? "节点包状态" : "节点包加载问题"}
      className={`node-package-diagnostics${healthy ? " is-healthy" : ""}`}
    >
      <div className="node-package-diagnostics-heading">
        <div>
          <h2>
            {healthy
              ? "节点包状态"
              : compatibilityOnly
                ? "节点包兼容状态"
                : "节点包兼容与加载问题"}
          </h2>
          <p>
            {healthy
              ? `${scan.packages.length} 个节点包已通过当前运行环境检查。`
              : compatibilityOnly
                ? "部分节点包已停用或尚未完成兼容确认。"
                : "不兼容包已停止加载，其他正常节点不受影响。"}
          </p>
        </div>
        <div className="node-package-diagnostics-tools">
          <span>
            {healthy ? `${scan.packages.length} 个包` : null}
            {compatibilityOnly ? `${attentionCount} 个待处理` : null}
            {!healthy && errorCount > 0 ? `${errorCount} 个错误` : ""}
            {!healthy && errorCount > 0 && warningCount > 0 ? "，" : ""}
            {!healthy && warningCount > 0 ? `${warningCount} 个警告` : ""}
          </span>
          {onInstall ? (
            <>
              <button
                disabled={installing || updatingPackageId !== null}
                type="button"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload aria-hidden="true" size={15} />
                {installing ? "正在导入" : "导入 ZIP"}
              </button>
              <input
                ref={fileInputRef}
                hidden
                accept=".zip,application/zip"
                aria-label="选择节点包 ZIP"
                type="file"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) {
                    onInstall(file);
                  }
                }}
              />
            </>
          ) : null}
        </div>
      </div>
      {(scan.recoveries?.length ?? 0) > 0 ? (
        <div className="node-package-recovery-notice" role="status">
          <RotateCcw aria-hidden="true" size={16} />
          <div>
            <strong>已恢复中断的节点包事务</strong>
            <span>
              服务启动时已安全处理 {scan.recoveries?.length} 个未完成事务，当前节点目录已重新校验。
            </span>
          </div>
        </div>
      ) : null}
      <div className="node-package-diagnostics-list">
        {scan.packages.map((nodePackage) => {
          const diagnostics = diagnosticsByPackage.get(nodePackage.id) ?? [];
          return (
            <details
              key={nodePackage.id}
              open={diagnostics.some((diagnostic) => diagnostic.level === "error")}
            >
              <summary>
                <span>
                  {nodePackage.name} v{nodePackage.version}
                </span>
                <PackageStateBadge nodePackage={nodePackage} />
              </summary>
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
              <DiagnosticList diagnostics={diagnostics} />
            </details>
          );
        })}
        {unknownDiagnosticGroups.map(([packageId, diagnostics]) => (
          <details
            key={packageId}
            open={diagnostics.some((diagnostic) => diagnostic.level === "error")}
          >
            <summary>
              <span>未识别包</span>
            </summary>
            <DiagnosticList diagnostics={diagnostics} />
          </details>
        ))}
      </div>
    </section>
  );
}

export function DiagnosticList({ diagnostics }: { diagnostics: NodePackageDiagnostic[] }) {
  if (diagnostics.length === 0) {
    return null;
  }
  return (
    <ul>
      {diagnostics.map((diagnostic, index) => (
        <li key={`${diagnostic.code}-${diagnostic.entrypoint ?? diagnostic.path ?? index}`}>
          <div>
            <span className={`node-package-diagnostic-level is-${diagnostic.level}`}>
              {diagnostic.level === "error" ? "错误" : "警告"}
            </span>
            <strong>{diagnostic.message}</strong>
          </div>
          {diagnostic.entrypoint || diagnostic.path ? (
            <code>{diagnostic.entrypoint ?? diagnostic.path}</code>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function groupDiagnostics(
  diagnostics: NodePackageDiagnostic[],
): Array<[string, NodePackageDiagnostic[]]> {
  const groups = new Map<string, NodePackageDiagnostic[]>();

  for (const diagnostic of diagnostics) {
    const packageId = diagnostic.packageId ?? "unknown";
    groups.set(packageId, [...(groups.get(packageId) ?? []), diagnostic]);
  }

  return [...groups.entries()];
}

export function PackageStateBadge({ nodePackage }: { nodePackage: NodePackageSummary }) {
  const compatibility = packageCompatibility(nodePackage);
  const status = nodePackageDisplayStatus(nodePackage);
  return (
    <span
      className={`node-package-compatibility is-${status}`}
      title="节点包当前状态"
    >
      {status === "disabled"
        ? "已停用"
        : status === "mismatch"
          ? "版本待确认"
          : compatibilityLabel(compatibility.status)}
    </span>
  );
}

export function PackageContractSummary({ nodePackage }: { nodePackage: NodePackageSummary }) {
  const compatibility = packageCompatibility(nodePackage);
  const lifecycle = packageLifecycle(nodePackage);
  const engines = nodePackage.engines ?? {};
  const pythonDependencies = nodePackage.pythonDependencies ?? [];
  const requirements = [
    engines.nodeflow ? `Node Flow ${engines.nodeflow}` : null,
    engines.python ? `Python ${engines.python}` : null,
    pythonDependencies.length > 0
      ? `${pythonDependencies.length} 个 Python 依赖`
      : null,
  ].filter(Boolean);

  return (
    <p className="node-package-contract-summary">
      {requirements.length > 0 ? `要求：${requirements.join("；")}` : "未声明运行环境要求"}
      {compatibility.nodeflowVersion && compatibility.pythonVersion
        ? ` · 当前：Node Flow ${compatibility.nodeflowVersion}，Python ${compatibility.pythonVersion}`
        : ""}
      {lifecycle.lockedVersion ? ` · 锁定：v${lifecycle.lockedVersion}` : ""}
    </p>
  );
}

export function PackageLifecycleActions({
  disabled,
  loadingRevisions,
  nodePackage,
  onLoadRevisions,
  onUpdateSettings,
  onUninstall,
  revisions,
}: {
  disabled: boolean;
  loadingRevisions: boolean;
  nodePackage: NodePackageSummary;
  onLoadRevisions?: (packageId: string) => void;
  onUpdateSettings?: (packageId: string, request: NodePackageSettingsUpdate) => void;
  onUninstall?: (packageId: string) => void;
  revisions?: NodePackageRevision[];
}) {
  const lifecycle = packageLifecycle(nodePackage);
  if (!lifecycle.managed) {
    return <p className="node-package-managed-note">系统内置包由平台管理。</p>;
  }
  if (!onUpdateSettings) {
    return null;
  }

  const nextLockedVersion =
    lifecycle.versionStatus === "mismatch" || lifecycle.lockedVersion === null
      ? nodePackage.version
      : null;
  const lockLabel =
    lifecycle.versionStatus === "mismatch"
      ? `接受 v${nodePackage.version}`
      : lifecycle.lockedVersion
        ? "解除版本锁定"
        : `锁定 v${nodePackage.version}`;

  return (
    <div className="node-package-lifecycle-actions">
      <label>
        <input
          aria-label={`启用 ${nodePackage.name}`}
          checked={lifecycle.enabled}
          disabled={disabled}
          type="checkbox"
          onChange={(event) =>
            onUpdateSettings(nodePackage.id, {
              enabled: event.target.checked,
              locked_version: lifecycle.lockedVersion,
            })
          }
        />
        启用节点包
      </label>
      <button
        disabled={disabled}
        type="button"
        onClick={() =>
          onUpdateSettings(nodePackage.id, {
            enabled: lifecycle.enabled,
            locked_version: nextLockedVersion,
          })
        }
      >
        {lockLabel}
      </button>
      {lifecycle.installManaged && onUninstall ? (
        <button
          className="danger-button"
          disabled={disabled}
          title={`卸载 ${nodePackage.name}`}
          type="button"
          onClick={() => onUninstall(nodePackage.id)}
        >
          <Trash2 aria-hidden="true" size={15} />
          卸载
        </button>
      ) : null}
      {lifecycle.installManaged && onLoadRevisions ? (
        <button
          disabled={disabled || loadingRevisions}
          type="button"
          onClick={() => onLoadRevisions(nodePackage.id)}
        >
          <History aria-hidden="true" size={15} />
          {loadingRevisions
            ? "正在加载历史"
            : revisions === undefined
              ? "历史版本"
              : "刷新历史"}
        </button>
      ) : null}
    </div>
  );
}

export function PackageRevisionHistory({
  disabled,
  nodePackage,
  onActivateRevision,
  revisions,
}: {
  disabled: boolean;
  nodePackage: NodePackageSummary;
  onActivateRevision?: (packageId: string, revisionId: string) => void;
  revisions?: NodePackageRevision[];
}) {
  if (revisions === undefined) {
    return null;
  }
  if (revisions.length === 0) {
    return <p className="node-package-revision-empty">暂无可恢复的历史版本。</p>;
  }
  return (
    <div className="node-package-revisions" aria-label={`${nodePackage.name}历史版本`}>
      {revisions.map((revision) => (
        <div className="node-package-revision" key={revision.revisionId}>
          <div>
            <strong>v{revision.version}</strong>
            <span>{formatRevisionTime(revision.archivedAt)}</span>
            {revision.sourceFilename ? <small>{revision.sourceFilename}</small> : null}
          </div>
          {onActivateRevision ? (
            <button
              disabled={disabled}
              type="button"
              onClick={() =>
                onActivateRevision(nodePackage.id, revision.revisionId)
              }
            >
              <RotateCcw aria-hidden="true" size={14} />
              恢复 v{revision.version}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function formatRevisionTime(value: string): string {
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime())
    ? value
    : timestamp.toLocaleString("zh-CN", { hour12: false });
}

function packageCompatibility(nodePackage: NodePackageSummary): {
  status: NodePackageCompatibilityStatus;
  nodeflowVersion: string | null;
  pythonVersion: string | null;
} {
  return (
    nodePackage.compatibility ?? {
      status: nodePackage.status === "failed" ? "incompatible" : "unverified",
      nodeflowVersion: null,
      pythonVersion: null,
    }
  );
}

function packageLifecycle(nodePackage: NodePackageSummary): {
  managed: boolean;
  enabled: boolean;
  lockedVersion: string | null;
  versionStatus: "unlocked" | "locked" | "mismatch";
  installManaged: boolean;
} {
  if (nodePackage.lifecycle) {
    return {
      ...nodePackage.lifecycle,
      installManaged: nodePackage.lifecycle.installManaged ?? false,
    };
  }
  return {
    managed: false,
    enabled: nodePackage.status !== "disabled",
    lockedVersion: null,
    versionStatus: "unlocked",
    installManaged: false,
  };
}

function compatibilityLabel(status: NodePackageCompatibilityStatus): string {
  return {
    compatible: "兼容",
    unverified: "未验证",
    incompatible: "不兼容",
  }[status];
}
