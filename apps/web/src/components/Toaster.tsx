import { useState } from "react";
import { cn } from "@/lib/utils";

declare global {
  interface Window {
    __toast?: (msg: string, type?: string) => void;
  }
}

export function Toaster() {
  const [toasts, setToasts] = useState<{ id: string; msg: string; type: string }[]>([]);

  window.__toast = (msg: string, type = "info") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  };

  return (
    <div className="fixed top-14 right-4 z-[100] flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "animate-in slide-in-from-right-full rounded-lg border px-4 py-3 shadow-xl text-sm",
            t.type === "error"
              ? "border-red-500/30 bg-red-500/5 text-red-400"
              : t.type === "success"
                ? "border-green-500/30 bg-green-500/5 text-green-400"
                : "border-border bg-surface text-text",
          )}
        >
          {t.msg}
        </div>
      ))}
    </div>
  );
}

export function toast(msg: string, type?: string) {
  window.__toast?.(msg, type);
}
