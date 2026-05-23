# Project Context

- **Owner:** Jason T
- **Project:** squads-demo — virtual boardgame on GitHub Pages, turn-based multiplayer, image-rich (maps/units/cards), rules driven by text docs
- **Stack:** TBD — frontend framework, build tooling, and turn-passing mechanism are open architecture decisions
- **Created:** 2026-05-20

## Learnings

<!-- Append new learnings below. -->

### 2026-05-20 — Multiplayer architecture assessment

- **GH Pages alone is insufficient** for multiplayer turn-passing. Static hosting = no server, no DB, no sockets. Git-as-DB hacks (commits/issues/gists) are fragile, rate-limited, and leak identity.
- **Recommended:** GH Pages frontend + Cloudflare Workers (free tier) + Workers KV for turn state. Async only, no realtime — correct shape for a turn-based card game.
- **Identity:** game-code + per-player token in localStorage. Defer GitHub OAuth.
- **Rejected:** pure git-as-DB (UX), Firebase/Supabase (heavier than needed), realtime/websockets (overkill).
- **Blocking questions for Jason:** player count (2 vs 4–6), identity model, spectator need, asset rights from echoesofemperors.com, rules-engine vs. trust-the-players.
- **Source material:** site is TCG/deck-builder shaped (7 civ decks: Byzantines, HRE, Mongols, Norsemen, Ottomans, Scots, English). Not hex-and-counter — that simplifies state schema considerably.

### 2026-05-20 — Architecture locked (MVP-1)

- **Stack locked:** TS + Vite + React 18 + Zustand frontend; Cloudflare Workers + Workers KV backend; Zod schemas shared; pnpm workspaces; Vitest; Wrangler.
- **Players:** 2 normal, up to 4 max per game.
- **Identity:** anonymous `gameCode` (6 chars) + per-player `playerToken` in `localStorage`. Worker stores `tokenHash` only. No GitHub login. Token loss = seat loss; recovery is post-MVP.
- **Rules engine:** full enforcement. Pure-TS `applyAction(state, action, actorId)` in `/packages/rules`, deterministic (seeded RNG from state). Imported by client (instant feedback) AND Worker (authoritative). Worker verdict wins.
- **Liveness:** polling. 5s active tab / 30s background (Page Visibility API) / 60s after 5min idle. "Your turn" toast + favicon dot.
- **Concurrency:** optimistic via `version` field on state; Worker rejects stale writes.
- **Repo layout:** `/apps/web`, `/apps/worker`, `/packages/{rules,schema,assets-meta}`, `/assets`, `/scripts`, `/tests`, `/docs`. Two deploy targets, one repo.
- **Assets:** Sabine ingests echoesofemperors.com → `/assets/{civ}/{type}/{name}.{ext}` + `/packages/assets-meta/{civ}.json`. Mirroring approved; attribution in `/assets/CREDITS.md`.
- **Civ pack for MVP-1:** English vs Byzantines (only English ingested in MVP-1; Byzantines stub).
- **MVP-1 scope:** join-by-code, opening hands, draw + play one card, "your turn" handoff. No combat, no win condition. Acceptance = two-browser handoff demo.
- **Team assignments (MVP-1):** Wedge (scaffold + deploy pipeline), Artoo (schema + rules skeleton + Worker), Lando (UI shell + polling hook), Sabine (English ingest), Cassian (Vitest harness + Miniflare integration).
- **Risks:** Cloudflare account/Wrangler setup blocks deploy; KV free-tier write limits (1k/ns/day — fine for turn-based, recheck for spectators); polling cost on idle tabs; rules ambiguity from source site (Cassian tests pin interpretations); CORS locked to GH Pages origin.
- **Decision artifact:** `.squad/decisions/inbox/wedge-multiplayer-architecture.md` (status: Locked) — original proposal preserved as "## History" for traceability.

### 2026-05-20 — MVP-1 scaffold landed

- **Layout:** pnpm workspaces; `apps/{web,worker}` + `packages/{schema,rules,assets-meta}`. Workspace versions wired via `workspace:*`.
- **TS config:** root `tsconfig.base.json` with `target ES2022`, `module ESNext`, `moduleResolution Bundler`, strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`. Each package extends base; `apps/worker` adds `@cloudflare/workers-types`; `apps/web` adds `vite/client` and `jsx: react-jsx`.
- **Versions pinned:** TypeScript ^5.6, Vite ^5.4, React ^18.3, Zustand ^5, Zod ^3.23, Vitest ^2.1, Wrangler ^3.78, miniflare ^3.
- **Vite base:** `apps/web/vite.config.ts` sets `base: '/squads-demo/'` — must match repo name AND the Pages workflow. Renaming the repo means updating both spots.
- **CORS:** Worker reads `env.ALLOWED_ORIGINS` (comma-separated) from `wrangler.toml [vars]` and `.dev.vars`. Default dev origin: `http://localhost:5173`.
- **KV:** namespace block in `wrangler.toml` is commented with TODO — Artoo runs `wrangler kv:namespace create GAMES` and uncomments.
- **Worker handlers:** stub for POST `/games`, 501 stubs for `/games/:id` and `/games/:id/actions`, OPTIONS preflight done. `applyAction` imported (`void`-referenced) so cross-package wiring is exercised by typecheck.
- **Rules engine:** `Result<T, E>` discriminated union, `applyAction` returns `{ ok: false, code: 'not_implemented' }`. Cards register via `import './cards/{civ}/{cardId}'` per the locked decision.
- **Tests landed:** Vitest smoke tests for rules (`applyAction` not_implemented) and worker (CORS preflight returns 204 with correct headers).
- **GH Pages workflow:** `.github/workflows/deploy-pages.yml` — pnpm + Node 20 + frozen lockfile + `pnpm -F @eoe/web build` → `actions/upload-pages-artifact@v3` from `apps/web/dist` → `actions/deploy-pages@v4`. Concurrency group `pages`.
- **Tooling:** ESLint (eslint:recommended + @typescript-eslint/recommended), Prettier (single quotes, semis, 100 col, trailing commas), `.editorconfig` (LF, 2-space).
- **`.gitignore`:** added `node_modules/`, `dist/`, `.wrangler/`, `coverage/`, `*.local`, `.env`/`.env.*` (with `!.env.example`), `.DS_Store`. Existing `.squad/` runtime ignores preserved.
- **Did NOT run:** `pnpm install`. User runs first.

### 2026-05-20 — Rulebook synthesis & MVP-1 backlog refinement

- **Rulebook extracted:** `documentation/Rulebook_EN.pdf` had embedded text — full extraction to `Rulebook_EN.txt` (444 lines). `English_Base_EN.pdf` partial extract confirms card data shape (cost, movement, melee, ranged, health, class, keywords, flavor). Byzantines/StartingTiles/Constantinople PDFs are image-only — no extractable text. Did NOT invent content for those.
- **Turn structure is 4 phases (not 3):** Start → Mobilization → Deployment → End. Tactics play in either Mob or Dep; Technologies only in Dep; Reactions on opponent's turn; Events persist.
- **Card categories richer than original sketch:** Unit, Technology (4 sub-types), Tactic, Upgrade, Action, Reaction, Event. Buildings (Camp/Barracks/Capital) are NOT cards — they're tokens placed by unit actions.
- **Map model:** 3×3 grid of TILES, each tile = 2×2 squares → effectively 6×6 playable squares. Tiles have orientation (revealed via Scouting). Engine speaks `(x, y)` squares + terrain; tile rotation is render metadata. Square terrains: plain, mountain, water, river, village, farmland, forest, mine, gold-double.
- **Win conditions:** capital→0 OR all-units-eliminated. Both must be checked.
- **Resource model is per-token, not just counts:** Main resources from Camps have exhausted/unexhausted state and a source camp; Temporary resources sit on specific cards with optional max capacity. This affects Zod schema design.
- **Hand cap = 7, draw to 5 (or +1 if ≥5). Deck does NOT reshuffle when empty.**
- **King/Queen pawns** are unique per game, give +1/+2, removable on death.
- **10 ambiguities pinned for `needs-confirmation` tests** — Reaction timing windows, "two-effect" cards, King/Queen-attached unit discard, Camp resource regeneration, Scouting-onto-water cost, upgrade stacking across units, "surrounding Capital" diagonal read, melee mutual-kill square ownership, Long-Range diagonal interaction with Short-Range, deck-empty discard interactions.
- **MVP-1 backlog refined:** original 9-issue plan replaced with ~14 smaller issues (preview only — issues NOT filed). Critical path: schema → applyAction skeleton → first card kind (unit deploy) → handoff demo. Card content beyond unit deploy is post-MVP-1.
- **Architecture refinements written** to `.squad/decisions/inbox/wedge-rulebook-synthesis.md`. Stack stays locked. Schema additions are additive, no breaking changes to the locked architecture.

### 2026-05-22 — MVP-3 shipped, MVP-4 priority pinned

- Issues #53–#58 closed via PRs #59–#66 (incl hotfix #63 and CI #64). HEAD `69255ca` on main.
- New @eoe/rules handlers landed: DeployUnit, Scout, Attack, Capital init, Win condition.
- Byzantines civ data shipped (Sabine, PR #60) — 20-card stub convention pinned for HRE/Mongols/Norsemen/Ottomans/Scots.
- **MVP-4 blocker:** Issue #37 (PlayCard UI) needs worker `?seat=X` unredact contract — owner needs to be set on the next handoff. See `lando-playcard-needs-worker-unredact` decision (now in decisions.md).
- **Open RFC obligations:** capital `tileId`/`siegeState`/per-player `units[]` model (Artoo flagged); handler vocabulary lock required before civ behavior modules ship.
