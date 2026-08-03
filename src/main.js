// KeyVault frontend controller — thin DOM shell. Wires the vault chooser +
// three-pane UI to Tauri commands. Testable business logic lives in
// filter.js / vendorPresets.js / formState.js / history.js (unit-tested);
// this file is event wiring + rendering glue.
import { invoke } from "@tauri-apps/api/core";
import { writeText, clear as clearClipboard } from "@tauri-apps/plugin-clipboard-manager";
import { open as openDialog, save as saveDialog, message } from "@tauri-apps/plugin-dialog";
import { filterRecords, groupByVendor, emptyStateKind } from "./filter.js";
import { getEndpointUrl, normalizeUrl, getStandardLabel, ALL_STANDARDS } from "./vendorPresets.js";
import {
  openRecordFormState,
  applyVendorPreset,
  saveActiveUrl,
  handleStdClick,
  buildRecordInput,
  validateRecordInput,
  getDefaultStandard,
} from "./formState.js";
import { annotateHistoryEntries } from "./history.js";

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
  render();
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

  const kind = emptyStateKind({
    totalRecords: state.records.length,
    visibleRecords: list.length,
    hasActiveFilter: !!(state.query || state.vendor || state.tag),
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

  // Determine which standards this record supports (has endpoint for)
  const endpoints = rec.endpoints || {};
  const supportedStandards = Object.keys(endpoints);
  // Default selected: first supported standard
  const defaultStd = getDefaultStandard(endpoints);

  content.innerHTML = `
    <div class="detail-title">${escapeHtml(rec.name)}</div>
    <div class="detail-field">
      <div class="label">api_key</div>
      <div class="value">
        <span class="secret" id="secret-val" data-masked="true">••••••••••••</span>
        <button class="icon-btn" id="reveal-btn">👁 显示</button>
        <button class="icon-btn" id="copy-key">复制</button>
      </div>
    </div>
    <div class="detail-field">
      <div class="label">端点 URL</div>
      <div class="value">
        <span class="urlval" id="detail-url">${defaultStd ? escapeHtml(endpoints[defaultStd]) : "未配置"}</span>
        ${defaultStd ? `<button class="icon-btn" id="copy-url">复制</button>` : ""}
      </div>
    </div>
    <div class="detail-field">
      <div class="label">支持的接口规范</div>
      <div class="detail-std-group" id="detail-std-group">
        ${ALL_STANDARDS.map((key) => {
    const supported = supportedStandards.includes(key);
    const selected = key === defaultStd;
    return `<button type="button" class="detail-std-btn" data-std="${key}" data-supported="${supported}" data-selected="${selected}">${escapeHtml(getStandardLabel(key))}</button>`;
  }).join("")}
      </div>
    </div>
    ${rec.website
      ? `<div class="detail-field"><div class="label">官网</div>
            <div class="value"><a href="${escapeHtml(normalizeUrl(rec.website))}" target="_blank" rel="noopener">${escapeHtml(rec.website)}</a></div></div>`
      : ""
    }
    ${rec.vendor ? field("厂商", escapeHtml(rec.vendor)) : ""}
    ${rec.tags.length
      ? `<div class="detail-field"><div class="label">标签</div><div>${rec.tags
        .map((t) => `<span class="tag-chip">#${escapeHtml(t)}</span>`)
        .join("")}</div></div>`
      : ""
    }
    ${rec.note ? field("备注", escapeHtml(rec.note)) : ""}
    <div class="detail-actions">
      <button class="btn-secondary" id="edit-btn">编辑</button>
      <button class="btn-danger" id="delete-btn">删除</button>
    </div>`;

  // Wire detail standard buttons — click to switch displayed URL
  $("detail-std-group").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-std]");
    if (!btn || btn.dataset.supported !== "true") return;
    const std = btn.dataset.std;
    // Update URL display
    $("detail-url").textContent = endpoints[std] || "";
    // Update selected state
    $("detail-std-group").querySelectorAll(".detail-std-btn").forEach((b) => {
      b.dataset.selected = (b.dataset.std === std).toString();
    });
  });

  // reveal toggles the masked key
  $("reveal-btn").onclick = () => {
    const el = $("secret-val");
    const masked = el.dataset.masked === "true";
    el.textContent = masked ? rec.api_key : "••••••••••••";
    el.dataset.masked = (!masked).toString();
    $("reveal-btn").textContent = masked ? "🙈 隐藏" : "👁 显示";
  };
  $("copy-key").onclick = () => withCopied($("copy-key"), () => copyValue("api_key", rec.api_key));
  if ($("copy-url")) {
    $("copy-url").onclick = () => {
      const url = $("detail-url").textContent;
      if (url) withCopied($("copy-url"), () => copyValue("url", url));
    };
  }
  $("edit-btn").onclick = () => openForm(rec);
  $("delete-btn").onclick = () => onDelete(rec);
}

function field(label, value) {
  return `<div class="detail-field"><div class="label">${label}</div><div class="value">${value}</div></div>`;
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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------------- Form (add / edit) ----------------
// formState = { endpoints, activeStd } — mutated only by pure functions from
// formState.js; this section syncs the DOM to it and reads DOM values back.
let formState = openRecordFormState(null);

// Toggle button states mirror formState.endpoints (which standards are active).
function syncStdToggles() {
  $("f-standards-group").querySelectorAll(".std-toggle").forEach((btn) => {
    btn.dataset.active = (btn.dataset.std in formState.endpoints).toString();
  });
}

// Show the active standard's URL in the input (or hide the URL field).
function syncUrlField() {
  const { activeStd } = formState;
  if (activeStd) {
    $("f-url").value = formState.endpoints[activeStd] || "";
    $("f-url-label").textContent = `端点 URL (${getStandardLabel(activeStd)})`;
    $("f-url-field").hidden = false;
  } else {
    $("f-url").value = "";
    $("f-url-label").textContent = "端点 URL";
    $("f-url-field").hidden = true;
  }
}

function openForm(rec) {
  state.editingId = rec ? rec.id : null;
  $("dialog-title").textContent = rec ? "编辑密钥" : "新增密钥";
  $("f-name").value = rec ? rec.name : "";
  $("f-key").value = rec ? rec.api_key : "";
  $("f-vendor").value = rec ? rec.vendor : "";
  $("f-website").value = rec ? (rec.website || "") : "";
  $("f-tags").value = rec ? rec.tags.join(", ") : "";
  $("f-note").value = rec ? rec.note : "";
  $("form-error").textContent = "";
  formState = openRecordFormState(rec);
  syncStdToggles();
  syncUrlField();
  $("record-dialog").showModal();
  $("f-name").focus();
}

/** Vendor selector change: auto-fill website + standards from the preset. */
function onVendorChange() {
  const preset = applyVendorPreset($("f-vendor").value);
  formState = preset;
  $("f-website").value = preset.website;
  syncStdToggles();
  syncUrlField();
}

/** Click on a standard: focus it if already active, toggle it if inactive. */
function onStdGroupClick(e) {
  const btn = e.target.closest("[data-std]");
  if (!btn) return;
  const std = btn.dataset.std;
  const presetUrl = getEndpointUrl($("f-vendor").value, std);
  formState = handleStdClick(formState, std, $("f-url").value, presetUrl);
  syncStdToggles();
  syncUrlField();
}

async function onFormSubmit(e) {
  e.preventDefault();
  formState = saveActiveUrl(formState, $("f-url").value);
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
  $("f-vendor").addEventListener("change", onVendorChange);
  $("f-standards-group").addEventListener("click", onStdGroupClick);
}

wireEvents();
initVaultScreen();
