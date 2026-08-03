import { describe, it, expect } from "vitest";
import {
  applyVendorPreset,
  openRecordFormState,
  saveActiveUrl,
  toggleStandard,
  focusStandard,
  handleStdClick,
  trimEndpointUrls,
  getDefaultStandard,
  parseTags,
  buildRecordInput,
  validateRecordInput,
} from "./formState.js";

describe("applyVendorPreset", () => {
  it("fills website + standards and focuses the first standard", () => {
    const s = applyVendorPreset("OpenAI");
    expect(s.website).toBe("https://platform.openai.com");
    expect(s.endpoints).toEqual({
      "openai-chat": "https://api.openai.com/v1/chat/completions",
      "openai-responses": "https://api.openai.com/v1/responses",
    });
    expect(s.activeStd).toBe("openai-chat");
  });

  it("single-standard vendor focuses that standard", () => {
    expect(applyVendorPreset("Anthropic").activeStd).toBe("anthropic");
  });

  it("custom/unknown vendor resets everything", () => {
    const empty = { endpoints: {}, activeStd: null, website: "" };
    expect(applyVendorPreset("")).toEqual(empty);
    expect(applyVendorPreset("Nope")).toEqual(empty);
  });
});

describe("openRecordFormState", () => {
  it("loads record endpoints and focuses the first", () => {
    const s = openRecordFormState({
      id: "1",
      endpoints: { anthropic: "https://x", gemini: "https://y" },
    });
    expect(s.endpoints).toEqual({ anthropic: "https://x", gemini: "https://y" });
    expect(s.activeStd).toBe("anthropic");
  });

  it("record without endpoints or null record gives empty state", () => {
    expect(openRecordFormState(null)).toEqual({ endpoints: {}, activeStd: null });
    expect(openRecordFormState({ id: "1" })).toEqual({ endpoints: {}, activeStd: null });
  });
});

describe("saveActiveUrl", () => {
  it("stores the input URL for the active standard, trimmed", () => {
    const s = { endpoints: { a: "x" }, activeStd: "a" };
    expect(saveActiveUrl(s, "  https://new ").endpoints.a).toBe("https://new");
  });

  it("no-op without an active standard", () => {
    const s = { endpoints: {}, activeStd: null };
    expect(saveActiveUrl(s, "whatever")).toBe(s);
  });

  it("does not mutate the original state", () => {
    const s = { endpoints: { a: "x" }, activeStd: "a" };
    saveActiveUrl(s, "y");
    expect(s.endpoints.a).toBe("x");
  });
});

describe("toggleStandard", () => {
  it("activates an inactive standard with the preset URL, saving the previous URL", () => {
    const s = { endpoints: { a: "https://a" }, activeStd: "a" };
    const next = toggleStandard(s, "b", "  https://a-typed ", "https://preset-b");
    expect(next.endpoints).toEqual({ a: "https://a-typed", b: "https://preset-b" });
    expect(next.activeStd).toBe("b");
  });

  it("deactivates the active standard and refocuses the first remaining", () => {
    const s = { endpoints: { a: "https://a", b: "https://b" }, activeStd: "a" };
    const next = toggleStandard(s, "a", "https://a-typed", "");
    expect(next.endpoints).toEqual({ b: "https://b" });
    expect(next.activeStd).toBe("b");
  });

  it("deactivating the last standard leaves nothing active", () => {
    const s = { endpoints: { a: "https://a" }, activeStd: "a" };
    expect(toggleStandard(s, "a", "", "")).toEqual({ endpoints: {}, activeStd: null });
  });
});

describe("focusStandard", () => {
  it("switches the displayed standard, saving the current URL", () => {
    const s = { endpoints: { a: "https://a", b: "https://b" }, activeStd: "a" };
    const next = focusStandard(s, "b", " https://a-typed ");
    expect(next.activeStd).toBe("b");
    expect(next.endpoints).toEqual({ a: "https://a-typed", b: "https://b" });
  });

  it("no-op when the target is not active", () => {
    const s = { endpoints: { a: "https://a" }, activeStd: "a" };
    expect(focusStandard(s, "c", "x")).toBe(s);
  });
});

describe("handleStdClick", () => {
  it("focuses an already-active standard that is not displayed", () => {
    const s = { endpoints: { a: "https://a", b: "https://b" }, activeStd: "a" };
    const next = handleStdClick(s, "b", "https://a-typed", "");
    expect(next.activeStd).toBe("b");
    expect(next.endpoints.a).toBe("https://a-typed");
  });

  it("deactivates the displayed active standard", () => {
    const s = { endpoints: { a: "https://a" }, activeStd: "a" };
    expect(handleStdClick(s, "a", "x", "")).toEqual({ endpoints: {}, activeStd: null });
  });

  it("activates an inactive standard with the preset URL", () => {
    const s = { endpoints: {}, activeStd: null };
    const next = handleStdClick(s, "gemini", "", "https://preset");
    expect(next).toEqual({ endpoints: { gemini: "https://preset" }, activeStd: "gemini" });
  });
});

describe("trimEndpointUrls", () => {
  it("trims values and keeps keys (even empty ones)", () => {
    expect(trimEndpointUrls({ a: "  https://a  ", b: "" })).toEqual({ a: "https://a", b: "" });
  });
});

describe("getDefaultStandard", () => {
  it("returns the first supported standard", () => {
    expect(getDefaultStandard({ "openai-chat": "u", anthropic: "v" })).toBe("openai-chat");
  });

  it("null for no endpoints", () => {
    expect(getDefaultStandard({})).toBeNull();
    expect(getDefaultStandard(null)).toBeNull();
  });
});

describe("parseTags", () => {
  it("splits on comma, trims, drops empties", () => {
    expect(parseTags(" 翻译 , 项目A ,,  ")).toEqual(["翻译", "项目A"]);
  });

  it("empty or undefined text gives empty array", () => {
    expect(parseTags("")).toEqual([]);
    expect(parseTags(undefined)).toEqual([]);
  });
});

describe("buildRecordInput", () => {
  it("maps fields, parses tags, trims endpoints", () => {
    const input = buildRecordInput({
      name: " 翻译 ",
      apiKey: "k1",
      vendor: "DeepSeek",
      website: "https://platform.deepseek.com",
      note: " 备注 ",
      tagsText: " 翻译 , 项目A ",
      endpoints: { a: " https://a ", b: "" },
    });
    expect(input).toEqual({
      name: " 翻译 ",
      api_key: "k1",
      vendor: "DeepSeek",
      endpoints: { a: "https://a", b: "" },
      website: "https://platform.deepseek.com",
      note: " 备注 ",
      tags: ["翻译", "项目A"],
    });
  });
});

describe("validateRecordInput", () => {
  it("rejects empty name", () => {
    expect(validateRecordInput({ name: "  ", api_key: "k" })).toBe("用途名称不能为空");
  });

  it("rejects empty api_key", () => {
    expect(validateRecordInput({ name: "n", api_key: "" })).toBe("api_key 不能为空");
  });

  it("accepts a complete input", () => {
    expect(validateRecordInput({ name: "n", api_key: "k" })).toBeNull();
  });
});
