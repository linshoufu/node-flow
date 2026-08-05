import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type { DynamicOutputList } from "../types";

type DynamicOutputRule = Record<string, unknown>;

type DynamicOutputListEditorProps = {
  disabled?: boolean;
  label: string;
  description?: string;
  value: unknown;
  definition: DynamicOutputList;
  connectedOutputHandles?: string[];
  onChange: (value: DynamicOutputRule[]) => void;
  onFocus: () => void;
};

export function DynamicOutputListEditor({
  disabled = false,
  label,
  description,
  value,
  definition,
  connectedOutputHandles = [],
  onChange,
  onFocus,
}: DynamicOutputListEditorProps) {
  const rules = normalizeRules(value, definition);
  const canRemove = rules.length > 1;
  const connectedHandles = new Set(connectedOutputHandles);

  function updateRule(index: number, patch: DynamicOutputRule) {
    onChange(rules.map((rule, ruleIndex) => (ruleIndex === index ? { ...rule, ...patch } : rule)));
  }

  function removeRule(index: number) {
    if (canRemove) {
      onChange(rules.filter((_, ruleIndex) => ruleIndex !== index));
    }
  }

  function moveRule(index: number, offset: -1 | 1) {
    const targetIndex = index + offset;
    if (targetIndex < 0 || targetIndex >= rules.length) {
      return;
    }
    const next = [...rules];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    onChange(next);
  }

  return (
    <fieldset className="dynamic-output-list" disabled={disabled} onFocus={onFocus}>
      <legend>{label}</legend>
      {description ? <p>{description}</p> : null}
      <div className="dynamic-output-list-rows">
        {rules.map((rule, index) => {
          const ruleLabel = stringValue(rule[definition.labelKey]) || `分支 ${index + 1}`;
          const ruleId = stringValue(rule[definition.idKey]);
          const isConnected = connectedHandles.has(ruleId);
          return (
            <div className="dynamic-output-rule" key={stringValue(rule[definition.idKey]) || index}>
              <span className="dynamic-output-rule-index" aria-hidden="true">
                {index + 1}
              </span>
              <label>
                <span>分支名称</span>
                <input
                  aria-label={`第 ${index + 1} 条规则的分支名称`}
                  maxLength={80}
                  value={ruleLabel}
                  onChange={(event) => updateRule(index, { [definition.labelKey]: event.currentTarget.value })}
                />
              </label>
              <label>
                <span>匹配值</span>
                <input
                  aria-label={`第 ${index + 1} 条规则的匹配值`}
                  placeholder="文本、123、true 或 JSON"
                  value={formatRuleValue(rule.value)}
                  onChange={(event) => updateRule(index, { value: parseRuleValue(event.currentTarget.value) })}
                />
              </label>
              <div className="dynamic-output-rule-actions" role="group" aria-label={`${ruleLabel} 操作`}>
                <button
                  aria-label={`上移 ${ruleLabel}`}
                  disabled={index === 0}
                  title="上移规则"
                  type="button"
                  onClick={() => moveRule(index, -1)}
                >
                  <ArrowUp aria-hidden="true" size={15} />
                </button>
                <button
                  aria-label={`下移 ${ruleLabel}`}
                  disabled={index === rules.length - 1}
                  title="下移规则"
                  type="button"
                  onClick={() => moveRule(index, 1)}
                >
                  <ArrowDown aria-hidden="true" size={15} />
                </button>
                <button
                  aria-label={`删除 ${ruleLabel}`}
                  disabled={!canRemove || isConnected}
                  title={isConnected ? "该分支已连接到下游节点，请先删除或改接连线" : canRemove ? "删除规则" : "至少保留一条规则"}
                  type="button"
                  onClick={() => removeRule(index)}
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
        onClick={() => {
          onChange([
            ...rules,
            {
              [definition.idKey]: nextRuleId(rules, definition.idKey),
              [definition.labelKey]: "新分支",
              value: "",
            },
          ]);
        }}
      >
        <Plus aria-hidden="true" size={16} />
        添加分支
      </button>
      <small>
        {connectedHandles.size > 0
          ? "已连接的分支不能删除，请先在画布上删除或改接相关连线。"
          : "删除分支前请确认没有下游连线依赖它。"}
      </small>
    </fieldset>
  );
}

function normalizeRules(value: unknown, definition: DynamicOutputList): DynamicOutputRule[] {
  const candidates = Array.isArray(value) && value.length > 0 ? value : definition.defaultItems ?? [];
  return candidates.flatMap((candidate, index) => {
    if (!isRecord(candidate)) {
      return [];
    }
    const id = stringValue(candidate[definition.idKey]) || `route_${index + 1}`;
    return [
      {
        ...candidate,
        [definition.idKey]: id,
        [definition.labelKey]: stringValue(candidate[definition.labelKey]) || `分支 ${index + 1}`,
        value: candidate.value ?? "",
      },
    ];
  });
}

function nextRuleId(rules: DynamicOutputRule[], idKey: string): string {
  const ids = new Set(rules.map((rule) => stringValue(rule[idKey])));
  for (let index = 1; index <= 99; index += 1) {
    const candidate = `route_${index}`;
    if (!ids.has(candidate)) {
      return candidate;
    }
  }
  return `route_${Date.now().toString(36)}`;
}

function formatRuleValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value ?? "");
}

function parseRuleValue(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
