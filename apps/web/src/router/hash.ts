// Tiny hash router. GitHub Pages serves static files only, so a hash-based
// router (`#/`, `#/g/ABCD12`) is the safest shape — no server rewrites needed.
//
// Two routes for #14:
//   `#/`            → Home (create or join a game)
//   `#/g/:code`     → Lobby for that gameCode
//
// Anything else falls back to Home. No router dependency required.

import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'lobby'; gameCode: string };

const LOBBY_PATTERN = /^\/g\/([A-Za-z0-9]{4,6})\/?$/;

export const parseHash = (rawHash: string): Route => {
  const path = rawHash.replace(/^#/, '') || '/';
  const m = LOBBY_PATTERN.exec(path);
  if (m) {
    const code = m[1];
    if (code) return { name: 'lobby', gameCode: code.toUpperCase() };
  }
  return { name: 'home' };
};

export const buildHash = (route: Route): string => {
  if (route.name === 'home') return '#/';
  return `#/g/${route.gameCode}`;
};

export const useHashRoute = (): Route => {
  const [route, setRoute] = useState<Route>(() =>
    parseHash(typeof window !== 'undefined' ? window.location.hash : ''),
  );
  useEffect(() => {
    const onChange = (): void => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    // Pick up any hash set between initial render and effect mount.
    onChange();
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
};

export const navigate = (route: Route): void => {
  window.location.hash = buildHash(route).slice(1); // strip leading '#'
};
