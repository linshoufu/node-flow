import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "onChange" | "size"> & {
  onCheckedChange: (checked: boolean) => void;
};

/** A native, keyboard-accessible switch shared by canvas and inspector fields. */
export function Switch({ className, onCheckedChange, ...props }: Props) {
  return <input {...props} type="checkbox" role="switch" onChange={(event) => onCheckedChange(event.target.checked)} className={cn("workbench-switch nodrag nopan nowheel shrink-0", className)} />;
}
