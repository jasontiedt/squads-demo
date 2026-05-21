// React context for injecting the GameApi implementation. Tests pass a
// MockGameApi (or a custom stub); production wires either MockGameApi
// (default for #14) or RealGameApi once #13 lands.

import { createContext, useContext, type ReactNode } from 'react';
import type { GameApi } from './client.js';

const GameApiContext = createContext<GameApi | null>(null);

export interface GameApiProviderProps {
  api: GameApi;
  children: ReactNode;
}

export const GameApiProvider = ({
  api,
  children,
}: GameApiProviderProps): JSX.Element => (
  <GameApiContext.Provider value={api}>{children}</GameApiContext.Provider>
);

export const useGameApi = (): GameApi => {
  const api = useContext(GameApiContext);
  if (!api) {
    throw new Error(
      'useGameApi must be used inside <GameApiProvider>. ' +
        'Did you forget to wrap your tree?',
    );
  }
  return api;
};
