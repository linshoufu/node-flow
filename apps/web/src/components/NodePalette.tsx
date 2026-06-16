import type { NodeType } from "../types";

type NodePaletteProps = {
  nodeTypes: NodeType[];
  onAddNode: (nodeType: NodeType) => void;
};

export function NodePalette({ nodeTypes, onAddNode }: NodePaletteProps) {
  const categories = groupByCategory(nodeTypes);

  return (
    <aside className="panel palette-panel" aria-label="Node palette">
      <div className="panel-heading">
        <h2>Nodes</h2>
        <span>{nodeTypes.length}</span>
      </div>
      <div className="palette-groups">
        {categories.map(([category, items]) => (
          <section className="palette-group" key={category}>
            <h3>{category}</h3>
            <div className="palette-list">
              {items.map((nodeType) => (
                <button className="palette-node" key={nodeType.id} type="button" onClick={() => onAddNode(nodeType)}>
                  <span>{nodeType.name}</span>
                  <small>{nodeType.id}</small>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </aside>
  );
}

function groupByCategory(nodeTypes: NodeType[]): Array<[string, NodeType[]]> {
  const groups = new Map<string, NodeType[]>();

  for (const nodeType of nodeTypes) {
    const category = nodeType.category || "Other";
    groups.set(category, [...(groups.get(category) ?? []), nodeType]);
  }

  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
}
