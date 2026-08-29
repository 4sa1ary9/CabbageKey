import { describe, it, expect } from "vitest";
import { moveBefore, insertionSlot, nextAfterId, dropTarget } from "./order.js";

describe("moveBefore", () => {
  it("moves an earlier element to just before a later one", () => {
    expect(moveBefore(["a", "b", "c"], "a", "c")).toEqual({
      order: ["b", "a", "c"],
      changed: true,
    });
  });

  it("moves a later element to just before an earlier one", () => {
    expect(moveBefore(["a", "b", "c"], "c", "a")).toEqual({
      order: ["c", "a", "b"],
      changed: true,
    });
  });

  it("moves to the end when beforeId is null", () => {
    expect(moveBefore(["a", "b", "c"], "a", null)).toEqual({
      order: ["b", "c", "a"],
      changed: true,
    });
  });

  it("is a no-op when the element is already in place", () => {
    expect(moveBefore(["a", "b", "c"], "a", "b")).toEqual({
      order: ["a", "b", "c"],
      changed: false,
    });
    expect(moveBefore(["a", "b", "c"], "c", null)).toEqual({
      order: ["a", "b", "c"],
      changed: false,
    });
  });

  it("is a no-op when fromId equals beforeId", () => {
    expect(moveBefore(["a", "b", "c"], "b", "b")).toEqual({
      order: ["a", "b", "c"],
      changed: false,
    });
  });

  it("leaves the list unchanged for an unknown fromId", () => {
    expect(moveBefore(["a", "b"], "nope", "b")).toEqual({
      order: ["a", "b"],
      changed: false,
    });
  });

  it("leaves the list unchanged for an unknown beforeId", () => {
    expect(moveBefore(["a", "b"], "a", "nope")).toEqual({
      order: ["a", "b"],
      changed: false,
    });
  });

  it("handles a single-element list", () => {
    expect(moveBefore(["a"], "a", null)).toEqual({ order: ["a"], changed: false });
    expect(moveBefore(["a"], "a", "a")).toEqual({ order: ["a"], changed: false });
  });

  it("never mutates the input list", () => {
    const ids = ["a", "b", "c"];
    moveBefore(ids, "a", null);
    expect(ids).toEqual(["a", "b", "c"]);
  });
});

describe("insertionSlot", () => {
  const rows = [
    { id: "a", top: 0, bottom: 40 },
    { id: "b", top: 40, bottom: 80 },
    { id: "c", top: 80, bottom: 120 },
  ];

  it("cursor above the first midpoint inserts before the first row", () => {
    expect(insertionSlot(rows, 5)).toBe("a");
    expect(insertionSlot(rows, 19)).toBe("a");
  });

  it("cursor past a midpoint inserts before the next row", () => {
    expect(insertionSlot(rows, 20)).toBe("b");
    expect(insertionSlot(rows, 59)).toBe("b");
    expect(insertionSlot(rows, 60)).toBe("c");
    expect(insertionSlot(rows, 99)).toBe("c");
  });

  it("cursor below the last midpoint appends at the end", () => {
    expect(insertionSlot(rows, 100)).toBeNull();
    expect(insertionSlot(rows, 121)).toBeNull();
  });

  it("empty geometry appends at the end", () => {
    expect(insertionSlot([], 50)).toBeNull();
  });
});

describe("nextAfterId", () => {
  it("returns the id right after the last visible one", () => {
    expect(nextAfterId(["a", "b", "c"], "b")).toBe("c");
  });

  it("null when the visible record is already last", () => {
    expect(nextAfterId(["a", "b", "c"], "c")).toBeNull();
  });

  it("null for an unknown id or missing argument", () => {
    expect(nextAfterId(["a", "b"], "nope")).toBeNull();
    expect(nextAfterId(["a", "b"], null)).toBeNull();
    expect(nextAfterId(["a", "b"], undefined)).toBeNull();
  });
});

describe("dropTarget", () => {
  const rows = [
    { id: "a", top: 0, bottom: 40 },
    { id: "b", top: 40, bottom: 80 },
  ];

  it("record list: below the last visible row lands after it in the global order", () => {
    expect(
      dropTarget({
        allIds: ["a", "b", "x"],
        geometry: rows,
        clientY: 100,
        listKind: "records",
        lastVisibleId: "b",
      })
    ).toBe("x");
  });

  it("record list: below the vault's last row stays null (append at end)", () => {
    expect(
      dropTarget({
        allIds: ["a", "b"],
        geometry: rows,
        clientY: 100,
        listKind: "records",
        lastVisibleId: "b",
      })
    ).toBeNull();
  });

  it("record list: a geometry hit passes through untouched", () => {
    expect(
      dropTarget({
        allIds: ["a", "b", "x"],
        geometry: rows,
        clientY: 10,
        listKind: "records",
        lastVisibleId: "b",
      })
    ).toBe("a");
  });

  it("vendor list: null stays null (no filtered-view correction)", () => {
    expect(
      dropTarget({
        allIds: ["a", "b", "x"],
        geometry: rows,
        clientY: 100,
        listKind: "vendors",
        lastVisibleId: "b",
      })
    ).toBeNull();
  });

  it("vendor list: a geometry hit passes through untouched", () => {
    expect(
      dropTarget({
        allIds: ["a", "b"],
        geometry: rows,
        clientY: 10,
        listKind: "vendors",
        lastVisibleId: null,
      })
    ).toBe("a");
  });
});
