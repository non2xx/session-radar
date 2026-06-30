import { describe, it, expect } from "vitest";
import { emptyLayout } from "../src/core/layoutStore";
import * as M from "../src/core/mutations";

describe("mutations", () => {
  it("addGroup / renameGroup / deleteGroup moves sessions to ungrouped", () => {
    let l = emptyLayout();
    l = M.addGroup(l, "GroupX", "g1");
    l = M.moveSession(l, "alpha", "g1", 0);
    expect(l.groups[0].sessions).toEqual(["alpha"]);
    l = M.renameGroup(l, "g1", "GroupX2");
    expect(l.groups[0].name).toBe("GroupX2");
    l = M.deleteGroup(l, "g1");
    expect(l.groups.length).toBe(0);
    expect(l.ungroupedOrder).toContain("alpha");
  });
  it("setAlias sets and clears", () => {
    let l = M.setAlias(emptyLayout(), "a", "Alias");
    expect(l.aliases.a).toBe("Alias");
    l = M.setAlias(l, "a", "");
    expect(l.aliases.a).toBeUndefined();
  });
  it("hide/unhide", () => {
    let l = M.addGroup(emptyLayout(), "G", "g1");
    l = M.moveSession(l, "x", "g1", 0);
    l = M.hideSession(l, "x");
    expect(l.hidden).toContain("x");
    expect(l.groups[0].sessions).not.toContain("x");
    l = M.unhideSession(l, "x");
    expect(l.hidden).not.toContain("x");
  });
  it("moveSession reorders within ungrouped", () => {
    let l = emptyLayout();
    l = M.moveSession(l, "a", null, 0);
    l = M.moveSession(l, "b", null, 1);
    l = M.moveSession(l, "a", null, 1);
    expect(l.ungroupedOrder).toEqual(["b", "a"]);
  });
  it("does not mutate input", () => {
    const l0 = emptyLayout();
    M.addGroup(l0, "G", "g1");
    expect(l0.groups.length).toBe(0);
  });
});

describe("setPath/clearPath", () => {
  it("setPath stores, clearPath removes", () => {
    let l = emptyLayout();
    l = M.setPath(l, "web", "/home/u/web");
    expect(l.paths.web).toBe("/home/u/web");
    l = M.clearPath(l, "web");
    expect(l.paths.web).toBeUndefined();
  });
  it("setPath with blank clears", () => {
    let l = M.setPath(emptyLayout(), "web", "/x");
    l = M.setPath(l, "web", "   ");
    expect(l.paths.web).toBeUndefined();
  });
  it("does not mutate input", () => {
    const l0 = emptyLayout();
    M.setPath(l0, "web", "/x");
    expect(l0.paths).toEqual({});
  });
});
