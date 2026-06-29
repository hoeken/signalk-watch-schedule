import ShiftCard from "./ShiftCard.jsx";

/** Ordered list of shifts, starting with the active one. */
export default function ScheduleList({ shifts, now, preview }) {
  if (!shifts.length) {
    return <div className="empty">No watch in progress.</div>;
  }

  // If the visible shifts span more than one calendar day, show weekday labels.
  const firstDay = new Date(shifts[0].startTime).getDate();
  const withDay = shifts.some((s) => new Date(s.startTime).getDate() !== firstDay);

  return (
    <>
      {preview ? <div className="preview-note">Preview — watch not started</div> : null}
      <ul className="schedule">
        {shifts.map((s) => (
          <ShiftCard key={s.startTime} shift={s} now={now} withDay={withDay} />
        ))}
      </ul>
    </>
  );
}
