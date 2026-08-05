import { Box, ChevronDown, KeyRound, Layers3, ServerCog, Variable } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { WorkspaceResourceKind } from "../lib/workspaceResources";

export type { WorkspaceResourceKind } from "../lib/workspaceResources";

type WorkspaceResourceMenuProps = {
  disabled?: boolean;
  credentialCount: number;
  variableCount: number;
  environmentCount: number;
  packageCount: number;
  packageAttentionCount?: number;
  onSelect: (kind: WorkspaceResourceKind) => void;
};

const RESOURCE_ITEMS: Array<{
  kind: WorkspaceResourceKind;
  label: string;
  icon: typeof KeyRound;
}> = [
  { kind: "credentials", label: "凭据", icon: KeyRound },
  { kind: "variables", label: "项目变量", icon: Variable },
  { kind: "environments", label: "运行环境", icon: ServerCog },
  { kind: "packages", label: "节点包", icon: Box },
];

export function WorkspaceResourceMenu({
  disabled = false,
  credentialCount,
  variableCount,
  environmentCount,
  packageCount,
  packageAttentionCount = 0,
  onSelect,
}: WorkspaceResourceMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const counts: Record<WorkspaceResourceKind, number> = {
    credentials: credentialCount,
    variables: variableCount,
    environments: environmentCount,
    packages: packageCount,
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  function selectResource(kind: WorkspaceResourceKind) {
    triggerRef.current?.focus();
    setIsOpen(false);
    onSelect(kind);
  }

  return (
    <div className="workspace-resource-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        className="workspace-resource-trigger"
        disabled={disabled}
        type="button"
        onClick={() => setIsOpen((current) => !current)}
      >
        <Layers3 aria-hidden="true" size={15} />
        资源
        {packageAttentionCount > 0 ? (
          <span aria-label={`${packageAttentionCount} 个节点包需处理`} className="workspace-resource-alert">
            {packageAttentionCount}
          </span>
        ) : null}
        <ChevronDown aria-hidden="true" size={13} />
      </button>
      {isOpen ? (
        <section aria-label="资源管理" className="workspace-resource-popover" role="dialog">
          <header>
            <strong>资源管理</strong>
            <span>{credentialCount + variableCount + environmentCount + packageCount} 项</span>
          </header>
          <div className="workspace-resource-list">
            {RESOURCE_ITEMS.map((item) => {
              const Icon = item.icon;
              const attention = item.kind === "packages" ? packageAttentionCount : 0;
              return (
                <button key={item.kind} type="button" onClick={() => selectResource(item.kind)}>
                  <Icon aria-hidden="true" size={17} />
                  <span>{item.label}</span>
                  <strong>{counts[item.kind]}</strong>
                  {attention > 0 ? <em>{attention} 个需处理</em> : null}
                </button>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
