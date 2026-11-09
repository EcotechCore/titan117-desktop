// Phase 0: an empty window that proves the app builds and runs. The real
// layout (design.md 0.2) starts in phase 1.
function App(): React.JSX.Element {
  const { versions } = window.titan117

  return (
    <main className="empty">
      <h1>Titan117</h1>
      <p>The app runs. Agents arrive in phase 1.</p>
      <p className="versions">
        Electron {versions.electron} · Chromium {versions.chrome} · Node {versions.node}
      </p>
    </main>
  )
}

export default App
