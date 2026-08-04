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
