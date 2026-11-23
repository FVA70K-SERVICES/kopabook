// Animated entrance gate (KopaBook, Nov 2026).
//
// On every cold open the gate plays FIRST, then the existing session
// check decides where the app goes: a valid session goes straight to
// the Dashboard, no session goes to the sign-in / create-account page.
// The gate only paces the exit from the loading state; it never invents
// a session and never skips the api.me() check in App.jsx.
//
// Timing (defaults, Fortune's to overrule — same as the Connect gate):
//   GATE_MIN_MS 1400 from first paint: on a fast check the full
//   entrance is seen instead of flashing past.
//   Slow check: zero added delay — the gate waits for the check only,
//   and the message flips to "Checking your session…".
//   Ambiguous failure (not a definite 401): the gate holds and shows
//   Try again at once, never held by the minimum, and never routes a
//   signed-in user to sign-in on a network blip.
//   Reduced motion: zero wait, animation off, logo drawn at once.
//   bfcache restore: performance.now() keeps counting from the original
//   navigation, so the remaining wait is 0 and a restore never stalls.
//
// The AppLock PIN gate and the admin/owner areas are untouched by this
// gate: they render after it, exactly as before.
import Logo from "./Logo";

export const GATE_MIN_MS = 1400;

export default function EntranceGate({ slow, failed, onRetry }) {
  return (
    <div className="kb-gate" role="status" aria-live="polite">
      <div className="kb-gate-logo">
        <div className="kb-gate-halo" aria-hidden="true" />
        <Logo />
      </div>
      <p className="kb-gate-msg">
        {failed
          ? "Could not reach KopaBook."
          : slow
            ? "Checking your session…"
            : "Opening KopaBook…"}
      </p>
      {!failed && (
        <div className="kb-gate-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      )}
      {failed && (
        <>
          <button type="button" className="btn btn-primary kb-gate-retry" onClick={onRetry}>
            Try again
          </button>
          <p className="kb-gate-hint">Your books are safe. Check your connection and try again.</p>
        </>
      )}
    </div>
  );
}
