import { lazy } from "react";

/**
 * 重型低频组件统一懒加载入口。
 * 这些组件要么体积大、要么仅在弹窗/特定场景打开，
 * 通过 React.lazy 拆分为独立 chunk，减小首屏主包体积。
 *
 * 注意：测试环境会在 test-setup.ts 中 vi.mock 本模块，
 * 将其替换为同步组件，保证 jsdom 中 Suspense 不会挂起用例。
 */

// 最大的属性配置面板（右侧 inspector 插槽）
export const LazyConfigPanel = lazy(() => import("./components/ConfigPanel"));

// 工作流管理弹窗（顶栏按钮触发）
export const LazyWorkflowManager = lazy(() => import("./components/WorkflowManager"));

// 工作区资源管理页面（节点资产 / 节点包 / 凭据 / 项目变量 / 运行环境，仅进入 /resources 路由时加载）
export const LazyWorkspaceResourcePage = lazy(
  () => import("./components/WorkspaceResourcePage")
);

// 工作流设置弹层（仅点击“工作流设置”后加载）
export const LazyWorkflowSettingsPopover = lazy(
  () => import("./components/WorkflowSettingsPopover")
);

// 节点包关注提示（与 NodePackageManager 同模块，避免该模块整体进入主包）
export const LazyNodePackageAttentionNotice = lazy(() =>
  import("./components/NodePackageManager").then((module) => ({
    default: module.NodePackageAttentionNotice,
  }))
);

// 节点定义编辑页（编辑器路由 /resources/editor/{nodeTypeId} 时加载）
export const LazyNodeTypeEditor = lazy(
  () => import("./components/NodeTypeEditor")
);
