import { describe, it, expect } from "vitest";
import {
  applyVendorPreset,
  openRecordFormState,
  backfillPresetEndpoints,
  toggleStandard,
  trimEndpointUrls,
  parseTags,
  buildRecordInput,
  validateRecordInput,
  duplicateName,
} from "./formState.js";

describe("applyVendorPreset", () => {
  it("fills website + standards", () => {
    const s = applyVendorPreset("OpenAI");
    expect(s.website).toBe("https://platform.openai.com");
    expect(s.endpoints).toEqual({
      "openai-chat": "https://api.openai.com/v1/chat/completions",
      "openai-responses": "https://api.openai.com/v1/responses",
    });
  });

  it("custom/unknown vendor resets everything", () => {
    const empty = { endpoints: {}, website: "" };
    expect(applyVendorPreset("")).toEqual(empty);
    expect(applyVendorPreset("Nope")).toEqual(empty);
  });
});

describe("openRecordFormState", () => {
  it("loads record endpoints", () => {
    const s = openRecordFormState({
      id: "1",
      endpoints: { anthropic: "https://x", gemini: "https://y" },
    });
    expect(s.endpoints).toEqual({ anthropic: "https://x", gemini: "https://y" });
  });

  it("record without endpoints or null record gives empty state", () => {
    expect(openRecordFormState(null)).toEqual({ endpoints: {} });
    expect(openRecordFormState({ id: "1" })).toEqual({ endpoints: {} });
  });
});

describe("backfillPresetEndpoints", () => {
  it("fills only standards missing from the record, keeping existing values", () => {
    const endpoints = { "openai-chat": "https://my-proxy/v1/chat/completions" };
    expect(backfillPresetEndpoints(endpoints, "OpenAI")).toEqual({
      "openai-chat": "https://my-proxy/v1/chat/completions",
      "openai-responses": "https://api.openai.com/v1/responses",
    });
  });

  it("never overwrites existing values, even empty ones", () => {
    const endpoints = { "openai-chat": "", "openai-responses": "https://custom" };
    expect(backfillPresetEndpoints(endpoints, "OpenAI")).toEqual({
      "openai-chat": "",
      "openai-responses": "https://custom",
    });
  });

  it("custom/unknown vendor leaves endpoints untouched", () => {
    const endpoints = { anthropic: "https://x" };
    expect(backfillPresetEndpoints(endpoints, "")).toEqual({ anthropic: "https://x" });
    expect(backfillPresetEndpoints(endpoints, "Kimi")).toEqual({ anthropic: "https://x" });
  });

  it("missing endpoints object backfills from scratch", () => {
    expect(backfillPresetEndpoints(undefined, "Anthropic")).toEqual({
      anthropic: "https://api.anthropic.com/v1/messages",
    });
  });
});

describe("toggleStandard", () => {
  it("activates an inactive standard with the preset URL", () => {
    const s = { endpoints: { a: "https://a" } };
    const next = toggleStandard(s, "b", "https://preset-b");
    expect(next.endpoints).toEqual({ a: "https://a", b: "https://preset-b" });
  });

  it("deactivates an active standard with one click", () => {
    const s = { endpoints: { a: "https://a", b: "https://b" } };
    expect(toggleStandard(s, "a", "")).toEqual({ endpoints: { b: "https://b" } });
  });

  it("custom vendor activates with an empty URL", () => {
    const s = { endpoints: {} };
    expect(toggleStandard(s, "anthropic", "")).toEqual({ endpoints: { anthropic: "" } });
  });

  it("does not mutate the original state", () => {
    const s = { endpoints: { a: "https://a" } };
    toggleStandard(s, "b", "https://b");
    expect(s.endpoints).toEqual({ a: "https://a" });
  });
});

describe("trimEndpointUrls", () => {
  it("trims values and keeps keys (even empty ones)", () => {
    expect(trimEndpointUrls({ a: "  https://a  ", b: "" })).toEqual({ a: "https://a", b: "" });
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

describe("duplicateName", () => {
  it("appends _copy to the original name", () => {
    expect(duplicateName("翻译用")).toBe("翻译用_copy");
  });

  it("repeats the suffix for repeated copies (not unique)", () => {
    expect(duplicateName("翻译用_copy")).toBe("翻译用_copy_copy");
  });
});
