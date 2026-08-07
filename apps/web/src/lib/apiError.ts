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

// 常见浏览器 fetch 网络层错误的 message 特征
const NETWORK_ERROR_PATTERNS = [
  /failed to fetch/i,
  /networkerror/i,
  /load failed/i,
  /network request failed/i,
];

function isNetworkLayerError(message: string): boolean {
  return NETWORK_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

export function parseApiError(error: unknown): ParsedApiError {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/^API (\d+): (.+)$/s);
  if (!match) {
    // fetch 网络层错误（如 "Failed to fetch"）给出中文友好兜底文案，
    // 原始信息以括号后缀保留便于排查；其他无前缀错误保持原样透出。
    return {
      code: null,
      currentVersion: null,
      expectedVersion: null,
      message: isNetworkLayerError(message)
        ? `无法连接到服务，请检查后端是否已启动（${message}）`
        : message,
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
    const status = Number(match[1]);
    // 5xx 且响应体无法解析时，给出服务不可用的兜底文案，原始信息保留为后缀
    if (status >= 500) {
      return apiError(status, `服务暂时不可用，请稍后重试（${message}）`);
    }
    return apiError(status, message);
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
