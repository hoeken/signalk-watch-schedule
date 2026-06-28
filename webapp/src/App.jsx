import { useCallback, useEffect, useState } from 'react';
import { resolveSchedule, snapToHour } from '@core/index.js';
import * as api from './api.js';
import ScheduleList from './components/ScheduleList.jsx';
import WatchControl from './components/WatchControl.jsx';
import LoginPanel from './components/LoginPanel.jsx';

const SHIFT_COUNT = 12;

export default function App() {
  const [view, setView] = useState(null); // composed { state, system, teams, ... }
  const [systems, setSystems] = useState([]);
  const [loginStatus, setLoginStatus] = useState(null);
  const [selectedSystemId, setSelectedSystemId] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
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
      if (pending) return;
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
      if (pending) clearTimeout(pending);
    };
  }, [refresh]);

  // Default the picker to the active system (or first available) once loaded.
  useEffect(() => {
    if (selectedSystemId) return;
    const fallback = view?.state?.systemId || systems[0]?.id || null;
    if (fallback) setSelectedSystemId(fallback);
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
  const controllable = api.canControl(loginStatus);
  const startsAt = snapToHour(now, 'nearest');

  // Build the displayed shifts with the SHARED core, recomputed each tick so the
  // current shift and countdowns stay live between server deltas.
  let shifts = [];
  let preview = false;
  if (onWatch && view.system && state.startedAt) {
    shifts = resolveSchedule(view.system, teams, state.startedAt, now, { count: SHIFT_COUNT });
  } else {
    const selected = systems.find((s) => s.id === selectedSystemId);
    if (selected) {
      // resolve with now just before start so nothing is flagged current in preview
      shifts = resolveSchedule(selected, teams, startsAt, startsAt - 1, { count: SHIFT_COUNT });
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
        setLoginStatus({ status: 'notLoggedIn', authenticationRequired: true });
        setError('Your session expired — please log in again.');
      } else {
        setError(e.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const doStart = () => handleControl(() => api.startWatch(selectedSystemId));
  const doStop = () => handleControl(() => api.stopWatch());
  const doLogin = async (u, p) => {
    await api.login(u, p);
    await refresh();
  };
  const doLogout = async () => {
    await api.logout();
    await refresh();
  };

  const loggedIn = loginStatus?.status === 'loggedIn';

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__title">
          <span className={`status-dot ${onWatch ? 'on' : 'off'}`} />
          Watch Schedule
        </div>
        <div className="topbar__right">
          {loggedIn ? (
            <button className="link" onClick={doLogout}>
              {loginStatus.username ? `Log out · ${loginStatus.username}` : 'Log out'}
            </button>
          ) : null}
        </div>
      </header>

      {error ? <div className="warn banner">{error}</div> : null}

      <main className="layout">
        <section className="panel schedule-panel">
          <h2>{onWatch ? 'On Watch' : 'Schedule'}</h2>
          <ScheduleList shifts={shifts} now={now} preview={preview} />
        </section>

        <aside className="panel control-panel">
          <h2>Control</h2>
          {controllable ? (
            <WatchControl
              onWatch={onWatch}
              systems={systems}
              system={view?.system}
              startedAt={state.startedAt}
              selectedSystemId={selectedSystemId}
              onSelect={setSelectedSystemId}
              onStart={doStart}
              onStop={doStop}
              busy={busy}
              startsAt={startsAt}
            />
          ) : (
            <LoginPanel onLogin={doLogin} />
          )}
        </aside>
      </main>
    </div>
  );
}
