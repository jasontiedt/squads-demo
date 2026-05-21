// Vitest setup — clears persistent + runtime state between tests so the
// session store and hash router don't leak across cases.

import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { useSession } from './store/session.js';

afterEach(() => {
  cleanup();
  localStorage.clear();
  // Reset the Zustand store to its initial shape.
  useSession.setState({
    games: {},
    pollState: 'idle',
    error: null,
    currentGameCode: null,
    currentGameState: null,
  });
  if (typeof window !== 'undefined') {
    window.location.hash = '';
  }
});
