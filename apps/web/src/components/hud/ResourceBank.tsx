// ─────────────────────────── Resource bank ─────────────────────────
//
// Read-only chip strip showing a player's Main resource tokens by kind
// (food / wood / gold / wild). Exhausted tokens are styled dimmer than
// fresh ones; the chip's title attribute breaks the count down so
// hover-inspection still answers "how many usable food do I have?".
//
// Cost-paying lands in MVP-5; this is presentation-only.

import type { Player, ResourceKind } from '@eoe/schema';

/** Wire shape — the redacted Player from the API. */
type ResourceBankPlayer = Pick<Player, 'seat' | 'resources'>;

export interface ResourceBankProps {
  player: ResourceBankPlayer;
  /** Optional label override — defaults to "Seat {seat}". */
  label?: string;
}

/** Display order — keep stable so the strip doesn't reshuffle. */
const RESOURCE_ORDER: readonly ResourceKind[] = [
  'food',
  'wood',
  'gold',
  'wild',
] as const;

/** Single-letter icon placeholder; SVG icons can replace this later. */
const RESOURCE_GLYPH: Record<ResourceKind, string> = {
  food: 'F',
  wood: 'W',
  gold: 'G',
  wild: '*',
};

const RESOURCE_LABEL: Record<ResourceKind, string> = {
  food: 'Food',
  wood: 'Wood',
  gold: 'Gold',
  wild: 'Wild',
};

interface ResourceTally {
  total: number;
  fresh: number;
  exhausted: number;
}

const emptyTally = (): ResourceTally => ({
  total: 0,
  fresh: 0,
  exhausted: 0,
});

const tallyResources = (
  resources: ResourceBankPlayer['resources'],
): Record<ResourceKind, ResourceTally> => {
  const out: Record<ResourceKind, ResourceTally> = {
    food: emptyTally(),
    wood: emptyTally(),
    gold: emptyTally(),
    wild: emptyTally(),
  };
  for (const token of resources) {
    const tally = out[token.kind];
    tally.total += 1;
    if (token.exhausted) tally.exhausted += 1;
    else tally.fresh += 1;
  }
  return out;
};

export const ResourceBank = ({
  player,
  label,
}: ResourceBankProps): JSX.Element => {
  const tallies = tallyResources(player.resources);
  const heading = label ?? `Seat ${player.seat}`;

  return (
    <div
      data-testid={`resource-bank-${player.seat}`}
      data-seat={player.seat}
      className="resource-bank"
      aria-label={`${heading} resource bank`}
    >
      <span className="resource-bank-heading">{heading}</span>
      <ul className="resource-bank-chips" role="list">
        {RESOURCE_ORDER.map((kind) => {
          const tally = tallies[kind];
          const title = `${RESOURCE_LABEL[kind]} — ${tally.fresh} fresh, ${tally.exhausted} exhausted`;
          return (
            <li
              key={kind}
              data-testid={`resource-chip-${player.seat}-${kind}`}
              data-kind={kind}
              data-total={tally.total}
              data-fresh={tally.fresh}
              data-exhausted={tally.exhausted}
              className={`resource-chip resource-chip-${kind}${tally.total === 0 ? ' resource-chip-empty' : ''}`}
              title={title}
            >
              <span className="resource-chip-glyph" aria-hidden="true">
                {RESOURCE_GLYPH[kind]}
              </span>
              <span className="resource-chip-count">{tally.total}</span>
              <span className="visually-hidden">{title}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
