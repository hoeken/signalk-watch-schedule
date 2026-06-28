import { formatClock, formatClockDay, formatDuration, untilLabel, hexToRgba } from '../time.js';

/**
 * One shift in the schedule list. Each team has its own color; the active shift
 * is highlighted with a tinted background and an ON WATCH badge.
 */
export default function ShiftCard({ shift, now, withDay }) {
  const fmt = withDay ? formatClockDay : formatClock;
  const isCurrent = shift.isCurrent;
  const style = {
    borderLeftColor: shift.color,
    background: isCurrent ? hexToRgba(shift.color, 0.16) : undefined,
  };

  return (
    <li className={`shift${isCurrent ? ' shift--current' : ''}`} style={style}>
      <div className="shift__time">
        {fmt(shift.startTime)}
        <span className="shift__dash">–</span>
        {fmt(shift.endTime)}
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
        ) : (
          <div className="shift__status muted">in {untilLabel(shift.startTime, now)}</div>
        )}
      </div>
    </li>
  );
}
