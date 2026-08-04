// Pure form-state logic for the add/edit dialog: vendor preset auto-fill,
// preset URL backfill on edit, and the API-standard toggle state.
// No Tauri, no DOM here so it can be unit-tested with vitest.
import { getPreset } from "./vendorPresets.js";

// FormState = { endpoints: { standardKey → url } }

/** Fresh form state. */
function createFormState(endpoints = {}) {
  return { endpoints: { ...endpoints } };
}

/** State for the form when opened on a record (pass null for add). */
export function openRecordFormState(record) {
  const endpoints = record && record.endpoints ? record.endpoints : {};
  return createFormState(endpoints);
}

/** Vendor preset auto-fill: website + standards (full replace). */
export function applyVendorPreset(vendorName) {
  const preset = getPreset(vendorName);
  if (!preset) return { endpoints: {}, website: "" };
  return { endpoints: { ...preset.standards }, website: preset.website };
}

/** Backfill: fill in only standards missing from the record's endpoints,
 *  never overwriting existing values (not even empty ones). */
export function backfillPresetEndpoints(endpoints, vendorName) {
  const preset = getPreset(vendorName);
  const merged = { ...(endpoints || {}) };
  if (!preset) return merged;
  for (const [std, url] of Object.entries(preset.standards)) {
    if (!(std in merged)) merged[std] = url;
  }
  return merged;
}

/** Toggle a standard: add it (with presetUrl, empty for custom vendors) or remove it. */
export function toggleStandard(state, std, presetUrl) {
  const endpoints = { ...state.endpoints };
  if (std in endpoints) delete endpoints[std];
  else endpoints[std] = presetUrl;
  return createFormState(endpoints);
}

/** Trim endpoint URL values (keys are kept — matches previous submit behavior). */
export function trimEndpointUrls(endpoints) {
  const out = {};
  for (const [key, val] of Object.entries(endpoints)) out[key] = String(val).trim();
  return out;
}

/** "翻译, 项目A" → ["翻译", "项目A"] (trims, drops empties). */
export function parseTags(text) {
  return String(text || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Build the record payload from form field values. */
export function buildRecordInput({ name, apiKey, vendor, website, note, tagsText, endpoints }) {
  return {
    name: String(name || ""),
    api_key: String(apiKey || ""),
    vendor: String(vendor || ""),
    endpoints: trimEndpointUrls(endpoints),
    website: String(website || ""),
    note: String(note || ""),
    tags: parseTags(tagsText),
  };
}

/** Required-field validation; returns an error message or null. */
export function validateRecordInput(input) {
  if (!String(input.name || "").trim()) return "用途名称不能为空";
  if (!String(input.api_key || "").trim()) return "api_key 不能为空";
  return null;
}
