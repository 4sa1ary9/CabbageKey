// KeyVault frontend controller. Wires the three-pane UI to Tauri commands.
// Pure retrieval logic lives in filter.js (unit-tested); this file is DOM glue.
import { invoke } from "@tauri-apps/api/core";
import { writeText, clear as clearClipboard } from "@tauri-apps/plugin-clipboard-manager";
import { open as openDialog, save as saveDialog, message } from "@tauri-apps/plugin-dialog";
import { filterRecords, groupByVendor, emptyStateKind } from "./filter.js";

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
  isNewVault: false,
};

const $ = (id) => document.getElementById(id);

// ---------------- Lock screen / first run (T11) ----------------
async function refreshLockMode() {
  const path = $("vault-path").value.trim();
  if (!path) return;
  const exists = await invoke("vault_exists", { path });
  state.isNewVault = !exists;
  $("confirm-field").hidden = exists;
  $("recovery-warn").hidden = exists;
  $("pass-label").textContent = exists ? "主密码" : "设置主密码";
  $("unlock-btn").textContent = exists ? "解锁" : "创建并解锁";
  $("lock-sub").textContent = exists
    ? "本地加密的 API 密钥收纳箱"
    : "新建一个加密库 — 选好云盘同步目录里的位置";
}

async function onBrowse() {
  // For a new vault we save a path; for existing we open one.
  const path = state.isNewVault
    ? await saveDialog({ defaultPath: "vault.vault", filters: [{ name: "Vault", extensions: ["vault"] }] })
    : await openDialog({ multiple: false, filters: [{ name: "Vault", extensions: ["vault"] }] });
  if (path) {
    $("vault-path").value = path;
    await refreshLockMode();
  }
}

async function onUnlock() {
  const path = $("vault-path").value.trim();
  const pass = $("master-pass").value;
  const err = $("lock-error");
  err.textContent = "";

  if (!path) return (err.textContent = "请先选择 vault 文件位置");
  if (!pass) return (err.textContent = "请输入主密码");

  try {
    let view;
    if (state.isNewVault) {
      if (pass !== $("master-pass-confirm").value) {
        return (err.textContent = "两次输入的主密码不一致");
      }
      view = await invoke("create_vault", { path, passphrase: pass });
    } else {
      view = await invoke("unlock_vault", { path, passphrase: pass });
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
    } catch (_) {}
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
  // keep the new-vendor datalist fresh for the form
  $("vendor-options").innerHTML = state.vendors
    .map((v) => `<option value="${escapeHtml(v)}"></option>`)
    .join("");
}

function renderRail() {
  $("count-all").textContent = state.records.length;
  $("filter-all").dataset.active = (!state.vendor && !state.tag).toString();

  const groups = groupByVendor(state.records);
  $("vendor-list").innerHTML = state.vendors
    .map(
      (v) =>
        `<li><button class="rail-item" data-vendor="${escapeHtml(v)}" data-active="${
          state.vendor === v
        }">${escapeHtml(v)} <span class="count">${groups[v] || 0}</span></button></li>`
    )
    .join("");

  $("tag-list").innerHTML = state.tags
    .map(
      (t) =>
        `<li><button class="rail-item" data-tag="${escapeHtml(t)}" data-active="${
          state.tag === t
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
        `<li><div class="record-item" data-id="${r.id}" data-active="${
          state.selectedId === r.id
        }" tabindex="0" role="button">
          <div class="record-name">${escapeHtml(r.name)}</div>
          <div class="record-meta">${escapeHtml(r.vendor || "未分组")}${
          r.tags.length ? " · " + r.tags.map((t) => "#" + escapeHtml(t)).join(" ") : ""
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
    ${
      rec.url
        ? `<div class="detail-field"><div class="label">url</div>
            <div class="value"><span class="urlval">${escapeHtml(rec.url)}</span>
            <button class="icon-btn" id="copy-url">复制</button></div></div>`
        : ""
    }
    ${rec.vendor ? field("厂商", escapeHtml(rec.vendor)) : ""}
    ${
      rec.tags.length
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

  // reveal toggles the masked key
  $("reveal-btn").onclick = () => {
    const el = $("secret-val");
    const masked = el.dataset.masked === "true";
    el.textContent = masked ? rec.api_key : "••••••••••••";
    el.dataset.masked = (!masked).toString();
    $("reveal-btn").textContent = masked ? "🙈 隐藏" : "👁 显示";
  };
  $("copy-key").onclick = () => withCopied($("copy-key"), () => copyValue("api_key", rec.api_key));
  if ($("copy-url")) $("copy-url").onclick = () => withCopied($("copy-url"), () => copyValue("url", rec.url));
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
function openForm(rec) {
  state.editingId = rec ? rec.id : null;
  $("dialog-title").textContent = rec ? "编辑密钥" : "新增密钥";
  $("f-name").value = rec ? rec.name : "";
  $("f-key").value = rec ? rec.api_key : "";
  $("f-vendor").value = rec ? rec.vendor : "";
  $("f-url").value = rec ? rec.url : "";
  $("f-tags").value = rec ? rec.tags.join(", ") : "";
  $("f-note").value = rec ? rec.note : "";
  $("form-error").textContent = "";
  $("record-dialog").showModal();
  $("f-name").focus();
}

async function onFormSubmit(e) {
  e.preventDefault();
  const input = {
    name: $("f-name").value,
    api_key: $("f-key").value,
    vendor: $("f-vendor").value,
    url: $("f-url").value,
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
  $("vault-path").addEventListener("input", refreshLockMode);
  $("browse-btn").addEventListener("click", onBrowse);
  $("unlock-btn").addEventListener("click", onUnlock);
  $("master-pass").addEventListener("keydown", (e) => e.key === "Enter" && onUnlock());
  $("master-pass-confirm").addEventListener("keydown", (e) => e.key === "Enter" && onUnlock());

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
}

wireEvents();
refreshLockMode();

