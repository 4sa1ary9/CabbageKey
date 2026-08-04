// Pure HTML builder for the detail panel. DOM wiring stays in main.js;
// field order and api_key masking live here (unit-tested).
import { escapeHtml } from "./html.js";
import { ALL_STANDARDS, getStandardLabel, normalizeUrl } from "./vendorPresets.js";

// 24 bullets — matches the masked-state render; reveal toggle in main.js
// swaps between this and the real key.
export const MASKED_API_KEY = "••••••••••••••••••••••••";

function field(label, value) {
  return `<div class="detail-field"><div class="label">${label}</div><div class="value">${value}</div></div>`;
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
        <button class="icon-btn" id="reveal-btn">👁 显示</button>
        <button class="icon-btn" id="copy-key">复制</button>
      </div>
    </div>
    <div class="detail-field">
      <div class="label">支持的接口规范</div>
      <div class="detail-std-group">
        ${ALL_STANDARDS.map((key) => {
    const active = key in endpoints;
    return `<button type="button" class="detail-std-btn" data-std="${key}" data-supported="${active}" data-gray="${active && !endpoints[key]}">${escapeHtml(getStandardLabel(key))}</button>`;
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
    <div class="detail-actions">
      <button class="btn-secondary" id="edit-btn">编辑</button>
      <button class="btn-secondary" id="duplicate-btn">复制</button>
      <button class="btn-danger" id="delete-btn">删除</button>
    </div>`;
}
