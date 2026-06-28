import { describe, it, expect } from "vitest";
import { computeContainerOrder } from "../src/core/order";

describe("computeContainerOrder", () => {
  it("inserts before the target name", () => {
    expect(computeContainerOrder(["a", "b", "c"], ["c"], "b")).toEqual(["a", "c", "b"]);
  });
  it("appends when beforeName is null (group-header drop = end)", () => {
    expect(computeContainerOrder(["a", "b"], ["x"], null)).toEqual(["a", "b", "x"]);
  });
  it("moving multiple keeps their order, removes from base", () => {
    expect(computeContainerOrder(["a", "b", "c", "d"], ["a", "c"], "d")).toEqual(["b", "a", "c", "d"]);
  });
  it("beforeName not found → append", () => {
    expect(computeContainerOrder(["a", "b"], ["a"], "zzz")).toEqual(["b", "a"]);
  });
});
