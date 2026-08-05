import type { JsonSchema } from "../types";
import { effectiveSchema, isNullSchema, schemaAllOfParts, schemaFieldTypes, schemaUnionOptions } from "./jsonSchema";

export type SchemaFieldValidationInput = {
  value: unknown;
  schema: JsonSchema;
  rootSchema?: JsonSchema;
  isRequired: boolean;
};

export function validateSchemaField({ value, schema, rootSchema = schema, isRequired }: SchemaFieldValidationInput): string[] {
  return validateSchemaValue(value, schema, rootSchema, isRequired, []);
}
function validateSchemaValue(value: unknown, schema: JsonSchema, rootSchema: JsonSchema, isRequired: boolean, path: string[]): string[] {
  const compositionErrors = schemaCompositionErrors(value, schema, rootSchema, isRequired, path);
  if (compositionErrors) {
    return compositionErrors;
  }

  const activeSchema = effectiveSchema(schema, rootSchema);

  if (isEmptySchemaFieldValue(value) && shouldReturnEmptyValueEarly(value, activeSchema, isRequired)) {
    return isRequired ? [formatSchemaError(path, "必填项不能为空")] : [];
  }

  const errors: string[] = [];
  const schemaTypes = schemaFieldTypes(activeSchema, rootSchema);
  const schemaType = schemaTypes[0];
  const typeError = schemaTypeError(value, schemaTypes);

  if (typeError) {
    return [formatSchemaError(path, typeError)];
  }

  if (activeSchema.enum?.length && !activeSchema.enum.some((option) => Object.is(option, value))) {
    errors.push(formatSchemaError(path, "请选择有效选项"));
  }

  if (typeof value === "string") {
    const minLength = numericSchemaConstraint(activeSchema.minLength);
    const maxLength = numericSchemaConstraint(activeSchema.maxLength);
    const pattern = typeof activeSchema.pattern === "string" ? activeSchema.pattern : undefined;

    if (minLength !== undefined && value.length < minLength) {
      errors.push(formatSchemaError(path, `至少需要 ${minLength} 个字符`));
    }

    if (maxLength !== undefined && value.length > maxLength) {
      errors.push(formatSchemaError(path, `最多允许 ${maxLength} 个字符`));
    }

    if (pattern && !matchesPattern(value, pattern)) {
      errors.push(formatSchemaError(path, "格式不正确"));
    }

    const formatError = stringFormatError(value, activeSchema.format);
    if (formatError) {
      errors.push(formatSchemaError(path, formatError));
    }
  }

  if (Array.isArray(value)) {
    const minItems = numericSchemaConstraint(activeSchema.minItems);
    const maxItems = numericSchemaConstraint(activeSchema.maxItems);

    if (minItems !== undefined && value.length < minItems) {
      errors.push(formatSchemaError(path, `至少需要 ${minItems} 项`));
    }

    if (maxItems !== undefined && value.length > maxItems) {
      errors.push(formatSchemaError(path, `最多允许 ${maxItems} 项`));
    }

    errors.push(...arrayItemErrors(value, activeSchema, rootSchema, path));
  }

  if (typeof value === "number") {
    const minimum = numericSchemaConstraint(activeSchema.minimum);
    const maximum = numericSchemaConstraint(activeSchema.maximum);
    const exclusiveMinimum = numericSchemaConstraint(activeSchema.exclusiveMinimum);
    const exclusiveMaximum = numericSchemaConstraint(activeSchema.exclusiveMaximum);

    if (schemaType === "integer" && !Number.isInteger(value)) {
      errors.push(formatSchemaError(path, "请输入整数"));
    }

    if (minimum !== undefined && value < minimum) {
      errors.push(formatSchemaError(path, `不能小于 ${minimum}`));
    }

    if (maximum !== undefined && value > maximum) {
      errors.push(formatSchemaError(path, `不能大于 ${maximum}`));
    }

    if (exclusiveMinimum !== undefined && value <= exclusiveMinimum) {
      errors.push(formatSchemaError(path, `必须大于 ${exclusiveMinimum}`));
    }

    if (exclusiveMaximum !== undefined && value >= exclusiveMaximum) {
      errors.push(formatSchemaError(path, `必须小于 ${exclusiveMaximum}`));
    }
  }

  if (isPlainObject(value)) {
    errors.push(...objectPropertyErrors(value, activeSchema, rootSchema, path));
  }

  return errors;
}
function schemaCompositionErrors(value: unknown, schema: JsonSchema, rootSchema: JsonSchema, isRequired: boolean, path: string[]): string[] | undefined {
  const allOfParts = schemaAllOfParts(schema);
  if (allOfParts.length > 0) {
    const errors = allOfParts.flatMap((part) => validateSchemaValue(value, part, rootSchema, isRequired, path));
    return errors.length ? errors : [];
  }

  const options = schemaUnionOptions(schema);
  if (options.length === 0) {
    return undefined;
  }

  if (value === null && options.some(isNullSchema)) {
    return [];
  }

  const concreteOptions = options.filter((option) => !isNullSchema(option));
  if (concreteOptions.length === 0) {
    return undefined;
  }

  const optionErrors = concreteOptions.map((option) => validateSchemaValue(value, option, rootSchema, isRequired, path));
  if (optionErrors.some((errors) => errors.length === 0)) {
    return [];
  }

  return optionErrors.sort((left, right) => left.length - right.length)[0] ?? [];
}
export function isEmptySchemaFieldValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }

  if (typeof value === "string") {
    return value.trim() === "";
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  if (typeof value === "object") {
    return Object.keys(value).length === 0;
  }

  return false;
}

function shouldReturnEmptyValueEarly(value: unknown, schema: JsonSchema, isRequired: boolean): boolean {
  if (isRequired && !shouldValidateEmptyObjectProperties(value, schema)) {
    return true;
  }

  if (Array.isArray(value)) {
    return numericSchemaConstraint(schema.minItems) === undefined && !schema.items;
  }

  if (isPlainObject(value)) {
    return !shouldValidateEmptyObjectProperties(value, schema);
  }

  return true;
}

function shouldValidateEmptyObjectProperties(value: unknown, schema: JsonSchema): boolean {
  return isPlainObject(value) && Boolean(schema.required?.length);
}

function objectPropertyErrors(value: Record<string, unknown>, schema: JsonSchema, rootSchema: JsonSchema, path: string[]): string[] {
  const fields = new Set([...(schema.required ?? []), ...Object.keys(schema.properties ?? {})]);

  return Array.from(fields).flatMap((field) => {
    const fieldSchema = schema.properties?.[field] ?? {};
    return validateSchemaValue(value[field], fieldSchema, rootSchema, schema.required?.includes(field) ?? false, [
      ...path,
      schemaPathLabel(field, fieldSchema, rootSchema),
    ]);
  });
}

function arrayItemErrors(value: unknown[], schema: JsonSchema, rootSchema: JsonSchema, path: string[]): string[] {
  if (!schema.items) {
    return [];
  }

  if (Array.isArray(schema.items)) {
    return schema.items.flatMap((itemSchema, index) =>
      index < value.length ? validateSchemaValue(value[index], itemSchema, rootSchema, false, [...path, `第 ${index + 1} 项`]) : []
    );
  }

  return value.flatMap((item, index) => validateSchemaValue(item, schema.items as JsonSchema, rootSchema, false, [...path, `第 ${index + 1} 项`]));
}

function schemaPathLabel(field: string, schema: JsonSchema, rootSchema: JsonSchema): string {
  const activeSchema = effectiveSchema(schema, rootSchema);
  return typeof activeSchema.title === "string" && activeSchema.title.trim() ? activeSchema.title : field;
}
function formatSchemaError(path: string[], message: string | undefined): string {
  const safeMessage = message ?? "配置不合法";
  return path.length ? `${path.join(".")}：${safeMessage}` : safeMessage;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function schemaTypeError(value: unknown, schemaTypes: string[]): string | undefined {
  if (!schemaTypes.length || schemaTypes.some((schemaType) => matchesSchemaType(value, schemaType))) {
    return undefined;
  }

  return schemaTypeLabel(schemaTypes[0]);
}

function matchesSchemaType(value: unknown, schemaType: string): boolean {
  if (schemaType === "array") {
    return Array.isArray(value);
  }

  if (schemaType === "object") {
    return isPlainObject(value);
  }

  if (schemaType === "integer" || schemaType === "number") {
    return typeof value === "number";
  }

  return typeof value === schemaType;
}

function schemaTypeLabel(schemaType: string): string | undefined {
  const labels: Record<string, string> = {
    array: "类型应为数组",
    boolean: "类型应为布尔值",
    integer: "类型应为数字",
    number: "类型应为数字",
    object: "类型应为对象",
    string: "类型应为文本",
  };

  return labels[schemaType];
}
function numericSchemaConstraint(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function matchesPattern(value: string, pattern: string): boolean {
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return true;
  }
}

function stringFormatError(value: string, format: unknown): string | undefined {
  if (format === "uri" || format === "url" || format === "uri-reference") {
    return isValidUrl(value) ? undefined : "请输入有效 URL";
  }

  if (format === "email") {
    return isValidEmail(value) ? undefined : "请输入有效邮箱";
  }

  return undefined;
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return Boolean(url.protocol && url.hostname);
  } catch {
    return false;
  }
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
