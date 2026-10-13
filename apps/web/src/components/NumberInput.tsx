import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { Minus, Plus } from "lucide-react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange" | "size" | "step"> & {
  value: string | number;
  onValueChange: (value: string) => void;
  compact?: boolean;
  step?: number;
};

/** Native numeric editing and bounds, with visible controls that match the workbench. */
export function NumberInput({ value, onValueChange, compact = false, className = "", min, max, step = 1, disabled, readOnly, ...props }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(() => String(value));
  useEffect(() => {
    // Numeric consumers normalize an empty value to 0. Preserve the editing
    // draft (including the browser's intermediate minus/decimal text) until blur.
    setDraft((current) => current === String(value) || (typeof value === "number" && Number(current) === value) ? current : String(value));
  }, [value]);
  const label = props["aria-label"] ?? "数值";
  const numeric = value === "" ? null : Number(value);
  const stepValue = (direction: "up" | "down") => {
    if (!input.current) return;
    if (direction === "up") input.current.stepUp();
    else input.current.stepDown();
    setDraft(input.current.value);
    onValueChange(input.current.value);
  };
  return <span className={`number-control nodrag nopan ${compact ? "compact" : ""} ${className}`}>
    <input {...props} ref={input} className="number-value" type="number" value={draft} min={min} max={max} step={step} disabled={disabled} readOnly={readOnly} onChange={(event) => { setDraft(event.target.value); onValueChange(event.target.value); }} onBlur={(event) => { setDraft(String(value)); props.onBlur?.(event); }} />
    <span className="number-actions">
      <button type="button" aria-label={`减少${label}`} title={`减少${label}`} disabled={disabled || readOnly || (numeric !== null && min !== undefined && numeric <= Number(min))} onMouseDown={(event) => event.preventDefault()} onClick={() => stepValue("down")}><Minus size={12} /></button>
      <button type="button" aria-label={`增加${label}`} title={`增加${label}`} disabled={disabled || readOnly || (numeric !== null && max !== undefined && numeric >= Number(max))} onMouseDown={(event) => event.preventDefault()} onClick={() => stepValue("up")}><Plus size={12} /></button>
    </span>
  </span>;
}
