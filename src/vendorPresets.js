// Built-in AI vendor presets for auto-fill.
// Each entry: { name, website, standards: { key → endpoint URL }, defaultStandard }
//
// Standard keys:
//   "openai-chat"      — OpenAI Chat Completions (/v1/chat/completions)
//   "openai-responses" — OpenAI Responses API (/v1/responses)
//   "anthropic"        — Anthropic Messages (/v1/messages)
//   "gemini"           — Gemini Native generateContent

export const API_STANDARD_LABELS = {
    "openai-chat": "OpenAI Chat Completions",
    "openai-responses": "OpenAI Responses API",
    "anthropic": "Anthropic Messages",
    "gemini": "Gemini generateContent",
};

export const ALL_STANDARDS = Object.keys(API_STANDARD_LABELS);

export const VENDOR_PRESETS = [
    {
        name: "OpenAI",
        website: "https://platform.openai.com",
        standards: {
            "openai-chat": "https://api.openai.com/v1/chat/completions",
            "openai-responses": "https://api.openai.com/v1/responses",
        },
        defaultStandard: "openai-chat",
    },
    {
        name: "Anthropic",
        website: "https://console.anthropic.com",
        standards: {
            "anthropic": "https://api.anthropic.com/v1/messages",
        },
        defaultStandard: "anthropic",
    },
    {
        name: "Google",
        website: "https://aistudio.google.com",
        standards: {
            "gemini": "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
            "openai-chat": "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        },
        defaultStandard: "gemini",
    },
    {
        name: "DeepSeek",
        website: "https://platform.deepseek.com",
        standards: {
            "openai-chat": "https://api.deepseek.com/chat/completions",
            "openai-responses": "https://api.deepseek.com/responses",
        },
        defaultStandard: "openai-chat",
    },
    {
        name: "Moonshot",
        website: "https://platform.moonshot.cn",
        standards: {
            "openai-chat": "https://api.moonshot.cn/v1/chat/completions",
        },
        defaultStandard: "openai-chat",
    },
    {
        name: "Zhipu",
        website: "https://open.bigmodel.cn",
        standards: {
            "openai-chat": "https://open.bigmodel.cn/api/paas/v4/chat/completions",
        },
        defaultStandard: "openai-chat",
    },
    {
        name: "Baichuan",
        website: "https://platform.baichuan-ai.com",
        standards: {
            "openai-chat": "https://api.baichuan-ai.com/v1/chat/completions",
        },
        defaultStandard: "openai-chat",
    },
    {
        name: "Minimax",
        website: "https://platform.minimaxi.com",
        standards: {
            "openai-chat": "https://api.minimax.chat/v1/text/chatcompletion_v2",
        },
        defaultStandard: "openai-chat",
    },
    {
        name: "01.AI",
        website: "https://platform.lingyiwanwu.com",
        standards: {
            "openai-chat": "https://api.lingyiwanwu.com/v1/chat/completions",
        },
        defaultStandard: "openai-chat",
    },
    {
        name: "xAI",
        website: "https://console.x.ai",
        standards: {
            "openai-chat": "https://api.x.ai/v1/chat/completions",
        },
        defaultStandard: "openai-chat",
    },
];

/** Returns preset object for a vendor name, or null if not found. */
export function getPreset(vendorName) {
    return VENDOR_PRESETS.find((p) => p.name === vendorName) || null;
}

/** Returns array of supported standard keys for a vendor, or empty array. */
export function getSupportedStandards(vendorName) {
    const preset = getPreset(vendorName);
    return preset ? Object.keys(preset.standards) : [];
}

/** Returns endpoint URL for a vendor + standard combination, or empty string. */
export function getEndpointUrl(vendorName, standard) {
    const preset = getPreset(vendorName);
    if (!preset) return "";
    return preset.standards[standard] || "";
}

/** Prepends "https://" if the URL has no protocol. Returns empty for empty input. */
export function normalizeUrl(url) {
    if (!url) return "";
    if (url.startsWith("http://") || url.startsWith("https://")) {
        return url;
    }
    return "https://" + url;
}

/** Returns human-readable label for a standard key. */
export function getStandardLabel(key) {
    return API_STANDARD_LABELS[key] || key;
}
