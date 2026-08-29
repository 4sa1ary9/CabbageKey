import { describe, it, expect, vi } from "vitest";
import { enrichHistory } from "./history.js";

const entries = [
  { path: "C:\\a\\one.json", display_name: "one.json" },
  { path: "C:\\b\\two.json", display_name: "two.json" },
];

describe("enrichHistory", () => {
  it("probes every path and annotates the entries in order", async () => {
    const existsFn = vi.fn((path) => Promise.resolve(path.endsWith("one.json")));
    const out = await enrichHistory(entries, existsFn);
    expect(existsFn).toHaveBeenCalledTimes(2);
    expect(existsFn).toHaveBeenCalledWith("C:\\a\\one.json");
    expect(out).toEqual([
      { path: "C:\\a\\one.json", display_name: "one.json", exists: true },
      { path: "C:\\b\\two.json", display_name: "two.json", exists: false },
    ]);
  });

  it("treats an errored probe as not-existing", async () => {
    const existsFn = vi.fn((path) =>
      path.endsWith("two.json") ? Promise.reject(new Error("boom")) : Promise.resolve(true)
    );
    const out = await enrichHistory(entries, existsFn);
    expect(out.map((e) => e.exists)).toEqual([true, false]);
  });

  it("returns an empty list for empty history (no probes)", async () => {
    const existsFn = vi.fn();
    await expect(enrichHistory([], existsFn)).resolves.toEqual([]);
    expect(existsFn).not.toHaveBeenCalled();
  });

  it("does not mutate the input entries", async () => {
    const out = await enrichHistory(entries, () => Promise.resolve(true));
    expect(entries[0].exists).toBeUndefined();
    expect(out[0]).not.toBe(entries[0]);
  });
});
