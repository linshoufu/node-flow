import type { WorkflowPickerGroup } from "../lib/workflowPicker";

type WorkflowPickerProps = {
  disabled: boolean;
  groups: WorkflowPickerGroup[];
  value: string;
  onChange: (workflowId: string) => void;
};

export function WorkflowPicker({ disabled, groups, value, onChange }: WorkflowPickerProps) {
  return (
    <label className="workflow-picker">
      <span>工作流</span>
      <select
        aria-label="已保存工作流"
        disabled={disabled || groups.length === 0}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        <option value="">选择工作流...</option>
        {groups.map((group) =>
          group.label ? (
            <optgroup key={group.key} label={group.label}>
              {group.options.map(({ workflow, label }) => (
                <option key={workflow.id} value={workflow.id}>
                  {label}
                </option>
              ))}
            </optgroup>
          ) : (
            group.options.map(({ workflow, label }) => (
              <option key={workflow.id} value={workflow.id}>
                {label}
              </option>
            ))
          )
        )}
      </select>
    </label>
  );
}
