// KeyVault frontend controller — thin DOM shell. Wires the vault chooser +
// three-pane UI to Tauri commands. Testable business logic lives in
// filter.js / vendorPresets.js / formState.js / history.js / order.js
// (unit-tested); this file is event wiring + rendering glue.
import { invoke } from "@tauri-apps/api/core";
import { writeText, clear as clearClipboard } from "@tauri-apps/plugin-clipboard-manager";
import { open as openDialog, save as saveDialog, message } from "@tauri-apps/plugin-dialog";
import { filterRecords, groupByVendor, emptyStateKind } from "./filter.js";
import { getEndpointUrl, getStandardLabel, ALL_STANDARDS } from "./vendorPresets.js";
import { vendorCandidates, filterVendorCandidates } from "./vendorDropdown.js";
import {
  openRecordFormState,
  applyVendorPreset,
  backfillPresetEndpoints,
  toggleStandard,
  buildRecordInput,
  validateRecordInput,
} from "./formState.js";
import { annotateHistoryEntries } from "./history.js";
import { escapeHtml } from "./html.js";
import { buildDetailBodyHtml, MASKED_API_KEY } from "./detailView.js";
import { moveBefore } from "./order.js";

const CLIPBOARD_CLEAR_SECONDS = 30; // auto-clear window after copy

// ---- session-ish UI state ----
const state = {
  records: [],
  vendors: [],
  tags: [],
  query: "",
  vendor: null,
  tag: null,
  selectedId: null,
  editingId: null,
};

const $ = (id) => document.getElementById(id);

// ---------------- Vault chooser (open existing / new, no password) ----------------
async function openVault(path) {
  const err = $("vault-error");
  err.textContent = "";
  try {
    applyView(await invoke("open_vault", { path }));
    enterApp();
  } catch (e) {
    err.textContent = String(e);
  }
}

async function createVault(path) {
  const err = $("vault-error");
  err.textContent = "";
  try {
    applyView(await invoke("create_vault", { path }));
    enterApp();
  } catch (e) {
    err.textContent = String(e);
  }
}

function showVaultScreen() {
  $("vault-screen").hidden = false;
  $("app").hidden = true;
  renderVaultHistory();
}

// Refresh the recent-history list on the chooser page. Called whenever the
// screen is shown — history always reflects the latest open/create/remove.
async function renderVaultHistory() {
  const ul = $("vault-history-list");
  let entries = [];
  try {
    entries = await invoke("get_vault_history");
  } catch (_) {
    // No history available — leave the list empty.
  }
  if (!entries.length) {
    ul.innerHTML = "";
    return;
  }
  // Check file existence for each entry in parallel (drives the 置灰 state).
  const existsList = await Promise.all(
    entries.map((e) => invoke("vault_exists", { path: e.path }).catch(() => false))
  );
  ul.innerHTML = annotateHistoryEntries(entries, existsList)
    .map((entry) => {
      const missingClass = entry.exists ? "" : " vault-history-missing";
      const missingLabel = entry.exists ? "" : '<span class="vault-history-gone">文件不存在</span>';
      return `<li class="vault-history-item${missingClass}" data-path="${escapeHtml(entry.path)}">
        <div class="vault-history-info">
          <span class="vault-history-name">${escapeHtml(entry.display_name)}</span>
          <span class="vault-history-path">${escapeHtml(entry.path)}</span>
          ${missingLabel}
        </div>
        <button type="button" class="vault-history-remove" data-remove-path="${escapeHtml(entry.path)}" title="从历史移除">×</button>
      </li>`;
    })
    .join("");
}

function enterApp() {
  $("vault-screen").hidden = true;
  $("app").hidden = false;
  $("search").focus();
}

// "切换 vault" from the main UI: close the current vault and return to the
// chooser, where another vault can be opened or created — still no password.
async function onSwitchVault() {
  try {
    await invoke("close_vault");
  } catch (_) { }
  state.records = [];
  state.vendors = [];
  state.tags = [];
  state.query = "";
  state.vendor = null;
  state.tag = null;
  state.selectedId = null;
  state.editingId = null;
  $("search").value = "";
  $("vault-error").textContent = "";
  showVaultScreen();
}

async function onOpenExisting() {
  const path = await openDialog({ multiple: false, filters: [{ name: "Vault JSON", extensions: ["json"] }] });
  if (path) openVault(path);
}

async function onCreateNew() {
  const path = await saveDialog({ defaultPath: "vault.json", filters: [{ name: "Vault JSON", extensions: ["json"] }] });
  if (path) createVault(path);
}

// Startup: open the last-used vault directly, else show the chooser.
// If the remembered file is gone, show the chooser with a hint.
async function initVaultScreen() {
  try {
    const info = await invoke("startup_info");
    if (info.last_path) {
      if (await invoke("vault_exists", { path: info.last_path })) {
        openVault(info.last_path);
        return;
      }
      $("vault-hint").textContent = "上次使用的 vault 文件不存在，请重新打开或新建";
    }
  } catch (_) {
    // startup_info failed — fall through to the chooser
  }
  showVaultScreen();
}

// ---------------- Copy with clear-countdown ----------------
let clearTimer = null;
async function copyValue(label, value) {
  await writeText(value);
  showToast(`${label} 已复制，${CLIPBOARD_CLEAR_SECONDS} 秒后自动清空剪贴板`);
  if (clearTimer) clearTimeout(clearTimer);
  clearTimer = setTimeout(async () => {
    try {
      // Only clear if our value is still there — don't clobber a later copy.
      await clearClipboard();
    } catch (_) { }
  }, CLIPBOARD_CLEAR_SECONDS * 1000);
}

let toastTimer = null;
function showToast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2500);
}

// placeholder-render-and-events
function applyView(view) {
  state.records = view.records;
  state.vendors = view.vendors;
  state.tags = view.tags;
  if (state.selectedId && !state.records.find((r) => r.id === state.selectedId)) {
    state.selectedId = null;
  }
  populatePurposeDatalist();
  render();
}

// Purpose candidates: distinct usage names in this vault, sorted.
function populatePurposeDatalist() {
  const purposeOpts = [...new Set(state.records.map((r) => r.name))].sort();
  $("purpose-candidates").innerHTML = purposeOpts
    .map((n) => `<option value="${escapeHtml(n)}"></option>`)
    .join("");
}

// ---------------- Vendor dropdown (custom combobox) ----------------
// vendorDd = { open, highlighted, list, applied } — UI state for #f-vendor.
const vendorDd = { open: false, highlighted: -1, list: [], applied: "" };

function openVendorPanel() {
  vendorDd.open = true;
  vendorDd.highlighted = -1;
  $("vendor-dd-panel").hidden = false;
  $("f-vendor").setAttribute("aria-expanded", "true");
  renderVendorPanel();
}

function closeVendorPanel() {
  vendorDd.open = false;
  $("vendor-dd-panel").hidden = true;
  $("f-vendor").setAttribute("aria-expanded", "false");
}

// Re-render the filtered candidate list, keeping the highlight in range.
function renderVendorPanel() {
  vendorDd.list = filterVendorCandidates(vendorCandidates(state.vendors), $("f-vendor").value);
  if (vendorDd.highlighted >= vendorDd.list.length) vendorDd.highlighted = vendorDd.list.length - 1;
  $("vendor-dd-list").innerHTML = vendorDd.list
    .map(
      (name, i) =>
        `<li role="option" data-vendor="${escapeHtml(name)}" data-active="${vendorDd.highlighted === i}">${escapeHtml(name)}</li>`
    )
    .join("");
}

/** Set the vendor value and trigger the existing auto-fill rule. */
function applyVendor(name) {
  $("f-vendor").value = name;
  onVendorChange();
  closeVendorPanel();
}

function onVendorKeydown(e) {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (!vendorDd.open) openVendorPanel();
    if (!vendorDd.list.length) return;
    const step = e.key === "ArrowDown" ? 1 : -1;
    if (vendorDd.highlighted < 0) {
      vendorDd.highlighted = step === 1 ? 0 : vendorDd.list.length - 1;
    } else {
      vendorDd.highlighted = Math.min(Math.max(vendorDd.highlighted + step, 0), vendorDd.list.length - 1);
    }
    renderVendorPanel();
  } else if (e.key === "Enter") {
    if (!vendorDd.open) return; // panel closed → let the form submit normally
    e.preventDefault();
    if (vendorDd.highlighted >= 0) applyVendor(vendorDd.list[vendorDd.highlighted]);
    else if ($("f-vendor").value.trim()) applyVendor($("f-vendor").value); // custom vendor
    else closeVendorPanel();
  } else if (e.key === "Escape") {
    if (!vendorDd.open) return; // panel closed → let the dialog handle Escape
    e.preventDefault();
    closeVendorPanel();
  }
}

// ---------------- Rendering ----------------
function visibleRecords() {
  return filterRecords(state.records, {
    query: state.query,
    vendor: state.vendor,
    tag: state.tag,
  });
}

function render() {
  renderRail();
  renderList();
  renderDetail();
}

function renderRail() {
  $("count-all").textContent = state.records.length;
  $("filter-all").dataset.active = (!state.vendor && !state.tag).toString();

  const groups = groupByVendor(state.records);
  $("vendor-list").innerHTML = state.vendors
    .map(
      (v) =>
        `<li><button class="rail-item" data-vendor="${escapeHtml(v)}" data-active="${state.vendor === v
        }">${escapeHtml(v)} <span class="count">${groups[v] || 0}</span></button></li>`
    )
    .join("");

  $("tag-list").innerHTML = state.tags
    .map(
      (t) =>
        `<li><button class="rail-item" data-tag="${escapeHtml(t)}" data-active="${state.tag === t
        }">#${escapeHtml(t)}</button></li>`
    )
    .join("");
}

function renderList() {
  const list = visibleRecords();
  const ul = $("record-list");
  const empty = $("empty-state");
  const hasActiveFilter = !!(state.query || state.vendor || state.tag);

  const kind = emptyStateKind({
    totalRecords: state.records.length,
    visibleRecords: list.length,
    hasActiveFilter,
  });

  if (kind) {
    ul.innerHTML = "";
    empty.hidden = false;
    empty.innerHTML = renderEmptyState(kind);
    return;
  }
  empty.hidden = true;
  // Draggable only when unfiltered — reordering needs the full global order.
  ul.innerHTML = list
    .map(
      (r) =>
        `<li><div class="record-item" data-id="${r.id}" draggable="${hasActiveFilter
        ? "false"
        : "true"}" data-active="${state.selectedId === r.id
        }" tabindex="0" role="button">
          <div class="record-name">${escapeHtml(r.name)}</div>
          <div class="record-meta">${escapeHtml(r.vendor || "未分组")}${r.tags.length ? " · " + r.tags.map((t) => "#" + escapeHtml(t)).join(" ") : ""
        }</div>
        </div></li>`
    )
    .join("");
}

function renderEmptyState(kind) {
  if (kind === "first-run") {
    return `<h3>还没有任何密钥</h3>
      <p>把你散落各处的 API key 收进来。每条至少填用途名称和 key。</p>
      <button class="btn-primary" id="empty-add">+ 新增第一个密钥</button>`;
  }
  return `<h3>没有匹配的记录</h3>
    <p>当前搜索或筛选下没有结果。</p>
    <button class="btn-secondary" id="empty-clear">清除筛选</button>`;
}

function renderDetail() {
  const ph = $("detail-placeholder");
  const content = $("detail-content");
  const rec = state.records.find((r) => r.id === state.selectedId);
  if (!rec) {
    ph.hidden = false;
    content.hidden = true;
    return;
  }
  ph.hidden = true;
  content.hidden = false;
  content.innerHTML = buildDetailBodyHtml(rec);

  // Per-URL copy buttons (delegated on the freshly rendered list)
  $("detail-content").querySelector(".detail-url-list").addEventListener("click", (e) => {
    const btn = e.target.closest(".copy-url");
    if (!btn) return;
    withCopied(btn, () => copyValue("url", btn.dataset.url));
  });

  // reveal toggles the masked key
  $("reveal-btn").onclick = () => {
    const el = $("secret-val");
    const masked = el.dataset.masked === "true";
    el.textContent = masked ? rec.api_key : MASKED_API_KEY;
    el.dataset.masked = (!masked).toString();
    $("reveal-btn").textContent = masked ? "🙈 隐藏" : "👁 显示";
  };
  $("copy-key").onclick = () => withCopied($("copy-key"), () => copyValue("api_key", rec.api_key));
  $("edit-btn").onclick = () => openForm(rec);
  $("delete-btn").onclick = () => onDelete(rec);
}

async function withCopied(btn, fn) {
  await fn();
  btn.classList.add("copied");
  const orig = btn.textContent;
  btn.textContent = "✓ 已复制";
  setTimeout(() => {
    btn.classList.remove("copied");
    btn.textContent = orig;
  }, 1500);
}

// ---------------- Form (add / edit) ----------------
// formState = { endpoints } — mutated only by pure functions from formState.js;
// URL input rows mirror endpoints live via the "input" listener below.
let formState = openRecordFormState(null);

// Toggle buttons mirror formState.endpoints: lit = active with URL,
// gray = active but URL empty, plain = inactive.
function syncStdToggles() {
  $("f-standards-group").querySelectorAll(".std-toggle").forEach((btn) => {
    const std = btn.dataset.std;
    const active = std in formState.endpoints;
    const hasUrl = !!formState.endpoints[std];
    btn.dataset.active = (active && hasUrl).toString();
    btn.dataset.gray = (active && !hasUrl).toString();
  });
}

// One URL input row per active standard; nothing shown when none active.
function renderUrlRows() {
  const stds = ALL_STANDARDS.filter((s) => s in formState.endpoints);
  $("f-url-section").hidden = !stds.length;
  $("f-url-rows").innerHTML = stds
    .map(
      (std) => `<div class="url-row" data-std="${std}">
      <span class="url-row-label">${escapeHtml(getStandardLabel(std))}</span>
      <input class="url-row-input" type="text" autocomplete="off" value="${escapeHtml(formState.endpoints[std])}" />
    </div>`
    )
    .join("");
}

function openForm(rec) {
  state.editingId = rec ? rec.id : null;
  $("dialog-title").textContent = rec ? "编辑密钥" : "新增密钥";
  $("f-name").value = rec ? rec.name : "";
  $("f-key").value = rec ? rec.api_key : "";
  $("f-vendor").value = rec ? rec.vendor : "";
  vendorDd.highlighted = -1;
  vendorDd.applied = rec ? rec.vendor || "" : "";
  closeVendorPanel();
  $("f-website").value = rec ? (rec.website || "") : "";
  $("f-tags").value = rec ? rec.tags.join(", ") : "";
  $("f-note").value = rec ? rec.note : "";
  $("form-error").textContent = "";
  // Backfill preset URLs for standards the record is missing (never overwrites).
  const st = openRecordFormState(rec);
  formState = { endpoints: backfillPresetEndpoints(st.endpoints, rec ? rec.vendor : "") };
  syncStdToggles();
  renderUrlRows();
  $("record-dialog").showModal();
  $("f-name").focus();
}

/** Vendor input change: full-replace website + standards from the preset. */
function onVendorChange() {
  const vendor = $("f-vendor").value;
  vendorDd.applied = vendor;
  const preset = applyVendorPreset(vendor);
  formState = preset;
  $("f-website").value = preset.website;
  syncStdToggles();
  renderUrlRows();
}

/** Click a standard: one click toggles it on (with preset URL) or off. */
function onStdGroupClick(e) {
  const btn = e.target.closest("[data-std]");
  if (!btn) return;
  const std = btn.dataset.std;
  const presetUrl = getEndpointUrl($("f-vendor").value, std);
  formState = toggleStandard(formState, std, presetUrl);
  syncStdToggles();
  renderUrlRows();
}

async function onFormSubmit(e) {
  e.preventDefault();
  const input = buildRecordInput({
    name: $("f-name").value,
    apiKey: $("f-key").value,
    vendor: $("f-vendor").value,
    website: $("f-website").value,
    note: $("f-note").value,
    tagsText: $("f-tags").value,
    endpoints: formState.endpoints,
  });
  const err = validateRecordInput(input);
  if (err) {
    $("form-error").textContent = err;
    return;
  }

  try {
    const cmd = state.editingId ? "update_record" : "add_record";
    const args = state.editingId ? { id: state.editingId, input } : { input };
    const view = await invoke(cmd, args);
    applyView(view);
    $("record-dialog").close();
  } catch (e) {
    $("form-error").textContent = String(e);
  }
}

async function onDelete(rec) {
  const ok = await message(`确定删除 “${rec.name}” ？此操作不可撤销。`, {
    title: "删除确认",
    kind: "warning",
    okLabel: "删除",
    cancelLabel: "取消",
  });
  if (!ok) return;
  try {
    const view = await invoke("delete_record", { id: rec.id });
    if (state.selectedId === rec.id) state.selectedId = null;
    applyView(view);
  } catch (e) {
    showToast(String(e));
  }
}

// ---------------- Drag-to-reorder (HTML5 DnD, no deps) ----------------
// Reordering rewrites the global order, so drag is enabled only when no
// filter (search / vendor / tag) is active. While dragging, the <li> moves
// live to show the target slot; on drop the new order is computed with
// `moveBefore` and committed via `reorder_records` (persists to disk).
const drag = { el: null, id: null, moved: false, suppressClick: false, dropped: false };

function itemIdOf(li) {
  return li.querySelector(".record-item")?.dataset.id ?? null;
}

// Upper half of an item = slot above it; lower half = slot below it.
function overUpperHalf(li, clientY) {
  const rect = li.getBoundingClientRect();
  return clientY < rect.top + rect.height / 2;
}

function onDragStart(e) {
  const li = e.target.closest("li");
  if (!li || !itemIdOf(li)) return;
  drag.el = li;
  drag.id = itemIdOf(li);
  drag.moved = false;
  drag.dropped = false;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", drag.id); // required for Firefox to start a drag
  li.classList.add("dragging");
}

// `drag` fires repeatedly while the pointer moves — this is what separates a
// real drag from a plain click (which must keep selecting the record).
function onDrag(e) {
  drag.moved = true;
}

function onDragOver(e) {
  if (!drag.el) return;
  e.preventDefault(); // required to allow the drop
  const li = e.target.closest("li");
  if (!li || li === drag.el) return;
  if (overUpperHalf(li, e.clientY)) {
    // slot above the hovered item
    if (li.previousElementSibling !== drag.el) li.before(drag.el);
  } else {
    // slot below the hovered item
    if (li.nextElementSibling !== drag.el) li.after(drag.el);
  }
}

function onDrop(e) {
  if (!drag.el) return;
  e.preventDefault();
  drag.dropped = true;
  const el = drag.el;
  el.classList.remove("dragging");
  const dropLi = e.target.closest("li");
  // Dropped on the dragged item itself or outside the items — restore.
  if (!dropLi || dropLi === el) {
    renderList();
    return;
  }
  // "Below the target" means "before its next sibling" (skipping the dragged
  // item, which sits right next to the target while dragging).
  let beforeId;
  if (overUpperHalf(dropLi, e.clientY)) {
    beforeId = itemIdOf(dropLi);
  } else {
    let next = dropLi.nextElementSibling;
    while (next === el) next = next.nextElementSibling;
    beforeId = next ? itemIdOf(next) : null;
  }
  const ids = state.records.map((r) => r.id);
  const nextOrder = moveBefore(ids, drag.id, beforeId);
  if (nextOrder.every((id, i) => id === ids[i])) {
    renderList(); // nothing actually changed — restore the live DOM
    return;
  }
  invoke("reorder_records", { ids: nextOrder })
    .then(applyView)
    .catch((err) => {
      showToast(String(err));
      renderList(); // restore the pre-drag order
    });
}

function onDragEnd() {
  drag.el?.classList.remove("dragging");
  if (!drag.dropped) renderList(); // cancelled / dropped outside — restore order
  drag.suppressClick = drag.moved;
  drag.el = null;
  drag.id = null;
}

// Expire the suppress flag on the next interaction start: every click is
// preceded by its own mousedown, so the click that trails a drag (if a
// browser fires one) is consumed, while the user's next click works.
function expireSuppress() {
  drag.suppressClick = false;
}

// While a drag is active, swallow document-level drops so releasing outside
// the list never navigates away (Chrome treats dropped text as a link).
function swallowDrop(e) {
  if (drag.el) e.preventDefault();
}

// ---------------- Events ----------------
function wireEvents() {
  $("open-existing-btn").addEventListener("click", onOpenExisting);
  $("create-new-btn").addEventListener("click", onCreateNew);
  $("switch-vault-btn").addEventListener("click", onSwitchVault);

  // History list: click an entry to open it, click × to remove it.
  $("vault-history-list").addEventListener("click", async (e) => {
    const removeBtn = e.target.closest("[data-remove-path]");
    if (removeBtn) {
      e.stopPropagation();
      try {
        await invoke("remove_vault_history", { path: removeBtn.dataset.removePath });
      } catch (_) { }
      renderVaultHistory();
      return;
    }
    const item = e.target.closest("[data-path]");
    if (item) openVault(item.dataset.path);
  });

  $("add-btn").addEventListener("click", () => openForm(null));
  $("search").addEventListener("input", (e) => {
    state.query = e.target.value;
    renderList();
  });

  $("filter-all").addEventListener("click", () => {
    state.vendor = null;
    state.tag = null;
    render();
  });

  // delegated rail clicks
  $("vendor-list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-vendor]");
    if (!b) return;
    state.vendor = state.vendor === b.dataset.vendor ? null : b.dataset.vendor;
    render();
  });
  $("tag-list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tag]");
    if (!b) return;
    state.tag = state.tag === b.dataset.tag ? null : b.dataset.tag;
    render();
  });

  // delegated record selection (click + keyboard)
  const selectFrom = (e) => {
    if (drag.suppressClick) {
      drag.suppressClick = false; // a real drag just ended — not a click
      return;
    }
    const item = e.target.closest("[data-id]");
    if (!item) return;
    state.selectedId = item.dataset.id;
    render();
  };
  $("record-list").addEventListener("click", selectFrom);
  $("record-list").addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      selectFrom(e);
    }
  });

  // drag-to-reorder (only enabled on items when no filter is active)
  $("record-list").addEventListener("dragstart", onDragStart);
  $("record-list").addEventListener("drag", onDrag);
  $("record-list").addEventListener("dragover", onDragOver);
  $("record-list").addEventListener("drop", onDrop);
  $("record-list").addEventListener("dragend", onDragEnd);
  document.addEventListener("dragover", swallowDrop);
  document.addEventListener("drop", swallowDrop);
  document.addEventListener("mousedown", expireSuppress);
  document.addEventListener("keydown", expireSuppress);

  // empty-state buttons (delegated, they re-render)
  $("empty-state").addEventListener("click", (e) => {
    if (e.target.id === "empty-add") openForm(null);
    if (e.target.id === "empty-clear") {
      state.query = "";
      state.vendor = null;
      state.tag = null;
      $("search").value = "";
      render();
    }
  });

  $("record-form").addEventListener("submit", onFormSubmit);
  $("form-cancel").addEventListener("click", () => $("record-dialog").close());
  // 点击 dialog 外部区域（backdrop）关闭
  $("record-dialog").addEventListener("click", (e) => {
    const rect = $("record-dialog").getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right ||
      e.clientY < rect.top || e.clientY > rect.bottom) {
      $("record-dialog").close();
    }
  });
  // Vendor dropdown: open on focus/typing, filter as you type, keyboard + click
  // selection, click-outside close. Value changes run the auto-fill rule once —
  // the `applied` guard stops a later blur from re-applying and clobbering edits.
  $("f-vendor").addEventListener("focus", openVendorPanel);
  // Reopen after the panel was closed by a click-outside (focus stays in input).
  $("f-vendor").addEventListener("click", () => {
    if (!vendorDd.open) openVendorPanel();
  });
  $("f-vendor").addEventListener("input", () => {
    if (!vendorDd.open) openVendorPanel();
    vendorDd.highlighted = -1;
    renderVendorPanel();
  });
  $("f-vendor").addEventListener("keydown", onVendorKeydown);
  $("f-vendor").addEventListener("blur", closeVendorPanel);
  $("f-vendor").addEventListener("change", () => {
    if ($("f-vendor").value !== vendorDd.applied) onVendorChange();
  });
  $("vendor-dd-list").addEventListener("mousedown", (e) => {
    e.preventDefault(); // keep focus in the input so blur doesn't commit first
    const item = e.target.closest("[data-vendor]");
    if (item) applyVendor(item.dataset.vendor);
  });
  document.addEventListener("click", (e) => {
    if (vendorDd.open && !e.target.closest("#vendor-dd")) closeVendorPanel();
  });
  $("f-standards-group").addEventListener("click", onStdGroupClick);
  // Typing in a URL row updates its standard live (drives lit/gray button state).
  $("f-url-rows").addEventListener("input", (e) => {
    const row = e.target.closest("[data-std]");
    if (!row) return;
    const std = row.dataset.std;
    if (std in formState.endpoints) {
      formState.endpoints[std] = e.target.value;
      syncStdToggles();
    }
  });
}

wireEvents();
initVaultScreen();
