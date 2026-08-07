import { Button, NavLink, Stack, Text, ThemeIcon } from "@mantine/core";
import { Box, ChevronLeft, KeyRound, Layers3, Puzzle, ServerCog, Variable } from "lucide-react";
import { useEffect, useState } from "react";
import type { useNodeCatalogController } from "../hooks/useNodeCatalogController";
import type { useWorkspaceResources } from "../hooks/useWorkspaceResources";
import type { ResourceRouteSection } from "../lib/workflowRoute";
import { CredentialManager } from "./CredentialManager";
import { EnvironmentManager } from "./EnvironmentManager";
import { NodeAssetManager } from "./NodeAssetManager";
import { NodePackageManager } from "./NodePackageManager";
import { NodeTypeEditor } from "./NodeTypeEditor";
import { ProjectVariableManager } from "./ProjectVariableManager";

export type WorkspaceResourcePageProps = {
  nodeCatalog: ReturnType<typeof useNodeCatalogController>;
  // 编辑器分区附带的节点类型 ID（仅 /resources/editor/{nodeTypeId} 时有效）
  nodeTypeId?: string;
  resources: ReturnType<typeof useWorkspaceResources>;
  // 当前分区由路由驱动，点击分区导航时通过 onSelectSection 更新 URL
  section: ResourceRouteSection;
  onBack: () => void;
  onSelectSection: (section: ResourceRouteSection, nodeTypeId?: string) => void;
};

// 左侧分区导航项，顺序即展示顺序
const RESOURCE_SECTIONS: Array<{
  section: ResourceRouteSection;
  label: string;
  icon: typeof KeyRound;
}> = [
  { section: "assets", label: "节点资产", icon: Puzzle },
  { section: "packages", label: "节点包", icon: Box },
  { section: "credentials", label: "凭据", icon: KeyRound },
  { section: "variables", label: "项目变量", icon: Variable },
  { section: "environments", label: "运行环境", icon: ServerCog },
];

/**
 * 工作区资源管理页面（节点资产 / 节点包 / 凭据 / 项目变量 / 运行环境）。
 * 由弹层升级为路由页面：左侧分区导航 + 右侧内容区，
 * 内容区复用现有各资源管理组件，不修改组件内部逻辑。
 */
export function WorkspaceResourcePage({
  nodeCatalog,
  nodeTypeId,
  resources,
  section,
  onBack,
  onSelectSection,
}: WorkspaceResourcePageProps) {
  const [selectedAssetNodeId, setSelectedAssetNodeId] = useState<string | null>(nodeTypeId ?? null);
  const {
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
    projectEnvironments,
    projectVariables,
    refreshCredentials,
    refreshProjectEnvironments,
    refreshProjectVariables,
    updateCredential,
    updateProjectEnvironment,
    updateProjectVariable,
  } = resources;
  const {
    activateNodePackageRevision,
    installNodePackage,
    isInstallingNodePackage,
    isNodeTypesReloading,
    loadNodePackageRevisions,
    loadingNodePackageRevisionId,
    nodePackageRevisions,
    nodePackageScan,
    nodeTypes,
    openNodeAssetSource,
    openingNodeAssetSourcePath,
    reloadNodeTypes,
    uninstallNodePackage,
    updateNodePackageSettings,
    updatingNodePackageId,
  } = nodeCatalog;

  useEffect(() => {
    if (section !== "assets" && section !== "editor") {
      return;
    }
    setSelectedAssetNodeId((current) => {
      if (nodeTypeId && nodeTypes.some((nodeType) => nodeType.id === nodeTypeId)) {
        return nodeTypeId;
      }
      if (current && nodeTypes.some((nodeType) => nodeType.id === current)) {
        return current;
      }
      return nodeTypes.find((nodeType) => !nodeType.package)?.id ?? nodeTypes[0]?.id ?? null;
    });
  }, [nodeTypeId, nodeTypes, section]);

  // 进入分区时刷新对应数据，与原弹层打开时的加载行为保持一致
  useEffect(() => {
    if (section === "credentials") {
      void refreshCredentials();
    } else if (section === "variables") {
      void refreshProjectVariables();
    } else if (section === "environments") {
      void refreshProjectEnvironments();
      void refreshCredentials();
    }
  }, [refreshCredentials, refreshProjectEnvironments, refreshProjectVariables, section]);

  // Escape 返回工作流；确认弹窗等遮罩打开时交由 DialogBackdrop 处理，不在此拦截
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }
      if (document.querySelector(".credential-manager-backdrop")) {
        return;
      }
      onBack();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onBack]);

  return (
    <div className={`workspace-resource-page${section === "assets" || section === "editor" ? " is-node-asset-workspace" : ""}`}>
      <nav aria-label="资源分区" className="workspace-resource-page-nav">
        <div className="workspace-resource-page-brand">
          <ThemeIcon color="indigo" radius="md" size={38} variant="light"><Layers3 size={19} /></ThemeIcon>
          <div>
            <Text fw={760} size="sm">资源中心</Text>
            <Text c="dimmed" size="xs">集中管理工作区依赖</Text>
          </div>
        </div>
        <Button className="workspace-resource-page-back" fullWidth justify="flex-start" leftSection={<ChevronLeft aria-hidden="true" size={15} />} size="sm" type="button" variant="default" onClick={onBack}>
          返回工作流
        </Button>
        <Stack className="workspace-resource-page-sections" gap={4}>
          {RESOURCE_SECTIONS.map(({ icon: Icon, label, section: sectionId }) => (
            <NavLink
              active={sectionId === section || (sectionId === "assets" && section === "editor")}
              aria-current={sectionId === section || (sectionId === "assets" && section === "editor") ? "page" : undefined}
              className="workspace-resource-page-section"
              component="button"
              key={sectionId}
              label={label}
              leftSection={<Icon aria-hidden="true" size={16} />}
              type="button"
              onClick={() => onSelectSection(sectionId)}
            />
          ))}
        </Stack>
        <Text className="workspace-resource-page-shortcut" c="dimmed" size="xs">按 Esc 返回工作流</Text>
      </nav>
      <div className="workspace-resource-page-content">
        {section === "packages" ? (
          <NodePackageManager
            installing={isInstallingNodePackage}
            loadingRevisionPackageId={loadingNodePackageRevisionId}
            refreshing={isNodeTypesReloading}
            revisionsByPackageId={nodePackageRevisions}
            scan={nodePackageScan}
            updatingPackageId={updatingNodePackageId}
            onActivateRevision={(packageId, revisionId) =>
              void activateNodePackageRevision(packageId, revisionId)
            }
            onClose={onBack}
            onInstall={(file) => void installNodePackage(file)}
            onLoadRevisions={(packageId) => void loadNodePackageRevisions(packageId)}
            onRefresh={() => void reloadNodeTypes()}
            onUninstall={(packageId) => void uninstallNodePackage(packageId)}
            onUpdateSettings={(packageId, request) =>
              void updateNodePackageSettings(packageId, request)
            }
          />
        ) : null}

        {section === "assets" || section === "editor" ? (
          <div className="node-asset-workspace">
            <NodeAssetManager
              embedded
              nodeTypes={nodeTypes}
              openingSourcePath={openingNodeAssetSourcePath}
              refreshing={isNodeTypesReloading}
              scan={nodePackageScan}
              selectedNodeTypeId={selectedAssetNodeId}
              onClose={onBack}
              onEditForm={setSelectedAssetNodeId}
              onOpenSource={(sourcePath) => void openNodeAssetSource(sourcePath)}
              onRefresh={() => void reloadNodeTypes()}
              onSelectNode={setSelectedAssetNodeId}
            />
            {selectedAssetNodeId ? (
              <NodeTypeEditor
                embedded
                nodeTypeId={selectedAssetNodeId}
                nodeTypes={nodeTypes}
                openingSourcePath={openingNodeAssetSourcePath}
                onBack={() => setSelectedAssetNodeId(null)}
                onOpenSource={(sourcePath) => void openNodeAssetSource(sourcePath)}
                onReload={() => void reloadNodeTypes()}
              />
            ) : (
              <section className="node-asset-workspace-empty">
                <Puzzle aria-hidden="true" size={30} />
                <strong>选择一个节点</strong>
                <p>从左侧选择节点，在这里查看端口和表单；本地脚本节点可以直接编辑。</p>
              </section>
            )}
          </div>
        ) : null}

        {section === "credentials" ? (
          <CredentialManager
            credentialTypes={credentialTypes}
            credentials={credentials}
            disabled={isCredentialManagerLoading}
            onClose={onBack}
            onCreate={createCredential}
            onDelete={deleteCredential}
            onUpdate={updateCredential}
          />
        ) : null}

        {section === "variables" ? (
          <ProjectVariableManager
            variables={projectVariables}
            disabled={isProjectVariableManagerLoading}
            onClose={onBack}
            onCreate={createProjectVariable}
            onDelete={deleteProjectVariable}
            onUpdate={updateProjectVariable}
          />
        ) : null}

        {section === "environments" ? (
          <EnvironmentManager
            credentials={credentials}
            disabled={isEnvironmentManagerLoading}
            environments={projectEnvironments}
            onClose={onBack}
            onCreate={createProjectEnvironment}
            onDelete={deleteProjectEnvironment}
            onUpdate={updateProjectEnvironment}
          />
        ) : null}
      </div>
    </div>
  );
}

// default 导出适配：供 React.lazy 懒加载使用，不改变组件内部逻辑
export default WorkspaceResourcePage;
