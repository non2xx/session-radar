import { describe, it, expect } from "vitest";
import { buildTree } from "../src/core/treeModel";
import { emptyLayout } from "../src/core/layoutStore";

describe("buildTree", () => {
  it("places grouped, ungrouped, applies alias/state, excludes hidden", () => {
    const layout = emptyLayout();
    layout.groups.push({ id: "g1", name: "GroupX", sessions: ["alpha"] });
    layout.aliases["alpha"] = "Alpha ERP";
    layout.hidden.push("secret");
    const statuses = new Map([
      ["alpha", { state: "working" as const, ts: 5 }],
      ["beta", { state: "idle" as const, ts: 9 }],
    ]);
    const discovered = ["alpha", "beta", "secret"];
    const t = buildTree(layout, statuses, discovered);
    expect(t.groups[0].name).toBe("GroupX");
    expect(t.groups[0].sessions[0]).toEqual({ name: "alpha", label: "Alpha ERP", state: "working", ts: 5 });
    expect(t.ungrouped.map((s) => s.name)).toEqual(["beta"]);
    expect(t.ungrouped[0].state).toBe("idle");
  });
  it("unknown state when no status file", () => {
    const t = buildTree(emptyLayout(), new Map(), ["x"]);
    expect(t.ungrouped[0]).toEqual({ name: "x", label: "x", state: "unknown", ts: null });
  });
});
