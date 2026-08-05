import type { WorkflowSummary } from "../types";

export type WorkflowPickerOption = {
  workflow: WorkflowSummary;
  label: string;
};

export type WorkflowPickerGroup = {
  key: string;
  label: string | null;
  options: WorkflowPickerOption[];
};

export function buildWorkflowPickerGroups(workflows: WorkflowSummary[]): WorkflowPickerGroup[] {
  const groups: Array<{ key: string; name: string; workflows: WorkflowSummary[] }> = [];
  const groupByName = new Map<string, { key: string; name: string; workflows: WorkflowSummary[] }>();

  for (const workflow of workflows) {
    const nameKey = workflowNameKey(workflow.name);
    let group = groupByName.get(nameKey);

    if (!group) {
      group = {
        key: nameKey,
        name: workflow.name,
        workflows: [],
      };
      groupByName.set(nameKey, group);
      groups.push(group);
    }

    group.workflows.push(workflow);
  }

  return groups.map((group) => {
    const hasDuplicateName = group.workflows.length > 1;

    return {
      key: group.key,
      label: hasDuplicateName ? group.name + " · " + group.workflows.length + " 个" : null,
      options: group.workflows.map((workflow, index) => ({
        workflow,
        label: hasDuplicateName
          ? workflow.name + " v" + workflow.version + " · 同名 " + (index + 1)
          : workflow.name + " v" + workflow.version,
      })),
    };
  });
}

function workflowNameKey(name: string): string {
  return name.trim().toLocaleLowerCase() || "未命名工作流";
}
