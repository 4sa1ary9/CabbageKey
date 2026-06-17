// Pure retrieval logic (D2 filter-stacking): search text + vendor + tag all
// narrow the same record list, independently and composably. No Tauri, no DOM
// here so it can be unit-tested with vitest.

/**
 * @param {Array} records
 * @param {{query?: string, vendor?: string|null, tag?: string|null}} filters
 */
export function filterRecords(records, { query = "", vendor = null, tag = null } = {}) {
  const q = query.trim().toLowerCase();
  return records.filter((r) => {
    // vendor filter: exact match on the grouping dimension
    if (vendor && r.vendor !== vendor) return false;
    // tag filter: record must carry the selected tag
    if (tag && !(r.tags || []).includes(tag)) return false;
    // text search: matches 用途名称 / 厂商 / 备注 / 标签
    if (q) {
      const hay = [
        r.name || "",
        r.vendor || "",
        r.note || "",
        ...(r.tags || []),
      ]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** Group records by vendor for the left-rail counts. Empty vendor -> "未分组". */
export function groupByVendor(records) {
  const groups = {};
  for (const r of records) {
    const key = r.vendor && r.vendor.trim() ? r.vendor : "未分组";
    groups[key] = (groups[key] || 0) + 1;
  }
  return groups;
}

/** Which empty-state to show (D3): distinguishes first-run from no-results. */
export function emptyStateKind({ totalRecords, visibleRecords, hasActiveFilter }) {
  if (totalRecords === 0) return "first-run"; // 库是空的，引导新增
  if (visibleRecords === 0 && hasActiveFilter) return "no-results"; // 搜索/筛选无果
  return null;
}
