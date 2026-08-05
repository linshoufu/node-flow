export const WORKFLOW_VARIABLE_NAME_ERROR = "变量名只能包含字母、数字和下划线，且不能以数字开头。";

export type WorkflowVariableIssue = {
  name: string;
  message: string;
};

export function isWorkflowVariableName(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

export function buildWorkflowVariableIssues(variables: Record<string, unknown>): WorkflowVariableIssue[] {
  return Object.keys(variables)
    .filter((name) => !isWorkflowVariableName(name))
    .map((name) => ({
      name,
      message: WORKFLOW_VARIABLE_NAME_ERROR,
    }));
}

export function validWorkflowVariableNames(variables: Record<string, unknown>): string[] {
  return Object.keys(variables)
    .filter(isWorkflowVariableName)
    .sort((left, right) => left.localeCompare(right));
}

export function nextWorkflowVariableName(variables: Record<string, unknown>): string {
  let index = 1;
  while (`variable_${index}` in variables) {
    index += 1;
  }
  return `variable_${index}`;
}

export function formatWorkflowVariableValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}
