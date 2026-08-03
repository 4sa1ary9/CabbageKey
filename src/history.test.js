import { describe, it, expect } from "vitest";
import { annotateHistoryEntries } from "./history.js";

describe("annotateHistoryEntries", () => {
  it("annotates each entry with its exists flag in order", () => {
    const entries = [
      { path: "a.json", display_name: "a.json" },
      { path: "b.json", display_name: "b.json" },
    ];
    const out = annotateHistoryEntries(entries, [true, false]);
    expect(out).toEqual([
      { path: "a.json", display_name: "a.json", exists: true },
      { path: "b.json", display_name: "b.json", exists: false },
    ]);
  });

  it("treats missing existence checks as false", () => {
    const entries = [{ path: "a.json", display_name: "a.json" }];
    const existsOf = (list) => annotateHistoryEntries(entries, list).map((e) => e.exists);
    expect(existsOf([])).toEqual([false]);
    expect(existsOf([true, true])).toEqual([true]);
  });

  it("does not mutate the input entries", () => {
    const entries = [{ path: "a.json", display_name: "a.json" }];
    const out = annotateHistoryEntries(entries, [true]);
    expect(entries[0].exists).toBeUndefined();
    expect(out[0]).not.toBe(entries[0]);
  });

  it("returns an empty list for empty history", () => {
    expect(annotateHistoryEntries([], [])).toEqual([]);
  });
});
