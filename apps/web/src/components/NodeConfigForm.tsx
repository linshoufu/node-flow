import type { ReactNode } from "react";
import { isNodeFormVisible, resolveNodeForm } from "../lib/nodeForm";
import type { JsonSchema, NodeFormField, NodeType, WorkflowNode } from "../types";

type NodeConfigFormProps = {
  node: WorkflowNode;
  nodeType: NodeType;
  renderField: (key: string, schema: JsonSchema, field?: NodeFormField) => ReactNode;
};

export function NodeConfigForm({ node, nodeType, renderField }: NodeConfigFormProps) {
  const properties = nodeType.configSchema.properties ?? {};
  const resolvedForm = resolveNodeForm(nodeType.form, nodeType.configSchema);

  if (!resolvedForm) {
    return (
      <form aria-label="配置字段" className="field-list" onSubmit={(event) => event.preventDefault()}>
        {nodeType.form ? <p className="form-contract-fallback">节点表单描述无效，已使用通用配置表单。</p> : null}
        {Object.entries(properties).map(([key, schema]) => renderField(key, schema))}
      </form>
    );
  }

  return (
    <form aria-label="配置字段" className="field-list node-config-form" onSubmit={(event) => event.preventDefault()}>
      {resolvedForm.groups
        .filter((group) => isNodeFormVisible(group.visibleWhen, node.config))
        .map((group) => {
          const visibleFields = group.fields.filter((field) => isNodeFormVisible(field.visibleWhen, node.config));
          if (visibleFields.length === 0) {
            return null;
          }
          return (
            <fieldset className="node-config-group" key={group.id}>
              <legend>{group.label}</legend>
              {group.description ? <p>{group.description}</p> : null}
              {visibleFields.map((field) => renderField(field.key, properties[field.key], field))}
            </fieldset>
          );
        })}
      {resolvedForm.fallbackFieldKeys.length > 0 ? (
        <fieldset className="node-config-group node-config-group-fallback">
          <legend>其他参数</legend>
          {resolvedForm.fallbackFieldKeys.map((key) => renderField(key, properties[key]))}
        </fieldset>
      ) : null}
    </form>
  );
}
