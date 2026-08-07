import { X } from "lucide-react";
import type { StatusNotification } from "../hooks/useStatusNotifications";

type StatusNotificationsProps = {
  // 编辑器锁定等场景下禁用通知上的操作按钮（如“撤销删除”）
  actionsDisabled?: boolean;
  notifications: readonly StatusNotification[];
  onDismiss: (id: string) => void;
};

/**
 * 状态通知堆叠浮层：固定顶部居中，沿用 .status-toast 视觉，
 * 按严重级别附加 is-error / is-success 变体样式。
 */
export function StatusNotifications({ actionsDisabled = false, notifications, onDismiss }: StatusNotificationsProps) {
  if (notifications.length === 0) {
    return null;
  }

  return (
    <div className="status-toast-stack">
      {notifications.map((notification) => (
        <div
          className={`status-toast is-${notification.tone}`}
          key={notification.id}
          role={notification.tone === "error" ? "alert" : "status"}
        >
          <span>{notification.message}</span>
          {notification.action ? (
            <button
              disabled={actionsDisabled}
              type="button"
              onClick={notification.action.onClick}
            >
              {notification.action.label}
            </button>
          ) : null}
          <button
            aria-label="关闭通知"
            className="status-toast-close"
            type="button"
            onClick={() => onDismiss(notification.id)}
          >
            <X aria-hidden="true" size={13} strokeWidth={2.4} />
          </button>
        </div>
      ))}
    </div>
  );
}
