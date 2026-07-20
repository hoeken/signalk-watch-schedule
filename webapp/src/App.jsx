import { useCallback, useEffect, useState } from "react";
import { resolveSchedule, snapToHour } from "@core/index.js";
import * as api from "./api.js";
import ScheduleList from "./components/ScheduleList.jsx";
import WatchControl from "./components/WatchControl.jsx";
import DeadmanPanel from "./components/DeadmanPanel.jsx";
import LoginModal from "./components/LoginModal.jsx";
import ThemeToggle from "./components/ThemeToggle.jsx";

const SHIFT_COUNT = 12;
const HOUR_MS = 3_600_000;
const START_WINDOW_HOURS = 12; // selectable start hours: now ± this many hours

// Per-watch team edits (names, count, order) live in this browser only — the
// server never persists them outside an active watch. Keeping them in
// localStorage means stopping a watch to tweak something brings the same
// custom teams back, instead of reverting to the configured defaults.
const TEAMS_STORAGE_KEY = "signalk-watch-schedule.teams";

/** The stored team draft, or null when absent/invalid (→ use server defaults). */
function loadStoredTeams() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TEAMS_STORAGE_KEY));
    if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((t) => t && typeof t.name === "string"))
      return parsed.map((t) => ({ name: t.name }));
  } catch {
    /* corrupt or unavailable storage — fall back to the defaults */
  }
  return null;
}

export default function App() {
  const [view, setView] = useState(null); // composed { state, system, teams, ... }
  const [systems, setSystems] = useState([]);
  const [config, setConfig] = useState(null); // plugin config (integration flags)
  const [loginStatus, setLoginStatus] = useState(null);
  const [selectedSystemId, setSelectedSystemId] = useState(null);
  const [startAt, setStartAt] = useState(null); // chosen start hour; null = follow "now"
  const [draftTeams, setDraftTeams] = useState(loadStoredTeams); // edited teams; null = server defaults
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showLogin, setShowLogin] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    const [v, login] = await Promise.all([api.getState(), api.getLoginStatus()]);
    setView(v);
    setLoginStatus(login);
  }, []);

  // Persist team edits so they survive a stop (and a reload); null clears the
  // draft and falls back to the live server defaults.
  const updateTeams = useCallback((next) => {
    setDraftTeams(next);
    try {
      if (next)
        localStorage.setItem(TEAMS_STORAGE_KEY, JSON.stringify(next));
      else
        localStorage.removeItem(TEAMS_STORAGE_KEY);
    } catch {
      /* storage unavailable — the draft just won't survive a reload */
    }
  }, []);

  // Initial load + state polling + 1s ticker (drives countdowns and advances the
  // current shift locally using the shared core between polls).
  useEffect(() => {
    refresh()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));

    const stopPolling = api.pollState(setView);
    const ticker = setInterval(() => setNow(Date.now()), 1000);

    return () => {
      stopPolling();
      clearInterval(ticker);
    };
  }, [refresh]);

  // `systems` (the available rotations) is auth-gated plugin data fetched
  // outside the delta poll, and depends entirely on the team count: the active
  // watch's while on watch, the locally edited teams while idle. Adding or
  // removing a team in the UI (or a crew change via plugin config) must
  // refetch, or the picker would offer rotations for the old count, the
  // preview would resolve the schedule against them, and /start would 400 on a
  // systemId no longer available. Also keyed on loginStatus: the endpoint 401s
  // for anonymous viewers, so a login needs to retry it.
  const serverTeamCount = view?.teams?.length ?? 0;
  const systemsTeamCount = view?.state?.onWatch
    ? serverTeamCount
    : (draftTeams?.length ?? serverTeamCount);
  useEffect(() => {
    let cancelled = false;
    api.getSystems(systemsTeamCount > 0 ? systemsTeamCount : undefined).then((sys) => {
      if (!cancelled)
        setSystems(sys);
    });
    return () => {
      cancelled = true;
    };
  }, [systemsTeamCount, loginStatus]);

  // Plugin config (e.g. whether the dead man's switch integration is on) is
  // auth-gated like /api/systems, so a login needs to retry it too.
  useEffect(() => {
    let cancelled = false;
    api.getConfig().then((cfg) => {
      if (!cancelled)
        setConfig(cfg);
    });
    return () => {
      cancelled = true;
    };
  }, [loginStatus]);

  // Default the picker to the active system (or first available) once loaded,
  // and keep the selection valid. A team-count change can drop the active
  // rotation from the available systems; selecting an id that isn't offered
  // would make /start 400, so fall back to a valid one rather than leave it.
  useEffect(() => {
    const valid = (id) => id != null && systems.some((s) => s.id === id);
    if (valid(selectedSystemId))
      return;
    const stateId = view?.state?.systemId;
    const fallback = (valid(stateId) ? stateId : systems[0]?.id) || null;
    if (fallback !== selectedSystemId)
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
  // Idle, the control panel edits a local draft of the teams, seeded from the
  // server defaults (plugin config, or communication.crewNames when the config
  // is empty). The draft is what the preview renders and what /start sends.
  const editTeams = draftTeams ?? teams;
  // The schedule is built for a crew of 2–5 teams; outside that range no valid
  // rotation exists, so surface it rather than render a broken schedule. On
  // watch that's the active teams; idle it's the edited draft.
  const effectiveTeams = onWatch ? teams : editTeams;
  const teamCountError =
    effectiveTeams.length < 2
      ? `Need at least 2 watch teams${effectiveTeams.length === 1 ? " (only 1 configured)" : ""} — add more in the control panel or the plugin settings.`
      : effectiveTeams.length > 5
        ? `Too many watch teams (${effectiveTeams.length}) — the schedule supports at most 5.`
        : null;
  // A watch can be scheduled to begin in the future: it's "on watch" but hasn't
  // started yet. Flagged separately so the UI reads as pending/grey rather than
  // active (server-side, watch.current is null and the schedule omits earlier
  // segments — see resolveSchedule).
  const notStarted = onWatch && !!state.startedAt && state.startedAt > now;
  const controllable = api.canControl(loginStatus);

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
      shifts = resolveSchedule(selected, editTeams, startHour, startHour, { count: SHIFT_COUNT })
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

  // Send the edited teams (already in watch order) with the start; blank names
  // fall back to a numbered placeholder so the server never rejects the list.
  const doStart = () =>
    handleControl(() =>
      api.startWatch(selectedSystemId, {
        startAt: startHour,
        teams: editTeams.map((t, i) => ({ name: t.name.trim() || `Team ${i + 1}` })),
      }),
    );
  const doStop = () => handleControl(() => api.stopWatch());
  const doLogin = async (u, p, rememberMe) => {
    await api.login(u, p, rememberMe);
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

      {error || teamCountError ? (
        <div className="warn banner">{error || teamCountError}</div>
      ) : null}

      <main className={`layout${controllable ? "" : " layout--solo"}`}>
        <section className="panel schedule-panel">
          <ScheduleList
            shifts={shifts}
            now={now}
            preview={preview}
            startsAt={notStarted ? state.startedAt : null}
          />
        </section>

        {controllable ? (
          <aside className="side-col">
            <section className="panel control-panel">
              <h2>Control</h2>
              <WatchControl
                onWatch={onWatch}
                systems={systems}
                system={view?.system}
                startedAt={state.startedAt}
                now={now}
                selectedSystemId={selectedSystemId}
                onSelect={setSelectedSystemId}
                teams={editTeams}
                onTeamsChange={updateTeams}
                teamsCustomized={draftTeams != null}
                onResetTeams={() => updateTeams(null)}
                startAt={startHour}
                startOptions={startOptions}
                onSelectStartAt={setStartAt}
                onStart={doStart}
                onStop={doStop}
                busy={busy}
              />
            </section>
            {onWatch && config?.deadMansSwitch ? <DeadmanPanel /> : null}
          </aside>
        ) : null}
      </main>

      <LoginModal open={showLogin} onClose={() => setShowLogin(false)} onLogin={doLogin} />
    </div>
  );
}
