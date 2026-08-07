import { useCallback, useEffect, useRef, useState } from "react";
import { detectToastTone, type ToastTone } from "../lib/toastTone";

// 非 error 通知的自动消失时长
const STATUS_NOTIFICATION_AUTO_DISMISS_MS = 6000;
// 通知堆叠上限，超出时丢弃最旧的一条
const STATUS_NOTIFICATION_QUEUE_LIMIT = 5;

export type StatusNotificationTone = ToastTone;

export type StatusNotificationAction = {
  label: string;
  onClick: () => void;
};

export type StatusNotification = {
  id: string;
  message: string;
  tone: StatusNotificationTone;
  // sticky 通知不会自动消失（error 级别或带操作按钮的通知）
  sticky: boolean;
  action?: StatusNotificationAction;
};

export type PushStatusNotificationOptions = {
  action?: StatusNotificationAction;
  sticky?: boolean;
  tone?: StatusNotificationTone;
};

/**
 * 状态通知队列：支持 info/success/error 三级。
 * - error 通知不自动消失，需手动关闭；
 * - info/success 通知 6 秒后自动消失；
 * - 队列最多堆叠 5 条，超出时丢弃最旧的一条；
 * - 支持携带可选操作按钮（如“撤销删除”），带操作的通知默认不自动消失。
 */
export function useStatusNotifications() {
  const [notifications, setNotifications] = useState<StatusNotification[]>([]);
  const nextIdRef = useRef(1);
  const timersRef = useRef<Map<string, number>>(new Map());

  const dismiss = useCallback((id: string) => {
    setNotifications((current) => current.filter((notification) => notification.id !== id));
  }, []);

  const push = useCallback((message: string, options?: PushStatusNotificationOptions) => {
    const tone = options?.tone ?? detectToastTone(message);
    // error 或带操作按钮的通知默认常驻，等待手动处理
    const sticky = options?.sticky ?? (tone === "error" || Boolean(options?.action));
    const id = `status-notification-${nextIdRef.current}`;
    nextIdRef.current += 1;

    setNotifications((current) => {
      const next = [...current, { action: options?.action, id, message, sticky, tone }];
      // 超出堆叠上限时丢弃最旧的通知
      return next.length > STATUS_NOTIFICATION_QUEUE_LIMIT
        ? next.slice(next.length - STATUS_NOTIFICATION_QUEUE_LIMIT)
        : next;
    });
    return id;
  }, []);

  // 为非 sticky 通知安排自动消失计时器，并清理已移除通知的残留计时器
  useEffect(() => {
    for (const notification of notifications) {
      if (notification.sticky || timersRef.current.has(notification.id)) {
        continue;
      }
      const timer = window.setTimeout(() => {
        timersRef.current.delete(notification.id);
        dismiss(notification.id);
      }, STATUS_NOTIFICATION_AUTO_DISMISS_MS);
      timersRef.current.set(notification.id, timer);
    }

    for (const [id, timer] of Array.from(timersRef.current.entries())) {
      if (!notifications.some((notification) => notification.id === id)) {
        window.clearTimeout(timer);
        timersRef.current.delete(id);
      }
    }
  }, [dismiss, notifications]);

  // 卸载时清理所有计时器，避免触发已卸载组件的状态更新
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) {
        window.clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);

  return { dismiss, notifications, push };
}
