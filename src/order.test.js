import { describe, it, expect } from "vitest";
import { moveBefore } from "./order.js";

describe("moveBefore", () => {
  it("moves an earlier element to just before a later one", () => {
    expect(moveBefore(["a", "b", "c"], "a", "c")).toEqual(["b", "a", "c"]);
  });

  it("moves a later element to just before an earlier one", () => {
    expect(moveBefore(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
  });

  it("moves to the end when beforeId is null", () => {
    expect(moveBefore(["a", "b", "c"], "a", null)).toEqual(["b", "c", "a"]);
  });

  it("is a no-op when the element is already in place", () => {
    expect(moveBefore(["a", "b", "c"], "a", "b")).toEqual(["a", "b", "c"]);
    expect(moveBefore(["a", "b", "c"], "c", null)).toEqual(["a", "b", "c"]);
  });

  it("is a no-op when fromId equals beforeId", () => {
    expect(moveBefore(["a", "b", "c"], "b", "b")).toEqual(["a", "b", "c"]);
  });

  it("leaves the list unchanged for an unknown fromId", () => {
    expect(moveBefore(["a", "b"], "nope", "b")).toEqual(["a", "b"]);
  });

  it("leaves the list unchanged for an unknown beforeId", () => {
    expect(moveBefore(["a", "b"], "a", "nope")).toEqual(["a", "b"]);
  });

  it("handles a single-element list", () => {
    expect(moveBefore(["a"], "a", null)).toEqual(["a"]);
    expect(moveBefore(["a"], "a", "a")).toEqual(["a"]);
  });

  it("never mutates the input list", () => {
    const ids = ["a", "b", "c"];
    moveBefore(ids, "a", null);
    expect(ids).toEqual(["a", "b", "c"]);
  });
});
