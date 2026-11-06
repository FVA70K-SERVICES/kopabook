// Shared loading, cached-data and retry states for list screens.
// Inline styles only: the shared stylesheet is owned by another worker,
// so this file must not depend on any new CSS class. Every state uses
// plain words, no em dash, and never presents an empty list as data
// while a load is still in flight.
import { formatUpdatedTime, isNetworkError } from "../lib/listCache";

const BAR = {
  height: 14,
  borderRadius: 7,
  background: "rgba(128, 128, 128, 0.22)",
  marginBottom: 10,
};

// Skeleton rows shown while a list loads and no cached data exists yet.
// aria-busy plus role="status" so assistive tech announces loading
// instead of silence or a misleading zero.
export function ListSkeleton({ rows = 5, label = "Loading..." }) {
  const widths = ["92%", "78%", "86%", "64%", "81%", "70%"];
  const list = Array.from({ length: rows }, (_, i) => widths[i % widths.length]);
  return (
    <div className="loading" role="status" aria-live="polite" aria-busy="true" aria-label={label} style={{ textAlign: "left" }}>
      <p style={{ color: "var(--muted)", margin: "0 0 14px", textAlign: "center" }}>{label}</p>
      {list.map((w, i) => (
        <div key={i} aria-hidden="true" style={{ ...BAR, width: w }} />
      ))}
    </div>
  );
}

// Small "Updated HH:MM" note shown under a list painted from cache.
export function UpdatedNote({ updatedAt, onRefresh }) {
  if (!updatedAt) return null;
  return (
    <p className="hint" style={{ margin: "4px 0 10px" }}>
      Updated {formatUpdatedTime(updatedAt)}
      {onRefresh ? (
        <>
          {" · "}
          <button type="button" className="btn btn-secondary btn-sm" onClick={onRefresh}>Refresh</button>
        </>
      ) : null}
    </p>
  );
}

// Plain-word load failure with a Retry button. When the failure looks
// like no connection, it says so instead of repeating a bare error.
export function LoadError({ message, onRetry }) {
  const offline = isNetworkError(message);
  return (
    <div className="alert alert-error" role="alert">
      <div>{offline ? "You are offline or the connection failed. Check your connection and try again." : (message || "Could not load this list. Try again.")}</div>
      {onRetry ? (
        <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={onRetry}>Retry</button>
      ) : null}
    </div>
  );
}
