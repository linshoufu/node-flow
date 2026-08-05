import type { WorkflowSettingsActions, WorkflowSettingsPopoverProps } from "./WorkflowSettingsPopover";
import { WorkflowSettingsPopover } from "./WorkflowSettingsPopover";

type WorkflowSettingsMenuProps = Omit<WorkflowSettingsPopoverProps, "actions"> & {
  actions: Omit<WorkflowSettingsActions, "onClose">;
  disabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

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
        <WorkflowSettingsPopover
          {...popoverProps}
          actions={{
            ...actions,
            onClose: () => onOpenChange(false),
          }}
        />
      ) : null}
    </div>
  );
}
