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

  return (
    <>
      {preview ? <div className="preview-note">Preview — watch not started</div> : null}
      {startsAt ? (
        <div className="pending-note">
          Watch schedule not active yet — begins {formatDateTime(startsAt)}
          {startsIn ? ` (in ${startsIn})` : ""}
        </div>
      ) : null}
      <ul className="schedule">
        {shifts.map((s) => (
          <ShiftCard key={s.startTime} shift={s} now={now} withDay={withDay} />
        ))}
      </ul>
    </>
  );
}
