// Sortable-ish unique ids for daemon-created records: millisecond timestamp
// for ordering plus random tail for uniqueness within the same tick.

export function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
