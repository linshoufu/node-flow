export interface CommonGroupField {
  name: string;
  label?: string;
  on_difference: "split" | "error";
  allow_empty?: boolean;
  emit?: boolean;
}

export function groupFieldsFromConfig(config: Record<string, unknown>): CommonGroupField[] {
  if (Array.isArray(config.common_fields)) return config.common_fields as CommonGroupField[];
  const by = (config.by ?? []) as string[];
  const headers = (config.header_fields ?? []) as string[];
  const optional = (config.optional_keys ?? []) as string[];
  return [...new Set([...headers, ...by])].map((name) => ({ name,
    on_difference: by.includes(name) ? "split" : "error",
    allow_empty: by.includes(name) ? optional.includes(name) : true,
    emit: headers.includes(name),
  }));
}

export function withCommonGroupFields(config: Record<string, unknown>, fields: CommonGroupField[]) {
  const next = { ...config, common_fields: fields };
  for (const key of ["by", "header_fields", "optional_keys"]) delete (next as Record<string, unknown>)[key];
  return next;
}
