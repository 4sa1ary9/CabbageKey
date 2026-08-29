// KeyVault frontend controller — thin DOM shell. Wires the vault chooser +
// three-pane UI to the Tauri command layer through api.js (the single invoke
// seam). Testable business logic lives in
// filter.js / vendorPresets.js / formState.js / history.js / order.js
// (unit-tested); this file is event wiring + rendering glue.
import * as api from "./api.js";
import { writeText, readText, clear as clearClipboard } from "@tauri-apps/plugin-clipboard-manager";
import { open as openDialog, save as saveDialog, message, ask } from "@tauri-apps/plugin-dialog";
import { filterRecords, groupByVendor, emptyStateKind, UNGROUPED, vendorFilterValid, tagFilterValid } from "./filter.js";
import { getEndpointUrl, getStandardLabel, ALL_STANDARDS } from "./vendorPresets.js";
import { vendorCandidates, filterVendorCandidates } from "./vendorDropdown.js";
import {
  openRecordFormState,
  applyVendorPreset,
  backfillPresetEndpoints,
  toggleStandard,
  buildRecordInput,
  validateRecordInput,
  duplicateName,
} from "./formState.js";
import { annotateHistoryEntries } from "./history.js";
import { escapeHtml } from "./html.js";
import { buildDetailBodyHtml, MASKED_API_KEY, revealButtonHtml } from "./detailView.js";
import { moveBefore, insertionSlot, nextAfterId } from "./order.js";

const CLIPBOARD_CLEAR_SECONDS = 30; // auto-clear window after copy
const REVEAL_AUTO_MASK_SECONDS = 30; // 明文 key 显示多久后自动回掩码

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
    applyView(await api.openVault(path));
    enterApp();
  } catch (e) {
    err.textContent = String(e);
  }
}

async function createVault(path) {
  const err = $("vault-error");
  err.textContent = "";
  try {
    applyView(await api.createVault(path));
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
    entries = await api.getVaultHistory();
  } catch (_) {
    // No history available — leave the list empty.
  }
  if (!entries.length) {
    ul.innerHTML = "";
    return;
  }
  // Check file existence for each entry in parallel (drives the 置灰 state).
  const existsList = await Promise.all(
    entries.map((e) => api.vaultExists(e.path).catch(() => false))
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
    await api.closeVault();
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
    const info = await api.startupInfo();
    if (info.last_path) {
      if (await api.vaultExists(info.last_path)) {
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
let lastCopiedValue = null;
async function copyValue(value) {
  await writeText(value);
  lastCopiedValue = value;
  // 按钮态（"✓ 已复制"）由 withCopied 渲染，toast 只承载自动清空这一个信息。
  showToast(`剪贴板将在 ${CLIPBOARD_CLEAR_SECONDS} 秒后自动清空`);
  if (clearTimer) clearTimeout(clearTimer);
  clearTimer = setTimeout(async () => {
    try {
      // Only clear if our value is still there — don't clobber a later copy
      // (here or in any other app). 读取失败视为内容可能已变，不清空。
      const current = await readText();
      if (current === lastCopiedValue) await clearClipboard();
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
  // 筛选目标消失（如该厂商最后一条记录被删/改走）时复位筛选，
  // 不留"无结果空态 + 左栏无高亮"的死路。
  if (!vendorFilterValid(state.vendor, state.records, state.vendors)) state.vendor = null;
  if (!tagFilterValid(state.tag, state.tags)) state.tag = null;
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
    if (!vendorDd.open) {
      // panel closed → 确认厂商值并跳下一字段，而不是提交整个表单
      e.preventDefault();
      $("f-name").focus();
      return;
    }
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

/** 选中一条记录：只更新行高亮与详情面板（不整树重渲染）。 */
function selectRecord(id) {
  state.selectedId = id;
  document.querySelectorAll("#record-list .record-item").forEach((el) => {
    el.dataset.active = (el.dataset.id === id).toString();
  });
  renderDetail();
}

function renderRail() {
  $("count-all").textContent = state.records.length;
  $("filter-all").dataset.active = (!state.vendor && !state.tag).toString();

  const groups = groupByVendor(state.records);
  let vendorHtml = state.vendors
    .map(
      (v) =>
        `<li><button class="rail-item" data-vendor="${escapeHtml(v)}" data-active="${state.vendor === v
        }">${escapeHtml(v)} <span class="count">${groups[v] || 0}</span></button><span class="drag-handle" title="按住拖拽排序"></span></li>`
    )
    .join("");
  // 合成"未分组"项：确有无厂商记录且没有同名真实厂商时才出现；
  // 无拖拽手柄 — 非真实厂商，不参与 reorder 持久化。
  const ungroupedCount = state.records.filter((r) => !(r.vendor && r.vendor.trim())).length;
  if (ungroupedCount && !state.vendors.includes(UNGROUPED)) {
    vendorHtml += `<li><button class="rail-item" data-vendor="${UNGROUPED}" data-active="${state.vendor === UNGROUPED}">未分组 <span class="count">${ungroupedCount}</span></button></li>`;
  }
  $("vendor-list").innerHTML = vendorHtml;

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
  ul.innerHTML = list
    .map(
      (r) =>
        `<li><div class="record-item" data-id="${r.id}" data-active="${state.selectedId === r.id
        }" tabindex="0" role="button">
          <div class="record-main">
            <div class="record-name">${escapeHtml(r.name)}</div>
            <div class="record-meta">${escapeHtml(r.vendor || UNGROUPED)}${r.tags.length ? " · " + r.tags.map((t) => "#" + escapeHtml(t)).join(" ") : ""
        }</div>
          </div>
          <span class="drag-handle" title="按住拖拽排序"></span>
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

let revealTimer = null;

// 明文显示到时自动回掩码（与剪贴板自动清空同一防护窗口）。
function autoRemask() {
  revealTimer = null;
  const el = $("secret-val");
  if (el && el.dataset.masked === "false") {
    el.textContent = MASKED_API_KEY;
    el.dataset.masked = "true";
    const btn = $("reveal-btn");
    if (btn) btn.innerHTML = revealButtonHtml(true);
  }
}

// reveal 切换掩码/明文；显示后启动自动回掩码计时。
function toggleReveal(rec) {
  const el = $("secret-val");
  const masked = el.dataset.masked === "true";
  el.textContent = masked ? rec.api_key : MASKED_API_KEY;
  el.dataset.masked = (!masked).toString();
  $("reveal-btn").innerHTML = revealButtonHtml(!masked);
  if (revealTimer) clearTimeout(revealTimer);
  if (masked) revealTimer = setTimeout(autoRemask, REVEAL_AUTO_MASK_SECONDS * 1000);
}

function renderDetail() {
  const ph = $("detail-placeholder");
  const content = $("detail-content");
  if (revealTimer) {
    clearTimeout(revealTimer);
    revealTimer = null;
  }
  const rec = state.records.find((r) => r.id === state.selectedId);
  if (!rec) {
    ph.hidden = false;
    content.hidden = true;
    return;
  }
  ph.hidden = true;
  content.hidden = false;
  content.innerHTML = buildDetailBodyHtml(rec); // 事件一次性委托在 wireEvents
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
// formState = { endpoints } — mutated by pure functions from formState.js, plus
// one live-sync exception: the URL-row "input" handler below writes the typed
// value in place so lit/gray toggle states mirror typing without a re-render.
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

// Shared field filling for the add/edit dialog. `fields` may be a record
// (edit mode) or a plain prefill object (quick add / duplicate); missing
// keys become empty values.
function fillFormFields(fields) {
  $("f-name").value = fields.name || "";
  $("f-key").value = fields.api_key || "";
  $("f-vendor").value = fields.vendor || "";
  vendorDd.highlighted = -1;
  vendorDd.applied = fields.vendor || "";
  closeVendorPanel();
  $("f-website").value = fields.website || "";
  $("f-tags").value = (fields.tags || []).join(", ");
  $("f-note").value = fields.note || "";
  $("form-error").textContent = "";
}

// 打开时的字段快照 — 供关闭守卫判断"有未保存的修改"。
function snapshotForm() {
  return JSON.stringify({
    name: $("f-name").value,
    key: $("f-key").value,
    vendor: $("f-vendor").value,
    website: $("f-website").value,
    tags: $("f-tags").value,
    note: $("f-note").value,
    endpoints: formState.endpoints,
  });
}

let formSnapshot = "";

/** Close the dialog, confirming first when there are unsaved edits.
 *  Backdrop click / Esc route here; the explicit 取消 button closes directly. */
async function guardedCloseDialog() {
  if (snapshotForm() !== formSnapshot) {
    const ok = await ask("表单有未保存的修改，确定丢弃吗？", {
      title: "关闭表单",
      kind: "warning",
      okLabel: "丢弃",
      cancelLabel: "继续编辑",
    });
    if (!ok) return;
  }
  $("record-dialog").close();
}

// Sync toggles + URL rows, then open the dialog and focus the name field.
function showRecordDialog() {
  syncStdToggles();
  renderUrlRows();
  formSnapshot = snapshotForm();
  $("record-dialog").showModal();
  $("f-name").focus();
}

function openForm(rec) {
  state.editingId = rec ? rec.id : null;
  $("dialog-title").textContent = rec ? "编辑密钥" : "新增密钥";
  fillFormFields(rec || {});
  // Backfill preset URLs for standards the record is missing (never overwrites).
  const st = openRecordFormState(rec);
  formState = { endpoints: backfillPresetEndpoints(st.endpoints, rec ? rec.vendor : "") };
  showRecordDialog();
}

// Quick add with the rail's vendor filter pre-applied: preset vendors get
// their website + endpoint URLs, custom vendors just the name — the same
// auto-fill rule as typing the vendor into the form manually.
function openAddWithVendor(vendor) {
  state.editingId = null;
  $("dialog-title").textContent = "新增密钥";
  formState = applyVendorPreset(vendor);
  fillFormFields({ vendor, website: formState.website });
  showRecordDialog();
}

// Duplicate add: every field copied from the source record with the name
// suffixed "_copy". No preset backfill — the copy mirrors the record's
// endpoint URLs exactly, and the suffix may repeat across copies.
function openDuplicateForm(rec) {
  state.editingId = null;
  $("dialog-title").textContent = "新增密钥";
  fillFormFields({ ...rec, name: duplicateName(rec.name) });
  formState = openRecordFormState(rec);
  showRecordDialog();
}

/** Vendor input change: full-replace website + standards from the preset.
 *  当表单里已有非空端点 URL 时先确认 — 全量替换（自定义厂商则清空）是破坏性的。 */
async function onVendorChange() {
  const vendor = $("f-vendor").value;
  const preset = applyVendorPreset(vendor);
  if (Object.values(formState.endpoints).some((url) => url && url.trim())) {
    const ok = await ask("切换厂商会替换官网并重新填充端点 URL，已填内容将被覆盖，继续吗？", {
      title: "切换厂商",
      kind: "warning",
      okLabel: "继续",
      cancelLabel: "取消",
    });
    if (!ok) {
      $("f-vendor").value = vendorDd.applied; // 回退到切换前的厂商
      return;
    }
  }
  vendorDd.applied = vendor;
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

let submitting = false;
async function onFormSubmit(e) {
  e.preventDefault();
  if (submitting) return; // 命令在途：双击/连按 Enter 不产生第二条记录
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

  submitting = true;
  $("form-save").disabled = true;
  try {
    const view = state.editingId
      ? await api.updateRecord(state.editingId, input)
      : await api.addRecord(input);
    applyView(view);
    $("record-dialog").close();
  } catch (err2) {
    $("form-error").textContent = String(err2);
  } finally {
    submitting = false;
    $("form-save").disabled = false;
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
    const view = await api.deleteRecord(rec.id);
    if (state.selectedId === rec.id) state.selectedId = null;
    applyView(view);
  } catch (e) {
    showToast(String(e));
  }
}

// ---------------- Drag-to-reorder (pointer events, no HTML5 DnD) ----------------
// HTML5 drag-and-drop is unreliable inside Tauri's WebView2 on Windows (the
// native DnD layer swallows dragover/drop), so reordering is implemented with
// pointer events: a ghost box follows the cursor, the source row hides and
// the rows below make room for a slot marker, and on pointerup the order is
// committed via `reorder_records` (persists to disk). Reorder is disabled
// when a filter is active (handle is not rendered).
const drag = {
  el: null, id: null, beforeId: null, moved: false, suppressClick: false,
  list: null, allIds: [], startX: 0, startY: 0, offsetY: 0, rowHeight: 0,
  ghost: null, slot: null,
};

function itemIdOf(li) {
  const el = li.querySelector("[data-id]") ?? li.querySelector("[data-vendor]");
  return el?.dataset.id ?? el?.dataset.vendor ?? null;
}

function clearDropSlot() {
  drag.slot?.remove();
  drag.slot = null;
}

function clearGhost() {
  drag.ghost?.remove();
  drag.ghost = null;
}

// Static row geometry in document order, excluding the dragged row and the
// slot marker — the basis for slot computation.
function rowGeometry(list) {
  return [...list.children]
    .map((li) => {
      const id = itemIdOf(li);
      if (!id || id === drag.id) return null;
      const r = li.getBoundingClientRect();
      return { id, top: r.top, bottom: r.bottom };
    })
    .filter(Boolean);
}

function onHandlePointerDown(e) {
  if (e.button !== 0 || !e.target.closest(".drag-handle")) return;
  const list = e.target.closest("#record-list") ?? e.target.closest("#vendor-list");
  if (!list) return;
  const li = e.target.closest("li");
  if (!li || !itemIdOf(li)) return;
  drag.list = list;
  drag.el = li;
  drag.id = itemIdOf(li);
  drag.beforeId = null;
  drag.moved = false;
  drag.allIds = list === $("record-list") ? state.records.map((r) => r.id) : state.vendors;
  drag.startX = e.clientX;
  drag.startY = e.clientY;
  drag.offsetY = e.clientY - li.getBoundingClientRect().top;
  window.addEventListener("pointermove", onHandlePointerMove);
  window.addEventListener("pointerup", onHandlePointerUp);
  window.addEventListener("pointercancel", onHandlePointerUp);
}

// Ghost + slot appear once the pointer moves past the click threshold — a
// press without movement stays a plain click (selects the record).
function onHandlePointerMove(e) {
  if (!drag.el) return;
  if (!drag.moved) {
    if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 5) return;
    drag.moved = true;
    const rect = drag.el.getBoundingClientRect();
    drag.rowHeight = rect.height; // measured BEFORE hiding the row
    drag.el.classList.add("dragging");
    const src = drag.el.querySelector(".record-item") ?? drag.el.querySelector(".rail-item");
    const ghost = src.cloneNode(true);
    ghost.querySelector(".drag-handle")?.remove();
    ghost.classList.add("drag-ghost");
    ghost.style.width = `${rect.width}px`;
    document.body.appendChild(ghost);
    drag.ghost = ghost;
    drag.el.style.display = "none"; // rows below close the gap
  }
  const ghostWidth = drag.ghost.offsetWidth;
  drag.ghost.style.left = `${e.clientX - ghostWidth / 2}px`;
  drag.ghost.style.top = `${e.clientY - drag.offsetY}px`;
  // Move the slot marker to the insertion point (below the cursor); rows
  // below it shift down by one row height.
  let beforeId = insertionSlot(rowGeometry(drag.list), e.clientY);
  if (beforeId === null && drag.list === $("record-list")) {
    // Dropped below the last visible row of a filtered view: the record
    // lands right after that row in the global order, not at vault's end.
    const visible = visibleRecords();
    const lastVisibleId = visible.length ? visible[visible.length - 1].id : null;
    beforeId = nextAfterId(drag.allIds, lastVisibleId);
  }
  if (beforeId === drag.beforeId) return;
  drag.beforeId = beforeId;
  clearDropSlot();
  const slot = document.createElement("li");
  slot.className = "drop-slot";
  slot.style.height = `${drag.rowHeight}px`;
  const target = beforeId
    ? drag.list.querySelector(`[data-id="${CSS.escape(beforeId)}"], [data-vendor="${CSS.escape(beforeId)}"]`)?.closest("li")
    : null;
  if (target) target.before(slot);
  else drag.list.append(slot); // insertion point outside the visible rows
  drag.slot = slot;
}

function onHandlePointerUp(e) {
  if (!drag.el) return;
  window.removeEventListener("pointermove", onHandlePointerMove);
  window.removeEventListener("pointerup", onHandlePointerUp);
  window.removeEventListener("pointercancel", onHandlePointerUp);
  const el = drag.el;
  const list = drag.list;
  drag.el = null;
  if (!drag.moved) return; // plain click on the handle — selects the row
  clearGhost();
  clearDropSlot();
  el.classList.remove("dragging");
  const nextOrder = moveBefore(drag.allIds, drag.id, drag.beforeId);
  drag.suppressClick = true; // the click trailing a drag must not select
  if (nextOrder.every((id, i) => id === drag.allIds[i])) {
    if (list === $("record-list")) renderList();
    else render(); // nothing actually changed — restore
    return;
  }
  const commit = list === $("record-list")
    ? api.reorderRecords(nextOrder)
    : api.reorderVendors(nextOrder);
  commit
    .then(applyView)
    .catch((err) => {
      showToast(String(err));
      if (list === $("record-list")) renderList();
      else render(); // restore the pre-drag order
    });
}

// Expire the suppress flag on the next interaction start: every click is
// preceded by its own mousedown, so the click that trails a drag (if a
// browser fires one) is consumed, while the user's next click works.
function expireSuppress() {
  drag.suppressClick = false;
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
        await api.removeVaultHistory(removeBtn.dataset.removePath);
      } catch (_) { }
      renderVaultHistory();
      return;
    }
    const item = e.target.closest("[data-path]");
    if (item) openVault(item.dataset.path);
  });

  // "+ 新增": with a vendor filter active, open the form with that vendor
  // pre-applied (preset auto-fill included); otherwise a plain empty form.
  // "未分组"是展示层合成项，不能作为厂商预填进表单。
  $("add-btn").addEventListener("click", () => {
    if (state.vendor && state.vendor !== UNGROUPED) openAddWithVendor(state.vendor);
    else openForm(null);
  });
  $("search").addEventListener("input", (e) => {
    state.query = e.target.value;
    renderList();
  });

  $("filter-all").addEventListener("click", () => {
    state.vendor = null;
    state.tag = null;
    render();
  });

  // delegated rail clicks — a drag that just ended must not toggle the filter
  $("vendor-list").addEventListener("click", (e) => {
    if (drag.suppressClick) {
      drag.suppressClick = false;
      return;
    }
    const li = e.target.closest("li");
    const b = li?.querySelector("[data-vendor]");
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

  // delegated record selection (click + keyboard)。选中只更新行高亮 + 详情，
  // 不整树重渲染 — 保住列表滚动位置与键盘焦点。
  const selectFrom = (e) => {
    if (drag.suppressClick) {
      drag.suppressClick = false; // a real drag just ended — not a click
      return;
    }
    const item = e.target.closest("[data-id]");
    if (!item) return;
    selectRecord(item.dataset.id);
  };
  $("record-list").addEventListener("click", selectFrom);
  $("record-list").addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      selectFrom(e);
    }
  });

  // 详情面板事件：一次性委托在容器上，renderDetail 重渲染无需重挂监听。
  $("detail-content").addEventListener("click", (e) => {
    const rec = state.records.find((r) => r.id === state.selectedId);
    if (!rec) return;
    const copyUrl = e.target.closest(".copy-url");
    if (copyUrl) {
      withCopied(copyUrl, () => copyValue(copyUrl.dataset.url));
      return;
    }
    if (e.target.closest("#reveal-btn")) {
      toggleReveal(rec);
      return;
    }
    if (e.target.closest("#copy-key")) withCopied($("copy-key"), () => copyValue(rec.api_key));
    else if (e.target.closest("#edit-btn")) openForm(rec);
    else if (e.target.closest("#duplicate-btn")) openDuplicateForm(rec);
    else if (e.target.closest("#delete-btn")) onDelete(rec);
  });

  // drag-to-reorder via pointer events (only the handle starts a drag)
  $("record-list").addEventListener("pointerdown", onHandlePointerDown);
  $("vendor-list").addEventListener("pointerdown", onHandlePointerDown);
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
  // 点击 dialog 外部区域（backdrop）/ Esc 关闭 — 有未保存修改时先确认
  $("record-dialog").addEventListener("click", (e) => {
    const rect = $("record-dialog").getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right ||
      e.clientY < rect.top || e.clientY > rect.bottom) {
      guardedCloseDialog();
    }
  });
  $("record-dialog").addEventListener("cancel", (e) => {
    e.preventDefault(); // Esc 不直接丢弃，走同一守卫
    guardedCloseDialog();
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
