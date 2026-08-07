import { useCallback, useEffect, useRef, useState } from "react";

export type ConfirmDialogOptions = {
  cancelLabel?: string;
  confirmLabel?: string;
  // 破坏性操作：确认按钮使用 danger 样式
  danger?: boolean;
  description?: string;
  title: string;
};

export type PendingConfirmRequest = ConfirmDialogOptions & {
  id: number;
};

type PendingConfirmEntry = PendingConfirmRequest & {
  resolve: (confirmed: boolean) => void;
};

export type ConfirmDialogService = {
  // 请求一次确认：弹窗打开，返回的 Promise 在用户确认/取消后结算
  confirm: (options: ConfirmDialogOptions) => Promise<boolean>;
  // 当前应渲染的弹窗请求；为 null 时不渲染
  request: PendingConfirmRequest | null;
  // 集中一处的结算入口：关闭当前弹窗并按 FIFO 打开队列中的下一个
  settle: (confirmed: boolean) => void;
};

// 基于 state 的确认弹窗服务：由 App 层渲染 ConfirmDialog，并注入到各 hook 替换 window.confirm
export function useConfirmDialog(): ConfirmDialogService {
  const [queue, setQueue] = useState<PendingConfirmEntry[]>([]);
  const queueRef = useRef(queue);
  const idRef = useRef(0);
  queueRef.current = queue;

  const confirm = useCallback((options: ConfirmDialogOptions): Promise<boolean> => {
    const id = ++idRef.current;
    return new Promise<boolean>((resolve) => {
      // updater 保持纯净：id 在外部生成，StrictMode 重复调用不会产生重复条目
      setQueue((current) => [...current, { ...options, id, resolve }]);
    });
  }, []);

  const settle = useCallback((confirmed: boolean) => {
    const [head, ...rest] = queueRef.current;
    if (!head) {
      return;
    }
    setQueue(rest);
    head.resolve(confirmed);
  }, []);

  useEffect(() => () => {
    // 卸载时结算所有未决确认，避免悬挂的 Promise
    queueRef.current.forEach((entry) => entry.resolve(false));
  }, []);

  const head = queue[0];
  return {
    confirm,
    request: head
      ? {
        cancelLabel: head.cancelLabel,
        confirmLabel: head.confirmLabel,
        danger: head.danger,
        description: head.description,
        id: head.id,
        title: head.title,
      }
      : null,
    settle,
  };
}
