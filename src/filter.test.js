import { describe, it, expect } from "vitest";
import { filterRecords, groupByVendor, emptyStateKind } from "./filter.js";

const recs = [
  { id: "1", name: "翻译用", api_key: "k1", vendor: "DeepSeek", note: "", tags: ["翻译"] },
  { id: "2", name: "对话测试", api_key: "k2", vendor: "OpenAI", note: "个人", tags: ["项目A"] },
  { id: "3", name: "翻译备用", api_key: "k3", vendor: "DeepSeek", note: "", tags: ["翻译", "已废弃"] },
  { id: "4", name: "无厂商的", api_key: "k4", vendor: "", note: "", tags: [] },
];

describe("filterRecords", () => {
  it("returns all when no filter", () => {
    expect(filterRecords(recs)).toHaveLength(4);
  });

  it("filters by vendor", () => {
    expect(filterRecords(recs, { vendor: "DeepSeek" }).map((r) => r.id)).toEqual(["1", "3"]);
  });

  it("filters by tag", () => {
    expect(filterRecords(recs, { tag: "已废弃" }).map((r) => r.id)).toEqual(["3"]);
  });

  it("searches name / vendor / note / tags", () => {
    expect(filterRecords(recs, { query: "翻译" }).map((r) => r.id)).toEqual(["1", "3"]);
    expect(filterRecords(recs, { query: "openai" }).map((r) => r.id)).toEqual(["2"]);
    expect(filterRecords(recs, { query: "个人" }).map((r) => r.id)).toEqual(["2"]);
    expect(filterRecords(recs, { query: "项目A" }).map((r) => r.id)).toEqual(["2"]);
  });

  it("stacks search + vendor + tag", () => {
    const out = filterRecords(recs, { query: "翻译", vendor: "DeepSeek", tag: "已废弃" });
    expect(out.map((r) => r.id)).toEqual(["3"]);
  });

  it("returns empty when filters exclude everything", () => {
    expect(filterRecords(recs, { vendor: "Claude" })).toHaveLength(0);
  });
});

describe("groupByVendor", () => {
  it("counts per vendor and buckets empty vendor", () => {
    expect(groupByVendor(recs)).toEqual({ DeepSeek: 2, OpenAI: 1, 未分组: 1 });
  });
});

describe("emptyStateKind", () => {
  it("first-run when vault is empty", () => {
    expect(emptyStateKind({ totalRecords: 0, visibleRecords: 0, hasActiveFilter: false })).toBe(
      "first-run"
    );
  });
  it("no-results when filter hides everything", () => {
    expect(emptyStateKind({ totalRecords: 4, visibleRecords: 0, hasActiveFilter: true })).toBe(
      "no-results"
    );
  });
  it("null when records are visible", () => {
    expect(emptyStateKind({ totalRecords: 4, visibleRecords: 2, hasActiveFilter: true })).toBeNull();
  });
});
