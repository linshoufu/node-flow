import { Suspense } from "react";
import type { WorkflowSettingsActions, WorkflowSettingsPopoverProps } from "./WorkflowSettingsPopover";
import { LazyWorkflowSettingsPopover } from "../lazyComponents";

type WorkflowSettingsMenuProps = Omit<WorkflowSettingsPopoverProps, "actions"> & {
  actions: Omit<WorkflowSettingsActions, "onClose">;
  disabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * 工作流设置弹层懒加载占位：复用弹层容器类名保持同尺寸同定位，
 * 避免打开瞬间布局跳动与闪白。
 */
function WorkflowSettingsPopoverFallback() {
  return (
    <section aria-label="工作流设置加载中" className="workflow-settings-popover lazy-popover-skeleton" role="status">
      <div className="app-skeleton-bar app-skeleton-heading" />
      <div className="app-skeleton-bar app-skeleton-line-long" />
      <div className="app-skeleton-bar app-skeleton-line-short" />
      <div className="app-skeleton-bar app-skeleton-line-long" />
    </section>
  );
}

export function WorkflowSettingsMenu({
  actions,
  disabled,
  open,
  onOpenChange,
  ...popoverProps
}: WorkflowSettingsMenuProps) {
  return (
    <div className="workflow-settings">
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={disabled}
        type="button"
        onClick={() => {
          if (!disabled) {
            onOpenChange(!open);
          }
        }}
      >
        工作流设置
      </button>
      {open ? (
        <Suspense fallback={<WorkflowSettingsPopoverFallback />}>
          <LazyWorkflowSettingsPopover
            {...popoverProps}
            actions={{
              ...actions,
              onClose: () => onOpenChange(false),
            }}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
