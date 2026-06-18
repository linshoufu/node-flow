import type { NodeType } from "../types";

type NodePaletteProps = {
  nodeTypes: NodeType[];
  onAddNode: (nodeType: NodeType) => void;
};

export function NodePalette({ nodeTypes, onAddNode }: NodePaletteProps) {
  const categories = groupByCategory(nodeTypes);

  return (
    <aside className="panel palette-panel" aria-label="节点库">
      <div className="panel-heading">
        <div>
          <h2>节点库</h2>
          <p>拖拽或点击添加到当前画布</p>
        </div>
        <span>{nodeTypes.length} 个</span>
      </div>
      <div className="palette-groups">
        {categories.map(([category, items]) => (
          <section className="palette-group" key={category}>
            <h3>{category}</h3>
            <div className="palette-list">
              {items.map((nodeType) => (
                <button
                  className="palette-node"
                  draggable
                  key={nodeType.id}
                  type="button"
                  onClick={() => onAddNode(nodeType)}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "copy";
                    event.dataTransfer.setData("application/node-flow-node-type", nodeType.id);
                    event.dataTransfer.setData("text/plain", nodeType.id);
                  }}
                >
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
    const category = nodeType.category || "其他";
    groups.set(category, [...(groups.get(category) ?? []), nodeType]);
  }

  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
}
