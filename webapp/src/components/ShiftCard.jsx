import { formatClock, formatClockDay, formatDuration, untilLabel, agoLabel, hexToRgba } from '../time.js';

/**
 * One shift in the schedule list. Each team has its own color; the active shift
 * is highlighted with a tinted background and an ON WATCH badge. Non-current
 * shifts read relative to `now`: upcoming ones count down ("in 2h"), already
 * elapsed ones count up ("ended 1h ago") — the latter shows up when previewing a
 * back-dated start.
 */
export default function ShiftCard({ shift, now, withDay }) {
  const fmt = withDay ? formatClockDay : formatClock;
  const isCurrent = shift.isCurrent;
  const ended = !isCurrent && shift.endTime <= now;
  const startsIn = untilLabel(shift.startTime, now);
  const endedAgo = agoLabel(shift.endTime, now);
  const style = {
    borderLeftColor: shift.color,
    background: isCurrent ? hexToRgba(shift.color, 0.16) : undefined,
  };

  return (
    <li className={`shift${isCurrent ? ' shift--current' : ''}`} style={style}>
      <div className="shift__time">
        {fmt(shift.startTime)}
      </div>

      <div className="shift__body">
        <div className="shift__team" style={{ color: shift.color }}>
          {shift.teamName}
          {shift.label ? <span className="shift__label"> · {shift.label}</span> : null}
        </div>
        <div className="shift__crew">
          {shift.crew.length ? shift.crew.join(', ') : 'No crew assigned'}
        </div>
      </div>

      <div className="shift__meta">
        <div className="shift__dur">{formatDuration(shift.durationMin)}</div>
        {isCurrent ? (
          <div className="shift__status">
            <span className="badge">ON WATCH</span>
            <span className="muted">ends in {untilLabel(shift.endTime, now)}</span>
          </div>
        ) : ended ? (
          <div className="shift__status muted">{endedAgo ? `ended ${endedAgo} ago` : 'just ended'}</div>
        ) : (
          <div className="shift__status muted">{startsIn ? `in ${startsIn}` : 'soon'}</div>
        )}
      </div>
    </li>
  );
}
