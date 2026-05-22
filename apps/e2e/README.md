# `@eoe/e2e` — end-to-end Playwright tests

Playwright drives **two Chromium browser contexts** (host + guest) against
a locally-running Worker + Web build to exercise the MVP-1 multiplayer
demo flow: create → join → end-phase → end-turn → handoff.

## What it covers

`tests/two-browser-handoff.spec.ts` is the **issue #16 scenario**:

1. Host (context A) creates a game as English.
2. Guest (context B) joins the 6-character code as Byzantines.
3. Host clicks **End phase** × 3 then **End turn** — server version bumps
   on every action, phase walks `start → mobilization → deployment → end`,
   then `EndTurn` rotates the active seat.
4. Within ~3 s (the Lobby polls `GET /games/:code` every 2 s) the Guest's
   view flips to *your turn* — `data-active-player="2"` and `data-your-turn="true"`.
5. Guest takes their turn the same way; Host sees it become their turn
   again and the turn counter advances to 2.

Assertions use `expect.poll` and attribute auto-retry — no arbitrary
`sleep`/`setTimeout`. Tolerance for the handoff visibility is **3.5 s**.

## How it runs

`playwright.config.ts` launches two local servers via `webServer`:

| Server | Port | Command | Why |
| --- | --- | --- | --- |
| Cloudflare Worker | 8787 | `wrangler dev --local` | Miniflare's in-memory KV — no Cloudflare account needed. |
| Web (prod build) | 5174 | `vite build && vite preview` | **Must be `vite preview`**, not `vite dev` — `App.tsx` only wires the real network API when `import.meta.env.PROD` is true. The dev server would hand back the in-memory mock. |

The web build is told to hit the local Worker via `VITE_WORKER_URL=http://localhost:8787`.
Because Vite is configured with `base: '/squads-demo/'` for GH Pages, the
test `baseURL` is `http://localhost:5174/squads-demo/`.

## Run it locally

From the repo root:

```sh
# One-time: install Playwright's Chromium binary
pnpm test:e2e:install

# Run the e2e suite
pnpm test:e2e
```

After a failed run, `pnpm --filter @eoe/e2e report` opens the HTML
report with traces and screenshots.

## CI

Default `pnpm test` does **not** run e2e — the package's runner script
is named `e2e` (not `test`), so `pnpm -r test` skips it. CI surfaces
(when added) should call `pnpm test:e2e:install` once per cache key and
`pnpm test:e2e` for the run.

`workers: 1` is intentional: the scenario is stateful (shared in-memory
KV in the local Worker), so parallel test files would race on the same
game-code space.

## Test hooks (production code)

The spec depends on a small surface of `data-testid` / `data-*` attributes
in `apps/web/src/views/{Home,Lobby}.tsx`. They're declarative, render
no UI of their own, and are exercised by the spec only — no production
logic was changed in the web app.

| Element | Hook | Purpose |
| --- | --- | --- |
| Create tab button | `data-testid="tab-create"` | Switch to create form. |
| Create form name input | `data-testid="create-name"` | Fill host name. |
| Create form civ select | `data-testid="create-civ"` | Pick English/Byzantines. |
| Create submit | `data-testid="create-submit"` | Submit create. |
| Join tab button | `data-testid="tab-join"` | Switch to join form. |
| Join form code/name/civ | `data-testid="join-{code,name,civ}"` | Fill join form. |
| Join submit | `data-testid="join-submit"` | Submit join. |
| Lobby root | `data-testid="lobby"` + `data-version`, `data-seat`, `data-active-player`, `data-your-turn` | Observe game state without scraping text. |
| Game code header | `data-testid="game-code"` | Verify routed game. |
| End phase button | `data-testid="end-phase-btn"` | Drive phase progression. |
| End turn button | `data-testid="end-turn-btn"` | Rotate active player. |

## Enabling fix: Worker KV namespace

`apps/worker/wrangler.toml` had the `[[kv_namespaces]]` block commented
out with a `TODO`. `wrangler dev` couldn't start without it. The block
is now uncommented with a placeholder `id` — Wrangler's local Miniflare
KV ignores the id at runtime. Before `wrangler deploy`, replace it with
the real namespace id from `wrangler kv:namespace create GAMES`.

No Worker source code changed.
