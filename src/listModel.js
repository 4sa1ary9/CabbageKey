// Owner of the list pane's state — records, search query, vendor/tag
// filters, selection — and of their invariants: a filter's target must
// exist, a selection must point at an existing record. Every mutation
// re-validates in place and reports what changed via a change-aspect set;
// the DOM layer subscribes once and maps aspects to paint work.
// No Tauri, no DOM here so it can be unit-tested with vitest.
import { filterRecords, vendorFilterValid, tagFilterValid } from "./filter.js";

/**
 * Change aspects (booleans on the object passed to subscribers):
 *   records   — the record set was replaced (open/create/any mutation command)
 *   filter    — vendor/tag filter toggled or reset
 *   query     — search text changed
 *   selection — selected record changed
 */
export function createListModel() {
  const state = {
    records: [],
    vendors: [],
    tags: [],
    query: "",
    vendor: null,
    tag: null,
    selectedId: null,
  };
  const subscribers = new Set();

  function emit(aspects) {
    for (const fn of subscribers) fn(aspects);
  }

  /** Records visible under the current query + vendor + tag stack. */
  function visibleRecords() {
    return filterRecords(state.records, {
      query: state.query,
      vendor: state.vendor,
      tag: state.tag,
    });
  }

  function hasActiveFilter() {
    return !!(state.query || state.vendor || state.tag);
  }

  /** Replace the record set (a VaultView). Re-validates filter targets and
   *  the selection so a deleted vendor/record never leaves a "no results"
   *  dead end with nothing highlighted in the rail. */
  function setRecords(view) {
    state.records = view.records;
    state.vendors = view.vendors;
    state.tags = view.tags;
    let filterReset = false;
    if (!vendorFilterValid(state.vendor, state.records, state.vendors)) {
      state.vendor = null;
      filterReset = true;
    }
    if (!tagFilterValid(state.tag, state.tags)) {
      state.tag = null;
      filterReset = true;
    }
    let selectionReset = false;
    if (state.selectedId && !state.records.some((r) => r.id === state.selectedId)) {
      state.selectedId = null;
      selectionReset = true;
    }
    emit({ records: true, filter: filterReset, selection: selectionReset });
  }

  /** Search text change — narrows the list only. */
  function setQuery(query) {
    state.query = query;
    emit({ query: true });
  }

  /** Rail vendor click: select the vendor, or deselect when re-clicked. */
  function toggleVendor(vendor) {
    state.vendor = state.vendor === vendor ? null : vendor;
    emit({ filter: true });
  }

  /** Rail tag click: select the tag, or deselect when re-clicked. */
  function toggleTag(tag) {
    state.tag = state.tag === tag ? null : tag;
    emit({ filter: true });
  }

  /** 全部 button: drop the vendor + tag filters (query is kept). */
  function clearFilters() {
    state.vendor = null;
    state.tag = null;
    emit({ filter: true });
  }

  /** Select a record row (click / keyboard). */
  function select(id) {
    state.selectedId = id;
    emit({ selection: true });
  }

  /** State hygiene when the vault closes. No emit: the app screen is being
   *  hidden, nothing is painted. */
  function reset() {
    state.records = [];
    state.vendors = [];
    state.tags = [];
    state.query = "";
    state.vendor = null;
    state.tag = null;
    state.selectedId = null;
  }

  /** Subscribe to change aspects; returns an unsubscribe function. */
  function subscribe(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  }

  return {
    state, // live read-only by convention — writes go through the methods
    visibleRecords,
    hasActiveFilter,
    setRecords,
    setQuery,
    toggleVendor,
    toggleTag,
    clearFilters,
    select,
    reset,
    subscribe,
  };
}
