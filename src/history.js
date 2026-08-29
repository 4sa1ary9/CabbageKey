// Owner of the vault chooser's recent-history enrichment: probe every
// entry's file existence in parallel and annotate the results. Rendering
// (DOM glue) stays in main.js; unit-tested.

/**
 * Probe `existsFn(path)` for every entry in parallel and annotate each entry
 * with an `exists` flag for rendering. Result order matches `entries`; a
 * missing or errored probe counts as false (entry shown as 失效).
 * `existsFn` is injected — production passes `api.vaultExists`, tests a stub.
 */
export async function enrichHistory(entries, existsFn) {
  const existsList = await Promise.all(
    entries.map((e) => existsFn(e.path).catch(() => false))
  );
  return entries.map((e, i) => ({ ...e, exists: Boolean(existsList[i]) }));
}
