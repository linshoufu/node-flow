import { useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Search } from "lucide-react";
import { buildNodeTypeSearchIndex, displayNodeName, filterNodeTypes } from "./NodePalette";
import { NodeTypeIcon } from "./NodeTypeIcon";
import type { NodeType } from "../types";

type CanvasQuickSearchProps = {
  nodeTypes: NodeType[];
  screenPosition: { x: number; y: number };
  onAdd: (nodeType: NodeType) => void;
  onClose: () => void;
};

const MAX_VISIBLE_RESULTS = 8;
const PANEL_WIDTH = 300;
const PANEL_MAX_HEIGHT = 372;

export function CanvasQuickSearch({ nodeTypes, screenPosition, onAdd, onClose }: CanvasQuickSearchProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // 与节点库共用预建搜索索引，输入与过滤渲染用 useDeferredValue 分离
  const nodeTypeSearchIndex = useMemo(() => buildNodeTypeSearchIndex(nodeTypes), [nodeTypes]);
  const deferredQuery = useDeferredValue(query);
  const results = useMemo(
    () => filterNodeTypes(nodeTypes, deferredQuery, nodeTypeSearchIndex).slice(0, MAX_VISIBLE_RESULTS),
    [nodeTypes, deferredQuery, nodeTypeSearchIndex],
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    // 点击面板外任意位置关闭，Esc 在输入框里处理
    function handlePointerDown(event: PointerEvent) {
      if (!panelRef.current?.contains(event.target as Node)) {
        onClose();
      }
    }
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [onClose]);

  function commit(nodeType: NodeType) {
    onAdd(nodeType);
    onClose();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => Math.min(current + 1, results.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      const targetNode = results[activeIndex];
      if (targetNode) {
        event.preventDefault();
        commit(targetNode);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }

  // 双击点即面板左上角，空间不足时夹紧到视口内
  const margin = 10;
  const left = Math.max(margin, Math.min(screenPosition.x, window.innerWidth - PANEL_WIDTH - margin));
  const top = Math.max(margin, Math.min(screenPosition.y, window.innerHeight - PANEL_MAX_HEIGHT - margin));

  return (
    <div
      aria-label="快速添加节点"
      className="canvas-quick-search nodrag nopan"
      ref={panelRef}
      role="dialog"
      style={{ top, left }}
    >
      <label className="canvas-quick-search-input">
        <Search aria-hidden="true" size={14} strokeWidth={2.2} />
        <input
          aria-label="搜索节点"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="搜索节点，Enter 添加到当前位置"
          ref={inputRef}
          type="search"
        />
      </label>
      {results.length === 0 ? (
        <p className="canvas-quick-search-empty">没有匹配的节点。</p>
      ) : (
        <ul className="canvas-quick-search-list">
          {results.map((nodeType, index) => (
            <li key={nodeType.id}>
              <button
                data-active={index === activeIndex ? "true" : undefined}
                data-category={nodeType.category || "其他"}
                type="button"
                onClick={() => commit(nodeType)}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <NodeTypeIcon className="palette-node-icon" icon={nodeType.icon} />
                <span>{displayNodeName(nodeType)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="canvas-quick-search-hint">↑↓ 选择 · Enter 添加 · Esc 关闭</p>
    </div>
  );
}
