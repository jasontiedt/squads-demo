# @eoe/rules

Pure-TS rules engine for Echoes of Emperors. Exports a single deterministic entry point:

```ts
applyAction(state: GameState, action: Action, actorId: Seat): Result<GameState>
```

The package is **pure**: no I/O, no `Math.random`, seeded RNG only. Used by both `apps/web` (advisory) and `apps/worker` (authoritative).

## Tests

```
pnpm --filter @eoe/rules test
```

- `applyAction.test.ts` — phase-machine transitions (EndPhase / EndTurn).
- `phases.test.ts` — table-driven phase-gate exhaustiveness.
- `needs-confirmation.test.ts` — **see below**.

## Pinned ambiguities (needs-confirmation)

`needs-confirmation.test.ts` pins every rulebook ambiguity flagged in `.squad/decisions.md` (originally `wedge-rulebook-synthesis.md`) as an `it.skip`-ed test. Each test:

1. Has a `// @needs-confirmation: <one-line question>` comment directly above the `it`.
2. Records a default interpretation in plain English on a `// Default:` line.
3. Asserts the EXPECTED post-resolution behavior so the test locks regression the moment it is un-skipped.

The current pinned list (10 ambiguities):

| # | Ambiguity | Default interpretation |
|---|-----------|------------------------|
| 1 | Reaction timing windows | Every top-level action opens ONE reaction window after gate-pass, before mutation. |
| 2 | "Two-effect" cards — per-play or per-game? | **Per-play.** Choice is made each time the card resolves. |
| 3 | King/Queen-attached unit discard | **Cannot be force-discarded** when the field is full. King/Queen exemption applies to the bearer at discard time. |
| 4 | Camp resource regeneration | **Refresh to 1 unexhausted token** at Start of Turn. Camps are not banks; tokens do not accumulate. |
| 5 | Scouting onto water | Unit moves back, **does NOT exhaust**. Tile orientation is still locked on reveal. |
| 6 | Upgrade stacking across units | Same upgrade card may attach to **two different units** simultaneously. The "no-double" rule scopes to one unit. |
| 7 | "Surrounding Capital" — diagonals? | **Yes, diagonals included** (Chebyshev distance 1, the 8 adjacent squares). |
| 8 | Melee mutual-kill — square occupancy | **Empty square.** Both units removed; attacker does not advance. |
| 9 | Long-Range diagonal vs Short-Range ban | **Long-Range bypasses the diagonal ban** at any distance (the ban is keyword-scoped, not range-scoped). |
| 10 | Deck-empty discard interactions | **Silent no-op.** Draw/mill from empty deck does nothing; no HP penalty; parent action still resolves. |

A live counter test asserts `NEEDS_CONFIRMATION_COUNT === 10` so CI flags drift (and the PR template can reference the count directly).

### Un-skip workflow

When Jason confirms an interpretation (or supplies a different answer):

1. **Capture the decision.** Write `.squad/decisions/inbox/cassian-ambiguity-N-<slug>.md` with:
   - The exact question (copy from `// @needs-confirmation:`).
   - Jason's answer.
   - The rulebook citation (page / section, if any) backing the answer.
   - The test that now locks the behavior.
2. **Un-skip the test.** Change `it.skip(...)` to `it(...)`. Tighten the assertion if the default needs adjusting to match the confirmed answer.
3. **Update the table above.** Replace the row's default with the confirmed interpretation. Bump or remove from the pinned-count constant (`NEEDS_CONFIRMATION_COUNT`) if the ambiguity is fully retired.
4. **If the underlying rule is not yet implemented,** leave the test live but expecting the current verdict (`not_implemented` for stubbed actions). Add a follow-up issue tagged `area:rules` for the handler work — the un-skipped test then becomes the acceptance criterion for that issue.
5. **Open a dedicated PR** for the confirmation. Do NOT bundle it with feature work — confirmations are decisions and need their own audit trail.

### Adding a new pinned ambiguity

When Cassian (or any agent) discovers a fresh ambiguity during implementation:

1. Add a `describe()` block to `needs-confirmation.test.ts` with the format above (`// @needs-confirmation:`, `// Default:`, assertion body).
2. Bump `NEEDS_CONFIRMATION_COUNT`.
3. Append a row to the table in this README.
4. **Do not fix the underlying rule in the same PR** — the ambiguity is the signal that the rule needs Jason's input first.
