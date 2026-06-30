import { formatDateTime, untilLabel } from "../time.js";
import ShiftCard from "./ShiftCard.jsx";

/**
 * Ordered list of shifts, starting with the active one. `startsAt` (epoch ms) is
 * set only for a watch that's scheduled but hasn't begun, and is the authoritative
 * start moment — for anchored systems it can sit inside the first clock-aligned
 * shift, so it's truer than that shift's own start time.
 */
export default function ScheduleList({ shifts, now, preview, startsAt }) {
  if (!shifts.length) {
    return <div className="empty">No watch in progress.</div>;
  }

  // If the visible shifts span more than one calendar day, show weekday labels.
  const firstDay = new Date(shifts[0].startTime).getDate();
  const withDay = shifts.some((s) => new Date(s.startTime).getDate() !== firstDay);

  // Scheduled-but-not-yet-started: nothing is on duty yet. Called out in grey,
  // deliberately avoiding the colored highlight an active watch gets, so it
  // doesn't read as "running now".
  const startsIn = startsAt ? untilLabel(startsAt, now) : "";

  // Split the timeline around the on-duty watch so each stretch gets its own
  // heading: shifts already finished ("Past Watches" — only surfaces when a
  // back-dated preview reaches into the past), the one on duty now ("Current
  // Watch"), and everything still to come ("Upcoming Watches"). With no watch on
  // duty (pending future start, or a preview that hasn't begun) nothing is past
  // or current and every shift is upcoming.
  const currentIdx = startsAt ? -1 : shifts.findIndex((s) => s.isCurrent);
  const hasCurrent = currentIdx >= 0;
  const past = hasCurrent ? shifts.slice(0, currentIdx) : [];
  const current = hasCurrent ? shifts.slice(currentIdx, currentIdx + 1) : [];
  const upcoming = hasCurrent ? shifts.slice(currentIdx + 1) : shifts;

  const list = (segment) => (
    <ul className="schedule">
      {segment.map((s) => (
        <ShiftCard key={s.startTime} shift={s} now={now} withDay={withDay} />
      ))}
    </ul>
  );

  return (
    <>
      {preview ? <div className="preview-note">Preview Mode: watch not yet started</div> : null}
      {startsAt ? (
        <div className="pending-note">
          Watch schedule not yet active: begins {formatDateTime(startsAt)}
          {startsIn ? ` (in ${startsIn})` : ""}
        </div>
      ) : null}
      {past.length ? (
        <>
          <h2 className="past-heading">Past Watches</h2>
          {list(past)}
        </>
      ) : null}
      {hasCurrent ? (
        <>
          <h2 className="current-heading">Current Watch</h2>
          {list(current)}
        </>
      ) : null}
      {upcoming.length ? (
        <>
          <h2 className="upcoming-heading">Upcoming Watches</h2>
          {list(upcoming)}
        </>
      ) : null}
    </>
  );
}
