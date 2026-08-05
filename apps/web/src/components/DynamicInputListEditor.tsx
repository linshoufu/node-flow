import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type { DynamicInputList } from "../types";

type DynamicInputEntry = Record<string, unknown>;

type DynamicInputListEditorProps = {
  connectedInputHandles?: string[];
  definition: DynamicInputList;
  description?: string;
  disabled?: boolean;
  label: string;
  onChange: (value: DynamicInputEntry[]) => void;
  onFocus: () => void;
  value: unknown;
};

export function DynamicInputListEditor({
  connectedInputHandles = [],
  definition,
  description,
  disabled = false,
  label,
  onChange,
  onFocus,
  value,
}: DynamicInputListEditorProps) {
  const entries = normalizeEntries(value, definition);
  const connectedHandles = new Set(connectedInputHandles);
  const canRemove = entries.length > 1;

  function updateEntry(index: number, patch: DynamicInputEntry) {
    onChange(entries.map((entry, entryIndex) => (entryIndex === index ? { ...entry, ...patch } : entry)));
  }

  function removeEntry(index: number) {
    if (canRemove) {
      onChange(entries.filter((_, entryIndex) => entryIndex !== index));
    }
  }

  function moveEntry(index: number, offset: -1 | 1) {
    const targetIndex = index + offset;
    if (targetIndex < 0 || targetIndex >= entries.length) {
      return;
    }
    const next = [...entries];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    onChange(next);
  }

  return (
    <fieldset className="dynamic-output-list dynamic-input-list" disabled={disabled} onFocus={onFocus}>
      <legend>{label}</legend>
      {description ? <p>{description}</p> : null}
      <div className="dynamic-output-list-rows">
        {entries.map((entry, index) => {
          const entryLabel = stringValue(entry[definition.labelKey]) || `输入 ${index + 1}`;
          const entryId = stringValue(entry[definition.idKey]);
          const isConnected = connectedHandles.has(entryId);
          return (
            <div className="dynamic-output-rule dynamic-input-rule" key={entryId || index}>
              <span className="dynamic-output-rule-index" aria-hidden="true">
                {index + 1}
              </span>
              <label>
                <span>输入名称</span>
                <input
                  aria-label={`第 ${index + 1} 个输入的名称`}
                  maxLength={80}
                  value={entryLabel}
                  onChange={(event) => updateEntry(index, { [definition.labelKey]: event.currentTarget.value })}
                />
              </label>
              <div className="dynamic-output-rule-actions" role="group" aria-label={`${entryLabel} 操作`}>
                <button
                  aria-label={`上移 ${entryLabel}`}
                  disabled={index === 0}
                  title="上移输入"
                  type="button"
                  onClick={() => moveEntry(index, -1)}
                >
                  <ArrowUp aria-hidden="true" size={15} />
                </button>
                <button
                  aria-label={`下移 ${entryLabel}`}
                  disabled={index === entries.length - 1}
                  title="下移输入"
                  type="button"
                  onClick={() => moveEntry(index, 1)}
                >
                  <ArrowDown aria-hidden="true" size={15} />
                </button>
                <button
                  aria-label={`删除 ${entryLabel}`}
                  disabled={!canRemove || isConnected}
                  title={isConnected ? "该输入已连接到上游节点，请先删除或改接连线" : canRemove ? "删除输入" : "至少保留一个输入"}
                  type="button"
                  onClick={() => removeEntry(index)}
                >
                  <Trash2 aria-hidden="true" size={15} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <button
        className="dynamic-output-add"
        type="button"
        onClick={() =>
          onChange([
            ...entries,
            {
              [definition.idKey]: nextEntryId(entries, definition.idKey),
              [definition.labelKey]: "新输入",
            },
          ])
        }
      >
        <Plus aria-hidden="true" size={16} />
        添加输入
      </button>
      <small>
        {connectedHandles.size > 0
          ? "已连接的输入不能删除，请先在画布上删除或改接相关连线。"
          : "输入名称会同步为画布端口；调整前请确认没有上游连线依赖。"}
      </small>
    </fieldset>
  );
}

function normalizeEntries(value: unknown, definition: DynamicInputList): DynamicInputEntry[] {
  const candidates = Array.isArray(value) && value.length > 0 ? value : definition.defaultItems ?? [];
  return candidates.flatMap((candidate, index) => {
    if (!isRecord(candidate)) {
      return [];
    }
    return [
      {
        ...candidate,
        [definition.idKey]: stringValue(candidate[definition.idKey]) || `input_${index + 1}`,
        [definition.labelKey]: stringValue(candidate[definition.labelKey]) || `输入 ${index + 1}`,
      },
    ];
  });
}

function nextEntryId(entries: DynamicInputEntry[], idKey: string): string {
  const ids = new Set(entries.map((entry) => stringValue(entry[idKey])));
  for (let index = 1; index <= 99; index += 1) {
    const candidate = `input_${index}`;
    if (!ids.has(candidate)) {
      return candidate;
    }
  }
  return `input_${Date.now().toString(36)}`;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
