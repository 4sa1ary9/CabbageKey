import { describe, expect, it, vi } from "vitest";
import { ALL_STANDARDS } from "./vendorPresets.js";
import { createFormSession } from "./formSession.js";

// jsdom fixture mirroring the dialog skeleton in index.html — enough for the
// session to read/write every field it owns.
const FIXTURE = `
<dialog id="record-dialog"></dialog>
<span id="dialog-title"></span>
<input id="f-name" /><input id="f-key" /><input id="f-vendor" />
<input id="f-website" /><input id="f-tags" /><input id="f-note" />
<div id="form-error"></div><button id="form-save"></button>
<div id="f-standards-group">${ALL_STANDARDS.map((s) => `<button class="std-toggle" data-std="${s}"></button>`).join("")}</div>
<div id="f-url-section" hidden></div><div id="f-url-rows"></div>
`;

function makeSession(depsOverrides = {}) {
  document.body.innerHTML = FIXTURE;
  const $ = (id) => document.getElementById(id);
  const els = {
    name: $("f-name"),
    key: $("f-key"),
    vendor: $("f-vendor"),
    website: $("f-website"),
    tags: $("f-tags"),
    note: $("f-note"),
    error: $("form-error"),
    save: $("form-save"),
    dialog: $("record-dialog"),
    title: $("dialog-title"),
    stdGroup: $("f-standards-group"),
    urlSection: $("f-url-section"),
    urlRows: $("f-url-rows"),
  };
  // jsdom has no dialog showModal; stub both ends of the lifecycle.
  els.dialog.showModal = vi.fn();
  els.dialog.close = vi.fn();
  const deps = {
    api: { addRecord: vi.fn(), updateRecord: vi.fn() },
    confirmDiscard: vi.fn(async () => true),
    confirmVendorSwitch: vi.fn(async () => true),
    onOpened: vi.fn(),
    ...depsOverrides,
  };
  return { session: createFormSession(els, deps), els, deps };
}

const REC = {
  id: "r1",
  name: "翻译用",
  api_key: "sk-x",
  vendor: "OpenAI",
  endpoints: {},
  website: "",
  note: "",
  tags: [],
};

function urlRowValues(els) {
  return [...els.urlRows.querySelectorAll(".url-row-input")].map((i) => i.value);
}

function lamp(els, std) {
  const btn = els.stdGroup.querySelector(`[data-std="${std}"]`);
  return { active: btn.dataset.active, gray: btn.dataset.gray };
}

function pending() {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}

describe("open", () => {
  it("add: clears stale fields, paints a clean form, shows the dialog", () => {
    const { session, els, deps } = makeSession();
    els.name.value = "stale";
    session.open({ kind: "add" });
    expect(els.name.value).toBe("");
    expect(els.title.textContent).toBe("新增密钥");
    expect(els.urlSection.hidden).toBe(true);
    expect(deps.onOpened).toHaveBeenCalledTimes(1);
    expect(els.dialog.showModal).toHaveBeenCalledTimes(1);
    expect(session.isDirty()).toBe(false);
  });

  it("edit: fills from the record and backfills missing preset URLs", () => {
    const { session, els } = makeSession();
    session.open({ kind: "edit", rec: REC });
    expect(els.title.textContent).toBe("编辑密钥");
    expect(els.name.value).toBe("翻译用");
    expect(els.vendor.value).toBe("OpenAI");
    expect(els.website.value).toBe("");
    expect(urlRowValues(els)).toEqual([
      "https://api.openai.com/v1/chat/completions",
      "https://api.openai.com/v1/responses",
    ]);
  });

  it("duplicate: suffixes the name and mirrors endpoints without backfill", () => {
    const { session, els } = makeSession();
    session.open({
      kind: "duplicate",
      rec: { ...REC, endpoints: { "openai-chat": "https://custom" } },
    });
    expect(els.name.value).toBe("翻译用_copy");
    expect(urlRowValues(els)).toEqual(["https://custom"]);
  });

  it("quick-add: prefills vendor + preset website and endpoint URLs", () => {
    const { session, els } = makeSession();
    session.open({ kind: "quick-add", vendor: "OpenAI" });
    expect(els.vendor.value).toBe("OpenAI");
    expect(els.website.value).toBe("https://platform.openai.com");
    expect(urlRowValues(els)).toEqual([
      "https://api.openai.com/v1/chat/completions",
      "https://api.openai.com/v1/responses",
    ]);
  });
});

describe("dirty guard + close", () => {
  it("isDirty flips when a field changes after open", () => {
    const { session, els } = makeSession();
    session.open({ kind: "add" });
    expect(session.isDirty()).toBe(false);
    els.note.value = "改了一句";
    expect(session.isDirty()).toBe(true);
  });

  it("isDirty flips when a URL changes", () => {
    const { session } = makeSession();
    session.open({ kind: "add" });
    session.toggleStd("anthropic");
    session.setUrl("anthropic", "https://y");
    expect(session.isDirty()).toBe(true);
  });

  it("confirmClose closes a clean form without asking", async () => {
    const { session, els, deps } = makeSession();
    session.open({ kind: "add" });
    await session.confirmClose();
    expect(deps.confirmDiscard).not.toHaveBeenCalled();
    expect(els.dialog.close).toHaveBeenCalledTimes(1);
  });

  it("confirmClose keeps the dialog open when the discard is declined", async () => {
    const { session, els, deps } = makeSession();
    session.open({ kind: "add" });
    els.name.value = "没保存";
    deps.confirmDiscard.mockResolvedValueOnce(false);
    await session.confirmClose();
    expect(els.dialog.close).not.toHaveBeenCalled();
  });
});

describe("submit", () => {
  it("add mode submits via api.addRecord with the built payload", async () => {
    const { session, els, deps } = makeSession();
    session.open({ kind: "add" });
    const view = { records: [], vendors: [], tags: [] };
    deps.api.addRecord.mockResolvedValueOnce(view);
    els.name.value = "n";
    els.key.value = "k";
    els.tags.value = "a, b";
    expect(await session.submit()).toBe(view);
    expect(deps.api.addRecord).toHaveBeenCalledWith({
      name: "n",
      api_key: "k",
      vendor: "",
      endpoints: {},
      website: "",
      note: "",
      tags: ["a", "b"],
    });
    expect(deps.api.updateRecord).not.toHaveBeenCalled();
  });

  it("edit mode submits via api.updateRecord with the record id", async () => {
    const { session, deps } = makeSession();
    session.open({ kind: "edit", rec: REC });
    deps.api.updateRecord.mockResolvedValueOnce({ records: [] });
    await session.submit();
    expect(deps.api.updateRecord).toHaveBeenCalledTimes(1);
    const [id] = deps.api.updateRecord.mock.calls[0];
    expect(id).toBe("r1");
  });

  it("ignores submits while one is in flight (double-click guard)", async () => {
    const { session, els, deps } = makeSession();
    session.open({ kind: "add" });
    els.name.value = "n";
    els.key.value = "k";
    const gate = pending();
    const view = { records: [] };
    deps.api.addRecord.mockReturnValueOnce(gate.promise);
    const first = session.submit();
    expect(els.save.disabled).toBe(true);
    expect(await session.submit()).toBeNull();
    expect(deps.api.addRecord).toHaveBeenCalledTimes(1);
    gate.resolve(view);
    expect(await first).toBe(view);
    expect(els.save.disabled).toBe(false);
  });

  it("shows validation errors and skips the api call", async () => {
    const { session, els, deps } = makeSession();
    session.open({ kind: "add" });
    expect(await session.submit()).toBeNull();
    expect(els.error.textContent).toBe("用途名称不能为空");
    expect(deps.api.addRecord).not.toHaveBeenCalled();
    expect(els.save.disabled).toBe(false);
  });

  it("shows api failures inline and re-enables the save button", async () => {
    const { session, els, deps } = makeSession();
    session.open({ kind: "add" });
    els.name.value = "n";
    els.key.value = "k";
    deps.api.addRecord.mockRejectedValueOnce("没有打开的 vault");
    expect(await session.submit()).toBeNull();
    expect(els.error.textContent).toBe("没有打开的 vault");
    expect(els.save.disabled).toBe(false);
  });
});

describe("vendor switch", () => {
  it("no-ops when the vendor did not actually change", async () => {
    const { session, deps } = makeSession();
    session.open({ kind: "add" });
    await session.setVendor("OpenAI");
    expect(deps.confirmVendorSwitch).not.toHaveBeenCalled();
    await session.setVendor("OpenAI");
    expect(deps.confirmVendorSwitch).not.toHaveBeenCalled();
  });

  it("commits preset values without confirm when nothing would be lost", async () => {
    const { session, els, deps } = makeSession();
    session.open({ kind: "add" });
    await session.setVendor("Anthropic");
    expect(deps.confirmVendorSwitch).not.toHaveBeenCalled();
    expect(els.website.value).toBe("https://console.anthropic.com");
    expect(urlRowValues(els)).toEqual(["https://api.anthropic.com/v1/messages"]);
  });

  it("rolls the input back to the applied vendor when declined", async () => {
    const { session, els, deps } = makeSession();
    session.open({ kind: "add" });
    session.toggleStd("anthropic");
    // Simulate typing: the value lands in the row's DOM input, then syncs.
    const rowInput = els.urlRows.querySelector(".url-row-input");
    rowInput.value = "https://custom";
    session.setUrl("anthropic", "https://custom");
    els.vendor.value = "Anthropic";
    deps.confirmVendorSwitch.mockResolvedValueOnce(false);
    await session.setVendor("Anthropic");
    expect(els.vendor.value).toBe("");
    expect(urlRowValues(els)).toEqual(["https://custom"]);
  });

  it("replaces endpoints with the preset when accepted", async () => {
    const { session, els, deps } = makeSession();
    session.open({ kind: "add" });
    session.toggleStd("anthropic");
    session.setUrl("anthropic", "https://custom");
    els.vendor.value = "Anthropic";
    deps.confirmVendorSwitch.mockResolvedValueOnce(true);
    await session.setVendor("Anthropic");
    expect(els.vendor.value).toBe("Anthropic");
    expect(urlRowValues(els)).toEqual(["https://api.anthropic.com/v1/messages"]);
  });

  it("force re-apply of the applied vendor still resets to preset values", async () => {
    const { session, els, deps } = makeSession();
    session.open({ kind: "quick-add", vendor: "OpenAI" });
    session.setUrl("openai-chat", "https://custom");
    els.vendor.value = "OpenAI";
    deps.confirmVendorSwitch.mockResolvedValueOnce(true);
    await session.setVendor("OpenAI", { force: true });
    expect(deps.confirmVendorSwitch).toHaveBeenCalledTimes(1);
    expect(urlRowValues(els)).toEqual([
      "https://api.openai.com/v1/chat/completions",
      "https://api.openai.com/v1/responses",
    ]);
  });
});

describe("standards + urls", () => {
  it("toggleStd adds then removes a standard (custom vendor → empty URL)", () => {
    const { session, els } = makeSession();
    session.open({ kind: "add" });
    session.toggleStd("gemini");
    expect(els.urlSection.hidden).toBe(false);
    expect(urlRowValues(els)).toEqual([""]);
    expect(lamp(els, "gemini")).toEqual({ active: "false", gray: "true" });
    session.toggleStd("gemini");
    expect(els.urlSection.hidden).toBe(true);
    expect(urlRowValues(els)).toEqual([]);
  });

  it("setUrl updates the standard live and repaints the lamps", () => {
    const { session, els } = makeSession();
    session.open({ kind: "add" });
    session.toggleStd("anthropic");
    session.setUrl("anthropic", "https://y");
    expect(lamp(els, "anthropic")).toEqual({ active: "true", gray: "false" });
  });

  it("setUrl ignores a standard that is not active", () => {
    const { session, els } = makeSession();
    session.open({ kind: "add" });
    session.setUrl("gemini", "https://nope");
    expect(lamp(els, "gemini")).toEqual({ active: "false", gray: "false" });
    expect(session.isDirty()).toBe(false);
  });
});
