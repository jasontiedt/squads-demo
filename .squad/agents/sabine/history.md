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

### 2026-05-21: OCR ingest pipeline shipped (issue #17, PR #29)

**Shipped:** Pure-JS OCR pipeline at `scripts/ocr-pdf.mjs` using `tesseract.js` v7 + `pdf-to-png-converter` v3 (no Poppler/Tesseract CLI, no system deps). Scripts: `pnpm ocr:pdf <file.pdf>` (single) and `pnpm ocr:all` (Byzantines + Constantinople + StartingTiles). Output schema per page: `{ page, text, confidence, words: [{ text, bbox, confidence }] }` → `documentation/ocr/<basename>.ocr.json`. Full write-up in `documentation/ocr/REPORT.md`.

**Per-source confidence (text extraction):**

| Source | Pages | Avg conf | Verdict |
|--------|-------|----------|---------|
| Byzantines_Base_EN | 4 | ~47% | Names + flavor + ability text recoverable. Numeric costs/stats and resource icons NOT extractable. |
| Constantinople | 4 | ~32% | Mostly tile artwork. Not suitable for auto-ingest. |
| StartingTiles | 1 | ~28% | OCR hallucination on iconography. Manual transcription required. |

**Byzantines OCR identified units:** Optimatoi (1pt cost, cavalry/villager hybrid?), Skoutatoi, Stratiotai, Varangian Guard. Cost/stat numbers visible but unreliable — confirm by eyeball before backfilling `byzantines.json`.

**English `_needsConfirmation` flags NOT resolved by this PR.** `English_Base_EN.pdf` was not OCR'd in this batch (likely also image-only). 10 flags from PR #26 remain open in `english.json`. Recommended follow-up issue: run `pnpm ocr:pdf documentation/English_Base_EN.pdf` and resolve the 10 flags from the output.

**Windows quirk handled:** `pdf-to-png-converter` v3 / `pdfjs-dist` v5 expect forward-slash paths. Script monkey-patches `normalizePath` via `require.cache` lookup to convert backslashes. If pipeline breaks on a future Node/pdfjs version, check that patch first.

**Asset hygiene:** `eng.traineddata` (~5MB) is auto-downloaded by tesseract.js on first run. Added `eng.traineddata` + `*.traineddata` to `.gitignore`. Never commit it.

**Follow-up issues recommended (in REPORT.md):**
1. OCR pass on `English_Base_EN.pdf` → resolve the 10 `needs_confirmation` flags.
2. Data-only PR: backfill `byzantines.json` (4 units recoverable, numbers need eyeball-verification).
3. Manual transcription for `StartingTiles.pdf` (OCR unusable).
4. Manual transcription for `Constantinople.pdf` (tile descriptions).
5. Optional: bump `viewportScale` in the script to test if Byzantines confidence becomes auto-ingestable.

**Tests:** schema 204/204, rules 94/94 (+14 skipped), assets-meta 17/17, worker 4/4. `apps/web` config failed to load in worktree due to missing node_modules junction (env quirk, no apps/web changes in this PR).

## 2025-01-XX — Issue #35: Static board view shipped

**What I built:** `apps/web/src/components/board/Board.tsx` — SVG renderer for the polled `PublicGameState`. 6×6 square grid, terrain-colored cells, unit/building overlays, tile borders drawn with heavier stroke on the 2×2 grid lines. Wired into `Lobby.tsx` replacing the `board-placeholder` section. 6 new Vitest component tests, all 64 web tests green, Vite build clean (221 KB JS, 1.87 KB CSS).

**Key call: squares, not hexes.** Issue copy said "hex/region" but the engine model is a 6×6 square grid (`Coord{x,y}∈0..5`). Rendering hexes would have added a coord-translation layer that disagrees with the schema, rules engine, and the click-to-target work coming in #37. Wrote this up in `.squad/decisions/inbox/sabine-board-squares-over-hex.md`.

**Data contract found:** `PublicGameState.map.tiles[]` is the source of truth — `assets-meta` has card data only, not map data. Tiles are 2×2 with `faceDown` flag; the renderer skips face-down tiles and draws an "unrevealed" fill for any square without a revealed tile. This also means `placeholderState` (empty `tiles: []`) renders cleanly as a blank 6×6 grid — important because `Lobby` shows that state briefly during rehydrate.

**Null guard at Lobby, not Board.** `Lobby` derives `state` as `PublicGameState | null` (null during rehydrate). Tightened to `{state && <Board state={state} />}` rather than make `Board` accept null — keeps `Board`'s contract clean and matches the existing null-check pattern used for `state?.version` etc. elsewhere in Lobby.

**Test-id contract for #37:** `data-testid="board"` on the root, `data-testid="region-{x}-{y}"` on every cell (all 36 always present, even unrevealed), `data-testid="unit-{id}"` and `data-testid="building-{id}"` on overlays. The click pipeline in #37 can attach directly — no coord math, no hit testing.

**Seat colors picked:** seat 1 red `#d94f4f`, seat 2 blue `#4f9ed9`, seat 3 amber `#d9b94f`, seat 4 violet `#a44fd9`. Exhausted units render at 0.55 opacity. Terrain palette: muted, calm, dark-mode-friendly. If Sabine-the-designer wants to repaint these later, the palettes are isolated as `TERRAIN_FILL` and `SEAT_COLOR` constants at the top of `Board.tsx`.

### 2026-05-22 — #58: Byzantines 20-card stub deck (MVP-3)

**Shipped:** `packages/assets-meta/data/byzantines.json` expanded from 2 placeholders to 20 stub cards mirroring the English deck shape from #41. Tests rewritten (14 cases in `byzantines.test.ts`) to assert the new shape — schema parse, civ tagging, kind diversity (unit/action/tactic/upgrade/technology/event), archer ranged > 0, persistent events flag. assets-meta 26/26, schema 206/206 green.

**Pattern reused from #41:**
- `_meta.summary` + `stub_status.{themed_stubs, generic_stubs}` listing all card IDs by category (analogous to `real_from_ocr` / `playtest_stubs` for English).
- Every card carries a per-card `_needsConfirmation.stub` block with a one-line rationale and a "refine in #17" pointer.
- Top-level `_meta.needs_confirmation[]` array of `{card, field, note}` so a single grep yields the full #17 TODO surface (the test suite enforces every entry references a real card id, and that all 20 ids are present — i.e. ALL byzantine cards are stubs).
- Cost convention: encode every cost as `wild` since Byzantines OCR (#17, 47% confidence) couldn't extract resource-type icons either.

**Themes chosen (6 themed stubs):**
- `byz-cataphract` — UNIT, heavy cavalry. Stat-line intentionally mirrors English Knight (4/7 melee/health) so the two MVP-3 civs have comparable apex units for playtest.
- `byz-varangian-guard` — UNIT, elite mercenary infantry (4/5, armor-1 + elite).
- `byz-strategos` — ACTION (general's rally). Chose action over unit so the deck has at least one leadership-flavored action card distinct from a unit.
- `byz-greek-fire` — TACTIC (deployment-phase combat, 2 dmg ignoring armor). The rulebook may class greek-fire as naval-only or persistent — flagged.
- `byz-basileus` — EVENT (persistent, capital +1 gold/turn). Modelled as event rather than unit/upgrade since "emperor's reign" reads as a global persistent effect.
- `byz-tagmata` — UNIT, mid-tier elite infantry slotting between Skoutatoi (basic) and Varangian Guard (apex).

**Generic 14 distribution:** 7 units (skoutatoi/stratiotai/optimatoi/toxotai/akritai/dromon/pronoiar) + 2 actions (themata-muster=draw 2, imperial-courier=scry 3) + 2 tactics (fortified-line=+2 health, naval-blockade=skip move) + 1 upgrade (lamellar-armor, infantry/cavalry only mirroring English plate-armor) + 1 technology (cataphract-doctrine, subType 'A' placeholder) + 1 event (purple-born-heir, persistent cost reduction).

**Schema coverage:** Byzantines deck exercises 6 of 8 Card kinds (unit, action, tactic, upgrade, technology, event). Reaction and civilization kinds not represented — civilization cards never sit in a deck per the schema header (they're set up on the Unit Field), and reaction is an MVP-1 schema-only stub the rules engine doesn't resolve yet.

**Dromon naval flag:** Used `class: ['naval']` + `movement.pattern: 'long'` for the warship card. Both are guesses — the schema accepts any string in `class[]` and `pattern` is enum 'short'|'long' so this parses, but confirm in #17 whether naval is a first-class unit class with rules-engine semantics or a thematic-only tag.

**Loader wiring:** No change needed. `src/index.ts` already had `case 'byzantines'` returning `byzantinesData` — the JSON file swap is transparent to the loader.

**Worktree state:** worktree-local strategy at `c:/GitRepos/squads-demo-58`, junctions present (root + per-package node_modules) from the heartbeat helper.
