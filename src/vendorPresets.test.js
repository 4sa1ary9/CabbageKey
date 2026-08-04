import { describe, it, expect } from "vitest";
import {
    VENDOR_PRESETS,
    getPreset,
    getSupportedStandards,
    getEndpointUrl,
    normalizeUrl,
    getStandardLabel,
} from "./vendorPresets.js";

describe("VENDOR_PRESETS", () => {
    it("contains exactly 10 vendors", () => {
        expect(VENDOR_PRESETS).toHaveLength(10);
    });

    it("includes all expected vendor names", () => {
        const names = VENDOR_PRESETS.map((p) => p.name);
        expect(names).toEqual([
            "OpenAI", "Anthropic", "Google", "DeepSeek", "Moonshot",
            "Zhipu", "Baichuan", "Minimax", "01.AI", "xAI",
        ]);
    });

    it("each preset has required shape", () => {
        for (const preset of VENDOR_PRESETS) {
            expect(typeof preset.name).toBe("string");
            expect(typeof preset.website).toBe("string");
            expect(typeof preset.standards).toBe("object");
            expect(typeof preset.defaultStandard).toBe("string");
            expect(Object.keys(preset.standards).length).toBeGreaterThan(0);
            expect(preset.standards[preset.defaultStandard]).toBeDefined();
        }
    });
});

describe("getPreset", () => {
    it("returns preset for a known vendor", () => {
        const p = getPreset("OpenAI");
        expect(p).not.toBeNull();
        expect(p.name).toBe("OpenAI");
        expect(p.website).toBe("https://platform.openai.com");
    });

    it("returns null for unknown vendor", () => {
        expect(getPreset("UnknownVendor")).toBeNull();
    });

    it("returns null for empty string", () => {
        expect(getPreset("")).toBeNull();
    });
});

describe("getSupportedStandards", () => {
    it("returns multiple standards for multi-protocol vendor", () => {
        expect(getSupportedStandards("DeepSeek")).toEqual(["openai-chat", "openai-responses"]);
    });

    it("returns ['anthropic'] for Anthropic", () => {
        expect(getSupportedStandards("Anthropic")).toEqual(["anthropic"]);
    });

    it("returns empty array for unknown vendor", () => {
        expect(getSupportedStandards("Nope")).toEqual([]);
    });
});

describe("getEndpointUrl", () => {
    it("returns correct URL for vendor + standard", () => {
        expect(getEndpointUrl("OpenAI", "openai-chat")).toBe(
            "https://api.openai.com/v1/chat/completions"
        );
    });

    it("returns empty for unsupported standard", () => {
        expect(getEndpointUrl("OpenAI", "anthropic")).toBe("");
    });

    it("returns empty for unknown vendor", () => {
        expect(getEndpointUrl("Unknown", "openai-chat")).toBe("");
    });
});

describe("normalizeUrl", () => {
    it("prepends https:// when no protocol", () => {
        expect(normalizeUrl("example.com")).toBe("https://example.com");
    });

    it("leaves https:// URLs unchanged", () => {
        expect(normalizeUrl("https://example.com")).toBe("https://example.com");
    });

    it("leaves http:// URLs unchanged", () => {
        expect(normalizeUrl("http://example.com")).toBe("http://example.com");
    });

    it("returns empty for empty input", () => {
        expect(normalizeUrl("")).toBe("");
    });

    it("returns empty for null/undefined", () => {
        expect(normalizeUrl(null)).toBe("");
        expect(normalizeUrl(undefined)).toBe("");
    });
});

describe("getStandardLabel", () => {
    it("uses short names matching the toggle buttons in the form", () => {
        expect(getStandardLabel("openai-chat")).toBe("OpenAI Chat");
        expect(getStandardLabel("openai-responses")).toBe("OpenAI Responses");
        expect(getStandardLabel("anthropic")).toBe("Anthropic");
        expect(getStandardLabel("gemini")).toBe("Gemini");
    });

    it("falls back to the raw key for unknown standards", () => {
        expect(getStandardLabel("nope")).toBe("nope");
    });
});
