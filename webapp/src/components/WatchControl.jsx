import { formatClock } from '../time.js';

/**
 * Start/stop control for authenticated users. When idle, a system picker lets
 * the captain choose the rotation (the schedule preview updates live as they
 * change it). When on watch, shows the active system and a stop button.
 */
export default function WatchControl({
  onWatch,
  systems,
  system,
  startedAt,
  selectedSystemId,
  onSelect,
  onStart,
  onStop,
  busy,
  startsAt,
}) {
  if (onWatch) {
    return (
      <div className="control">
        <div className="control__active">
          Running <strong>{system?.name ?? 'watch'}</strong>
          {startedAt ? <div className="muted">Started at {formatClock(startedAt)}</div> : null}
        </div>
        <button className="btn btn--stop" onClick={onStop} disabled={busy}>
          {busy ? 'Stopping…' : 'Stop Watch'}
        </button>
      </div>
    );
  }

  const canStart = systems.length > 0;

  return (
    <div className="control">
      <label className="control__field">
        <span>Watch system</span>
        <select
          value={selectedSystemId ?? ''}
          onChange={(e) => onSelect(e.target.value)}
          disabled={!canStart || busy}
        >
          {systems.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      {canStart ? (
        <div className="muted">Starts at {formatClock(startsAt)} (rounded to the hour)</div>
      ) : (
        <div className="warn">No watch systems available — configure watch teams in the plugin settings.</div>
      )}

      <button className="btn btn--start" onClick={onStart} disabled={busy || !canStart}>
        {busy ? 'Starting…' : 'Start Watch'}
      </button>
    </div>
  );
}
