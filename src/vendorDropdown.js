// Pure logic for the custom vendor dropdown in the add/edit form.
// Candidate list building + filtering. No Tauri, no DOM — unit-testable.
import { VENDOR_PRESETS } from "./vendorPresets.js";

/** Full candidate list: built-in presets first (preset order), then vault-used
 *  names not already covered — deduped. */
export function vendorCandidates(usedNames) {
  const out = [];
  const seen = new Set();
  for (const name of [...VENDOR_PRESETS.map((p) => p.name), ...usedNames]) {
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/** Case-insensitive substring filter on the trimmed query. */
export function filterVendorCandidates(candidates, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [...candidates];
  return candidates.filter((c) => c.toLowerCase().includes(q));
}
