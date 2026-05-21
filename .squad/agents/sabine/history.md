# Project Context

- **Owner:** Jason T
- **Project:** squads-demo — virtual boardgame on GitHub Pages, turn-based multiplayer, image-rich (maps/units/cards), rules driven by text docs
- **Stack:** TBD — asset pipeline format and design tokens approach pending early decisions
- **Created:** 2026-05-20

## Learnings

<!-- Append new learnings below. -->

### 2026-05-21: English MVP card subset (issue #10, PR #26)

**Shipped:** 6 unit cards (Watchman, Billman, Welsh Infantry, Longbowman, Esquire, English Knight) in `packages/assets-meta/data/english.json`. Loader case added, 11 new vitest tests, all 17 assets-meta + 204 schema tests green.

**Stat-bar decoding (HIGH confidence):** Order is **melee / health / ranged** top-to-bottom in the OCR text columns. Derived by inter-card comparison — Longbowman ARCHER reads 0/2/3 (longbows have no melee), Welsh INFANTRY-ARCHER reads 3/3/2 (spear+bow hybrid), Esquire CAVALRY reads 2/5/0 (light cav, no ranged). Movement is the leading number on the class band ("2 INFANTRY" = 2 movement points + INFANTRY class). All 6 units show movement 2.

**Cost decoding (LOW confidence — flagged):** OCR extracts cost icons as bare numbers without resource-type identification because the PDF's vertical cost-icon column collapses in text extraction. Total cost per card encoded as `{ wild: <sum> }` so each card parses against `ResourceKind`, and every card carries a `cost.breakdown` entry in `_meta.needs_confirmation` (10 flags total across the 6 cards). Watchman especially uncertain — STARTING SCOUT label may imply free / pre-deployed.

**Per-card confidence:**

| Card | Cost (best-effort) | Melee | Health | Ranged | Keywords | Notes |
|------|-------------------|-------|--------|--------|----------|-------|
| Watchman | wild:1 | 1 | 4 | 0 | starting-scout | Has an unmodeled `Action: Replace camp -> barracks`; flavor-only in MVP-1 data |
| Billman | wild:3 | 2 | 4 | 0 | melee-armor-1 | OCR shows 1+1+1 |
| Welsh Infantry | wild:3 | 3 | 3 | 2 | — | Dual class `infantry,archer` |
| Longbowman | wild:4 | 0 | 2 | 3 | long-range | OCR shows 2+2 |
| Esquire | wild:3 | 2 | 5 | 0 | charge-2 | OCR shows 2+1 |
| English Knight | wild:7 | 4 | 7 | 0 | charge-2, armor-2 | OCR shows 3+4 |

**Recommendation for #17 OCR scope (in priority order):**

1. **Cost resource breakdown** — highest-value verification. Every English card has flagged cost. The OCR pass needs to read the cost-icon column with its resource-type glyphs (wood / food / gold / wild / and possibly flexible-symbol). Without this, no card costs are canonical.
2. **Civ-card stats / abilities** — Anglo-Normans (English civ card) was bundled in the same OCR column as Watchman; the partial extract conflated rows. A clean re-OCR would unambiguously separate the civ card text from Watchman's stats.
3. **Keyword vocabulary normalization** — keywords like `charge-2`, `armor-2`, `melee-armor-1`, `long-range`, `starting-scout` are currently free-form strings. Wedge's `artoo-card-effect-typing.md` note will eventually define a typed keyword DSL; coordinating with #17 lets the OCR pass capture every keyword variant the rulebook uses, not just the 5 I extracted here.
4. **Watchman's Action effect** — `Action: Replace a surrounding camp of yours with a barracks` is recorded as flavor only because the unit schema has no effect payload. If the schema ever grows a unit-attached action hook, this is the canonical example.
5. **Welsh Infantry dual-class semantics** — hybrid `infantry,archer` is modeled as an array; the rules engine will eventually need to define union vs intersection semantics for class-gated effects.

**Deviation from issue path (documented in PR #26):** Issue #10 specified `packages/rules/src/cards/english/<cardId>.ts` side-effect registration files. Did NOT create them, per the loader-shape decision from #11 — rules/cards is reserved for behavior, and MVP-1 unit cards have no resolved effect payload yet. Data-only landing avoids a refactor when the effect handler shape locks.

**Image strategy:** No binary `.png` files in this PR. `apps/web/public/cards/english/README.md` documents expected filenames so future card-art ingest is drop-in.

**Worktree gotcha:** The worktree at `c:/GitRepos/squads-demo-10` had a junction for root `node_modules` but per-package `node_modules` were empty. Had to manually `mklink /J` `packages/{assets-meta,schema}/node_modules` to the main checkout. If we keep using worktree-local strategy, a heartbeat helper that creates these junctions on worktree init would save 5 minutes per worktree.
