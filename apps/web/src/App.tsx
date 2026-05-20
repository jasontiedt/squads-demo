export function App() {
  const apiBase = import.meta.env.VITE_API_BASE;
  return (
    <main>
      <h1>Echoes of Emperors — MVP-1 scaffold</h1>
      <p>
        API base: <code>{apiBase}</code>
      </p>
      <p>Lando wires up the real UI shell next.</p>
    </main>
  );
}
