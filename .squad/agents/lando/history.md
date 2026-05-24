# Project Context

- **Owner:** Jason T
- **Project:** squads-demo — virtual boardgame on GitHub Pages, turn-based multiplayer, image-rich (maps/units/cards), rules driven by text docs
- **Stack:** TBD — frontend framework and tooling are pending Wedge's architecture decision
- **Created:** 2026-05-20

## Learnings

<!-- Append new learnings below. -->

### 2026-11-22 — Issue #14: Web shell + token persistence (PR opened)
- **Routing:** Chose **hash router** (custom `src/router/hash.ts`) over react-router. Two routes only (`#/`, `#/g/:code`), GH Pages compatible without SPA fallback gymnastics, zero new deps. `Route` is a discriminated union `{name:'home'}|{name:'lobby',gameCode}`. `useHashRoute()` subscribes to `hashchange`. Reconciled issue body (offered hash OR react-router) with task spec (preferred state) by going state-y under the hood — store drives membership, hash drives view.
- **Store shape (`apps/web/src/store/session.ts`):** Zustand + `persist` middleware. Persisted slice = `{games: Record<gameCode, GameMembership>}` where `GameMembership = {playerToken, seat, civ, name}`. Runtime fields (`pollState`, `error`, `currentGameCode`, `currentGameState`) deliberately NOT persisted — `partialize` strips them. Keep in mind: full `GameState` is heavy and stale on reload; only membership tokens go to disk. Persist key = `eoe:active-game`, version = 1, both exported as named consts so tests can assert on them.
- **API contract (`apps/web/src/api/client.ts`):** `GameApi` interface with `createGame({name, civ})`, `joinGame({gameCode, name, civ})`, `getGame({gameCode, playerToken})`. Each method returns `{gameId, gameCode, playerToken, seat, state}`. Errors are `ApiError(code, status, message)` — discriminated by string `code` ('invalid_name' | 'unauthorized' | 'not_implemented' | etc). `MockGameApi` is the default in `App.tsx`; `RealGameApi` is a stub that throws `not_implemented` on every method (placeholder until #13 wires up `fetch` to the Worker). Injected via React context (`GameApiProvider` + `useGameApi`) so tests can swap implementations without prop drilling.
- **Mock behavior:** Auto-generates `STUB01`, `STUB02`, … via internal counter. `MockGameApiOptions.nextGameCode` lets tests pin a deterministic code (consumed once). Tokens padded to 40 chars to satisfy `PlayerToken` schema (min 32). `placeholderState()` returns minimal valid `GameState` using `Seed.parse(\`stub-seed-${gameId}\`)` for a proper branded value — no `as` casts.
- **Home view:** Two-tab UI (Create/Join) using `aria-selected` + visible only on active. CreateForm: name + civ (default 'english'). JoinForm: gameCode + name + civ (default 'byzantines'). gameCode input auto-uppercases on change. Validation lives in `src/lib/validation.ts` (4-6 alphanumeric for gameCode, ≤32 chars + non-empty for name). On success: write membership to store, set currentGame, navigate to `#/g/{code}`. On `ApiError`: set `pollState='error'` with message.
- **Lobby view:** Reads `selectMembership(state, gameCode)`. If no membership → alert + "Back to home" button. If membership exists but `currentGameState` is null or for a different code → fires `api.getGame(...)` once on mount (rehydrate path after reload). Shows seat/civ/phase/activePlayer/turn (with "your turn" indicator) + a placeholder div ("Game UI lands in #15"). Leave button calls `leaveGame(code)` + `navigate({name:'home'})`.
- **App.tsx auto-route on reload:** On mount, if hash is empty/`#`/`#/` and `Object.keys(games)[0]` exists, navigate to that lobby. This is the persistence payoff — refresh the page and you're back in your game.
- **Tests (39 across 6 files):** hash router (parse/build), validation rules, session store (set/persist/rehydrate via `useSession.persist.rehydrate()`/leave/select), Home form (tab switching, validation rejection, create success with pinned `nextGameCode`, API error path), Lobby (membership display, missing-membership alert, leave clears state, rehydrate via getGame), API stubs (Mock auto-counter, override-once, joinGame seat-2 assignment, getGame token lookup, unauthorized throw, empty-name reject; Real throws on all methods + strips trailing slashes from baseUrl).
- **Strict-mode discipline:** Zero `!` non-null assertions in tests. Used `getByLabelText` helpers + `setInput(label, val)` wrapper. Zero `any`. `useGameApi()` throws if used outside provider so the type is non-nullable downstream.
- **What #13 needs to do:** Replace `MockGameApi` default in `App.tsx` (or wrap with env toggle) and flesh out `RealGameApi` to `POST /api/game/create`, `POST /api/game/join`, `GET /api/game/:code` per Wedge's locked architecture. Token persistence + UI shell are ready — just swap the implementation.

### 2026-05-23 — MVP-4 contributions

- **PR #80 (#71 interactive board surface):** rendered the 6×6 tiled board, unit + building sprites positioned by `Coord`, click-to-select wiring tied into the session store. Server-validated action dispatch through the existing `GameApi`. Silent-success recovery on first spawn — coordinator finished commit + push + PR from worktree.
- **PR #81 (#72 HUD):** turn / phase indicators, active-player badge, per-seat capital HP readouts. Reads `state.players[i].capitalHp` directly — will refactor to read `state.buildings[].damage` once the MVP-5 capital-RFC lands.
- Carry-forward: PlayCard UI (#37) still blocked on the worker `?seat=X` unredact contract.

