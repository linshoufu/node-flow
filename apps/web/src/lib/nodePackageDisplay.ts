import type {
  NodePackageCompatibilityStatus,
  NodePackageDiagnostic,
  NodePackageScanResult,
  NodePackageSummary,
} from "../types";

export function nodePackageDisplayStatus(
  nodePackage: NodePackageSummary,
): NodePackageCompatibilityStatus | "disabled" | "mismatch" {
  const lifecycle = nodePackage.lifecycle ?? {
    managed: false,
    enabled: nodePackage.status !== "disabled",
    lockedVersion: null,
    versionStatus: "unlocked" as const,
  };
  if (!lifecycle.enabled) {
    return "disabled";
  }
  if (lifecycle.versionStatus === "mismatch") {
    return "mismatch";
  }
  return nodePackage.compatibility?.status ?? (nodePackage.status === "failed" ? "incompatible" : "unverified");
}

export function nodePackageIdsNeedingAttention(
  packages: NodePackageSummary[],
  diagnostics: NodePackageDiagnostic[],
): Set<string> {
  const ids = new Set<string>();
  for (const nodePackage of packages) {
    if (nodePackageDisplayStatus(nodePackage) !== "compatible") {
      ids.add(nodePackage.id);
    }
  }
  for (const diagnostic of diagnostics) {
    if (diagnostic.packageId) {
      ids.add(diagnostic.packageId);
    }
  }
  return ids;
}

export function nodePackageAttentionCount(scan: NodePackageScanResult | null): number {
  if (!scan) {
    return 0;
  }
  return nodePackageIdsNeedingAttention(scan.packages, scan.diagnostics).size;
}
