const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// "just now" / "12m ago" / "3h ago" / "2d ago" — used anywhere a timestamp
// needs to read as a glance-able age rather than a full date (rail artifact
// flyouts, the library panel's saved-at column).
export function formatRelativeAge(timestamp: number): string {
  const elapsed = Date.now() - timestamp;
  if (elapsed < MINUTE_MS) return "just now";
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}m ago`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}h ago`;
  return `${Math.floor(elapsed / DAY_MS)}d ago`;
}
