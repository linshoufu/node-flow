export type CanvasTemplateCard = {
  id: string;
  name: string;
  description: string;
  tags: readonly string[];
  nodeCount: number;
  available: boolean;
  unavailableReason?: string;
};

type CanvasEmptyStateProps = {
  templates: readonly CanvasTemplateCard[];
  onApplyTemplate: (templateId: string) => void;
};

export function CanvasEmptyState({ templates, onApplyTemplate }: CanvasEmptyStateProps) {
  return (
    <div className="canvas-empty-state">
      <div className="canvas-empty-copy">
        <p className="canvas-empty-kicker">空画布</p>
        <h2>从测试模板开始</h2>
        <p>选择一个接口测试模板快速搭好流程，也可以继续从左侧节点库拖拽或点击添加节点。</p>
      </div>

      <div className="template-card-list">
        {templates.map((template) => {
          const buttonLabel = template.available ? "使用模板" : template.unavailableReason ?? "暂不可用";

          return (
            <article aria-label={template.name} className="template-card" key={template.id}>
              <div className="template-card-main">
                <div>
                  <h3>{template.name}</h3>
                  <p>{template.description}</p>
                </div>
                <span className="template-node-count">{template.nodeCount} 个节点</span>
              </div>
              <div className="template-card-footer">
                <div aria-label="模板标签" className="template-tags">
                  {template.tags.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
                <button
                  disabled={!template.available}
                  title={template.available ? undefined : template.unavailableReason}
                  type="button"
                  onClick={() => onApplyTemplate(template.id)}
                >
                  {buttonLabel}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
