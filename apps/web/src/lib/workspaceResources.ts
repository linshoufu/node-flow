import type { ResourceRouteSection } from "./workflowRoute";

export type WorkspaceResourceKind = "credentials" | "variables" | "environments" | "packages" | "nodes";

// 资源菜单/管理组件使用的 kind 与路由分区的映射：节点资产在路由中以 assets 表示
export function resourceRouteSectionForKind(kind: WorkspaceResourceKind): ResourceRouteSection {
  return kind === "nodes" ? "assets" : kind;
}

export function resourceKindForRouteSection(section: ResourceRouteSection): WorkspaceResourceKind | "editor" {
  if (section === "editor") {
    return "editor";
  }
  return section === "assets" ? "nodes" : section;
}
