import { test, expect, type Page, type BrowserContext } from '@playwright/test';

/**
 * MVP-1 finale (issue #16): two-browser create → join → play → handoff.
 *
 * Scenario:
 *   1. Host (context A) creates a game as English, name "Host".
 *      App routes to `/lobby/<6-char-code>`.
 *   2. Guest (context B) joins the same code as Byzantines, name "Guest".
 *      Both views become visible.
 *   3. Host clicks End phase 3× (start → mobilization → deployment → end)
 *      then End turn. Each click bumps the server `version`.
 *   4. Within ~3s the Guest's 2s poll picks up activePlayer=2 and turn=1.
 *   5. Guest takes their turn (3× End phase, then End turn).
 *   6. Within ~3s the Host sees activePlayer=1 and turn=2.
 *
 * All assertions use `expect.poll` or attribute auto-retry — no
 * arbitrary `setTimeout`/`sleep`. Polling tolerance is 3.5s to give
 * the 2s Lobby poller one full cycle of headroom.
 */

const POLL_BUDGET_MS = 3_500;

interface Player {
  context: BrowserContext;
  page: Page;
  label: 'host' | 'guest';
}

/** Wait for the Lobby's `data-version` attribute to reach `min`. */
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

/** Wait for the Lobby's `data-active-player` attribute to equal `seat`. */
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

/** Read the current numeric value of a `data-*` attribute on the lobby root. */
async function readNumericAttr(page: Page, attr: string): Promise<number> {
  const v = await page.locator('[data-testid="lobby"]').getAttribute(attr);
  return v === null ? -1 : Number(v);
}

/**
 * Click one of the action buttons and wait for the version counter to
 * advance by at least 1. The Lobby disables buttons while
 * `actionInFlight` is true, then re-enables once the POST returns —
 * which is also when the local state and `data-version` update.
 */
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

test.describe('MVP-1 two-browser multiplayer demo', () => {
  test('host creates, guest joins, both end turns and see the handoff', async ({ browser }) => {
    // Two isolated browser contexts → distinct localStorage, distinct
    // session tokens. This is the seat-1 / seat-2 split.
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    const host: Player = { context: hostCtx, page: await hostCtx.newPage(), label: 'host' };
    const guest: Player = { context: guestCtx, page: await guestCtx.newPage(), label: 'guest' };

    try {
      // ─── 1. Host creates a game ────────────────────────────────────
      await host.page.goto('/');
      await host.page.locator('[data-testid="tab-create"]').click();
      await host.page.locator('[data-testid="create-name"]').fill('Host');
      await host.page.locator('[data-testid="create-civ"]').selectOption('english');
      await host.page.locator('[data-testid="create-submit"]').click();

      // Hash route lands on /g/<6-char base32 code>.
      // Hash changes are same-document; waitForURL doesn't fire,
      // so poll the URL directly.
      await expect
        .poll(() => host.page.url(), { timeout: 15_000 })
        .toMatch(/#\/g\/[A-Z2-9]{6}/);
      const hashMatch = /#\/g\/([A-Z2-9]{6})/.exec(host.page.url());
      expect(hashMatch, 'lobby hash should contain a 6-char gameCode').not.toBeNull();
      const gameCode = hashMatch![1]!;

      await expect(host.page.locator('[data-testid="game-code"]')).toHaveText(`Game ${gameCode}`);
      await expect(host.page.locator('[data-testid="lobby"]')).toHaveAttribute('data-seat', '1');

      // First server version after create (1 player seated) is v1.
      await waitForVersion(host.page, 1);

      // ─── 2. Guest joins the same game ──────────────────────────────
      await guest.page.goto('/');
      await guest.page.locator('[data-testid="tab-join"]').click();
      await guest.page.locator('[data-testid="join-code"]').fill(gameCode);
      await guest.page.locator('[data-testid="join-name"]').fill('Guest');
      await guest.page.locator('[data-testid="join-civ"]').selectOption('byzantines');
      await guest.page.locator('[data-testid="join-submit"]').click();

      await expect
        .poll(() => guest.page.url(), { timeout: 15_000 })
        .toMatch(new RegExp(`#/g/${gameCode}`));
      await expect(guest.page.locator('[data-testid="game-code"]')).toHaveText(`Game ${gameCode}`);
      await expect(guest.page.locator('[data-testid="lobby"]')).toHaveAttribute('data-seat', '2');

      // Join bumps server version. Both clients should observe v >= 2
      // within one poll cycle. Host learns about the second player via
      // the 2s GET poll, not a push notification.
      await waitForVersion(host.page, 2);
      await waitForVersion(guest.page, 2);

      // Sanity: it's the host's turn first.
      await waitForActivePlayer(host.page, 1);
      await waitForActivePlayer(guest.page, 1);
      await expect(host.page.locator('[data-testid="lobby"]')).toHaveAttribute('data-your-turn', 'true');
      await expect(guest.page.locator('[data-testid="lobby"]')).toHaveAttribute('data-your-turn', 'false');
      await expect(host.page.locator('[data-testid="turn"]')).toHaveText('1');

      // ─── 3. Host plays turn 1 ──────────────────────────────────────
      const versionBeforeHostTurn = await readNumericAttr(host.page, 'data-version');
      await takeTurn(host.page);
      const versionAfterHostTurn = await readNumericAttr(host.page, 'data-version');
      // 3 EndPhase + 1 EndTurn = 4 server actions = +4 versions.
      expect(versionAfterHostTurn).toBeGreaterThanOrEqual(versionBeforeHostTurn + 4);

      // ─── 4. Guest sees handoff within ~3s ──────────────────────────
      await waitForActivePlayer(guest.page, 2);
      await expect(guest.page.locator('[data-testid="lobby"]')).toHaveAttribute(
        'data-your-turn',
        'true',
        { timeout: POLL_BUDGET_MS },
      );
      // Phase wraps back to 'start' on EndTurn.
      await expect(guest.page.locator('[data-testid="phase"]')).toHaveText('start', {
        timeout: POLL_BUDGET_MS,
      });
      // Host now sees it's no longer their turn.
      await waitForActivePlayer(host.page, 2);
      await expect(host.page.locator('[data-testid="lobby"]')).toHaveAttribute(
        'data-your-turn',
        'false',
        { timeout: POLL_BUDGET_MS },
      );

      // ─── 5. Guest plays turn 1 (their first turn) ──────────────────
      const versionBeforeGuestTurn = await readNumericAttr(guest.page, 'data-version');
      await takeTurn(guest.page);
      const versionAfterGuestTurn = await readNumericAttr(guest.page, 'data-version');
      expect(versionAfterGuestTurn).toBeGreaterThanOrEqual(versionBeforeGuestTurn + 4);

      // ─── 6. Host sees handoff back, turn counter advances to 2 ─────
      await waitForActivePlayer(host.page, 1);
      await expect(host.page.locator('[data-testid="lobby"]')).toHaveAttribute(
        'data-your-turn',
        'true',
        { timeout: POLL_BUDGET_MS },
      );
      await expect(host.page.locator('[data-testid="turn"]')).toHaveText('2', {
        timeout: POLL_BUDGET_MS,
      });
      await expect(guest.page.locator('[data-testid="turn"]')).toHaveText('2', {
        timeout: POLL_BUDGET_MS,
      });
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });
});
