import { describe, expect, it, vi } from "vitest";
import { createListModel } from "./listModel.js";
import { UNGROUPED } from "./filter.js";

const rec = (id, vendor = "DeepSeek", tags = []) => ({
  id,
  name: `n${id}`,
  api_key: "k",
  vendor,
  tags,
});

const VIEW = {
  records: [rec("1"), rec("2", "OpenAI"), rec("3", "")],
  vendors: ["DeepSeek", "OpenAI"],
  tags: ["翻译"],
};

function modelWith(view = VIEW) {
  const model = createListModel();
  const aspects = [];
  model.subscribe((a) => aspects.push(a));
  model.setRecords(view);
  return { model, aspects };
}

describe("setRecords", () => {
  it("replaces records/vendors/tags and reports the records aspect", () => {
    const { model, aspects } = modelWith();
    expect(model.state.records).toHaveLength(3);
    expect(aspects.at(-1)).toEqual({ records: true, filter: false, selection: false });
  });

  it("resets a filter whose target vanished and reports the filter reset", () => {
    const { model, aspects } = modelWith();
    model.toggleVendor("OpenAI");
    model.setRecords({ records: [rec("1")], vendors: ["DeepSeek"], tags: [] });
    expect(model.state.vendor).toBeNull();
    expect(aspects.at(-1)).toEqual({ records: true, filter: true, selection: false });
  });

  it("keeps a filter whose target still exists", () => {
    const { model } = modelWith();
    model.toggleVendor("DeepSeek");
    model.setRecords(VIEW);
    expect(model.state.vendor).toBe("DeepSeek");
  });

  it("未分组 filter survives only while ungrouped records remain", () => {
    const { model } = modelWith();
    model.toggleVendor(UNGROUPED);
    expect(model.state.vendor).toBe(UNGROUPED);
    model.setRecords({ records: [rec("1")], vendors: ["DeepSeek"], tags: [] });
    expect(model.state.vendor).toBeNull();
  });

  it("resets the selection when the selected record is gone", () => {
    const { model, aspects } = modelWith();
    model.select("2");
    model.setRecords({ records: [rec("1")], vendors: ["DeepSeek"], tags: [] });
    expect(model.state.selectedId).toBeNull();
    expect(aspects.at(-1)).toEqual({ records: true, filter: false, selection: true });
  });

  it("keeps the selection when the record survives", () => {
    const { model } = modelWith();
    model.select("1");
    model.setRecords(VIEW);
    expect(model.state.selectedId).toBe("1");
  });
});

describe("filters + query", () => {
  it("setQuery narrows the list and reports query", () => {
    const { model, aspects } = modelWith();
    model.setQuery("n1");
    expect(model.visibleRecords().map((r) => r.id)).toEqual(["1"]);
    expect(aspects.at(-1)).toEqual({ query: true });
  });

  it("toggleVendor selects then deselects on re-click", () => {
    const { model } = modelWith();
    model.toggleVendor("OpenAI");
    expect(model.state.vendor).toBe("OpenAI");
    expect(model.visibleRecords().map((r) => r.id)).toEqual(["2"]);
    model.toggleVendor("OpenAI");
    expect(model.state.vendor).toBeNull();
  });

  it("toggleTag selects then deselects", () => {
    const { model } = modelWith();
    model.toggleTag("翻译");
    expect(model.state.tag).toBe("翻译");
    model.toggleTag("翻译");
    expect(model.state.tag).toBeNull();
  });

  it("clearFilters drops vendor + tag but keeps the query", () => {
    const { model } = modelWith();
    model.setQuery("x");
    model.toggleVendor("OpenAI");
    model.toggleTag("翻译");
    model.clearFilters();
    expect(model.state.vendor).toBeNull();
    expect(model.state.tag).toBeNull();
    expect(model.state.query).toBe("x");
    expect(model.hasActiveFilter()).toBe(true);
  });

  it("hasActiveFilter reflects any of query/vendor/tag", () => {
    const { model } = modelWith();
    expect(model.hasActiveFilter()).toBe(false);
    model.setQuery("x");
    expect(model.hasActiveFilter()).toBe(true);
    model.setQuery("");
    model.toggleTag("翻译");
    expect(model.hasActiveFilter()).toBe(true);
  });
});

describe("selection + reset + subscribe", () => {
  it("select sets the selection and reports it", () => {
    const { model, aspects } = modelWith();
    model.select("2");
    expect(model.state.selectedId).toBe("2");
    expect(aspects.at(-1)).toEqual({ selection: true });
  });

  it("reset returns every field to its initial value without emitting", () => {
    const { model, aspects } = modelWith();
    model.setQuery("x");
    model.toggleVendor("OpenAI");
    model.select("2");
    const before = aspects.length;
    model.reset();
    expect(model.state).toEqual({
      records: [],
      vendors: [],
      tags: [],
      query: "",
      vendor: null,
      tag: null,
      selectedId: null,
    });
    expect(aspects).toHaveLength(before);
  });

  it("notifies every subscriber and stops after unsubscribe", () => {
    const model = createListModel();
    const a = vi.fn();
    const b = vi.fn();
    const off = model.subscribe(a);
    model.subscribe(b);
    model.setRecords(VIEW);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    off();
    model.select("1");
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });
});
