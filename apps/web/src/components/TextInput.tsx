import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Props = InputHTMLAttributes<HTMLInputElement> & { compact?: boolean };

export function TextInput({ compact = false, className, ...props }: Props) {
  return <input {...props} className={cn("nodrag nopan min-w-0 rounded-lg border border-border bg-raised px-2.5 text-xs text-text outline-none transition-[border-color,box-shadow] hover:border-border-hover focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-40", compact ? "h-7" : "h-[34px]", className)} />;
}
