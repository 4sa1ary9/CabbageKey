import { describe, it, expect } from "vitest";
import { buildDetailBodyHtml, MASKED_API_KEY } from "./detailView.js";

const rec = {
  id: "1",
  name: "翻译用",
  api_key: "sk-123",
  vendor: "DeepSeek",
  website: "platform.deepseek.com",
  note: "主力",
  tags: ["翻译", "项目A"],
  endpoints: { "openai-chat": "https://api.deepseek.com/chat/completions" },
};

function labels(html) {
  const div = document.createElement("div");
  div.innerHTML = html;
  return [...div.querySelectorAll(".detail-field .label")].map((el) => el.textContent);
}

describe("buildDetailBodyHtml field order", () => {
  it("orders 厂商 → 官网 → api_key → 支持的接口规范 → 端点 URL → 标签 → 备注", () => {
    expect(labels(buildDetailBodyHtml(rec))).toEqual([
      "厂商",
      "官网",
      "api_key",
      "支持的接口规范",
      "端点 URL",
      "标签",
      "备注",
    ]);
  });

  it("omits 厂商 and 官网 when missing, keeps others", () => {
    const r = { ...rec, vendor: "", website: "" };
    const html = buildDetailBodyHtml(r);
    expect(labels(html)).toEqual(["api_key", "支持的接口规范", "端点 URL", "标签", "备注"]);
  });

  it("omits 标签 and 备注 when missing", () => {
    const r = { ...rec, tags: [], note: "" };
    expect(labels(buildDetailBodyHtml(r))).toEqual([
      "厂商",
      "官网",
      "api_key",
      "支持的接口规范",
      "端点 URL",
    ]);
  });
});

describe("api_key masking", () => {
  it("MASKED_API_KEY is exactly 24 bullets", () => {
    expect(MASKED_API_KEY).toBe("•".repeat(24));
    expect(MASKED_API_KEY).not.toBe("•".repeat(12));
  });

  it("renders the secret value as 24 bullets with data-masked=true", () => {
    const div = document.createElement("div");
    div.innerHTML = buildDetailBodyHtml(rec);
    const el = div.querySelector("#secret-val");
    expect(el.textContent).toBe("•".repeat(24));
    expect(el.dataset.masked).toBe("true");
  });

  it("does not leak the real api key in masked state", () => {
    const div = document.createElement("div");
    div.innerHTML = buildDetailBodyHtml(rec);
    expect(div.textContent).not.toContain("sk-123");
  });
});

describe("detail actions", () => {
  it("renders 编辑 / 复制 / 删除 buttons in that order", () => {
    const div = document.createElement("div");
    div.innerHTML = buildDetailBodyHtml(rec);
    const btns = [...div.querySelectorAll(".detail-actions button")].map((b) => b.textContent);
    expect(btns).toEqual(["编辑", "复制", "删除"]);
  });
});
