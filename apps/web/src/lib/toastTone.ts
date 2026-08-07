export type ToastTone = "info" | "success" | "error";

// 命中任一关键词即判定为错误通知
const ERROR_KEYWORDS = ["失败", "错误", "无法", "冲突", "未能", "拒绝"] as const;

// 命中任一关键词即判定为成功通知（错误关键词优先级更高）
const SUCCESS_KEYWORDS = ["成功", "已完成", "已保存", "已加载", "已安装", "已卸载", "已恢复"] as const;

/**
 * 根据状态文案中的关键词判定通知严重级别。
 * 优先匹配错误关键词，其次匹配成功关键词，其余一律为普通信息。
 */
export function detectToastTone(message: string): ToastTone {
  if (containsKeyword(message, ERROR_KEYWORDS)) {
    return "error";
  }
  if (containsKeyword(message, SUCCESS_KEYWORDS)) {
    return "success";
  }
  return "info";
}

function containsKeyword(message: string, keywords: readonly string[]): boolean {
  return keywords.some((keyword) => message.includes(keyword));
}
