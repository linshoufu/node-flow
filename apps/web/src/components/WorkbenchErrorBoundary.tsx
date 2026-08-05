import { Component, type ErrorInfo, type ReactNode } from "react";
import { FilePlus2, RefreshCw, RotateCcw, TriangleAlert } from "lucide-react";

type WorkbenchErrorBoundaryProps = {
  area?: string;
  children: ReactNode;
  compact?: boolean;
  fallbackClassName?: string;
  resetKey?: string | number | null;
  onError?: (error: Error, info: ErrorInfo) => void;
  onOpenBlank?: () => void;
  onReload?: () => void;
};

type WorkbenchErrorBoundaryState = {
  error: Error | null;
};

export class WorkbenchErrorBoundary extends Component<
  WorkbenchErrorBoundaryProps,
  WorkbenchErrorBoundaryState
> {
  state: WorkbenchErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): WorkbenchErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (this.props.onError) {
      this.props.onError(error, info);
      return;
    }
    console.error("[node-flow] Workbench render failed", error, info);
  }

  componentDidUpdate(previousProps: WorkbenchErrorBoundaryProps) {
    if (
      this.state.error
      && previousProps.resetKey !== this.props.resetKey
    ) {
      this.setState({ error: null });
    }
  }

  render() {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }

    const {
      area = "工作台",
      compact = false,
      fallbackClassName = "",
      onOpenBlank = openBlankWorkflow,
      onReload = reloadWorkbench,
    } = this.props;
    const className = [
      "workbench-error-boundary",
      compact ? "is-compact" : "is-root",
      fallbackClassName,
    ].filter(Boolean).join(" ");

    return (
      <section
        aria-label={`${area}故障恢复`}
        className={className}
        role="alert"
      >
        <div className="workbench-error-icon" aria-hidden="true">
          <TriangleAlert size={compact ? 22 : 28} />
        </div>
        <div className="workbench-error-content">
          {compact ? <h2>{area}暂时无法显示</h2> : <h1>工作台暂时无法显示</h1>}
          <p>
            {compact
              ? "这个区域遇到了渲染错误，其他区域仍可继续使用。"
              : "编辑器遇到了未预期的渲染错误，工作流数据仍保存在浏览器或服务器中。"}
          </p>
          <details>
            <summary>错误摘要</summary>
            <code>{errorSummary(error)}</code>
          </details>
          <div className="workbench-error-actions">
            <button type="button" onClick={() => this.setState({ error: null })}>
              <RotateCcw aria-hidden="true" size={15} />
              重试{compact ? "此区域" : "工作台"}
            </button>
            <button type="button" onClick={onReload}>
              <RefreshCw aria-hidden="true" size={15} />
              重新加载
            </button>
            {!compact ? (
              <button type="button" onClick={onOpenBlank}>
                <FilePlus2 aria-hidden="true" size={15} />
                打开空白工作流
              </button>
            ) : null}
          </div>
        </div>
      </section>
    );
  }
}

function errorSummary(error: Error): string {
  const message = error.message.trim() || "未知渲染错误";
  return message.length > 300 ? `${message.slice(0, 297)}...` : message;
}

function reloadWorkbench() {
  window.location.reload();
}

function openBlankWorkflow() {
  window.location.assign("/workflow/new");
}
