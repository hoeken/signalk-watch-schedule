import { useState } from "react";
import { getTeamColor, BUILTIN_SYSTEMS } from "@core/index.js";

// The built-in rotations bound how many teams a watch can schedule (2–5).
const MIN_TEAMS = Math.min(...BUILTIN_SYSTEMS.map((s) => s.teamCount));
const MAX_TEAMS = Math.max(...BUILTIN_SYSTEMS.map((s) => s.teamCount));

/** Move the item at `from` to `to`, returning a new array. */
function move(arr, from, to) {
  const next = arr.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * Editable list of watch teams for the next watch: position 0 is first on
 * watch, the rest follow in order. Names are edited inline, teams can be added
 * and removed (within the 2–5 the rotations support), and rows reorder by
 * dragging the grip on the desktop or with the ▲/▼ buttons on touch screens
 * and via the keyboard (HTML5 drag does not work there — and this runs on
 * phones at the nav station).
 *
 * `teams` is the ordered team list itself; every edit calls `onChange` with a
 * new list. Team color follows the on-watch position, matching the schedule.
 */
export default function TeamEditor({ teams, onChange, disabled }) {
  const [dragFrom, setDragFrom] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  // Rows are only draggable while the grip is pressed — a draggable row would
  // otherwise hijack text selection inside the name inputs.
  const [armed, setArmed] = useState(null);

  const reorder = (from, to) => {
    if (from == null || to < 0 || to >= teams.length || from === to)
      return;
    onChange(move(teams, from, to));
  };
  const rename = (pos, name) => onChange(teams.map((t, i) => (i === pos ? { ...t, name } : t)));
  const remove = (pos) => onChange(teams.filter((_, i) => i !== pos));
  const add = () => onChange([...teams, { name: `Team ${teams.length + 1}` }]);

  const canRemove = teams.length > MIN_TEAMS;
  const canAdd = teams.length < MAX_TEAMS;

  const endDrag = () => {
    setDragFrom(null);
    setDragOver(null);
    setArmed(null);
  };

  return (
    <>
      <ul className="team-order">
        {teams.map((team, pos) => {
          const color = getTeamColor(pos);
          const dragging = dragFrom === pos;
          const over = dragOver === pos && dragFrom != null && dragFrom !== pos;
          return (
            <li
              key={pos}
              className={`team-order__item${dragging ? " is-dragging" : ""}${over ? " is-over" : ""}`}
              style={{ borderLeftColor: color }}
              draggable={!disabled && armed === pos}
              onPointerUp={() => setArmed(null)}
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
              <span
                className="team-order__handle"
                aria-hidden="true"
                onPointerDown={() => !disabled && setArmed(pos)}
              />
              <span className="team-order__num" style={{ color }}>{pos + 1}</span>
              <input
                className="team-order__name-input"
                style={{ color }}
                type="text"
                value={team.name}
                placeholder={`Team ${pos + 1}`}
                aria-label={`Team ${pos + 1} name`}
                onChange={(e) => rename(pos, e.target.value)}
                disabled={disabled}
              />
              <span className="team-order__moves">
                <button
                  type="button"
                  className="team-order__btn"
                  aria-label={`Move ${team.name || "team"} earlier`}
                  onClick={() => reorder(pos, pos - 1)}
                  disabled={disabled || pos === 0}
                >
                  ▲
                </button>
                <button
                  type="button"
                  className="team-order__btn"
                  aria-label={`Move ${team.name || "team"} later`}
                  onClick={() => reorder(pos, pos + 1)}
                  disabled={disabled || pos === teams.length - 1}
                >
                  ▼
                </button>
              </span>
              <button
                type="button"
                className="team-order__btn team-order__remove"
                aria-label={`Remove ${team.name || "team"}`}
                onClick={() => remove(pos)}
                disabled={disabled || !canRemove}
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>
      <button type="button" className="team-order__add" onClick={add} disabled={disabled || !canAdd}>
        + Add team
      </button>
    </>
  );
}
