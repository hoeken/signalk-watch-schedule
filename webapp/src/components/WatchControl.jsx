import { formatClock, formatDateTime, formatHourOption } from "../time.js";
import TeamOrderList from "./TeamOrderList.jsx";

/**
 * Start/stop control for authenticated users. When idle, the captain picks the
 * rotation, the start hour (±12h of whole hours), and the team order — the
 * schedule preview updates live as they change any of them. When on watch, shows
 * the active system and a stop button.
 */
export default function WatchControl({
  onWatch,
  systems,
  system,
  startedAt,
  now,
  selectedSystemId,
  onSelect,
  teams,
  teamOrder,
  onReorder,
  startAt,
  startOptions,
  onSelectStartAt,
  onStart,
  onStop,
  busy,
}) {
  if (onWatch) {
    const future = startedAt && startedAt > now;
    return (
      <div className="control">
        <div className="control__active">
          Running <strong>{system?.name ?? "watch"}</strong>
          {system?.description ? <div className="muted" style={{ marginBottom: "0.5rem" }}>{system.description}</div> : null}
          {startedAt ? (
            <div className="muted">
              {future ? "Starts" : "Started"} on {formatDateTime(startedAt)}
            </div>
          ) : null}
        </div>
        <button className="btn btn--stop" onClick={onStop} disabled={busy}>
          {busy ? "Stopping…" : "Stop Watch"}
        </button>
      </div>
    );
  }

  const canStart = systems.length > 0;
  const selectedSystem = systems.find((s) => s.id === selectedSystemId);

  return (
    <div className="control">
      <label className="control__field">
        <span className="control__field-title-row">
          Watch system
          <a
            className="link"
            href="https://github.com/hoeken/signalk-watch-schedule/issues"
            target="_blank"
            rel="noopener noreferrer"
          >
            request new
          </a>
        </span>
        <select
          value={selectedSystemId ?? ""}
          onChange={(e) => onSelect(e.target.value)}
          disabled={!canStart || busy}
        >
          {systems.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {selectedSystem?.description ? <div className="muted">{selectedSystem.description}</div> : null}
      </label>

      <label className="control__field">
        <span>Start time</span>
        <select
          value={startAt}
          onChange={(e) => onSelectStartAt(Number(e.target.value))}
          disabled={!canStart || busy}
        >
          {startOptions.map((ms) => (
            <option key={ms} value={ms}>
              {formatHourOption(ms, now)}
            </option>
          ))}
        </select>
      </label>

      {canStart && teams.length > 1 ? (
        <div className="control__field">
          <span className="control__field-title">Watch order</span>
          <TeamOrderList teams={teams} order={teamOrder} onReorder={onReorder} disabled={busy} />
          <div className="muted">
            {teams[teamOrder[0]]?.name ?? "The first team"} starts at {formatClock(startAt)}; the rest follow in
            order.
          </div>
        </div>
      ) : null}

      {canStart ? null : (
        <div className="warn">No watch systems available — configure watch teams in the plugin settings.</div>
      )}

      <button className="btn btn--start" onClick={onStart} disabled={busy || !canStart}>
        {busy ? "Starting…" : "Start Watch"}
      </button>
    </div>
  );
}
