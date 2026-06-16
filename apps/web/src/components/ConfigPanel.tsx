import type { JsonSchema, NodeType, WorkflowNode } from "../types";

type ConfigPanelProps = {
  node?: WorkflowNode;
  nodeType?: NodeType;
  onConfigChange: (nodeId: string, key: string, value: unknown) => void;
};

export function ConfigPanel({ node, nodeType, onConfigChange }: ConfigPanelProps) {
  const properties = nodeType?.configSchema.properties ?? {};
  const entries = Object.entries(properties);

  return (
    <aside className="panel config-panel" aria-label="Config panel">
      <div className="panel-heading">
        <h2>Config</h2>
        {nodeType ? <span>{nodeType.category}</span> : null}
      </div>

      {!node || !nodeType ? (
        <p className="empty-state">Select a node to edit its settings.</p>
      ) : (
        <div className="config-content">
          <div className="selected-node">
            <strong>{nodeType.name}</strong>
            <small>{node.id}</small>
          </div>

          {entries.length === 0 ? (
            <p className="empty-state">No configurable fields.</p>
          ) : (
            <form className="field-list">
              {entries.map(([key, schema]) => (
                <SchemaField
                  key={key}
                  name={key}
                  schema={schema}
                  value={node.config[key]}
                  onChange={(value) => onConfigChange(node.id, key, value)}
                />
              ))}
            </form>
          )}
        </div>
      )}
    </aside>
  );
}

type SchemaFieldProps = {
  name: string;
  schema: JsonSchema;
  value: unknown;
  onChange: (value: unknown) => void;
};

function SchemaField({ name, schema, value, onChange }: SchemaFieldProps) {
  const label = schema.title || name;
  const schemaType = Array.isArray(schema.type) ? schema.type.find((type) => type !== "null") : schema.type;

  if (schema.enum?.length) {
    const selectedIndex = Math.max(
      0,
      schema.enum.findIndex((option) => Object.is(option, value))
    );

    return (
      <label className="field">
        <span>{label}</span>
        <select
          value={String(selectedIndex)}
          onChange={(event) => onChange(schema.enum?.[Number(event.currentTarget.value)] ?? schema.enum?.[0])}
        >
          {schema.enum.map((option, index) => (
            <option key={`${String(option)}-${index}`} value={String(index)}>
              {String(option)}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (schemaType === "boolean") {
    return (
      <label className="field field-checkbox">
        <input checked={Boolean(value)} type="checkbox" onChange={(event) => onChange(event.currentTarget.checked)} />
        <span>{label}</span>
      </label>
    );
  }

  if (schemaType === "number" || schemaType === "integer") {
    return (
      <label className="field">
        <span>{label}</span>
        <input
          step={schemaType === "integer" ? 1 : "any"}
          type="number"
          value={typeof value === "number" ? value : 0}
          onChange={(event) => {
            const nextValue = event.currentTarget.value;
            onChange(schemaType === "integer" ? Number.parseInt(nextValue || "0", 10) : Number(nextValue || 0));
          }}
        />
      </label>
    );
  }

  return (
    <label className="field">
      <span>{label}</span>
      <input value={String(value ?? "")} type="text" onChange={(event) => onChange(event.currentTarget.value)} />
    </label>
  );
}
