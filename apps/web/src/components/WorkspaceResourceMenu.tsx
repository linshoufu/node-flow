import { Box, ChevronDown, KeyRound, Layers3, Puzzle, ServerCog, Variable } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { WorkspaceResourceKind } from "../lib/workspaceResources";

export type { WorkspaceResourceKind } from "../lib/workspaceResources";

type WorkspaceResourceMenuProps = {
  disabled?: boolean;
  credentialCount: number;
  variableCount: number;
  environmentCount: number;
  nodeCount: number;
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
  { kind: "nodes", label: "节点资产", icon: Puzzle },
];

export function WorkspaceResourceMenu({
  disabled = false,
  credentialCount,
  variableCount,
  environmentCount,
  nodeCount,
  packageCount,
  packageAttentionCount = 0,
  onSelect,
}: WorkspaceResourceMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  // 弹窗 portal 到 body 并 fixed 定位，脱离顶栏层叠上下文，避免被工作区面板遮挡
  const [popoverPosition, setPopoverPosition] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLElement | null>(null);
  const counts: Record<WorkspaceResourceKind, number> = {
    credentials: credentialCount,
    variables: variableCount,
    environments: environmentCount,
    packages: packageCount,
    nodes: nodeCount,
  };

  useLayoutEffect(() => {
    if (!isOpen) {
      setPopoverPosition(null);
      return;
    }
    function positionPopover() {
      const trigger = triggerRef.current;
      const popover = popoverRef.current;
      if (!trigger || !popover) {
        return;
      }
      const rect = trigger.getBoundingClientRect();
      const margin = 10;
      const gap = 7;
      const width = popover.offsetWidth;
      const height = popover.offsetHeight;
      // 默认右对齐触发按钮；空间不足时夹紧到视口内
      let left = rect.right - width;
      left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
      let top = rect.bottom + gap;
      if (top + height > window.innerHeight - margin) {
        top = Math.max(margin, window.innerHeight - height - margin);
      }
      setPopoverPosition({ top, left });
    }
    positionPopover();
    window.addEventListener("resize", positionPopover);
    return () => {
      window.removeEventListener("resize", positionPopover);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !popoverRef.current?.contains(target)) {
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
      {isOpen
        ? createPortal(
            <section
              ref={popoverRef}
              aria-label="资源管理"
              className="workspace-resource-popover"
              role="dialog"
              style={popoverPosition ?? { top: 0, left: 0, visibility: "hidden" }}
            >
              <header>
                <strong>资源管理</strong>
                <span>{credentialCount + variableCount + environmentCount + nodeCount + packageCount} 项</span>
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
            </section>,
            document.body,
          )
        : null}
    </div>
  );
}
