import { formatClock, formatWeekday, formatDuration, untilLabel, agoLabel, hexToRgba } from "../time.js";

/**
 * One shift in the schedule list. Each team has its own color; the active shift
 * is highlighted with a tinted background. Non-current
 * shifts read relative to `now`: upcoming ones count down ("in 2h"), already
 * elapsed ones count up ("ended 1h ago") — the latter shows up when previewing a
 * back-dated start.
 */
export default function ShiftCard({ shift, now, withDay, selectedTeam, onSelect }) {
  const isCurrent = shift.isCurrent;
  const ended = !isCurrent && shift.endTime <= now;
  const startsIn = untilLabel(shift.startTime, now);
  const endedAgo = agoLabel(shift.endTime, now);
  // When a team is selected, cards for other teams are dimmed to highlight it.
  const dimmed = selectedTeam != null && shift.teamName !== selectedTeam;
  const style = {
    borderLeftColor: shift.color,
    background: isCurrent ? hexToRgba(shift.color, 0.16) : undefined,
  };

  return (
    <li
      className={`shift${isCurrent ? " shift--current" : ""}${dimmed ? " shift--dimmed" : ""}`}
      style={style}
      onClick={() => onSelect(shift.teamName)}
    >
      <div className="shift__time">
        {formatClock(shift.startTime)}
        {withDay ? <div className="shift__day">{formatWeekday(shift.startTime)}</div> : null}
      </div>

      <div className="shift__body">
        <div className="shift__team" style={{ color: shift.color }}>
          {shift.teamName}
        </div>
        {shift.label ? <div className="shift__label">{shift.label}</div> : null}
      </div>

      <div className="shift__meta">
        <div className="shift__dur">{formatDuration(shift.durationMin)}</div>
        {isCurrent ? (
          <div className="shift__status">
            <span className="muted">ends in {untilLabel(shift.endTime, now)}</span>
          </div>
        ) : ended ? (
          <div className="shift__status muted">{endedAgo ? `ended ${endedAgo} ago` : "just ended"}</div>
        ) : (
          <div className="shift__status muted">{startsIn ? `in ${startsIn}` : "soon"}</div>
        )}
      </div>
    </li>
  );
}
