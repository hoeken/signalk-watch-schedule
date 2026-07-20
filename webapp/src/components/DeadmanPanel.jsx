const DEADMAN_APP_URL = "/signalk-dead-mans-switch/";

/**
 * Embeds the signalk-dead-mans-switch webapp while a watch is running, so the
 * crew can see the check-in countdown and acknowledge it without leaving the
 * schedule. `embedded=true` tells the switch webapp it's inside a host page,
 * and our own `mode` query param (B&G displays pass mode=day/night for
 * theming) is forwarded so both apps agree on the theme.
 */
export default function DeadmanPanel() {
  const mode = new URLSearchParams(window.location.search).get("mode");
  const src = `${DEADMAN_APP_URL}?embedded=true${mode !== null ? `&mode=${encodeURIComponent(mode)}` : ""}`;
  return (
    <section className="panel deadman-panel">
      <h2>Dead Man&apos;s Switch</h2>
      <iframe className="deadman-frame" src={src} title="Dead man's switch" />
    </section>
  );
}
