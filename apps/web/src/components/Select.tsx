import { Children, Fragment, isValidElement, type ButtonHTMLAttributes, type ComponentProps, type ReactNode } from "react";
import * as Primitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "value" | "defaultValue" | "onChange" | "type"> & {
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
  required?: boolean;
  placeholder?: string;
};

type Choice = { value: string; label: string; disabled?: boolean };

function textContent(children: ReactNode): string {
  return Children.toArray(children).map((child) => isValidElement<{ children?: ReactNode }>(child)
    ? textContent(child.props.children) : String(child)).join("");
}

/** Preserve native option values, including implicit labels and empty/reset choices. */
export function selectChoices(children: ReactNode): Choice[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<ComponentProps<"option">>(child)) return [];
    if (child.type === Fragment) return selectChoices(child.props.children);
    if (child.type !== "option") return [];
    const label = child.props.label ?? textContent(child.props.children);
    return [{ value: String(child.props.value ?? label), label, disabled: child.props.disabled }];
  });
}

/** Shared workbench select. Radix owns keyboard navigation, focus and form integration. */
export function Select({ value, onValueChange, children, className, disabled, required, name, form, placeholder = "请选择", ...props }: Props) {
  const choices = selectChoices(children);
  // Radix reserves an empty item value. Keep the public empty value and native
  // form validation unchanged, while exposing an explicit reset item in the menu.
  let emptyItem = "__nodeflow_empty_choice__";
  while (choices.some((choice) => choice.value === emptyItem)) emptyItem += "_";
  const selected = choices.find((choice) => choice.value === value);
  return <Primitive.Root value={value} onValueChange={(next) => onValueChange(next === emptyItem ? "" : next)} disabled={disabled} required={required} name={name} form={form}>
    <Primitive.Trigger {...props} className={cn(
      "group nodrag nopan flex h-[34px] min-w-0 items-center justify-between gap-2 bg-raised px-2.5 py-1.5 text-left text-xs text-text shadow-sm transition-[background-color,border-color,box-shadow] disabled:cursor-not-allowed disabled:opacity-40",
      className,
      "rounded-lg border border-border outline-none hover:border-border-hover focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 data-[state=open]:border-primary/60 data-[state=open]:ring-2 data-[state=open]:ring-primary/10",
    )}>
      <span className="min-w-0 flex-1 truncate"><Primitive.Value placeholder={selected?.label ?? placeholder}>{selected?.label}</Primitive.Value></span>
      <Primitive.Icon asChild><ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted transition-transform group-data-[state=open]:rotate-180" /></Primitive.Icon>
    </Primitive.Trigger>
    <Primitive.Portal>
      <Primitive.Content position="popper" sideOffset={6} collisionPadding={8} className="workbench-select-menu nodrag nopan nowheel z-[100] min-w-[max(160px,var(--radix-select-trigger-width))] max-w-[min(480px,calc(100vw-24px))] overflow-hidden rounded-xl border border-border-hover/70 bg-raised p-1 text-text shadow-[0_12px_40px_hsl(225_35%_3%_/_0.6),0_2px_8px_hsl(225_35%_3%_/_0.4)]">
        <Primitive.ScrollUpButton className="flex h-5 items-center justify-center text-muted"><ChevronUp size={13} /></Primitive.ScrollUpButton>
        <Primitive.Viewport className="max-h-[min(300px,var(--radix-select-content-available-height))] p-0.5">
          {choices.map((choice) => <Primitive.Item key={choice.value} value={choice.value || emptyItem} disabled={choice.disabled} textValue={choice.label}
            className="relative flex min-h-8 cursor-default select-none items-center rounded-lg py-2 pl-8 pr-3 text-xs leading-4 text-text-secondary outline-none data-[highlighted]:bg-primary/12 data-[highlighted]:text-text data-[state=checked]:text-text data-[disabled]:pointer-events-none data-[disabled]:opacity-35">
            <span className="absolute left-2 flex h-4 w-4 items-center justify-center text-primary">{choice.value === value && <Check size={13} strokeWidth={2.5} />}</span>
            <Primitive.ItemText>{choice.label}</Primitive.ItemText>
          </Primitive.Item>)}
        </Primitive.Viewport>
        <Primitive.ScrollDownButton className="flex h-5 items-center justify-center text-muted"><ChevronDown size={13} /></Primitive.ScrollDownButton>
      </Primitive.Content>
    </Primitive.Portal>
  </Primitive.Root>;
}
