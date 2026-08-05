import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { NodePackageScanResult } from "../types";
import { nodePackageAttentionCount } from "../lib/nodePackageDisplay";
import {
  NodePackageAttentionNotice,
  NodePackageManager,
} from "./NodePackageManager";

const scan: NodePackageScanResult = {
  packages: [
    {
      id: "nodeflow.builtin",
      name: "内置节点",
      version: "1.0.0",
      status: "loaded",
      nodeIds: ["manual.trigger", "core.log"],
      compatibility: {
        status: "compatible",
        nodeflowVersion: "0.1.0",
        pythonVersion: "3.12.0",
      },
      lifecycle: {
        managed: false,
        enabled: true,
        lockedVersion: null,
        versionStatus: "unlocked",
      },
    },
    {
      id: "example.tools",
      name: "接口测试工具",
      description: "提供 HTTP 测试节点",
      author: "测试团队",
      version: "2.0.0",
      status: "failed",
      nodeIds: ["example.http_test"],
      compatibility: {
        status: "incompatible",
        nodeflowVersion: "0.1.0",
        pythonVersion: "3.12.0",
      },
      lifecycle: {
        managed: true,
        enabled: true,
        lockedVersion: "1.0.0",
        versionStatus: "mismatch",
        installManaged: true,
      },
    },
  ],
  diagnostics: [
    {
      code: "package_version_lock_mismatch",
      level: "error",
      message: "节点包版本与锁定版本不一致。",
      packageId: "example.tools",
    },
  ],
  legacyNodeCount: 0,
};

describe("NodePackageManager", () => {
  it("shows a searchable Chinese package workspace without exposing package IDs", () => {
    render(<NodePackageManager scan={scan} onClose={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: "节点包管理" })).toBeInTheDocument();
    expect(screen.getByText("内置节点")).toBeInTheDocument();
    expect(screen.getByText("接口测试工具")).toBeInTheDocument();
    expect(screen.getByText("版本待确认")).toBeInTheDocument();
    expect(screen.queryByText("example.tools")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "搜索节点包" }), {
      target: { value: "接口" },
    });
    expect(screen.queryByText("内置节点")).not.toBeInTheDocument();
    expect(screen.getByText("接口测试工具")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "搜索节点包" }), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "需处理 1" }));
    expect(screen.queryByText("内置节点")).not.toBeInTheDocument();
    expect(screen.getByText("接口测试工具")).toBeInTheDocument();
  });

  it("connects import, lifecycle, history and close actions", () => {
    const onClose = vi.fn();
    const onInstall = vi.fn();
    const onLoadRevisions = vi.fn();
    const onUpdateSettings = vi.fn();
    const { container } = render(
      <NodePackageManager
        onClose={onClose}
        onInstall={onInstall}
        onLoadRevisions={onLoadRevisions}
        onUpdateSettings={onUpdateSettings}
        scan={scan}
      />,
    );
    const dialog = within(container).getByRole("dialog", { name: "节点包管理" });
    const file = new File(["zip"], "tools.zip", { type: "application/zip" });

    fireEvent.change(within(dialog).getByLabelText("选择节点包 ZIP"), {
      target: { files: [file] },
    });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "启用 接口测试工具" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "历史版本" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "关闭节点包管理" }));

    expect(onInstall).toHaveBeenCalledWith(file);
    expect(onUpdateSettings).toHaveBeenCalledWith("example.tools", {
      enabled: false,
      locked_version: "1.0.0",
    });
    expect(onLoadRevisions).toHaveBeenCalledWith("example.tools");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps package attention visible outside the manager", () => {
    const onOpen = vi.fn();
    render(<NodePackageAttentionNotice onOpen={onOpen} scan={scan} />);

    expect(nodePackageAttentionCount(scan)).toBe(1);
    expect(screen.getByText("发现 1 个节点包加载问题，其他可用节点不受影响。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看节点包" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
