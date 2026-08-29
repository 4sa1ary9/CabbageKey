// KeyVault frontend controller — thin DOM shell. Wires the vault chooser +
// three-pane UI to the Tauri command layer through api.js (the single invoke
// seam). Testable business logic lives in
// api.js / filter.js / formState.js / formSession.js / history.js / listModel.js / order.js
// (unit-tested); this file is event wiring + rendering glue.
import * as api from "./api.js";
import { writeText, readText, clear as clearClipboard } from "@tauri-apps/plugin-clipboard-manager";
import { open as openDialog, save as saveDialog, message, ask } from "@tauri-apps/plugin-dialog";
import { emptyStateKind, vendorKey, railVendorGroups, isUngroupedKey } from "./filter.js";
import { vendorCandidates, filterVendorCandidates } from "./vendorDropdown.js";
import { enrichHistory } from "./history.js";
import { escapeHtml } from "./html.js";
import { buildDetailBodyHtml, MASKED_API_KEY, revealButtonHtml } from "./detailView.js";
import { dropTarget, moveBefore } from "./order.js";
import { createFormSession } from "./formSession.js";
import { createListModel } from "./listModel.js";

const CLIPBOARD_CLEAR_SECONDS = 30; // auto-clear window after copy
const REVEAL_AUTO_MASK_SECONDS = 30; // 明文 key 显示多久后自动回掩码

// ---- list pane state: the model owns records/filters/selection and their
// invariants (a filter's target exists, a selection points at a record);
// mutations report change aspects and the mapping below is the ONE place
// that knows which aspect repaints which DOM (granular renders preserve
// list scroll position and keyboard focus).
const listModel = createListModel();
const state = listModel.state; // live read-only view — writes go through listModel

listModel.subscribe((ch) => {
  if (ch.records) populatePurposeDatalist();
  if (ch.records || ch.filter) renderRail();
  if (ch.records || ch.filter || ch.query) renderList();
  if (ch.records || ch.filter || ch.selection) renderDetail();
  if (ch.selection) updateRowHighlight();
});

const $ = (id) => document.getElementById(id);

// ---------------- Vault chooser (open existing / new, no password) ----------------
async function openVault(path) {
  const err = $("vault-error");
  err.textContent = "";
  try {
    listModel.setRecords(await api.openVault(path));
    enterApp();
  } catch (e) {
    err.textContent = String(e);
  }
}

async function createVault(path) {
  const err = $("vault-error");
  err.textContent = "";
  try {
    listModel.setRecords(await api.createVault(path));
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
  // 并行探测每个条目的文件存在性（驱动置灰态）与顺序对齐在 history.js 里。
  ul.innerHTML = (await enrichHistory(entries, api.vaultExists))
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
  listModel.reset();
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

// ---------------- Rendering ----------------
// Explicit repaint for paths that change no state (drag restore after a
// no-op or a failed command); state changes go through listModel's aspects.
function render() {
  renderRail();
  renderList();
  renderDetail();
}

/** 选中行高亮：不整树重渲染 — 保住列表滚动位置与键盘焦点。 */
function updateRowHighlight() {
  const id = state.selectedId;
  document.querySelectorAll("#record-list .record-item").forEach((el) => {
    el.dataset.active = (el.dataset.id === id).toString();
  });
}

// Purpose candidates: distinct usage names in this vault, sorted.
function populatePurposeDatalist() {
  const purposeOpts = [...new Set(state.records.map((r) => r.name))].sort();
  $("purpose-candidates").innerHTML = purposeOpts
    .map((n) => `<option value="${escapeHtml(n)}"></option>`)
    .join("");
}

// ---------------- Vendor dropdown (custom combobox) ----------------
// vendorDd = { open, highlighted, list } — combobox view state. The committed
// vendor value (applied) lives in the form session.
const vendorDd = { open: false, highlighted: -1, list: [] };

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

/** Set the vendor value and trigger the auto-fill rule. `force` re-applies
 *  even when the value equals the applied vendor (preset reset on re-pick). */
function applyVendor(name) {
  $("f-vendor").value = name;
  formSession.setVendor(name, { force: true });
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

function renderRail() {
  $("count-all").textContent = state.records.length;
  $("filter-all").dataset.active = (!state.vendor && !state.tag).toString();

  // 合成"未分组"项的判定与计数在 filter.js 的 railVendorGroups 里；
  // 无拖拽手柄 — 非真实厂商，不参与 reorder 持久化。
  $("vendor-list").innerHTML = railVendorGroups(state.records, state.vendors)
    .map(
      (g) =>
        `<li><button class="rail-item" data-vendor="${escapeHtml(g.key)}" data-active="${state.vendor === g.key
        }">${escapeHtml(g.key)} <span class="count">${g.count}</span></button>${g.draggable ? '<span class="drag-handle" title="按住拖拽排序"></span>' : ""}</li>`
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
  const list = listModel.visibleRecords();
  const ul = $("record-list");
  const empty = $("empty-state");

  const kind = emptyStateKind({
    totalRecords: state.records.length,
    visibleRecords: list.length,
    hasActiveFilter: listModel.hasActiveFilter(),
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
            <div class="record-meta">${escapeHtml(vendorKey(r.vendor))}${r.tags.length ? " · " + r.tags.map((t) => "#" + escapeHtml(t)).join(" ") : ""
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

// ---------------- Form session (add / edit dialog) ----------------
// The dialog lifecycle (field filling, endpoint state, dirty guard, vendor
// switch confirm/rollback, submit protocol) lives in formSession.js; the
// element handles it owns are injected here, the DOM events wired below.
const els = {
  name: $("f-name"),
  key: $("f-key"),
  vendor: $("f-vendor"),
  website: $("f-website"),
  tags: $("f-tags"),
  note: $("f-note"),
  error: $("form-error"),
  save: $("form-save"),
  dialog: $("record-dialog"),
  title: $("dialog-title"),
  stdGroup: $("f-standards-group"),
  urlSection: $("f-url-section"),
  urlRows: $("f-url-rows"),
};

const formSession = createFormSession(els, {
  api,
  confirmDiscard: () =>
    ask("表单有未保存的修改，确定丢弃吗？", {
      title: "关闭表单",
      kind: "warning",
      okLabel: "丢弃",
      cancelLabel: "继续编辑",
    }),
  confirmVendorSwitch: () =>
    ask("切换厂商会替换官网并重新填充端点 URL，已填内容将被覆盖，继续吗？", {
      title: "切换厂商",
      kind: "warning",
      okLabel: "继续",
      cancelLabel: "取消",
    }),
  onOpened: () => {
    vendorDd.highlighted = -1;
    closeVendorPanel();
  },
});

async function onDelete(rec) {
  const ok = await message(`确定删除 “${rec.name}” ？此操作不可撤销。`, {
    title: "删除确认",
    kind: "warning",
    okLabel: "删除",
    cancelLabel: "取消",
  });
  if (!ok) return;
  try {
    listModel.setRecords(await api.deleteRecord(rec.id));
  } catch (e) {
    showToast(String(e));
  }
}

// ---------------- Drag-to-reorder (pointer events, no HTML5 DnD) ----------------
// HTML5 drag-and-drop is unreliable inside Tauri's WebView2 on Windows (the
// native DnD layer swallows dragover/drop), so reordering is implemented with
// pointer events: a ghost box follows the cursor, the source row hides and
// the rows below make room for a slot marker, and on pointerup the resolved
// order is committed via `reorder_records` / `reorder_vendors` (persists to
// disk). Filtering never disables dragging: a drop below the last visible
// row of a filtered view lands right after that row in the global order —
// the drop decision lives in order.js (dropTarget), this section is pointer
// plumbing and DOM only.
const drag = {
  el: null, id: null, kind: null, beforeId: null, moved: false, suppressClick: false,
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
  drag.kind = list === $("record-list") ? "records" : "vendors";
  drag.beforeId = null;
  drag.moved = false;
  drag.allIds = drag.kind === "records" ? state.records.map((r) => r.id) : state.vendors;
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
  const visible = drag.kind === "records" ? listModel.visibleRecords() : null;
  const beforeId = dropTarget({
    allIds: drag.allIds,
    geometry: rowGeometry(drag.list),
    clientY: e.clientY,
    listKind: drag.kind,
    lastVisibleId: visible?.length ? visible[visible.length - 1].id : null,
  });
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
  drag.el = null;
  if (!drag.moved) return; // plain click on the handle — selects the row
  clearGhost();
  clearDropSlot();
  el.classList.remove("dragging");
  const repaint = () => (drag.kind === "records" ? renderList() : render());
  const { order: nextOrder, changed } = moveBefore(drag.allIds, drag.id, drag.beforeId);
  drag.suppressClick = true; // the click trailing a drag must not select
  if (!changed) {
    repaint(); // nothing actually changed — restore
    return;
  }
  const commit = drag.kind === "records"
    ? api.reorderRecords(nextOrder)
    : api.reorderVendors(nextOrder);
  commit
    .then((view) => listModel.setRecords(view))
    .catch((err) => {
      showToast(String(err));
      repaint(); // restore the pre-drag order
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
    formSession.open(
      state.vendor && !isUngroupedKey(state.vendor)
        ? { kind: "quick-add", vendor: state.vendor }
        : { kind: "add" }
    );
  });
  $("search").addEventListener("input", (e) => {
    listModel.setQuery(e.target.value);
  });

  $("filter-all").addEventListener("click", () => listModel.clearFilters());

  // delegated rail clicks — a drag that just ended must not toggle the filter
  $("vendor-list").addEventListener("click", (e) => {
    if (drag.suppressClick) {
      drag.suppressClick = false;
      return;
    }
    const li = e.target.closest("li");
    const b = li?.querySelector("[data-vendor]");
    if (!b) return;
    listModel.toggleVendor(b.dataset.vendor);
  });
  $("tag-list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tag]");
    if (!b) return;
    listModel.toggleTag(b.dataset.tag);
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
    listModel.select(item.dataset.id);
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
    if (e.target.closest("#edit-btn")) formSession.open({ kind: "edit", rec });
    else if (e.target.closest("#duplicate-btn")) formSession.open({ kind: "duplicate", rec });
    else if (e.target.closest("#delete-btn")) onDelete(rec);
  });

  // drag-to-reorder via pointer events (only the handle starts a drag)
  $("record-list").addEventListener("pointerdown", onHandlePointerDown);
  $("vendor-list").addEventListener("pointerdown", onHandlePointerDown);
  document.addEventListener("mousedown", expireSuppress);
  document.addEventListener("keydown", expireSuppress);

  // empty-state buttons (delegated, they re-render)
  $("empty-state").addEventListener("click", (e) => {
    if (e.target.id === "empty-add") formSession.open({ kind: "add" });
    if (e.target.id === "empty-clear") {
      $("search").value = "";
      listModel.setQuery("");
      listModel.clearFilters();
    }
  });

  $("record-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const view = await formSession.submit();
    if (view) {
      listModel.setRecords(view);
      formSession.close();
    }
  });
  $("form-cancel").addEventListener("click", () => formSession.close());
  // 点击 dialog 外部区域（backdrop）/ Esc 关闭 — 有未保存修改时先确认
  $("record-dialog").addEventListener("click", (e) => {
    const rect = $("record-dialog").getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right ||
      e.clientY < rect.top || e.clientY > rect.bottom) {
      formSession.confirmClose();
    }
  });
  $("record-dialog").addEventListener("cancel", (e) => {
    e.preventDefault(); // Esc 不直接丢弃，走同一守卫
    formSession.confirmClose();
  });
  // Vendor dropdown: open on focus/typing, filter as you type, keyboard + click
  // selection, click-outside close. Value changes route through the session —
  // its applied-vendor guard stops a later blur from re-applying and clobbering.
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
  $("f-vendor").addEventListener("change", () => formSession.setVendor($("f-vendor").value));
  $("vendor-dd-list").addEventListener("mousedown", (e) => {
    e.preventDefault(); // keep focus in the input so blur doesn't commit first
    const item = e.target.closest("[data-vendor]");
    if (item) applyVendor(item.dataset.vendor);
  });
  document.addEventListener("click", (e) => {
    if (vendorDd.open && !e.target.closest("#vendor-dd")) closeVendorPanel();
  });
  $("f-standards-group").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-std]");
    if (btn) formSession.toggleStd(btn.dataset.std);
  });
  // Typing in a URL row updates its standard live (drives lit/gray button state).
  $("f-url-rows").addEventListener("input", (e) => {
    const row = e.target.closest("[data-std]");
    if (row) formSession.setUrl(row.dataset.std, e.target.value);
  });
}

wireEvents();
initVaultScreen();
