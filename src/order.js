// Pure reorder logic for the drag-to-reorder list. No DOM, no Tauri — the
// drop handler computes the next global order here and hands it to
// `reorder_records`.

/**
 * Move `fromId` in `ids` so it lands immediately before `beforeId`
 * (`null` = end of the list). No-op when either id is unknown or the
 * element is already in place. Returns `{ order, changed }` — a new array
 * (never mutating `ids`) plus whether anything actually moved, so callers
 * don't have to detect no-ops by comparing arrays.
 */
export function moveBefore(ids, fromId, beforeId) {
  const unchanged =
    fromId === beforeId ||
    !ids.includes(fromId) ||
    (beforeId !== null && !ids.includes(beforeId));
  let order;
  if (unchanged) {
    order = [...ids];
  } else {
    const rest = ids.filter((id) => id !== fromId);
    if (beforeId === null) {
      order = [...rest, fromId];
    } else {
      order = [...rest];
      order.splice(rest.indexOf(beforeId), 0, fromId);
    }
  }
  return { order, changed: order.some((v, i) => v !== ids[i]) };
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

/**
 * Next global id after `lastVisibleId` — the insertion point when a record
 * is dropped below the last row of a filtered (vendor/tag/search) view.
 * The dragged record must land right after that last visible record in the
 * global order, not at the end of the whole vault. Returns null when
 * `lastVisibleId` is unknown or already last.
 */
export function nextAfterId(ids, lastVisibleId) {
  if (!lastVisibleId) return null;
  const at = ids.indexOf(lastVisibleId);
  if (at < 0 || at >= ids.length - 1) return null;
  return ids[at + 1];
}

/**
 * The drop decision for one pointermove: the insertion slot from geometry,
 * plus the record-list strategy for a drop below the last visible row — the
 * record lands right after that row in the GLOBAL order (in a filtered view
 * that is not the vault's end). Vendor lists have no such correction: null
 * stays null (= append at end). `listKind` names the two list policies;
 * this rule used to live split across the drop handler and is pure — and
 * tested — as a whole now.
 */
export function dropTarget({ allIds, geometry, clientY, listKind, lastVisibleId = null }) {
  const beforeId = insertionSlot(geometry, clientY);
  if (beforeId !== null || listKind !== "records") return beforeId;
  return nextAfterId(allIds, lastVisibleId);
}
