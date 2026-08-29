// Pure retrieval logic (D2 filter-stacking): search text + vendor + tag all
// narrow the same record list, independently and composably. No Tauri, no DOM
// here so it can be unit-tested with vitest.

/** Synthetic rail entry for records without a vendor — display layer only:
 *  never persisted, never part of the backend's vendor list. */
export const UNGROUPED = "未分组";

/** The one grouping-key rule shared by counts, rail and vendor filter. */
function vendorKey(vendor) {
  return vendor && vendor.trim() ? vendor : UNGROUPED;
}

/**
 * @param {Array} records
 * @param {{query?: string, vendor?: string|null, tag?: string|null}} filters
 */
export function filterRecords(records, { query = "", vendor = null, tag = null } = {}) {
  const q = query.trim().toLowerCase();
  return records.filter((r) => {
    // vendor filter: exact match on the grouping dimension (same key rule as
    // the rail counts, so 未分组 selects records without a vendor)
    if (vendor && vendorKey(r.vendor) !== vendor) return false;
    // tag filter: record must carry the selected tag
    if (tag && !(r.tags || []).includes(tag)) return false;
    // text search: matches 用途名称 / 厂商 / 备注 / api_key / 端点 URL / 标签
    if (q) {
      const hay = [
        r.name || "",
        r.vendor || "",
        r.note || "",
        r.api_key || "",
        ...Object.values(r.endpoints || {}),
        ...(r.tags || []),
      ]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** Group records by vendor for the left-rail counts. Empty vendor -> 未分组. */
export function groupByVendor(records) {
  const groups = {};
  for (const r of records) {
    const key = vendorKey(r.vendor);
    groups[key] = (groups[key] || 0) + 1;
  }
  return groups;
}

/** Keep the vendor filter after a view update only if its target still
 *  exists: a real vendor must still be listed, the 未分组 sentinel only
 *  while ungrouped records remain. Otherwise a deleted vendor would leave a
 *  silent "no results" dead end with nothing highlighted in the rail. */
export function vendorFilterValid(vendor, records, vendors) {
  if (!vendor) return true;
  if (vendor === UNGROUPED) return records.some((r) => !(r.vendor && r.vendor.trim()));
  return vendors.includes(vendor);
}

/** Same rule for the tag filter. */
export function tagFilterValid(tag, tags) {
  return !tag || tags.includes(tag);
}

/** Which empty-state to show (D3): distinguishes first-run from no-results. */
export function emptyStateKind({ totalRecords, visibleRecords, hasActiveFilter }) {
  if (totalRecords === 0) return "first-run"; // 库是空的，引导新增
  if (visibleRecords === 0 && hasActiveFilter) return "no-results"; // 搜索/筛选无果
  return null;
}
