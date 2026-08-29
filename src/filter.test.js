import { describe, it, expect } from "vitest";
import {
  filterRecords,
  groupByVendor,
  emptyStateKind,
  UNGROUPED,
  vendorFilterValid,
  tagFilterValid,
} from "./filter.js";

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

  it("filters ungrouped records via the 未分组 sentinel", () => {
    expect(filterRecords(recs, { vendor: UNGROUPED }).map((r) => r.id)).toEqual(["4"]);
    expect(filterRecords(recs, { vendor: UNGROUPED, query: "翻译" })).toHaveLength(0);
  });

  it("returns empty when filters exclude everything", () => {
    expect(filterRecords(recs, { vendor: "Claude" })).toHaveLength(0);
  });
});

describe("search haystack", () => {
  it("matches api_key fragments", () => {
    expect(filterRecords(recs, { query: "k2" }).map((r) => r.id)).toEqual(["2"]);
  });

  it("matches endpoint URL values", () => {
    const withUrl = {
      id: "5",
      name: "x",
      api_key: "k5",
      vendor: "",
      note: "",
      tags: [],
      endpoints: { "openai-chat": "https://api.example.com/v1" },
    };
    expect(filterRecords([withUrl], { query: "example.com" })).toHaveLength(1);
  });
});

describe("groupByVendor", () => {
  it("counts per vendor and buckets empty vendor", () => {
    expect(groupByVendor(recs)).toEqual({ DeepSeek: 2, OpenAI: 1, 未分组: 1 });
  });
});

describe("stale filter guards", () => {
  const vendors = ["DeepSeek", "OpenAI"];
  it("keeps a vendor filter only while the vendor is listed", () => {
    expect(vendorFilterValid("DeepSeek", recs, vendors)).toBe(true);
    expect(vendorFilterValid("Gone", recs, vendors)).toBe(false);
    expect(vendorFilterValid(null, recs, vendors)).toBe(true);
  });

  it("keeps 未分组 only while ungrouped records remain", () => {
    expect(vendorFilterValid(UNGROUPED, recs, vendors)).toBe(true);
    expect(vendorFilterValid(UNGROUPED, recs.slice(0, 3), vendors)).toBe(false);
  });

  it("keeps a tag filter only while the tag is listed", () => {
    expect(tagFilterValid("翻译", ["翻译", "项目A"])).toBe(true);
    expect(tagFilterValid("Gone", ["翻译", "项目A"])).toBe(false);
    expect(tagFilterValid(null, [])).toBe(true);
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
