import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("ResizeObserver", TestResizeObserver);

/**
 * 测试环境同步渲染路径：
 * App 装配层通过 React.lazy 懒加载重型面板，Suspense 在 jsdom 中会让
 * 同步断言（getBy*）拿不到内容。这里把懒加载入口模块整体 mock 为
 * 真实组件的同步版本，保证现有用例无需改动即可通过。
 */
vi.mock("./lazyComponents", async () => {
  const [configPanel, workflowManager, workspaceResourcePage, nodePackageManager, workflowSettingsPopover] =
    await Promise.all([
      import("./components/ConfigPanel"),
      import("./components/WorkflowManager"),
      import("./components/WorkspaceResourcePage"),
      import("./components/NodePackageManager"),
      import("./components/WorkflowSettingsPopover"),
    ]);

  return {
    LazyConfigPanel: configPanel.ConfigPanel,
    LazyWorkflowManager: workflowManager.WorkflowManager,
    LazyWorkspaceResourcePage: workspaceResourcePage.WorkspaceResourcePage,
    LazyNodePackageAttentionNotice: nodePackageManager.NodePackageAttentionNotice,
    LazyWorkflowSettingsPopover: workflowSettingsPopover.WorkflowSettingsPopover,
  };
});
