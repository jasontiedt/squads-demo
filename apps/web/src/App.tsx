import { useEffect } from 'react';
import { GameApiProvider } from './api/context.js';
import { MockGameApi } from './api/mock.js';
import { RealGameApi } from './api/real.js';
import type { GameApi } from './api/client.js';
import { Home } from './views/Home.js';
import { Lobby } from './views/Lobby.js';
import { useHashRoute, navigate } from './router/hash.js';
import { useSession } from './store/session.js';

// Pick the API at module load.
//
// Precedence:
//   `VITE_WORKER_URL`  — primary, set by deployment env.
//   `VITE_API_BASE`    — legacy alias kept for vite.config compatibility.
//   `http://localhost:8787` — local `wrangler dev` default.
//
// In dev (`import.meta.env.DEV`) we keep the in-memory `MockGameApi` so
// the web shell runs without `wrangler dev`. Production builds always
// hit the real worker.
//
// Tests inject their own GameApi via the `App` `api` prop and bypass
// this entirely.

const env = import.meta.env as Record<string, string | undefined>;
const workerUrl =
  env.VITE_WORKER_URL ?? env.VITE_API_BASE ?? 'http://localhost:8787';

const defaultApi: GameApi = import.meta.env.PROD
  ? new RealGameApi(workerUrl)
  : new MockGameApi();

export interface AppProps {
  /**
   * Test-only injection of a GameApi. Production callers should not pass this;
   * the env-selected default implementation is used.
   */
  api?: GameApi;
}

export const App = ({ api = defaultApi }: AppProps): JSX.Element => {
  const route = useHashRoute();
  const games = useSession((s) => s.games);

  // On first paint, if no hash is set but we have a persisted membership,
  // auto-route to the most recent game's lobby. Keeps reload-to-where-you-were
  // working without a backend round-trip.
  useEffect(() => {
    const h = window.location.hash;
    if (h && h !== '#' && h !== '#/') return;
    const first = Object.keys(games)[0];
    if (first) navigate({ name: 'lobby', gameCode: first });
    // We deliberately run only on initial mount, not on every games change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <GameApiProvider api={api}>
      {route.name === 'lobby' ? (
        <Lobby gameCode={route.gameCode} />
      ) : (
        <Home />
      )}
    </GameApiProvider>
  );
};
