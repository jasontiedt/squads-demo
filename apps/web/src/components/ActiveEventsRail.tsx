/**
 * ActiveEventsRail — MVP-6 S6 (issue #102).
 *
 * Renders a rail of active event chips for a single player. Lobby
 * mounts two: one above the board (opponents) and one below (the
 * viewing seat). Each chip shows the card's display name and its
 * `ticksRemaining` (counter only — the eventTick reducer in the
 * rules engine owns the actual countdown + expiry).
 *
 * Per state.ts `Player.activeEvents` is capped at length 3; we still
 * call `slice(0, 3)` defensively so a hand-crafted state never blows
 * out the layout.
 */
import type { JSX } from 'react';
import type { ActiveEvent, Civ, Seat } from '@eoe/schema';
import { loadCivMeta } from '@eoe/assets-meta';

export interface ActiveEventsRailProps {
  seat: Seat;
  civ: Civ;
  activeEvents: ReadonlyArray<ActiveEvent>;
  /** Layout / a11y hint — "Opponent" rail vs "Your" rail. */
  label: string;
  position: 'top' | 'bottom';
}

const MAX_VISIBLE = 3;

export const ActiveEventsRail = ({
  seat,
  civ,
  activeEvents,
  label,
  position,
}: ActiveEventsRailProps): JSX.Element | null => {
  if (activeEvents.length === 0) return null;
  const catalog = loadCivMeta(civ);
  const visible = activeEvents.slice(0, MAX_VISIBLE);

  return (
    <section
      className={`active-events-rail active-events-rail-${position}`}
      aria-label={`${label} — active events`}
      data-testid={`active-events-rail-${seat}`}
      data-seat={seat}
      data-position={position}
    >
      <span className="active-events-rail-label">{label}</span>
      <ul className="active-events-list" role="list">
        {visible.map((ev, idx) => {
          const card = catalog.find((c) => c.id === ev.cardId);
          const name = card?.name ?? ev.cardId;
          return (
            <li
              key={`${ev.cardId}-${idx}`}
              className="active-event-chip"
              data-testid={`active-event-${seat}-${ev.cardId}`}
              data-ticks-remaining={ev.ticksRemaining}
            >
              <span className="active-event-name">{name}</span>
              <span
                className="active-event-ticks"
                aria-label={`${ev.ticksRemaining} ticks remaining`}
              >
                {ev.ticksRemaining}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
