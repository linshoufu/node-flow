import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NodePackageDiagnostics } from "./NodePackageDiagnostics";

describe("NodePackageDiagnostics", () => {
  it("renders Chinese diagnostics grouped by the visible package name", () => {
    render(
      <NodePackageDiagnostics
        scan={{
          packages: [
            {
              id: "example.tools",
              name: "工具集",
              version: "1.0.0",
              status: "partial",
              nodeIds: ["example.ok"],
              credentialTypeIds: [],
              engines: {
                nodeflow: ">=0.1.0,<0.2.0",
                python: ">=3.11",
              },
              pythonDependencies: [],
              compatibility: {
                status: "incompatible",
                nodeflowVersion: "0.1.0",
                pythonVersion: "3.12.0",
              },
            },
          ],
          diagnostics: [
            {
              code: "package_entrypoint_missing",
              level: "error",
              message: "节点包入口文件不存在：missing.py",
              packageId: "example.tools",
              entrypoint: "missing.py",
            },
          ],
          legacyNodeCount: 2,
        }}
      />,
    );

    expect(screen.getByRole("region", { name: "节点包加载问题" })).toBeInTheDocument();
    expect(screen.getByText("工具集 v1.0.0")).toBeInTheDocument();
    expect(screen.getByText("missing.py")).toBeInTheDocument();
    expect(screen.getByText("节点包入口文件不存在：missing.py")).toBeInTheDocument();
    expect(screen.getByText("不兼容")).toBeInTheDocument();
    expect(screen.getByText("错误")).toBeInTheDocument();
    expect(screen.getByText(/要求：Node Flow/)).toBeInTheDocument();
    expect(screen.queryByText("example.tools")).not.toBeInTheDocument();
  });

  it("renders nothing without diagnostics", () => {
    const { container } = render(
      <NodePackageDiagnostics scan={{ packages: [], diagnostics: [], legacyNodeCount: 0 }} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("shows a compact healthy state after a compatible package scan", () => {
    render(
      <NodePackageDiagnostics
        scan={{
          packages: [
            {
              id: "example.ready",
              name: "通用工具",
              version: "2.0.0",
              status: "loaded",
              nodeIds: ["example.ready.node"],
              credentialTypeIds: [],
              engines: {
                nodeflow: ">=0.1.0,<0.2.0",
                python: ">=3.11",
              },
              pythonDependencies: ["httpx>=0.28"],
              compatibility: {
                status: "compatible",
                nodeflowVersion: "0.1.0",
                pythonVersion: "3.12.0",
              },
            },
          ],
          diagnostics: [],
          legacyNodeCount: 0,
        }}
      />,
    );

    expect(screen.getByRole("region", { name: "节点包状态" })).toBeInTheDocument();
    expect(screen.getByText("通用工具 v2.0.0")).toBeInTheDocument();
    expect(screen.getByText("兼容")).toBeInTheDocument();
    expect(screen.getByText("1 个节点包已通过当前运行环境检查。")).toBeInTheDocument();
  });

  it("shows a Chinese notice after startup recovers an interrupted package transaction", () => {
    render(
      <NodePackageDiagnostics
        scan={{
          packages: [
            {
              id: "nodeflow.builtin",
              name: "内置节点",
              version: "1.0.0",
              status: "loaded",
              nodeIds: [],
              credentialTypeIds: [],
              engines: {},
              pythonDependencies: [],
              compatibility: {
                status: "compatible",
                nodeflowVersion: "0.1.0",
                pythonVersion: "3.12.0",
              },
            },
          ],
          diagnostics: [],
          legacyNodeCount: 0,
          recoveries: [
            {
              transactionId: "tx_123",
              packageId: "example.tools",
              operation: "activate",
              action: "rolled_back",
              recoveredAt: "2026-07-31T12:00:00Z",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("已恢复中断的节点包事务")).toBeInTheDocument();
    expect(screen.getByText(/已安全处理 1 个未完成事务/)).toBeInTheDocument();
    expect(screen.queryByText("example.tools")).not.toBeInTheDocument();
  });

  it("renders a Chinese node port contract diagnostic with its source path", () => {
    render(
      <NodePackageDiagnostics
        scan={{
          packages: [],
          diagnostics: [
            {
              code: "node_port_contract_invalid",
              level: "error",
              message: "节点端口契约无效：输出端口句柄 'bad-handle' 必须匹配稳定标识符格式",
              path: "invalid_ports.py",
            },
          ],
          legacyNodeCount: 0,
        }}
      />,
    );

    expect(screen.getByText(/节点端口契约无效/)).toBeInTheDocument();
    expect(screen.getByText("invalid_ports.py")).toBeInTheDocument();
  });

  it("distinguishes an unverified compatibility warning from a load error", () => {
    const { container } = render(
      <NodePackageDiagnostics
        scan={{
          packages: [
            {
              id: "example.legacy",
              name: "旧版工具",
              version: "1.0.0",
              status: "loaded",
              nodeIds: ["example.legacy.node"],
              credentialTypeIds: [],
              engines: {},
              pythonDependencies: [],
              compatibility: {
                status: "unverified",
                nodeflowVersion: "0.1.0",
                pythonVersion: "3.12.0",
              },
            },
          ],
          diagnostics: [
            {
              code: "package_engine_constraints_missing",
              level: "warning",
              message: "节点包未声明兼容范围。",
              packageId: "example.legacy",
            },
          ],
          legacyNodeCount: 0,
        }}
      />,
    );

    const view = within(container);
    expect(view.getByText("未验证")).toBeInTheDocument();
    expect(view.getByText("警告")).toBeInTheDocument();
    expect(view.getByText(/未声明运行环境要求/)).toBeInTheDocument();
    expect(view.queryByText("错误")).not.toBeInTheDocument();
  });

  it("keeps an older package snapshot usable during a rolling backend restart", () => {
    const { container } = render(
      <NodePackageDiagnostics
        scan={{
          packages: [
            {
              id: "example.previous_api",
              name: "旧接口包",
              version: "1.0.0",
              status: "loaded",
              nodeIds: ["example.previous_api.node"],
            },
          ],
          diagnostics: [],
          legacyNodeCount: 0,
        }}
      />,
    );

    const view = within(container);
    expect(view.getByRole("region", { name: "节点包状态" })).toBeInTheDocument();
    expect(view.getByText("节点包兼容状态")).toBeInTheDocument();
    expect(view.getByText("未验证")).toBeInTheDocument();
    expect(view.getByText("1 个待处理")).toBeInTheDocument();
  });

  it("can disable a managed package and accept its discovered version", () => {
    const onUpdateSettings = vi.fn();
    render(
      <NodePackageDiagnostics
        onUpdateSettings={onUpdateSettings}
        scan={{
          packages: [
            {
              id: "example.upgrade",
              name: "升级工具",
              version: "2.0.0",
              status: "failed",
              nodeIds: [],
              credentialTypeIds: [],
              engines: {
                nodeflow: ">=0.1.0,<0.2.0",
                python: ">=3.11",
              },
              pythonDependencies: [],
              compatibility: {
                status: "compatible",
                nodeflowVersion: "0.1.0",
                pythonVersion: "3.12.0",
              },
              lifecycle: {
                managed: true,
                enabled: true,
                lockedVersion: "1.0.0",
                versionStatus: "mismatch",
              },
            },
          ],
          diagnostics: [
            {
              code: "package_version_lock_mismatch",
              level: "error",
              message: "节点包版本与锁定版本不一致。",
              packageId: "example.upgrade",
            },
          ],
          legacyNodeCount: 0,
        }}
      />,
    );

    expect(screen.getByText("版本待确认")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "接受 v2.0.0" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "启用 升级工具" }));

    expect(onUpdateSettings).toHaveBeenNthCalledWith(1, "example.upgrade", {
      enabled: true,
      locked_version: "2.0.0",
    });
    expect(onUpdateSettings).toHaveBeenNthCalledWith(2, "example.upgrade", {
      enabled: false,
      locked_version: "1.0.0",
    });
  });

  it("selects a ZIP for import and can uninstall an installer-managed package", () => {
    const onInstall = vi.fn();
    const onUninstall = vi.fn();
    render(
      <NodePackageDiagnostics
        onInstall={onInstall}
        onUninstall={onUninstall}
        onUpdateSettings={vi.fn()}
        scan={{
          packages: [
            {
              id: "example.installed",
              name: "已安装工具",
              version: "1.0.0",
              status: "loaded",
              nodeIds: ["example.installed.node"],
              compatibility: {
                status: "compatible",
                nodeflowVersion: "0.1.0",
                pythonVersion: "3.12.0",
              },
              lifecycle: {
                managed: true,
                enabled: true,
                lockedVersion: null,
                versionStatus: "unlocked",
                installManaged: true,
              },
            },
          ],
          diagnostics: [],
          legacyNodeCount: 0,
        }}
      />,
    );
    const file = new File(["zip"], "tools.zip", { type: "application/zip" });

    fireEvent.change(screen.getByLabelText("选择节点包 ZIP"), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: "卸载" }));

    expect(onInstall).toHaveBeenCalledWith(file);
    expect(onUninstall).toHaveBeenCalledWith("example.installed");
  });

  it("disables ZIP import while another package operation is running", () => {
    render(
      <NodePackageDiagnostics
        installing
        onInstall={vi.fn()}
        scan={{
          packages: [
            {
              id: "nodeflow.builtin",
              name: "内置节点",
              version: "1.0.0",
              status: "loaded",
              nodeIds: ["manual.trigger"],
            },
          ],
          diagnostics: [],
          legacyNodeCount: 0,
        }}
      />,
    );

    expect(screen.getByRole("button", { name: "正在导入" })).toBeDisabled();
  });

  it("loads and activates an installer-managed package revision", () => {
    const onLoadRevisions = vi.fn();
    const onActivateRevision = vi.fn();
    render(
      <NodePackageDiagnostics
        onActivateRevision={onActivateRevision}
        onLoadRevisions={onLoadRevisions}
        onUpdateSettings={vi.fn()}
        revisionsByPackageId={{
          "example.installed": [
            {
              revisionId: "rev_123",
              packageId: "example.installed",
              version: "1.0.0",
              sourceFilename: "tools-v1.zip",
              installedAt: "2026-07-31T08:00:00Z",
              archivedAt: "2026-07-31T09:00:00Z",
              checksum: "abc",
            },
          ],
        }}
        scan={{
          packages: [
            {
              id: "example.installed",
              name: "已安装工具",
              version: "2.0.0",
              status: "loaded",
              nodeIds: ["example.installed.node"],
              lifecycle: {
                managed: true,
                enabled: true,
                lockedVersion: null,
                versionStatus: "unlocked",
                installManaged: true,
              },
            },
          ],
          diagnostics: [],
          legacyNodeCount: 0,
        }}
      />,
    );

    expect(screen.getByText("tools-v1.zip")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "刷新历史" }));
    fireEvent.click(screen.getByRole("button", { name: "恢复 v1.0.0" }));

    expect(onLoadRevisions).toHaveBeenCalledWith("example.installed");
    expect(onActivateRevision).toHaveBeenCalledWith(
      "example.installed",
      "rev_123",
    );
  });
});
