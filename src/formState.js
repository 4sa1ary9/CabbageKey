// Pure form-state logic for the add/edit dialog: vendor preset auto-fill,
// the API-standard toggle/focus state machine, and submit payload building.
// No Tauri, no DOM here so it can be unit-tested with vitest.
import { getPreset } from "./vendorPresets.js";

// FormState = { endpoints: { standardKey → url }, activeStd: standardKey|null }

/** First key of an object, or null when empty. */
function firstKey(obj) {
  const keys = Object.keys(obj);
  return keys[0] || null;
}

/** Fresh form state. */
function createFormState(endpoints = {}, activeStd = null) {
  return { endpoints: { ...endpoints }, activeStd };
}

/** State for the form when opened on a record (pass null for add). */
export function openRecordFormState(record) {
  const endpoints = record && record.endpoints ? record.endpoints : {};
  return createFormState(endpoints, firstKey(endpoints));
}

/** Vendor preset auto-fill: website + standards + focus the first standard. */
export function applyVendorPreset(vendorName) {
  const preset = getPreset(vendorName);
  if (!preset) return { endpoints: {}, activeStd: null, website: "" };
  const endpoints = { ...preset.standards };
  return { endpoints, activeStd: firstKey(endpoints), website: preset.website };
}

/** Save the URL currently shown in the input into the active standard. */
export function saveActiveUrl(state, url) {
  if (!state.activeStd) return state;
  return { ...state, endpoints: { ...state.endpoints, [state.activeStd]: String(url).trim() } };
}

/** Trim endpoint URL values (keys are kept — matches previous submit behavior). */
export function trimEndpointUrls(endpoints) {
  const out = {};
  for (const [key, val] of Object.entries(endpoints)) out[key] = String(val).trim();
  return out;
}

/** Toggle a standard: activate it (fill presetUrl) or deactivate it and refocus the first remaining. */
export function toggleStandard(state, std, currentUrl, presetUrl) {
  const next = saveActiveUrl(state, currentUrl);
  if (next.endpoints[std] !== undefined) {
    const endpoints = { ...next.endpoints };
    delete endpoints[std];
    return createFormState(endpoints, firstKey(endpoints));
  }
  return createFormState({ ...next.endpoints, [std]: presetUrl }, std);
}

/** Switch the displayed standard, saving the current URL first. No-op if std is not active. */
export function focusStandard(state, std, currentUrl) {
  if (state.endpoints[std] === undefined) return state;
  const next = saveActiveUrl(state, currentUrl);
  return createFormState(next.endpoints, std);
}

/** Combined click decision: focus an already-active standard, else toggle it. */
export function handleStdClick(state, std, currentUrl, presetUrl) {
  if (state.endpoints[std] !== undefined && std !== state.activeStd) {
    return focusStandard(state, std, currentUrl);
  }
  return toggleStandard(state, std, currentUrl, presetUrl);
}

/** First supported standard shown in the detail panel, or null. */
export function getDefaultStandard(endpoints) {
  return firstKey(endpoints || {});
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
