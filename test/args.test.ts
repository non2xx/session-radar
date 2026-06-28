import { describe, it, expect } from "vitest";
import { sessionArg, groupArg } from "../src/core/args";

describe("sessionArg / groupArg", () => {
  it("reads a tree session Item", () => {
    expect(sessionArg({ kind: "session", node: { name: "x", label: "X" } })).toEqual({ name: "x", label: "X" });
  });
  it("reads a webview session payload", () => {
    expect(sessionArg({ name: "y", label: "Y" })).toEqual({ name: "y", label: "Y" });
  });
  it("reads a tree group Item", () => {
    expect(groupArg({ kind: "group", id: "g1", name: "G" })).toEqual({ id: "g1", name: "G" });
  });
  it("reads a webview group payload", () => {
    expect(groupArg({ id: "g2", name: "H" })).toEqual({ id: "g2", name: "H" });
  });
  it("returns undefined for junk", () => {
    expect(sessionArg(undefined)).toBeUndefined();
    expect(groupArg({})).toBeUndefined();
  });
});
