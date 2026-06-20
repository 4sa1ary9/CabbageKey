// KeyVault frontend controller. Wires the three-pane UI to Tauri commands.
// Pure retrieval logic lives in filter.js (unit-tested); this file is DOM glue.
import { invoke } from "@tauri-apps/api/core";
import { writeText, clear as clearClipboard } from "@tauri-apps/plugin-clipboard-manager";
import { open as openDialog, save as saveDialog, message } from "@tauri-apps/plugin-dialog";
import { filterRecords, groupByVendor, emptyStateKind } from "./filter.js";
import { getPreset, getSupportedStandards, getEndpointUrl, normalizeUrl, getStandardLabel, API_STANDARD_LABELS, ALL_STANDARDS } from "./vendorPresets.js";

const CLIPBOARD_CLEAR_SECONDS = 30; // D4: auto-clear window after copy

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
  lockMode: "choose", // "choose" | "unlock" | "create"
};

const $ = (id) => document.getElementById(id);

// ---------------- Lock screen / first run (T11) ----------------
// Three explicit modes instead of probing whether the file exists — that probe
// was the P0 bug (first run landed in openDialog and couldn't name a new file).
async function showChoose() {
  state.lockMode = "choose";
  $("lock-choose").hidden = false;
  $("lock-form").hidden = true;
  $("lock-sub").textContent = "本地加密的 API 密钥收纳箱";
  $("lock-error").textContent = "";
  await renderVaultHistory();
}

async function renderVaultHistory() {
  const ul = $("vault-history-list");
  let entries = [];
  try {
    entries = await invoke("get_vault_history");
  } catch (_) {
    // No history available — leave list empty
  }

  if (!entries.length) {
    ul.innerHTML = "";
    return;
  }

  // Check file existence for each entry in parallel
  const existChecks = await Promise.all(
    entries.map((e) => invoke("vault_exists", { path: e.path }).catch(() => false))
  );

  ul.innerHTML = entries
    .map((entry, i) => {
      const exists = existChecks[i];
      const missingClass = exists ? "" : " vault-history-missing";
      const missingLabel = exists ? "" : `<span class="vault-history-gone">文件不存在</span>`;
      return `<li class="vault-history-item${missingClass}" data-path="${escapeHtml(entry.path)}">
        <div class="vault-history-info">
          <span class="vault-history-name">${escapeHtml(entry.display_name)}</span>
          <span class="vault-history-path">${escapeHtml(entry.path)}</span>
          ${missingLabel}
        </div>
        <button type="button" class="vault-history-remove" data-remove-path="${escapeHtml(entry.path)}" title="移除">×</button>
      </li>`;
    })
    .join("");
}

function showUnlock(path) {
  state.lockMode = "unlock";
  $("vault-path").value = path || "";
  $("lock-choose").hidden = true;
  $("lock-form").hidden = false;
  $("confirm-field").hidden = true;
  $("recovery-warn").hidden = true;
  $("pass-label").textContent = "主密码";
  $("unlock-btn").textContent = "解锁";
  $("switch-btn").hidden = false;
  $("switch-btn").textContent = "退出登录 / 使用其他 vault";
  $("lock-sub").textContent = "本地加密的 API 密钥收纳箱";
  $("lock-error").textContent = "";
  $("master-pass").focus();
}

function showCreate(path) {
  state.lockMode = "create";
  $("vault-path").value = path || "";
  $("lock-choose").hidden = true;
  $("lock-form").hidden = false;
  $("confirm-field").hidden = false;
  $("recovery-warn").hidden = false;
  $("pass-label").textContent = "设置主密码";
  $("unlock-btn").textContent = "创建并解锁";
  $("switch-btn").hidden = false;
  $("switch-btn").textContent = "返回";
  $("lock-sub").textContent = "新建一个加密库 — 选好云盘同步目录里的位置";
  $("lock-error").textContent = "";
}

// Decide the startup screen: try passwordless open, else prefill last vault,
// else show the new/open chooser.
async function initLock() {
  try {
    const info = await invoke("startup_info");
    if (info.can_auto) {
      try {
        applyView(await invoke("auto_unlock"));
        enterApp();
        return;
      } catch (_) {
        // credential expired / file moved — fall through to manual unlock
      }
    }
    if (info.last_path) showUnlock(info.last_path);
    else showChoose();
  } catch (_) {
    showChoose();
  }
}

async function onBrowse() {
  // Create mode names a new file (saveDialog); unlock mode picks an existing one.
  const path = state.lockMode === "create"
    ? await saveDialog({ defaultPath: "vault.vault", filters: [{ name: "Vault", extensions: ["vault"] }] })
    : await openDialog({ multiple: false, filters: [{ name: "Vault", extensions: ["vault"] }] });
  if (path) $("vault-path").value = path;
}

async function onOpenExisting() {
  showUnlock("");
  await onBrowse();
}

async function onCreateNew() {
  showCreate("");
  await onBrowse();
}

function onSwitchClick() {
  if (state.lockMode === "create") {
    showChoose();
    return;
  }
  onLogout();
}

async function onLogout() {
  await invoke("forget_session");
  $("master-pass").value = "";
  $("master-pass-confirm").value = "";
  $("vault-path").value = "";
  $("remember-me").checked = false;
  showChoose();
}

async function onUnlock() {
  const path = $("vault-path").value.trim();
  const pass = $("master-pass").value;
  const remember = $("remember-me").checked;
  const err = $("lock-error");
  err.textContent = "";

  if (!path) return (err.textContent = "请先选择 vault 文件位置");
  if (!pass) return (err.textContent = "请输入主密码");

  try {
    let view;
    if (state.lockMode === "create") {
      if (pass !== $("master-pass-confirm").value) {
        return (err.textContent = "两次输入的主密码不一致");
      }
      view = await invoke("create_vault", { path, passphrase: pass, remember });
    } else {
      view = await invoke("unlock_vault", { path, passphrase: pass, remember });
    }
    applyView(view);
    enterApp();
  } catch (e) {
    // Wrong password / tamper / read failure all surface here, clearly (T11).
    err.textContent = String(e);
    $("master-pass").value = "";
    $("master-pass").focus();
  }
}

function enterApp() {
  $("lock-screen").hidden = true;
  $("app").hidden = false;
  $("search").focus();
}

async function onLockNow() {
  await invoke("lock_vault");
  state.records = [];
  state.selectedId = null;
  $("master-pass").value = "";
  $("app").hidden = true;
  $("lock-screen").hidden = false;
  // Back to a single-password unlock for the same vault (no auto-reopen).
  const path = $("vault-path").value.trim();
  if (path) showUnlock(path);
  else showChoose();
}

// ---------------- Copy with clear-countdown (D4) ----------------
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
  const defaultStd = supportedStandards[0] || null;

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

// ---------------- Vendor preset auto-fill ----------------

/** Handle vendor selector change: auto-fill website and endpoints from preset. */
function onVendorChange() {
  const vendorName = $("f-vendor").value;
  const preset = getPreset(vendorName);

  if (!preset) {
    // "自定义" selected — clear auto-filled fields
    $("f-website").value = "";
    formEndpoints = {};
    formActiveStd = null;
    $("f-url").value = "";
    $("f-url-field").hidden = true;
    // Reset all toggles
    $("f-standards-group").querySelectorAll(".std-toggle").forEach((btn) => {
      btn.dataset.active = "false";
    });
    return;
  }

  // Auto-fill from preset
  $("f-website").value = preset.website;

  // Set endpoints from preset standards
  formEndpoints = { ...preset.standards };
  const group = $("f-standards-group");
  group.querySelectorAll(".std-toggle").forEach((btn) => {
    const std = btn.dataset.std;
    btn.dataset.active = (std in formEndpoints).toString();
  });

  // Show first standard's URL
  const keys = Object.keys(formEndpoints);
  if (keys.length > 0) {
    formActiveStd = keys[0];
    $("f-url").value = formEndpoints[formActiveStd] || "";
    $("f-url-label").textContent = `端点 URL (${getStandardLabel(formActiveStd)})`;
    $("f-url-field").hidden = false;
  } else {
    formActiveStd = null;
    $("f-url").value = "";
    $("f-url-field").hidden = true;
  }
}

// ---------------- Form (add / edit) ----------------
// Track selected standards and their URLs in the form
let formEndpoints = {}; // { "openai-chat": "https://...", ... }
let formActiveStd = null; // which standard's URL is currently shown in the input

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

  // Initialize endpoints from record or empty
  formEndpoints = rec && rec.endpoints ? { ...rec.endpoints } : {};
  formActiveStd = null;

  // Render toggle button states
  const group = $("f-standards-group");
  group.querySelectorAll(".std-toggle").forEach((btn) => {
    const std = btn.dataset.std;
    const active = std in formEndpoints;
    btn.dataset.active = active.toString();
  });

  // Show URL for first active standard, or clear
  const activeKeys = Object.keys(formEndpoints);
  if (activeKeys.length > 0) {
    formActiveStd = activeKeys[0];
    $("f-url").value = formEndpoints[formActiveStd] || "";
    $("f-url-label").textContent = `端点 URL (${getStandardLabel(formActiveStd)})`;
    $("f-url-field").hidden = false;
  } else {
    $("f-url").value = "";
    $("f-url-label").textContent = "端点 URL";
    $("f-url-field").hidden = true;
  }

  $("record-dialog").showModal();
  $("f-name").focus();
}

/** Handle clicking a standard toggle button in the form */
function onStdToggleClick(e) {
  const btn = e.target.closest("[data-std]");
  if (!btn) return;
  const std = btn.dataset.std;
  const wasActive = btn.dataset.active === "true";

  if (wasActive) {
    // Deactivate: remove from endpoints
    // First save current URL if this was the active one
    if (formActiveStd === std) {
      // Don't save — we're removing it
    }
    delete formEndpoints[std];
    btn.dataset.active = "false";

    // If this was the displayed URL, switch to another or hide
    if (formActiveStd === std) {
      const remaining = Object.keys(formEndpoints);
      if (remaining.length > 0) {
        formActiveStd = remaining[0];
        $("f-url").value = formEndpoints[formActiveStd] || "";
        $("f-url-label").textContent = `端点 URL (${getStandardLabel(formActiveStd)})`;
      } else {
        formActiveStd = null;
        $("f-url").value = "";
        $("f-url-field").hidden = true;
      }
    }
  } else {
    // Activate: add to endpoints
    // Save the current URL before switching
    if (formActiveStd) {
      formEndpoints[formActiveStd] = $("f-url").value.trim();
    }
    // Auto-fill URL from vendor preset if available
    const vendorName = $("f-vendor").value;
    const presetUrl = getEndpointUrl(vendorName, std);
    formEndpoints[std] = presetUrl;
    btn.dataset.active = "true";

    // Show this standard's URL
    formActiveStd = std;
    $("f-url").value = presetUrl;
    $("f-url-label").textContent = `端点 URL (${getStandardLabel(std)})`;
    $("f-url-field").hidden = false;
  }
}

/** When user clicks a different active standard, show its URL */
function onStdFocusClick(e) {
  const btn = e.target.closest("[data-std]");
  if (!btn || btn.dataset.active !== "true") return;
  const std = btn.dataset.std;
  if (std === formActiveStd) return; // already showing
  // Save current
  if (formActiveStd) {
    formEndpoints[formActiveStd] = $("f-url").value.trim();
  }
  formActiveStd = std;
  $("f-url").value = formEndpoints[std] || "";
  $("f-url-label").textContent = `端点 URL (${getStandardLabel(std)})`;
}

/** Combined handler: toggle if inactive, focus if already active */
function onStdGroupClick(e) {
  const btn = e.target.closest("[data-std]");
  if (!btn) return;
  if (btn.dataset.active === "true" && btn.dataset.std !== formActiveStd) {
    // Already selected standard, switch URL display to it
    onStdFocusClick(e);
  } else {
    onStdToggleClick(e);
  }
}

async function onFormSubmit(e) {
  e.preventDefault();
  // Save current URL input into formEndpoints before submitting
  if (formActiveStd) {
    formEndpoints[formActiveStd] = $("f-url").value.trim();
  }
  // Clean up empty URLs
  const endpoints = {};
  for (const [key, val] of Object.entries(formEndpoints)) {
    endpoints[key] = val.trim();
  }
  const input = {
    name: $("f-name").value,
    api_key: $("f-key").value,
    vendor: $("f-vendor").value,
    endpoints,
    website: $("f-website").value,
    note: $("f-note").value,
    tags: $("f-tags").value.split(",").map((t) => t.trim()).filter(Boolean),
  };
  if (!input.name.trim()) return ($("form-error").textContent = "用途名称不能为空");
  if (!input.api_key.trim()) return ($("form-error").textContent = "api_key 不能为空");

  try {
    const cmd = state.editingId ? "update_record" : "add_record";
    const args = state.editingId
      ? { id: state.editingId, input, force: false }
      : { input, force: false };
    const view = await saveWithConflictGuard(cmd, args);
    if (view) {
      applyView(view);
      $("record-dialog").close();
    }
  } catch (e) {
    $("form-error").textContent = String(e);
  }
}

// D4: if the backend reports CONFLICT, ask the user before forcing.
async function saveWithConflictGuard(cmd, args) {
  try {
    return await invoke(cmd, args);
  } catch (e) {
    if (String(e).includes("CONFLICT")) {
      const ok = await message(
        "另一台设备在你编辑期间修改了这个 vault。继续保存会覆盖对方的改动。是否覆盖？",
        { title: "检测到冲突", kind: "warning", okLabel: "覆盖保存", cancelLabel: "取消" }
      );
      if (ok) return await invoke(cmd, { ...args, force: true });
      return null;
    }
    throw e;
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
  const view = await saveWithConflictGuard("delete_record", { id: rec.id, force: false });
  if (view) {
    if (state.selectedId === rec.id) state.selectedId = null;
    applyView(view);
  }
}

async function onExport() {
  const ok = await message(
    "导出会把所有密钥以明文 JSON 写入磁盘，任何人都能读取。仅用于备份，请妥善保管导出文件。确定继续？",
    { title: "明文导出（高风险）", kind: "warning", okLabel: "我了解，继续", cancelLabel: "取消" }
  );
  if (!ok) return;
  const dest = await saveDialog({ defaultPath: "keyvault-export.json" });
  if (dest) {
    await invoke("export_plaintext", { dest });
    showToast("已导出明文备份");
  }
}

// ---------------- Events ----------------
function wireEvents() {
  $("open-existing-btn").addEventListener("click", onOpenExisting);
  $("create-new-btn").addEventListener("click", onCreateNew);
  $("switch-btn").addEventListener("click", onSwitchClick);
  $("browse-btn").addEventListener("click", onBrowse);
  $("unlock-btn").addEventListener("click", onUnlock);
  $("master-pass").addEventListener("keydown", (e) => e.key === "Enter" && onUnlock());
  $("master-pass-confirm").addEventListener("keydown", (e) => e.key === "Enter" && onUnlock());

  // Vault history list: click entry to open, click × to remove
  $("vault-history-list").addEventListener("click", async (e) => {
    const removeBtn = e.target.closest("[data-remove-path]");
    if (removeBtn) {
      e.stopPropagation();
      const path = removeBtn.dataset.removePath;
      try {
        await invoke("remove_vault_history", { path });
      } catch (_) { }
      await renderVaultHistory();
      return;
    }
    const item = e.target.closest("[data-path]");
    if (item) {
      showUnlock(item.dataset.path);
    }
  });

  $("add-btn").addEventListener("click", () => openForm(null));
  $("lock-now-btn").addEventListener("click", onLockNow);
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
initLock();

