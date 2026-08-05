export type ParsedApiError = {
  code: string | null;
  currentVersion: number | null;
  expectedVersion: number | null;
  message: string;
  status: number | null;
};

type ApiErrorPayload = {
  detail?: string | {
    code?: string;
    current_version?: number;
    expected_version?: number;
    message?: string;
  } | Array<{ message?: string }>;
};

export function parseApiError(error: unknown): ParsedApiError {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/^API (\d+): (.+)$/s);
  if (!match) {
    return {
      code: null,
      currentVersion: null,
      expectedVersion: null,
      message,
      status: null,
    };
  }

  try {
    const parsed = JSON.parse(match[2]) as ApiErrorPayload;
    if (typeof parsed.detail === "string") {
      return apiError(Number(match[1]), parsed.detail);
    }
    if (Array.isArray(parsed.detail)) {
      const issueMessages = parsed.detail
        .map((issue) => issue.message)
        .filter((issueMessage): issueMessage is string => Boolean(issueMessage));
      return apiError(
        Number(match[1]),
        issueMessages.length > 0 ? issueMessages.join("；") : message,
      );
    }
    return {
      code: parsed.detail?.code ?? null,
      currentVersion: parsed.detail?.current_version ?? null,
      expectedVersion: parsed.detail?.expected_version ?? null,
      message: parsed.detail?.message ?? message,
      status: Number(match[1]),
    };
  } catch {
    return apiError(Number(match[1]), message);
  }
}

export function formatApiError(error: unknown): string {
  return parseApiError(error).message;
}

export function isWorkflowVersionConflict(error: unknown): boolean {
  const parsed = parseApiError(error);
  return parsed.status === 409 && parsed.code === "workflow_version_conflict";
}

function apiError(status: number, message: string): ParsedApiError {
  return {
    code: null,
    currentVersion: null,
    expectedVersion: null,
    message,
    status,
  };
}
