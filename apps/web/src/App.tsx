export default function App() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-title">Node Flow</span>
          <span className="brand-subtitle">Workflow editor</span>
        </div>
      </header>
      <main className="workspace-grid">
        <aside className="panel panel-left" aria-label="Nodes panel">
          <h2>Nodes</h2>
        </aside>
        <section className="canvas-shell" aria-label="Canvas workspace">
          <h1>Canvas</h1>
        </section>
        <aside className="panel panel-right" aria-label="Config panel">
          <h2>Config</h2>
        </aside>
      </main>
    </div>
  );
}
