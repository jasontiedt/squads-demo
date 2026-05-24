import { test, expect, type Page, type BrowserContext } from '@playwright/test';

/**
 * Issue #72: two-browser playable arc.
 *
 * BASELINE SCOPE (this commit):
 *   Drives multiple full rounds of turn handoff (host → guest → host …)
 *   through the real Worker, asserting that the version counter, active
 *   player, turn counter, and `data-your-turn` flag stay in lockstep
 *   across both browser contexts for 4+ rounds. This proves the
 *   multiplayer plumbing is stable end-to-end and provides a fixture
 *   that future iterations can extend to drive damage-to-winner.
 *
 * TODO (issue #72 acceptance — pending richer test fixtures):
 *   Drive deploys + attacks until a capital's `capital-hp-{seat}`
 *   `data-pct` reaches 0, then assert both pages render
 *   `winner-banner` with the correct `data-outcome`. Doing this
 *   reliably in <30s requires either a server-side "starter units"
 *   fixture or a deterministic deploy-order helper — both out of
 *   scope for the baseline.
 *
 * No hard waits: every wait is an `expect.poll` or attribute
 * auto-retry. Target runtime ≤30s.
 */

const POLL_BUDGET_MS = 3_500;

interface Player {
  context: BrowserContext;
  page: Page;
  label: 'host' | 'guest';
}

async function waitForVersion(page: Page, min: number): Promise<void> {
  await expect
    .poll(
      async () => {
        const v = await page.locator('[data-testid="lobby"]').getAttribute('data-version');
        return v === null ? -1 : Number(v);
      },
      { timeout: POLL_BUDGET_MS, message: `version >= ${min}` },
    )
    .toBeGreaterThanOrEqual(min);
}

async function waitForActivePlayer(page: Page, seat: number): Promise<void> {
  await expect
    .poll(
      async () => {
        const v = await page.locator('[data-testid="lobby"]').getAttribute('data-active-player');
        return v === null ? 0 : Number(v);
      },
      { timeout: POLL_BUDGET_MS, message: `active player == ${seat}` },
    )
    .toBe(seat);
}

async function readNumericAttr(page: Page, attr: string): Promise<number> {
  const v = await page.locator('[data-testid="lobby"]').getAttribute(attr);
  return v === null ? -1 : Number(v);
}

async function clickAndAdvance(page: Page, testid: 'end-phase-btn' | 'end-turn-btn'): Promise<void> {
  const before = await readNumericAttr(page, 'data-version');
  const btn = page.locator(`[data-testid="${testid}"]`);
  await expect(btn).toBeEnabled();
  await btn.click();
  await waitForVersion(page, before + 1);
}

/** Drive one full turn for the currently-active player: 3× End phase + End turn. */
async function takeTurn(page: Page): Promise<void> {
  await clickAndAdvance(page, 'end-phase-btn'); // start → mobilization
  await clickAndAdvance(page, 'end-phase-btn'); // mobilization → deployment
  await clickAndAdvance(page, 'end-phase-btn'); // deployment → end
  await clickAndAdvance(page, 'end-turn-btn'); // rotates seat & resets phase
}

test.describe('Two-browser playable arc (issue #72)', () => {
  test('host and guest alternate turns through multiple rounds with consistent state', async ({
    browser,
  }) => {
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    const host: Player = { context: hostCtx, page: await hostCtx.newPage(), label: 'host' };
    const guest: Player = { context: guestCtx, page: await guestCtx.newPage(), label: 'guest' };

    try {
      // ─── Host creates ──────────────────────────────────────────────
      await host.page.goto('/');
      await host.page.locator('[data-testid="tab-create"]').click();
      await host.page.locator('[data-testid="create-name"]').fill('Host');
      await host.page.locator('[data-testid="create-civ"]').selectOption('english');
      await host.page.locator('[data-testid="create-submit"]').click();

      await expect
        .poll(() => host.page.url(), { timeout: 15_000 })
        .toMatch(/#\/g\/[A-Z2-9]{6}/);
      const hashMatch = /#\/g\/([A-Z2-9]{6})/.exec(host.page.url());
      expect(hashMatch).not.toBeNull();
      const gameCode = hashMatch![1]!;
      await waitForVersion(host.page, 1);

      // ─── Guest joins ───────────────────────────────────────────────
      await guest.page.goto('/');
      await guest.page.locator('[data-testid="tab-join"]').click();
      await guest.page.locator('[data-testid="join-code"]').fill(gameCode);
      await guest.page.locator('[data-testid="join-name"]').fill('Guest');
      await guest.page.locator('[data-testid="join-civ"]').selectOption('byzantines');
      await guest.page.locator('[data-testid="join-submit"]').click();

      await expect
        .poll(() => guest.page.url(), { timeout: 15_000 })
        .toMatch(new RegExp(`#/g/${gameCode}`));
      await waitForVersion(host.page, 2);
      await waitForVersion(guest.page, 2);

      await waitForActivePlayer(host.page, 1);
      await waitForActivePlayer(guest.page, 1);

      // ─── Drive 4 full rounds (8 turns total) ───────────────────────
      // Round = host turn + guest turn. After round N, both pages
      // should observe turn counter = N + 1 (turn starts at 1, then
      // each EndTurn after the SECOND player increments it).
      const ROUNDS = 4;

      for (let round = 1; round <= ROUNDS; round++) {
        // Host plays
        await waitForActivePlayer(host.page, 1);
        await expect(host.page.locator('[data-testid="lobby"]')).toHaveAttribute(
          'data-your-turn',
          'true',
          { timeout: POLL_BUDGET_MS },
        );
        const vBefore = await readNumericAttr(host.page, 'data-version');
        await takeTurn(host.page);
        const vAfter = await readNumericAttr(host.page, 'data-version');
        expect(vAfter, `round ${round} host: +4 versions`).toBeGreaterThanOrEqual(vBefore + 4);

        // Handoff visible to guest
        await waitForActivePlayer(guest.page, 2);
        await expect(guest.page.locator('[data-testid="lobby"]')).toHaveAttribute(
          'data-your-turn',
          'true',
          { timeout: POLL_BUDGET_MS },
        );

        // Guest plays
        const gBefore = await readNumericAttr(guest.page, 'data-version');
        await takeTurn(guest.page);
        const gAfter = await readNumericAttr(guest.page, 'data-version');
        expect(gAfter, `round ${round} guest: +4 versions`).toBeGreaterThanOrEqual(gBefore + 4);

        // Handoff back to host, turn counter advanced
        await waitForActivePlayer(host.page, 1);
        const expectedTurn = String(round + 1);
        await expect(host.page.locator('[data-testid="turn"]')).toHaveText(expectedTurn, {
          timeout: POLL_BUDGET_MS,
        });
        await expect(guest.page.locator('[data-testid="turn"]')).toHaveText(expectedTurn, {
          timeout: POLL_BUDGET_MS,
        });
      }

      // Final sanity: both pages agree on phase=start at top of host's next turn.
      await expect(host.page.locator('[data-testid="phase"]')).toHaveText('start', {
        timeout: POLL_BUDGET_MS,
      });
      await expect(guest.page.locator('[data-testid="phase"]')).toHaveText('start', {
        timeout: POLL_BUDGET_MS,
      });
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });
});
