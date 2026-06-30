import { useCallback, useEffect, useState } from "react";
import { resolveSchedule, snapToHour } from "@core/index.js";
import * as api from "./api.js";
import ScheduleList from "./components/ScheduleList.jsx";
import WatchControl from "./components/WatchControl.jsx";
import LoginModal from "./components/LoginModal.jsx";
import ThemeToggle from "./components/ThemeToggle.jsx";

const SHIFT_COUNT = 12;
const HOUR_MS = 3_600_000;
const START_WINDOW_HOURS = 12; // selectable start hours: now ± this many hours

export default function App() {
  const [view, setView] = useState(null); // composed { state, system, teams, ... }
  const [systems, setSystems] = useState([]);
  const [loginStatus, setLoginStatus] = useState(null);
  const [selectedSystemId, setSelectedSystemId] = useState(null);
  const [startAt, setStartAt] = useState(null); // chosen start hour; null = follow "now"
  const [teamOrder, setTeamOrder] = useState(null); // permutation of team indices; null = natural
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showLogin, setShowLogin] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    const [v, sys, login] = await Promise.all([api.getState(), api.getSystems(), api.getLoginStatus()]);
    setView(v);
    setSystems(sys);
    setLoginStatus(login);
  }, []);

  // Initial load + live delta subscription + 1s ticker (drives countdowns and
  // advances the current shift locally using the shared core).
  useEffect(() => {
    refresh()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));

    let pending = null;
    const onDelta = () => {
      if (pending)
        return;
      pending = setTimeout(() => {
        pending = null;
        api.getState().then(setView).catch(() => {});
      }, 300);
    };
    const unsub = api.subscribeWatch(onDelta);
    const ticker = setInterval(() => setNow(Date.now()), 1000);

    return () => {
      unsub();
      clearInterval(ticker);
      if (pending)
        clearTimeout(pending);
    };
  }, [refresh]);

  // Default the picker to the active system (or first available) once loaded.
  useEffect(() => {
    if (selectedSystemId)
      return;
    const fallback = view?.state?.systemId || systems[0]?.id || null;
    if (fallback)
      setSelectedSystemId(fallback);
  }, [view, systems, selectedSystemId]);

  if (loading) {
    return (
      <div className="app">
        <div className="empty">Loading…</div>
      </div>
    );
  }

  const state = view?.state ?? { onWatch: false, startedAt: null, systemId: null };
  const teams = view?.teams ?? [];
  const onWatch = state.onWatch;
  // A watch can be scheduled to begin in the future: it's "on watch" but hasn't
  // started yet. Flagged separately so the UI reads as pending/grey rather than
  // active (server-side, watch.current is null and the schedule omits earlier
  // segments — see resolveSchedule).
  const notStarted = onWatch && !!state.startedAt && state.startedAt > now;
  const controllable = api.canControl(loginStatus);

  // Off watch, the captain chooses the start hour and team order; both feed the
  // live preview and the start request. The chosen order is a permutation of
  // indices into `teams` — guarded so a stale order (after a team count change)
  // falls back to the natural order rather than dropping a team.
  const naturalOrder = teams.map((_, i) => i);
  const order = teamOrder && teamOrder.length === teams.length ? teamOrder : naturalOrder;
  const orderedTeams = order.map((i) => teams[i]);

  const startHour = startAt ?? snapToHour(now, "nearest");
  const floorHour = snapToHour(now, "down");
  const startOptions = (() => {
    const hours = new Set();
    for (let k = -START_WINDOW_HOURS; k <= START_WINDOW_HOURS; k += 1)
      hours.add(floorHour + k * HOUR_MS);
    hours.add(startHour); // keep the current selection valid even as `now` drifts
    return [...hours].sort((a, b) => a - b);
  })();

  // Build the displayed shifts with the SHARED core, recomputed each tick so the
  // current shift and countdowns stay live between server deltas.
  let shifts = [];
  let preview = false;
  if (onWatch && view.system && state.startedAt) {
    shifts = resolveSchedule(view.system, teams, state.startedAt, now, { count: SHIFT_COUNT });
  } else {
    const selected = systems.find((s) => s.id === selectedSystemId);
    if (selected) {
      // Preview the rotation from the chosen start hour, in the chosen order, but
      // read against the real clock: once the chosen start has passed (e.g. a
      // back-dated start) the watch containing `now` is flagged current and the
      // watches before it read "ended … ago". A future start has nothing current
      // yet. We recompute isCurrent ourselves rather than letting resolveSchedule
      // key off `now`, so the list still begins at the start hour.
      const begun = now >= startHour;
      shifts = resolveSchedule(selected, orderedTeams, startHour, startHour, { count: SHIFT_COUNT })
        .map((s) => ({ ...s, isCurrent: begun && now >= s.startTime && now < s.endTime }));
      preview = true;
    }
  }

  const handleControl = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      setView(await fn());
    } catch (e) {
      if (e.code === 401) {
        setLoginStatus({ status: "notLoggedIn", authenticationRequired: true });
        setError("Your session expired — please log in again.");
        setShowLogin(true);
      } else {
        setError(e.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const doStart = () =>
    handleControl(() => api.startWatch(selectedSystemId, { startAt: startHour, teamOrder: order }));
  const doStop = () => handleControl(() => api.stopWatch());
  const doLogin = async (u, p) => {
    await api.login(u, p);
    await refresh();
    setShowLogin(false);
  };
  const doLogout = async () => {
    await api.logout();
    await refresh();
  };

  const loggedIn = loginStatus?.status === "loggedIn";

  return (
    <div className={`app${controllable ? "" : " app--solo"}`}>
      <header className="topbar">
        <div className="topbar__title">
          <span className={`status-dot ${notStarted ? "pending" : onWatch ? "on" : "off"}`} />
          Watch Schedule
          <ThemeToggle />
        </div>
        <div className="topbar__right">
          {loggedIn ? (
            <button className="link" onClick={doLogout}>
              {loginStatus.username ? `Log out · ${loginStatus.username}` : "Log out"}
            </button>
          ) : !controllable ? (
            <button className="link" onClick={() => setShowLogin(true)}>
              Log in
            </button>
          ) : null}
        </div>
      </header>

      {error ? <div className="warn banner">{error}</div> : null}

      <main className={`layout${controllable ? "" : " layout--solo"}`}>
        <section className="panel schedule-panel">
          <h2>{!onWatch ? "Schedule" : notStarted ? "Scheduled" : "On Watch"}</h2>
          <ScheduleList
            shifts={shifts}
            now={now}
            preview={preview}
            startsAt={notStarted ? state.startedAt : null}
          />
        </section>

        {controllable ? (
          <aside className="panel control-panel">
            <h2>Control</h2>
            <WatchControl
              onWatch={onWatch}
              systems={systems}
              system={view?.system}
              startedAt={state.startedAt}
              now={now}
              selectedSystemId={selectedSystemId}
              onSelect={setSelectedSystemId}
              teams={teams}
              teamOrder={order}
              onReorder={setTeamOrder}
              startAt={startHour}
              startOptions={startOptions}
              onSelectStartAt={setStartAt}
              onStart={doStart}
              onStop={doStop}
              busy={busy}
            />
          </aside>
        ) : null}
      </main>

      <LoginModal open={showLogin} onClose={() => setShowLogin(false)} onLogin={doLogin} />
    </div>
  );
}
