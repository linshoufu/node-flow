export type ExecutionItem = {
  json: unknown;
  binary?: unknown;
  pairedItem?: unknown;
};

export type PortExecutionItems = Record<string, ExecutionItem[]>;

export type ExecutionItemContext = {
  index: number;
  item: ExecutionItem;
};

export function normalizeExecutionItems(value: unknown): ExecutionItem[] {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeExecutionItem(item));
  }

  return [normalizeExecutionItem(value)];
}

export function executionItemMetadata(item: ExecutionItem): Record<string, unknown> | undefined {
  const metadata: Record<string, unknown> = {};

  if (item.binary !== undefined) {
    metadata.binary = item.binary;
  }

  if (item.pairedItem !== undefined) {
    metadata.pairedItem = item.pairedItem;
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

export function normalizePortExecutionItems(value: unknown): PortExecutionItems | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return Object.fromEntries(Object.entries(value).map(([name, itemValue]) => [name, normalizeExecutionItems(itemValue)]));
}

export function flattenPortExecutionItems(value: unknown): ExecutionItem[] | undefined {
  const ports = normalizePortExecutionItems(value);
  return ports ? Object.values(ports).flat() : undefined;
}

export function normalizeExecutionItemContext(value: unknown): ExecutionItemContext | undefined {
  if (!isRecord(value) || !Number.isInteger(value.index) || typeof value.index !== "number" || value.index < 0 || !("item" in value)) {
    return undefined;
  }

  return { index: value.index, item: normalizeExecutionItem(value.item) };
}

function normalizeExecutionItem(value: unknown): ExecutionItem {
  if (isRecord(value) && ("json" in value || "binary" in value || "pairedItem" in value)) {
    return {
      json: value.json,
      ...(value.binary !== undefined ? { binary: value.binary } : {}),
      ...(value.pairedItem !== undefined ? { pairedItem: value.pairedItem } : {}),
    };
  }

  return { json: value };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
