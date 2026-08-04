import { describe, it, expect } from "vitest";
import { VENDOR_PRESETS } from "./vendorPresets.js";
import { vendorCandidates, filterVendorCandidates } from "./vendorDropdown.js";

describe("vendorCandidates", () => {
  it("presets come first in preset order, then used names not yet listed", () => {
    const names = vendorCandidates(["Kimi", "OpenAI", "DeepSeek"]);
    expect(names.indexOf("OpenAI")).toBe(0);
    expect(names.indexOf("Anthropic")).toBe(1);
    expect(names.indexOf("DeepSeek")).toBeLessThan(names.indexOf("Kimi"));
  });

  it("dedupes used names that are also presets", () => {
    const names = vendorCandidates(["OpenAI", "OpenAI", "DeepSeek"]);
    expect(names.filter((n) => n === "OpenAI").length).toBe(1);
    expect(names.filter((n) => n === "DeepSeek").length).toBe(1);
  });

  it("no used names gives exactly the preset list", () => {
    expect(vendorCandidates([])).toEqual(VENDOR_PRESETS.map((p) => p.name));
  });
});

describe("filterVendorCandidates", () => {
  const candidates = ["OpenAI", "Anthropic", "DeepSeek", "Moonshot"];

  it("empty or blank query returns all candidates", () => {
    expect(filterVendorCandidates(candidates, "")).toEqual(candidates);
    expect(filterVendorCandidates(candidates, "  ")).toEqual(candidates);
  });

  it("matches case-insensitively as a substring", () => {
    expect(filterVendorCandidates(candidates, "open")).toEqual(["OpenAI"]);
    expect(filterVendorCandidates(candidates, "SHOT")).toEqual(["Moonshot"]);
  });

  it("trims the query", () => {
    expect(filterVendorCandidates(candidates, "  anthropic ")).toEqual(["Anthropic"]);
  });

  it("no match gives an empty list", () => {
    expect(filterVendorCandidates(candidates, "Kimi")).toEqual([]);
  });
});
