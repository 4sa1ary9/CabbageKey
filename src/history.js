// Pure helpers for the vault chooser's recent-history list.
// DOM glue lives in main.js; only shape mapping lives here (unit-tested).

/**
 * Annotate history entries with an `exists` flag for rendering.
 * `existsList` comes from parallel vault_exists checks, same order as entries;
 * a missing/errored check counts as false (entry shown as 失效).
 */
export function annotateHistoryEntries(entries, existsList) {
  return entries.map((e, i) => ({ ...e, exists: Boolean(existsList && existsList[i]) }));
}
