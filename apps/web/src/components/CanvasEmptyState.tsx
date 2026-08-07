export type CanvasTemplateCard = {
  category: "general" | "testing";
  id: string;
  name: string;
  description: string;
  tags: readonly string[];
  nodeCount: number;
  available: boolean;
  unavailableReason?: string;
};

const TEMPLATE_SECTIONS = [
  { category: "general", title: "通用工作流" },
  { category: "testing", title: "测试工作流" },
] as const;

type CanvasEmptyStateProps = {
  templates: readonly CanvasTemplateCard[];
  actionsDisabled?: boolean;
  onApplyTemplate: (templateId: string) => void;
};

export function CanvasEmptyState({ templates, actionsDisabled = false, onApplyTemplate }: CanvasEmptyStateProps) {
  return (
    <div className="canvas-empty-state">
      <div className="canvas-empty-copy">
        <p className="canvas-empty-kicker">空画布</p>
        <h2>从模板开始</h2>
        <p>选择通用或测试工作流模板快速搭好流程，也可以继续从左侧节点库拖拽或点击添加节点。</p>
        <p className="canvas-empty-tips">
          高效操作：双击画布空白处可快速搜索并添加节点，按 Ctrl+K 可打开命令面板。
        </p>
      </div>

      <div className="template-section-list">
        {TEMPLATE_SECTIONS.map((section) => {
          const sectionTemplates = templates.filter((template) => template.category === section.category);

          if (sectionTemplates.length === 0) {
            return null;
          }

          return (
            <section aria-labelledby={`template-section-${section.category}`} className="template-section" key={section.category}>
              <h3 id={`template-section-${section.category}`}>{section.title}</h3>
              <div className="template-card-list">
                {sectionTemplates.map((template) => {
                  const buttonLabel = template.available ? "使用模板" : template.unavailableReason ?? "暂不可用";

                  return (
                    <article aria-label={template.name} className="template-card" key={template.id}>
                      <div className="template-card-main">
                        <div>
                          <h4>{template.name}</h4>
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
                          disabled={actionsDisabled || !template.available}
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
            </section>
          );
        })}
      </div>
    </div>
  );
}
