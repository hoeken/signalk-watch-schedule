import { useEffect, useRef } from "react";
import LoginPanel from "./LoginPanel.jsx";

/**
 * Centered, backdrop-dimmed login dialog built on the native <dialog> element —
 * supported on the MFD's Chromium 69 (since Chrome 37), and giving us focus
 * trapping, Escape-to-close and the ::backdrop fade for free.
 *
 * `open` is driven by React but mirrored to the element's imperative
 * showModal()/close(): setting the `open` *attribute* directly would render it
 * non-modal (no top layer, no backdrop), so we never do that.
 */
export default function LoginModal({ open, onClose, onLogin }) {
  const ref = useRef(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog)
      return;
    if (open && !dialog.open)
      dialog.showModal();
    else if (!open && dialog.open)
      dialog.close();
  }, [open]);

  // Escape (and any other native dismissal) fires `close`; sync React back.
  const handleClose = () => onClose();

  // The dialog box is a full-viewport flex container, so a click whose target is
  // the dialog itself (the gutter around the panel) is a click outside — dismiss.
  const handleClick = (e) => {
    if (e.target === ref.current)
      onClose();
  };

  return (
    <dialog ref={ref} className="login-modal" onClose={handleClose} onClick={handleClick}>
      <div className="login-modal__panel panel">
        <LoginPanel onLogin={onLogin} />
        {/* Last in the DOM so focus lands on the username field on open; pinned
            to the corner with CSS. SVG glyph, not ×, for the MFD's sparse font. */}
        <button type="button" className="login-modal__close" onClick={onClose} aria-label="Close">
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </dialog>
  );
}
