// Debounces a value (search text) so typing does not refetch per keystroke.
// The first paint still uses the raw value; only the fetch follows the delay.
// Kept apart from listCache.js so the cache stays pure JS and directly
// unit-testable without React.
import { useEffect, useState } from "react";

export function useDebouncedValue(value, delayMs) {
  const delay = typeof delayMs === "number" ? delayMs : 300;
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
