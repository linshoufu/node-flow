import type { useNodeCatalogController } from "../hooks/useNodeCatalogController";
import type { useWorkspaceResources } from "../hooks/useWorkspaceResources";
import { CredentialManager } from "./CredentialManager";
import { DialogBackdrop } from "./DialogBackdrop";
import { EnvironmentManager } from "./EnvironmentManager";
import { NodePackageManager } from "./NodePackageManager";
import { ProjectVariableManager } from "./ProjectVariableManager";

export type WorkspaceResourceDialogsProps = {
  nodeCatalog: ReturnType<typeof useNodeCatalogController>;
  resources: ReturnType<typeof useWorkspaceResources>;
};

/**
 * 工作区资源管理弹层集合（节点包 / 凭据 / 项目变量 / 运行环境）。
 * 由 App 装配层统一传入资源状态与操作回调，保持 controller 边界不变。
 */
export function WorkspaceResourceDialogs({ nodeCatalog, resources }: WorkspaceResourceDialogsProps) {
  const {
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
    projectEnvironments,
    projectVariables,
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
    reloadNodeTypes,
    uninstallNodePackage,
    updateNodePackageSettings,
    updatingNodePackageId,
  } = nodeCatalog;

  return (
    <>
      {activeResourceManager === "packages" ? (
        <DialogBackdrop onClose={closeResource}>
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
            onClose={closeResource}
            onInstall={(file) => void installNodePackage(file)}
            onLoadRevisions={(packageId) => void loadNodePackageRevisions(packageId)}
            onRefresh={() => void reloadNodeTypes()}
            onUninstall={(packageId) => void uninstallNodePackage(packageId)}
            onUpdateSettings={(packageId, request) =>
              void updateNodePackageSettings(packageId, request)
            }
          />
        </DialogBackdrop>
      ) : null}

      {activeResourceManager === "credentials" ? (
        <DialogBackdrop onClose={closeResource}>
          <CredentialManager
            credentialTypes={credentialTypes}
            credentials={credentials}
            disabled={isCredentialManagerLoading}
            onClose={closeResource}
            onCreate={createCredential}
            onDelete={deleteCredential}
            onUpdate={updateCredential}
          />
        </DialogBackdrop>
      ) : null}

      {activeResourceManager === "variables" ? (
        <DialogBackdrop onClose={closeResource}>
          <ProjectVariableManager
            variables={projectVariables}
            disabled={isProjectVariableManagerLoading}
            onClose={closeResource}
            onCreate={createProjectVariable}
            onDelete={deleteProjectVariable}
            onUpdate={updateProjectVariable}
          />
        </DialogBackdrop>
      ) : null}

      {activeResourceManager === "environments" ? (
        <DialogBackdrop onClose={closeResource}>
          <EnvironmentManager
            credentials={credentials}
            disabled={isEnvironmentManagerLoading}
            environments={projectEnvironments}
            onClose={closeResource}
            onCreate={createProjectEnvironment}
            onDelete={deleteProjectEnvironment}
            onUpdate={updateProjectEnvironment}
          />
        </DialogBackdrop>
      ) : null}
    </>
  );
}
