import type { JsonSchema, NodeForm, NodeFormCondition, NodeFormControl, NodeFormGroup } from "../types";

const SUPPORTED_CONTROLS = new Set<NodeFormControl>([
  "text",
  "textarea",
  "password",
  "number",
  "switch",
  "select",
  "json",
  "dynamic_input_list",
  "dynamic_output_list",
  "url",
  "credential",
]);
const SUPPORTED_EXPRESSION_MODES = new Set(["allowed", "disabled", "required"]);

export type ResolvedNodeForm = {
  groups: NodeFormGroup[];
  fallbackFieldKeys: string[];
};

export function resolveNodeForm(form: NodeForm | undefined | null, schema: JsonSchema): ResolvedNodeForm | null {
  if (!form || !Array.isArray(form.groups) || form.groups.length === 0 || !isRecord(schema.properties)) {
    return null;
  }

  const properties = schema.properties;
  const groupIds = new Set<string>();
  const fieldKeys = new Set<string>();

  for (const group of form.groups) {
    if (!isValidGroup(group, properties, groupIds, fieldKeys)) {
      return null;
    }
  }

  return {
    groups: form.groups,
    fallbackFieldKeys: Object.keys(properties).filter((key) => !fieldKeys.has(key)),
  };
}

export function isNodeFormVisible(
  condition: NodeFormCondition | undefined,
  config: Record<string, unknown>
): boolean {
  if (!condition) {
    return true;
  }
  const value = config[condition.field];
  if (Array.isArray(condition.oneOf)) {
    return condition.oneOf.some((option) => Object.is(option, value));
  }
  if (condition.notEmpty === true) {
    return value !== undefined && value !== null && value !== "";
  }
  return Object.prototype.hasOwnProperty.call(condition, "equals") && Object.is(condition.equals, value);
}

function isValidGroup(
  group: NodeFormGroup,
  properties: Record<string, unknown>,
  groupIds: Set<string>,
  fieldKeys: Set<string>
): boolean {
  if (
    !isRecord(group) ||
    typeof group.id !== "string" ||
    !group.id.trim() ||
    groupIds.has(group.id) ||
    typeof group.label !== "string" ||
    !Array.isArray(group.fields) ||
    group.fields.length === 0 ||
    !isValidCondition(group.visibleWhen, properties)
  ) {
    return false;
  }
  groupIds.add(group.id);

  return group.fields.every((field) => {
    if (
      !isRecord(field) ||
      typeof field.key !== "string" ||
      !Object.prototype.hasOwnProperty.call(properties, field.key) ||
      fieldKeys.has(field.key) ||
      !SUPPORTED_CONTROLS.has(field.control as NodeFormControl) ||
      (field.expression !== undefined && !SUPPORTED_EXPRESSION_MODES.has(field.expression)) ||
      !isValidCondition(field.visibleWhen, properties) ||
      !isValidFieldOptions(field.control, field.options) ||
      !isValidCredentialTypes(field.control, field.credentialTypeIds)
    ) {
      return false;
    }
    fieldKeys.add(field.key);
    return true;
  });
}

function isValidCondition(
  condition: NodeFormCondition | undefined,
  properties: Record<string, unknown>
): boolean {
  if (!condition) {
    return true;
  }
  if (!isRecord(condition) || typeof condition.field !== "string" || !(condition.field in properties)) {
    return false;
  }
  const modes = [
    Object.prototype.hasOwnProperty.call(condition, "equals"),
    Array.isArray(condition.oneOf) && condition.oneOf.length > 0,
    condition.notEmpty === true,
  ].filter(Boolean);
  return modes.length === 1;
}

function isValidFieldOptions(control: unknown, options: unknown): boolean {
  if (control === "select") {
    return (
      Array.isArray(options) &&
      options.length > 0 &&
      options.every(
        (option) => isRecord(option) && typeof option.value === "string" && typeof option.label === "string"
      )
    );
  }
  return options === undefined || (Array.isArray(options) && options.length === 0);
}

function isValidCredentialTypes(control: unknown, credentialTypeIds: unknown): boolean {
  if (credentialTypeIds === undefined) {
    return true;
  }
  return (
    control === "credential" &&
    Array.isArray(credentialTypeIds) &&
    credentialTypeIds.every((credentialTypeId) => typeof credentialTypeId === "string" && credentialTypeId.length > 0)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
