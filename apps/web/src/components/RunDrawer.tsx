import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

import { runDrawerSummary } from "../lib/workbenchLayout";
import type { RunRecord } from "../types";

type RunDrawerProps = {
  expanded: boolean;
  run: RunRecord | null;
  onToggle: () => void;
  children: ReactNode;
};

export function RunDrawer({ expanded, run, onToggle, children }: RunDrawerProps) {
  const summary = runDrawerSummary(run);
  const toggleLabel = expanded ? "收起运行结果" : "展开运行结果";

  return (
    <section className="run-drawer" data-expanded={expanded} aria-label="运行结果抽屉">
      <div className="run-drawer-summary">
        <div className="run-drawer-title">
          <h2>运行结果</h2>
          <span className={run ? `status-pill status-${run.status}` : "status-pill"}>{summary.statusLabel}</span>
          <span className="run-drawer-detail">{summary.detail}</span>
        </div>
        <button
          aria-expanded={expanded}
          aria-label={toggleLabel}
          className="icon-button run-drawer-toggle"
          title={toggleLabel}
          type="button"
          onClick={onToggle}
        >
          <ChevronDown aria-hidden="true" size={18} />
        </button>
      </div>
      <div className="run-drawer-content" hidden={!expanded}>
        {children}
      </div>
    </section>
  );
}
