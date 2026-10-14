/**
 * 把 API 抛出的原始错误整理成可以展示给用户的保存失败信息。
 * 界面据此区分「可恢复的版本冲突」与其他失败，并给出对应操作。
 */
export type SaveFailureKind = "conflict" | "timeout" | "unreachable" | "unknown";

export type SaveFailure = {
  kind: SaveFailureKind;
  message: string;
  status?: number;
  expectedVersion?: number;
  currentVersion?: number;
};

type Detail = {
  code?: string;
  message?: string;
  expectedVersion?: number;
  currentVersion?: number;
};

const API_ERROR = /^API (\d{3}): ?([\s\S]*)$/;
const WORKFLOW_VERSION_CONFLICT = "workflow_version_conflict";
const DEFAULT_CONFLICT_MESSAGE = "工作流已被其他操作更新，请重新加载后再继续。";
const UNREACHABLE_MESSAGE = "无法连接到后端服务，请确认 API 正在运行后重试。";
const TIMEOUT_MESSAGE = "保存请求超时，后端可能仍在处理，请稍后重试。";
const MAX_MESSAGE_LENGTH = 200;

/** 只解析结构化响应体；非 JSON 的原始响应（例如 HTML 错误页）不展示给用户。 */
function parseBody(body: string): Detail {
  const text = body.trim();
  if (!text) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object") return {};
  const detail = "detail" in parsed ? (parsed as { detail?: unknown }).detail : parsed;
  if (typeof detail === "string") return { message: detail };
  if (!detail || typeof detail !== "object") return {};
  const fields = detail as Record<string, unknown>;
  return {
    code: typeof fields.code === "string" ? fields.code : undefined,
    message: typeof fields.message === "string" ? fields.message : undefined,
    expectedVersion: typeof fields.expected_version === "number" ? fields.expected_version : undefined,
    currentVersion: typeof fields.current_version === "number" ? fields.current_version : undefined,
  };
}

function clip(message: string): string {
  return message.length > MAX_MESSAGE_LENGTH ? `${message.slice(0, MAX_MESSAGE_LENGTH)}…` : message;
}

export function describeSaveFailure(error: unknown): SaveFailure {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const match = API_ERROR.exec(raw.trim());
  if (!match) {
    const timedOut = /timed out/i.test(raw);
    return { kind: timedOut ? "timeout" : "unreachable", message: timedOut ? TIMEOUT_MESSAGE : UNREACHABLE_MESSAGE };
  }
  const status = Number(match[1]);
  const detail = parseBody(match[2]);
  if (detail.code === WORKFLOW_VERSION_CONFLICT) {
    return {
      kind: "conflict",
      message: clip(detail.message ?? DEFAULT_CONFLICT_MESSAGE),
      status,
      expectedVersion: detail.expectedVersion,
      currentVersion: detail.currentVersion,
    };
  }
  return { kind: "unknown", message: clip(detail.message ?? `保存失败（HTTP ${status}）`), status };
}
