export type PinnedDataDraftResult = {
  pinnedData?: Record<string, unknown>;
  errors: string[];
};

export function createPinnedDataDraft(outputHandles: string[]): Record<string, unknown> {
  const primaryOutput = outputHandles.includes("success") ? "success" : outputHandles[0];
  return primaryOutput ? { [primaryOutput]: {} } : {};
}

export function parsePinnedDataDraft(text: string, outputHandles: string[]): PinnedDataDraftResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { errors: ["固定输出必须是有效的 JSON。"] };
  }

  if (!isRecord(value)) {
    return { errors: ["固定输出必须是一个对象，键名为输出端口。"] };
  }

  const outputNames = Object.keys(value);
  if (outputNames.length === 0) {
    return { errors: ["固定输出至少需要包含一个输出端口。"] };
  }

  const errors = outputNames
    .filter((name) => !outputHandles.includes(name))
    .map((name) => `输出端口“${name}”不存在。`);
  return errors.length ? { errors } : { pinnedData: value, errors: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
