import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NodeFlowMantineProvider } from "./NodeFlowMantineProvider";
import { WorkspaceResourcePage, type WorkspaceResourcePageProps } from "./WorkspaceResourcePage";

// 项目未开启 testing-library 自动清理，这里显式卸载，避免用例间 DOM 残留
afterEach(() => {
  cleanup();
});

function createResources(
  overrides: Partial<WorkspaceResourcePageProps["resources"]> = {}
): WorkspaceResourcePageProps["resources"] {
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
  } as unknown as WorkspaceResourcePageProps["resources"];
}

function createNodeCatalog(
  overrides: Partial<WorkspaceResourcePageProps["nodeCatalog"]> = {}
): WorkspaceResourcePageProps["nodeCatalog"] {
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
    openNodeAssetSource: vi.fn(),
    openingNodeAssetSourcePath: null,
    reloadNodeTypes: vi.fn(),
    uninstallNodePackage: vi.fn(),
    updateNodePackageSettings: vi.fn(),
    updatingPackageId: null,
    ...overrides,
  } as unknown as WorkspaceResourcePageProps["nodeCatalog"];
}

function renderPage(overrides: Partial<WorkspaceResourcePageProps> = {}) {
  return render(
    <NodeFlowMantineProvider>
      <WorkspaceResourcePage
        nodeCatalog={createNodeCatalog()}
        resources={createResources()}
        section="credentials"
        onBack={vi.fn()}
        onSelectSection={vi.fn()}
        {...overrides}
      />
    </NodeFlowMantineProvider>,
  );
}

describe("WorkspaceResourcePage", () => {
  it("renders five section navigation items and marks the current section", () => {
    renderPage({ section: "credentials" });

    const nav = screen.getByRole("navigation", { name: "资源分区" });
    expect(within(nav).getByText("节点资产")).toBeInTheDocument();
    expect(within(nav).getByText("节点包")).toBeInTheDocument();
    expect(within(nav).getByText("凭据")).toBeInTheDocument();
    expect(within(nav).getByText("项目变量")).toBeInTheDocument();
    expect(within(nav).getByText("运行环境")).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: "凭据" }))
      .toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("button", { name: "节点包" }))
      .not.toHaveAttribute("aria-current");
  });

  it("renders the node asset manager for the assets section", () => {
    renderPage({ section: "assets" });
    expect(screen.getByRole("region", { name: "节点资产管理" })).toBeInTheDocument();
  });

  it("renders the node package manager for the packages section", () => {
    renderPage({ section: "packages" });
    expect(screen.getByRole("dialog", { name: "节点包管理" })).toBeInTheDocument();
  });

  it("renders the credential manager for the credentials section", () => {
    renderPage({ section: "credentials" });
    expect(screen.getByRole("dialog", { name: "凭据管理" })).toBeInTheDocument();
  });

  it("renders the project variable manager for the variables section", () => {
    renderPage({ section: "variables" });
    expect(screen.getByRole("dialog", { name: "项目变量管理" })).toBeInTheDocument();
  });

  it("renders the environment manager for the environments section", () => {
    renderPage({ section: "environments" });
    expect(screen.getByRole("dialog", { name: "环境管理" })).toBeInTheDocument();
  });

  it("switches sections through the navigation", () => {
    const onSelectSection = vi.fn();
    renderPage({ onSelectSection });

    fireEvent.click(within(screen.getByRole("navigation", { name: "资源分区" }))
      .getByRole("button", { name: "节点资产" }));
    expect(onSelectSection).toHaveBeenCalledWith("assets");
  });

  it("returns to the workflow through the back button", () => {
    const onBack = vi.fn();
    renderPage({ onBack });

    fireEvent.click(screen.getByRole("button", { name: /返回工作流/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("refreshes credentials when entering the credentials section", () => {
    const refreshCredentials = vi.fn();
    renderPage({
      section: "credentials",
      resources: createResources({ refreshCredentials }),
    });
    expect(refreshCredentials).toHaveBeenCalled();
  });

  it("refreshes environments and credentials when entering the environments section", () => {
    const refreshCredentials = vi.fn();
    const refreshProjectEnvironments = vi.fn();
    renderPage({
      section: "environments",
      resources: createResources({ refreshCredentials, refreshProjectEnvironments }),
    });
    expect(refreshProjectEnvironments).toHaveBeenCalled();
    expect(refreshCredentials).toHaveBeenCalled();
  });

  it("does not refresh resource data for node catalog sections", () => {
    const refreshCredentials = vi.fn();
    const refreshProjectEnvironments = vi.fn();
    const refreshProjectVariables = vi.fn();
    renderPage({
      section: "packages",
      resources: createResources({
        refreshCredentials,
        refreshProjectEnvironments,
        refreshProjectVariables,
      }),
    });
    expect(refreshCredentials).not.toHaveBeenCalled();
    expect(refreshProjectEnvironments).not.toHaveBeenCalled();
    expect(refreshProjectVariables).not.toHaveBeenCalled();
  });

  it("returns to the workflow when pressing Escape outside confirm backdrops", () => {
    const onBack = vi.fn();
    renderPage({ onBack });

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
