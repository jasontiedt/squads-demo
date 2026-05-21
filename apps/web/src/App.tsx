import { useEffect } from 'react';
import { GameApiProvider } from './api/context.js';
import { MockGameApi } from './api/mock.js';
import type { GameApi } from './api/client.js';
import { Home } from './views/Home.js';
import { Lobby } from './views/Lobby.js';
import { useHashRoute, navigate } from './router/hash.js';
import { useSession } from './store/session.js';

// Default API for #14. Issue #13 swaps this for `new RealGameApi(VITE_API_BASE)`.
const defaultApi = new MockGameApi();

export interface AppProps {
  /**
   * Test-only injection of a GameApi. Production callers should not pass this;
   * the default Mock implementation is used.
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
