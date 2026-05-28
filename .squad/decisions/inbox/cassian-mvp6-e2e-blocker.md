# Cassian — MVP-6 reaction-arc e2e blocker (issue #103 part B)

Status: **blocked, PR opened anyway for review**
Date: 2026-05-27

## Where the spec gets to

The two-browser e2e in `apps/e2e/tests/mvp6-reaction-arc.spec.ts` reliably executes:

1. Host creates an English game via `[data-testid="tab-create"]` flow.
2. Guest joins as Byzantines via `[data-testid="tab-join"]` flow.
3. `POST /admin/games/:code/seed` with `X-Admin-Secret: test-admin-secret` returns 200
   and both clients pick up the new version. Admin seed accepts deterministic
   `hostDeck` / `guestDeck` arrays and the new `byz-imperial-shield` fixture card
   loads successfully.
4. Phase advances to `deployment`.
5. Host clicks `[data-testid="card-eng-welsh-infantry"]`, the deploy-legal cells
   light up, and clicking a cell with `data-target-legal="true"` registers
   (the `[data-testid^="target-legal-*"]` overlay rect has `pointer-events:none`,
   so the right click target is the underlying `cell-{x}-{y}` with
   `data-target-legal="true"`).

## What blocks

After the deploy click, the spec waits for `locator('[data-testid^="unit-"]')`
to appear and times out at 5s. Either:

- The deployed unit element uses a different `data-testid` prefix than `unit-`, or
- The deploy action isn't actually applying (need to check Worker logs / version bump).

Need a board-component DOM walk to find the actual unit testid pattern.
Recommend Sabine confirm what `data-testid` the deployed Welsh Infantry exposes
on the board SVG/HTML.

## Decisions pinned for future tests

- **Admin seed endpoint**: `POST /admin/games/:code/seed` with header
  `X-Admin-Secret: <secret>`, body `{ hostDeck: string[], guestDeck: string[] }`,
  returns `{ ok: true, version: number }`. **Verified working.**
- **Wrangler dev test config**: pass `--var ADMIN_SECRET:test-admin-secret` so
  Playwright can sign admin requests with a known secret.
- **Fixture card**: `byz-imperial-shield` (reaction, cost `{ wild: 1 }`, trigger
  `on-damage-dealt`, effect `heal-capital amount:2 target:self`) is an invented
  fixture, **not** a canonical Byzantine card. Marked `_needsConfirmation` in
  `byzantines.json` so historians can flag for removal/replacement once a real
  reaction card exists.
- **Legal-target click target**: target the cell with `data-target-legal="true"`,
  not the overlay rect with `data-testid^="target-legal-"` — overlay has
  `pointer-events:none`.

## Recommended follow-up

1. Sabine: document the deployed-unit DOM testid in `.squad/decisions.md`.
2. Cassian: once the unit testid is confirmed, this spec should pass to the
   attack+reaction step with no other changes.
3. Coordinator: keep PR in draft until the unit-testid follow-up lands.
