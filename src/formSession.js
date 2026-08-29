// Owner of the add/edit dialog's lifecycle: field filling, endpoint state,
// the unsaved-changes guard, vendor-switch confirm/rollback, and the submit
// protocol (double-click guard + api call). DOM reads/writes go through the
// element handles injected at construction — no document lookups in here.
// Plugin dialogs (confirm asks) and event wiring stay with the caller, who
// passes them in as deps.
import { escapeHtml } from "./html.js";
import { ALL_STANDARDS, getStandardLabel, getEndpointUrl } from "./vendorPresets.js";
import {
  openRecordFormState,
  applyVendorPreset,
  backfillPresetEndpoints,
  toggleStandard,
  buildRecordInput,
  validateRecordInput,
  duplicateName,
  endpointState,
} from "./formState.js";

/**
 * els:   { name, key, vendor, website, tags, note, error, save,
 *          dialog, title, stdGroup, urlSection, urlRows }
 * deps:  { api, confirmDiscard(): Promise<bool>,
 *          confirmVendorSwitch(): Promise<bool>, onOpened()? }
 */
export function createFormSession(els, deps) {
  let editingId = null;    // set in edit mode; null = creating a new record
  let endpoints = {};      // standardKey → URL for the standards toggled on
  let appliedVendor = "";  // last committed vendor — setVendor's rollback target
  let snapshot = "";       // field values at open time — dirty-guard baseline
  let submitting = false;

  // Toggle lamps mirror endpoints: lit = declared with URL, gray = declared
  // but URL empty, plain = inactive.
  function paintStdToggles() {
    els.stdGroup.querySelectorAll(".std-toggle").forEach((btn) => {
      const { declared, hasUrl } = endpointState(endpoints, btn.dataset.std);
      btn.dataset.active = (declared && hasUrl).toString();
      btn.dataset.gray = (declared && !hasUrl).toString();
    });
  }

  // One URL input row per active standard; nothing shown when none active.
  function paintUrlRows() {
    const stds = ALL_STANDARDS.filter((s) => s in endpoints);
    els.urlSection.hidden = !stds.length;
    els.urlRows.innerHTML = stds
      .map(
        (std) => `<div class="url-row" data-std="${std}">
      <span class="url-row-label">${escapeHtml(getStandardLabel(std))}</span>
      <input class="url-row-input" type="text" autocomplete="off" value="${escapeHtml(endpoints[std])}" />
    </div>`
      )
      .join("");
  }

  /** Write the dialog fields from a record or a plain prefill object;
   *  missing keys become empty values. */
  function fillFields(fields) {
    els.name.value = fields.name || "";
    els.key.value = fields.api_key || "";
    els.vendor.value = fields.vendor || "";
    appliedVendor = fields.vendor || "";
    els.website.value = fields.website || "";
    els.tags.value = (fields.tags || []).join(", ");
    els.note.value = fields.note || "";
    els.error.textContent = "";
  }

  function snapshotNow() {
    return JSON.stringify({
      name: els.name.value,
      key: els.key.value,
      vendor: els.vendor.value,
      website: els.website.value,
      tags: els.tags.value,
      note: els.note.value,
      endpoints,
    });
  }

  /** Open the dialog in one of four modes:
   *  { kind: "add" } | { kind: "edit", rec }
   *  | { kind: "quick-add", vendor } | { kind: "duplicate", rec } */
  function open(mode) {
    editingId = null;
    let fields;
    if (mode.kind === "edit") {
      editingId = mode.rec.id;
      els.title.textContent = "编辑密钥";
      fields = mode.rec;
      // Backfill preset URLs for standards the record is missing (never overwrites).
      endpoints = backfillPresetEndpoints(mode.rec.endpoints, mode.rec.vendor);
    } else if (mode.kind === "quick-add") {
      // Preset vendors get their website + endpoint URLs (full-replace rule);
      // custom vendors just the name.
      els.title.textContent = "新增密钥";
      const preset = applyVendorPreset(mode.vendor);
      endpoints = preset.endpoints;
      fields = { vendor: mode.vendor, website: preset.website };
    } else if (mode.kind === "duplicate") {
      // Every field copied from the source record with the name suffixed
      // "_copy". No preset backfill — the copy mirrors the record's
      // endpoint URLs exactly.
      els.title.textContent = "新增密钥";
      fields = { ...mode.rec, name: duplicateName(mode.rec.name) };
      endpoints = openRecordFormState(mode.rec).endpoints;
    } else {
      els.title.textContent = "新增密钥";
      fields = {};
      endpoints = {};
    }
    fillFields(fields);
    deps.onOpened?.();
    paintStdToggles();
    paintUrlRows();
    snapshot = snapshotNow();
    els.dialog.showModal();
    els.name.focus();
  }

  /** Vendor change: full-replace website + standards from the preset.
   *  当表单里已有非空端点 URL 时先确认 — 全量替换（自定义厂商则清空）是破坏性的；
   *  取消则把输入框回滚到 applied。No-op unless `force` when the value
   *  didn't actually change (a blur's change event echoes the applied value). */
  async function setVendor(vendor, { force = false } = {}) {
    if (!force && vendor === appliedVendor) return;
    const preset = applyVendorPreset(vendor);
    if (Object.values(endpoints).some((url) => url && url.trim())) {
      const ok = await deps.confirmVendorSwitch();
      if (!ok) {
        els.vendor.value = appliedVendor; // 回退到切换前的厂商
        return;
      }
    }
    appliedVendor = vendor;
    endpoints = preset.endpoints;
    els.website.value = preset.website;
    paintStdToggles();
    paintUrlRows();
  }

  /** Click a standard: one click toggles it on (with preset URL) or off. */
  function toggleStd(std) {
    const presetUrl = getEndpointUrl(els.vendor.value, std);
    endpoints = toggleStandard({ endpoints }, std, presetUrl).endpoints;
    paintStdToggles();
    paintUrlRows();
  }

  // Live-sync while typing: only the toggle lamps repaint — the row the user
  // is typing in is not re-rendered (avoids cursor jumps).
  function setUrl(std, url) {
    if (!(std in endpoints)) return;
    endpoints[std] = url;
    paintStdToggles();
  }

  /** True when the current field values differ from the open-time snapshot. */
  function isDirty() {
    return snapshotNow() !== snapshot;
  }

  /** Close the dialog, confirming first when there are unsaved edits.
   *  Backdrop click / Esc route here; the explicit 取消 button closes directly. */
  async function confirmClose() {
    if (isDirty()) {
      const ok = await deps.confirmDiscard();
      if (!ok) return;
    }
    els.dialog.close();
  }

  /** Submit protocol: double-click guard → build + validate → api call.
   *  Resolves to the fresh VaultView on success; null on an in-flight
   *  submit, a validation error, or an api failure (error painted inline). */
  async function submit() {
    if (submitting) return null; // 命令在途：双击/连按 Enter 不产生第二条记录
    const input = buildRecordInput({
      name: els.name.value,
      apiKey: els.key.value,
      vendor: els.vendor.value,
      website: els.website.value,
      note: els.note.value,
      tagsText: els.tags.value,
      endpoints,
    });
    const err = validateRecordInput(input);
    if (err) {
      els.error.textContent = err;
      return null;
    }

    submitting = true;
    els.save.disabled = true;
    try {
      return editingId
        ? await deps.api.updateRecord(editingId, input)
        : await deps.api.addRecord(input);
    } catch (e) {
      els.error.textContent = String(e);
      return null;
    } finally {
      submitting = false;
      els.save.disabled = false;
    }
  }

  function close() {
    els.dialog.close();
  }

  return { open, setVendor, toggleStd, setUrl, isDirty, confirmClose, submit, close };
}
