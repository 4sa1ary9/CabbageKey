// Pure HTML builder for the detail panel. DOM wiring stays in main.js;
// field order and api_key masking live here (unit-tested).
import { escapeHtml } from "./html.js";
import { ALL_STANDARDS, getStandardLabel, normalizeUrl } from "./vendorPresets.js";
import { endpointState } from "./formState.js";

// 24 bullets — matches the masked-state render; reveal toggle in main.js
// swaps between this and the real key.
export const MASKED_API_KEY = "••••••••••••••••••••••••";

function field(label, value) {
  return `<div class="detail-field"><div class="label">${label}</div><div class="value">${value}</div></div>`;
}

// 👁/🙈 emoji 在不同 Windows 版本渲染粗细不一 — 揭示按钮用描边 SVG（currentColor）。
const EYE_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3.5 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/></svg>';

/** Reveal 按钮内容：掩码态 eye+显示，明文态 eye-off+隐藏。 */
export function revealButtonHtml(masked) {
  return `${masked ? EYE_SVG : EYE_OFF_SVG}<span>${masked ? "显示" : "隐藏"}</span>`;
}

/** ISO UTC 字符串 → 本地时间显示；空值返回空串，无法解析时原样返回。 */
export function formatTimestamp(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("zh-CN", { hour12: false });
}

/** 创建/更新时间行：缺失时为空串（老 vault 可能没有）；两者相同只显示创建。 */
function metaLine(rec) {
  const parts = [];
  if (rec.created_at) parts.push(`创建于 ${formatTimestamp(rec.created_at)}`);
  if (rec.updated_at && rec.updated_at !== rec.created_at) {
    parts.push(`更新于 ${formatTimestamp(rec.updated_at)}`);
  }
  return parts.length
    ? `<div class="detail-meta">${escapeHtml(parts.join(" · "))}</div>`
    : "";
}

/** Inner HTML for the detail panel body: title + fields + actions. */
export function buildDetailBodyHtml(rec) {
  const endpoints = rec.endpoints || {};
  const supported = ALL_STANDARDS.filter((s) => s in endpoints);

  return `
    <div class="detail-title">${escapeHtml(rec.name)}</div>
    ${rec.vendor ? field("厂商", escapeHtml(rec.vendor)) : ""}
    ${rec.website
      ? `<div class="detail-field"><div class="label">官网</div>
          <div class="value"><a href="${escapeHtml(normalizeUrl(rec.website))}" target="_blank" rel="noopener">${escapeHtml(rec.website)}</a></div></div>`
      : ""
    }
    <div class="detail-field">
      <div class="label">api_key</div>
      <div class="value">
        <span class="secret" id="secret-val" data-masked="true">${MASKED_API_KEY}</span>
        <button class="icon-btn" id="reveal-btn">${revealButtonHtml(true)}</button>
        <button class="icon-btn" id="copy-key">复制</button>
      </div>
    </div>
    <div class="detail-field">
      <div class="label">支持的接口规范</div>
      <div class="detail-std-group">
        ${ALL_STANDARDS.map((key) => {
    const { declared, hasUrl } = endpointState(endpoints, key);
    return `<button type="button" class="detail-std-btn" data-std="${key}" data-supported="${declared}" data-gray="${declared && !hasUrl}">${escapeHtml(getStandardLabel(key))}</button>`;
  }).join("")}
      </div>
    </div>
    <div class="detail-field">
      <div class="label">端点 URL</div>
      <div class="detail-url-list">
        ${supported.length
          ? supported.map((std) => {
              const url = endpoints[std];
              if (!url) {
                return `<div class="detail-url-row" data-gray="true"><span class="detail-url-label">${escapeHtml(getStandardLabel(std))}</span><span class="urlval">未配置</span></div>`;
              }
              return `<div class="detail-url-row"><span class="detail-url-label">${escapeHtml(getStandardLabel(std))}</span><span class="urlval">${escapeHtml(url)}</span><button type="button" class="icon-btn copy-url" data-url="${escapeHtml(url)}">复制</button></div>`;
            }).join("")
          : `<span class="urlval">未配置</span>`
        }
      </div>
    </div>
    ${rec.tags.length
      ? `<div class="detail-field"><div class="label">标签</div><div>${rec.tags
        .map((t) => `<span class="tag-chip">#${escapeHtml(t)}</span>`)
        .join("")}</div></div>`
      : ""
    }
    ${rec.note ? field("备注", escapeHtml(rec.note)) : ""}
    ${metaLine(rec)}
    <div class="detail-actions">
      <button class="btn-secondary" id="edit-btn">编辑</button>
      <button class="btn-secondary" id="duplicate-btn">复制</button>
      <button class="btn-danger" id="delete-btn">删除</button>
    </div>`;
}
