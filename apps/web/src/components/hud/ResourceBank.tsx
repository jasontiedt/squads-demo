// ─────────────────────────── Resource bank ─────────────────────────
//
// Read-only chip strip showing a player's Main resource tokens by kind
// (food / wood / gold / wild). Exhausted tokens are styled dimmer than
// fresh ones; the chip's title attribute breaks the count down so
// hover-inspection still answers "how many usable food do I have?".
//
// Cost-paying lands in MVP-5; this is presentation-only.

import { useEffect, useRef, useState } from 'react';

import type { Player, ResourceKind, ResourceToken } from '@eoe/schema';

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

const groupResources = (
  resources: ResourceBankPlayer['resources'],
): Record<ResourceKind, ResourceToken[]> => {
  const out: Record<ResourceKind, ResourceToken[]> = {
    food: [],
    wood: [],
    gold: [],
    wild: [],
  };
  for (const token of resources) {
    out[token.kind].push(token);
  }
  return out;
};

export const ResourceBank = ({
  player,
  label,
}: ResourceBankProps): JSX.Element => {
  const resourcesByKind = groupResources(player.resources);
  const heading = label ?? `Seat ${player.seat}`;
  const previousExhaustion = useRef<ReadonlyMap<string, boolean>>(new Map());
  const [refreshedTokenIds, setRefreshedTokenIds] = useState<ReadonlySet<string>>(
    new Set(),
  );

  useEffect(() => {
    const nextExhaustion = new Map<string, boolean>();
    const refreshed = new Set<string>();

    for (const token of player.resources) {
      nextExhaustion.set(token.id, token.exhausted);
      if (previousExhaustion.current.get(token.id) === true && !token.exhausted) {
        refreshed.add(token.id);
      }
    }

    previousExhaustion.current = nextExhaustion;
    setRefreshedTokenIds(refreshed);

    if (refreshed.size === 0) return undefined;

    const clearRefresh = window.setTimeout(() => {
      setRefreshedTokenIds(new Set());
    }, 400);

    return () => {
      window.clearTimeout(clearRefresh);
    };
  }, [player.resources]);

  return (
    <div
      data-testid={`resource-bank-${player.seat}`}
      data-seat={player.seat}
      className="resource-bank"
      aria-label={`${heading} resource bank`}
    >
      <span className="resource-bank-heading">{heading}</span>
      <ul className="resource-bank-tokens" role="list">
        {RESOURCE_ORDER.map((kind) => {
          const tokens = resourcesByKind[kind];
          return tokens.map((token, idx) => {
            const title = `${RESOURCE_LABEL[kind]} — ${token.exhausted ? 'exhausted' : 'ready'}`;
            const isRefreshed = refreshedTokenIds.has(token.id);
            return (
              <li
                key={token.id}
                data-testid={`resource-${kind}-${idx}`}
                data-resource-id={token.id}
                data-seat={player.seat}
                data-kind={kind}
                data-exhausted={token.exhausted ? 'true' : 'false'}
                className={`resource-token resource-token-${kind}${token.exhausted ? ' resource-token-exhausted' : ''}${isRefreshed ? ' resource-token-refreshed' : ''}`}
                title={title}
              >
                <span className="resource-token-glyph" aria-hidden="true">
                  {RESOURCE_GLYPH[kind]}
                </span>
                <span className="visually-hidden">{title}</span>
              </li>
            );
          });
        })}
      </ul>
    </div>
  );
};
