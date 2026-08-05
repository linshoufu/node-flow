import type { JsonSchema } from "../types";

export function effectiveSchema(schema: JsonSchema, rootSchema: JsonSchema = schema, seenRefs = new Set<string>()): JsonSchema {
  const resolvedSchema = resolveReferencedSchema(schema, rootSchema, seenRefs);
  const base = withoutComposition(resolvedSchema);

  if (resolvedSchema.allOf?.length) {
    return resolvedSchema.allOf.reduce(
      (merged, part) => mergeSchemas(merged, effectiveSchema(part, rootSchema, seenRefs)),
      base
    );
  }

  const option = firstConcreteOption(resolvedSchema.anyOf) ?? firstConcreteOption(resolvedSchema.oneOf);
  if (option) {
    return mergeSchemas(base, effectiveSchema(option, rootSchema, seenRefs));
  }

  return resolvedSchema;
}

export function schemaUnionOptions(schema: JsonSchema): JsonSchema[] {
  return schema.anyOf ?? schema.oneOf ?? [];
}

export function schemaAllOfParts(schema: JsonSchema): JsonSchema[] {
  return schema.allOf ?? [];
}

export function isNullSchema(schema: JsonSchema): boolean {
  const types = rawSchemaTypes(schema);
  return types.length > 0 && types.every((type) => type === "null");
}

export function schemaFieldTypes(schema: JsonSchema, rootSchema: JsonSchema = schema): string[] {
  const effective = effectiveSchema(schema, rootSchema);
  return rawSchemaTypes(effective).filter((type) => type !== "null");
}

function resolveReferencedSchema(schema: JsonSchema, rootSchema: JsonSchema, seenRefs: Set<string>): JsonSchema {
  if (!schema.$ref) {
    return schema;
  }

  if (seenRefs.has(schema.$ref)) {
    return withoutReference(schema);
  }

  const target = localDefinition(schema.$ref, rootSchema);
  if (!target) {
    return schema;
  }

  const nextSeenRefs = new Set(seenRefs);
  nextSeenRefs.add(schema.$ref);
  return mergeSchemas(effectiveSchema(target, rootSchema, nextSeenRefs), withoutReference(schema));
}

function localDefinition(ref: string, rootSchema: JsonSchema): JsonSchema | undefined {
  if (!ref.startsWith("#/")) {
    return undefined;
  }

  const path = ref
    .slice(2)
    .split("/")
    .map((part) => decodeJsonPointerSegment(decodeURIComponent(part)));
  let current: unknown = rootSchema;

  for (const part of path) {
    if (!isRecord(current) || !(part in current)) {
      return undefined;
    }
    current = current[part];
  }

  return isRecord(current) ? (current as JsonSchema) : undefined;
}

function decodeJsonPointerSegment(segment: string): string {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function firstConcreteOption(options: JsonSchema[] | undefined): JsonSchema | undefined {
  return options?.find((option) => !isNullSchema(option));
}

function rawSchemaTypes(schema: JsonSchema): string[] {
  if (Array.isArray(schema.type)) {
    return schema.type;
  }

  return schema.type ? [schema.type] : [];
}

function withoutReference(schema: JsonSchema): JsonSchema {
  const { $ref, ...rest } = schema;
  void $ref;
  return rest;
}

function withoutComposition(schema: JsonSchema): JsonSchema {
  const { anyOf, oneOf, allOf, ...rest } = schema;
  void anyOf;
  void oneOf;
  void allOf;
  return rest;
}

function mergeSchemas(base: JsonSchema, next: JsonSchema): JsonSchema {
  return {
    ...base,
    ...next,
    properties: base.properties || next.properties ? { ...base.properties, ...next.properties } : undefined,
    required: mergeRequired(base.required, next.required),
  };
}

function mergeRequired(base: string[] | undefined, next: string[] | undefined): string[] | undefined {
  if (!base?.length && !next?.length) {
    return undefined;
  }

  return Array.from(new Set([...(base ?? []), ...(next ?? [])]));
}