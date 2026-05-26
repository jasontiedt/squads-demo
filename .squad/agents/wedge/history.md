# Project Context

- **Owner:** Jason T
- **Project:** squads-demo — virtual boardgame on GitHub Pages, turn-based multiplayer, image-rich (maps/units/cards), rules driven by text docs
- **Stack:** TS + Vite + React 18 + Zustand (web) · Cloudflare Workers + KV (api) · Zod shared schemas · pnpm workspaces · Vitest
- **Created:** 2026-05-20

## Learnings

<!-- Append new learnings below. Pre-MVP-5 entries archived to history-archive.md on 2025-11-21. -->

## Synopsis (pre-2025-11-21) — see history-archive.md for verbose entries

- **Locked architecture (MVP-1):** GH Pages frontend + Cloudflare Workers + KV backend (no realtime; polling 5s/30s/60s tiered). Anonymous `gameCode` + per-player `playerToken`; worker stores `tokenHash`. Pure-TS `applyAction(state, action, actorId)` in `/packages/rules` is the single source of truth, imported by client (instant feedback) and worker (authoritative — worker verdict wins). Optimistic concurrency via `version` field. Repo layout: `apps/{web,worker}` + `packages/{schema,rules,assets-meta}`. 2 players normal, up to 4 max.
- **MVP-1 scaffold landed:** pnpm workspaces, root `tsconfig.base.json` (strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`), Vite `base: '/squads-demo/'` (must match repo name + Pages workflow), CORS via `env.ALLOWED_ORIGINS`. GH Pages workflow: pnpm + Node 20 + `actions/upload-pages-artifact@v3` → `deploy-pages@v4`.
- **Rulebook synthesis:** 4-phase turn (Start → Mobilization → Deployment → End). Card categories: Unit, Technology (4 sub-types), Tactic, Upgrade, Action, Reaction, Event. Buildings (Camp/Barracks/Capital) are tokens, not cards. Map: 3×3 tiles × 2×2 squares = 6×6 playable. Win = capital→0 OR all-units-eliminated. Hand cap 7, draw to 5. Per-token resources with exhausted/unexhausted state. 10 ambiguities pinned for `needs-confirmation` tests.
- **MVP-3 (PRs #59–#66):** DeployUnit, Scout, Attack, Capital init, Win condition handlers shipped. Byzantines civ data + 20-card stub convention pinned.
- **MVP-4 "Playable Board" (PRs #74–#82):** Move handler, Capital-HP win, interactive board pickers (one selection state machine), HUD polish, capital-RFC #69 (PR #74 — pinned `CapitalInstance.tileId` + `siegeState`, kept `state.units` flat; helpers `unitsFor`/`unitsOnTile`/`capitalOf`/`tileOfSquare`). Pattern: denormalize fixed-at-init read-often data; never denormalize fields that mutate via card effects.
- **Cross-cutting lesson:** When MVP-N ship logs document "carry-forward," cross-check against `gh issue list --state closed` before propagating into MVP-(N+1). I once wrote #37 was MVP-4's blocker when it had already shipped MVP-2/3.
- **Inbox files need `git add -f`** — `.gitignore` blocks `.squad/decisions/inbox/`. For RFC PRs where the diff IS the file, force-add; Scribe's merge cleans up later.

### 2026-05-23 — MVP-5 scoping ("Cards Do Things")

- **Framing decision:** MVP-5's theme is the smallest possible move that makes a card affect game state beyond the generic discard-and-draw stub. Two card kinds — Action and Tactic — cover the stop condition. Technology, Upgrade, Reaction, Event stay deferred to MVP-6.
- **Critical-path bottleneck identified:** The Effect DSL has been the implicit blocker since MVP-1 — `effect: z.unknown()` was the right MVP-1 punt, but it's now blocked Lando's PlayCard UI (#37), forced Sabine to encode designer intent as prose `PLACEHOLDER:` strings, and left `PlayAction`/`PlayTactic` as `not_implemented` stubs in `applyAction.ts`. MVP-5 makes locking the DSL the FIRST slice (S1) because every other slice depends on it. Recommend timeboxed RFC to avoid analysis paralysis.
- **Verb set sized to existing catalog data, not theoretical maximum.** Picked 5 verbs (`draw`, `damage`, `heal-capital`, `gain-temporary-resource`, `buff-unit-stat`) because the 4 non-unit English cards plus 1-2 stop-condition needs cover them. Resisted adding `attach-keyword` (Upgrade), `class-wide-passive` (Technology), `trigger-on-event` (Reaction). Those wait for MVP-6 when the dispatcher pattern is proven.
- **`classFilter` on Target taxonomy is a known live issue.** Existing English cards ("Shield Wall" → infantry, "Longbow Mastery" → archers) use class as a target selector. S1 proposes adding `{ kind: 'units-by-class' }` to the locked Target union rather than asking Sabine to re-theme cards — fidelity-to-rulebook outweighs minimal-vocab here. Flagged for Brady.
- **Schema-breaking change blast radius is tiny right now.** Moving `effect: z.unknown()` → discriminated union invalidates KV cache + non-conforming catalog cards. Production has no live games, so this is a free move. Won't be free after MVP-6, which is a reason to do it now.
- **PlayCard generic stub gets deleted, not kept.** `playCard.ts` (the MVP-2 discard+draw handler) becomes orphan code once `PlayAction`/`PlayTactic` route through the dispatcher. Cleaner to remove it (and the `PlayCard` action variant) than keep two parallel paths. Flagged for Brady confirmation.
- **Cost-payment isolated as its own slice (S2) deliberately.** `payCost` is the second never-implemented primitive (after the dispatcher). Pulling it out as a 1-PR slice lets Artoo land it in parallel with the S1 RFC. After S2, every effect handler has cost-payment as a primitive — no copy-paste cost logic per verb.
- **Worker hand-unredact (#37) included in MVP-5 as S6.** Carried over from MVP-4. Independent of the DSL work — can ship in parallel. Without it, the two-browser stop condition is unreachable because the human can't see their own hand.
- **Decision artifact:** `.squad/decisions/inbox/wedge-mvp5-scope.md` (status: Proposed) — pending Brady review.

### 2025-11-21 — MVP-5 shipped

MVP-5 ("Cards Do Things") shipped. The locks held:
- **5-verb Effect DSL** (`draw`, `damage`, `heal-capital`, `gain-temporary-resource`, `buff-unit-stat`) survived contact with real catalog data and the dispatcher pattern.
- **Units-by-class taxonomy default** on `Target` carried forward from RFC #69 — `classFilter` handled "Shield Wall" (infantry) and "Longbow Mastery" (archers) cleanly, no card re-theming needed.
- **Generic `PlayCard` deleted.** No vestigial parallel path. `PlayAction`/`PlayTactic` are the only routes through the dispatcher.
- **Reactions / Events / Technology / Upgrade deferred to MVP-6** as scoped.

**Next:** MVP-6 scope kickoff. Likely candidates: Reactions (trigger taxonomy + opponent-window state), Events (≤3 active + persistent effects), Technology (class-wide passive buffs), Upgrade (attach-to-unit keyword effects), card-play UI (Lando, non-unit cards), admin seed endpoint for deterministic e2e (Cassian carry-over). The dispatcher pattern is proven — adding verbs is now mechanical, which should help size MVP-6 honestly.
