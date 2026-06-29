import { useState } from 'react';
import { getTeamColor } from '@core/index.js';

/** Move the item at `from` to `to`, returning a new array. */
function move(arr, from, to) {
  const next = arr.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * Reorderable list of watch teams: position 0 is first on watch, the rest
 * follow in order. Rows are draggable on the desktop; the ▲/▼ buttons make
 * reordering work on touch screens and via the keyboard too (HTML5 drag does
 * not — and this runs on phones at the nav station).
 *
 * `order` is a permutation of indices into `teams`; `onReorder` receives the new
 * permutation. Team color follows the on-watch position, matching the schedule.
 */
export default function TeamOrderList({ teams, order, onReorder, disabled }) {
  const [dragFrom, setDragFrom] = useState(null);
  const [dragOver, setDragOver] = useState(null);

  const reorder = (from, to) => {
    if (from == null || to < 0 || to >= order.length || from === to) return;
    onReorder(move(order, from, to));
  };

  const endDrag = () => {
    setDragFrom(null);
    setDragOver(null);
  };

  return (
    <ul className="team-order">
      {order.map((teamIndex, pos) => {
        const team = teams[teamIndex];
        const color = getTeamColor(pos);
        const crew = team?.crew?.length ? team.crew.join(', ') : 'No crew assigned';
        const dragging = dragFrom === pos;
        const over = dragOver === pos && dragFrom != null && dragFrom !== pos;
        return (
          <li
            key={teamIndex}
            className={`team-order__item${dragging ? ' is-dragging' : ''}${over ? ' is-over' : ''}`}
            style={{ borderLeftColor: color }}
            draggable={!disabled}
            onDragStart={() => setDragFrom(pos)}
            onDragEnter={() => setDragOver(pos)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              reorder(dragFrom, pos);
              endDrag();
            }}
            onDragEnd={endDrag}
          >
            <span className="team-order__handle" aria-hidden="true">⠿</span>
            <span className="team-order__num" style={{ color }}>{pos + 1}</span>
            <span className="team-order__body">
              <span className="team-order__name" style={{ color }}>
                {team?.name ?? `Team ${teamIndex + 1}`}
              </span>
              <span className="team-order__crew">{crew}</span>
            </span>
            <span className="team-order__moves">
              <button
                type="button"
                className="team-order__btn"
                aria-label={`Move ${team?.name ?? 'team'} earlier`}
                onClick={() => reorder(pos, pos - 1)}
                disabled={disabled || pos === 0}
              >
                ▲
              </button>
              <button
                type="button"
                className="team-order__btn"
                aria-label={`Move ${team?.name ?? 'team'} later`}
                onClick={() => reorder(pos, pos + 1)}
                disabled={disabled || pos === order.length - 1}
              >
                ▼
              </button>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
