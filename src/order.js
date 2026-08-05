// Pure reorder logic for the drag-to-reorder list. No DOM, no Tauri — the
// drop handler computes the next global order here and hands it to
// `reorder_records`.

/**
 * Move `fromId` in `ids` so it lands immediately before `beforeId`
 * (`null` = end of the list). No-op when either id is unknown or the
 * element is already in place. Returns a new array, never mutates `ids`.
 */
export function moveBefore(ids, fromId, beforeId) {
  if (fromId === beforeId) return [...ids];
  if (!ids.includes(fromId)) return [...ids];
  if (beforeId !== null && !ids.includes(beforeId)) return [...ids];
  const rest = ids.filter((id) => id !== fromId);
  if (beforeId === null) return [...rest, fromId];
  const at = rest.indexOf(beforeId);
  const out = [...rest];
  out.splice(at, 0, fromId);
  return out;
}

/**
 * Insertion slot from a cursor Y over static row geometry (document order).
 * Returns the id of the first row whose midpoint is below the cursor (the
 * row to insert before), or null to append at the end. `rows` come from
 * getBoundingClientRect during dragover — the drop target never depends on
 * the dragged row's own position, only on where the cursor is.
 */
export function insertionSlot(rows, y) {
  for (const r of rows) {
    if (y < r.top + (r.bottom - r.top) / 2) return r.id;
  }
  return null;
}
