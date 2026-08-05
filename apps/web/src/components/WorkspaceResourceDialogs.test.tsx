import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceResourceDialogs, type WorkspaceResourceDialogsProps } from "./WorkspaceResourceDialogs";

function createResources(
  overrides: Partial<WorkspaceResourceDialogsProps["resources"]> = {}
): WorkspaceResourceDialogsProps["resources"] {
  return {
    activeResourceManager: null,
    closeResource: vi.fn(),
    credentialTypes: [],
    credentials: [],
    createCredential: vi.fn(),
    createProjectEnvironment: vi.fn(),
    createProjectVariable: vi.fn(),
    deleteCredential: vi.fn(),
    deleteProjectEnvironment: vi.fn(),
    deleteProjectVariable: vi.fn(),
    isCredentialManagerLoading: false,
    isEnvironmentManagerLoading: false,
    isProjectVariableManagerLoading: false,
    openResource: vi.fn(),
    projectEnvironments: [],
    projectVariables: [],
    refreshCredentials: vi.fn(),
    refreshProjectEnvironments: vi.fn(),
    refreshProjectVariables: vi.fn(),
    updateCredential: vi.fn(),
    updateProjectEnvironment: vi.fn(),
    updateProjectVariable: vi.fn(),
    ...overrides,
  } as unknown as WorkspaceResourceDialogsProps["resources"];
}

function createNodeCatalog(
  overrides: Partial<WorkspaceResourceDialogsProps["nodeCatalog"]> = {}
): WorkspaceResourceDialogsProps["nodeCatalog"] {
  return {
    activateNodePackageRevision: vi.fn(),
    installNodePackage: vi.fn(),
    isInstallingNodePackage: false,
    isNodeTypesReloading: false,
    loadNodePackageRevisions: vi.fn(),
    loadingNodePackageRevisionId: null,
    nodePackageRevisions: {},
    nodePackageScan: null,
    nodeTypes: [],
    reloadNodeTypes: vi.fn(),
    uninstallNodePackage: vi.fn(),
    updateNodePackageSettings: vi.fn(),
    updatingNodePackageId: null,
    ...overrides,
  } as unknown as WorkspaceResourceDialogsProps["nodeCatalog"];
}

describe("WorkspaceResourceDialogs", () => {
  it("renders no dialog when no resource manager is active", () => {
    render(<WorkspaceResourceDialogs nodeCatalog={createNodeCatalog()} resources={createResources()} />);
    expect(screen.queryByText("节点包管理")).not.toBeInTheDocument();
    expect(screen.queryByText("凭据管理")).not.toBeInTheDocument();
    expect(screen.queryByText("项目变量")).not.toBeInTheDocument();
    expect(screen.queryByText("运行环境")).not.toBeInTheDocument();
  });

  it("renders the node package manager for packages", () => {
    render(
      <WorkspaceResourceDialogs
        nodeCatalog={createNodeCatalog()}
        resources={createResources({ activeResourceManager: "packages" })}
      />
    );
    expect(screen.getByText("节点包管理")).toBeInTheDocument();
  });

  it("renders the credential manager for credentials", () => {
    render(
      <WorkspaceResourceDialogs
        nodeCatalog={createNodeCatalog()}
        resources={createResources({ activeResourceManager: "credentials" })}
      />
    );
    expect(screen.getByText("凭据管理")).toBeInTheDocument();
  });

  it("renders the project variable manager for variables", () => {
    render(
      <WorkspaceResourceDialogs
        nodeCatalog={createNodeCatalog()}
        resources={createResources({ activeResourceManager: "variables" })}
      />
    );
    expect(screen.getByText("项目变量")).toBeInTheDocument();
  });

  it("renders the environment manager for environments", () => {
    render(
      <WorkspaceResourceDialogs
        nodeCatalog={createNodeCatalog()}
        resources={createResources({ activeResourceManager: "environments" })}
      />
    );
    expect(screen.getByText("运行环境")).toBeInTheDocument();
  });
});
