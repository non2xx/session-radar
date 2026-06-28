import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readStatuses } from "../src/core/statusReader";

describe("readStatuses", () => {
  it("reads valid status files and ignores junk", () => {
    const dir = mkdtempSync(join(tmpdir(), "st-"));
    writeFileSync(join(dir, "a.json"), JSON.stringify({ state: "working", ts: 5 }));
    writeFileSync(join(dir, "b.json"), JSON.stringify({ state: "idle", ts: 9 }));
    writeFileSync(join(dir, "c.json"), "not json");
    writeFileSync(join(dir, "d.json"), JSON.stringify({ state: "bogus", ts: 1 }));
    const m = readStatuses(dir);
    expect(m.get("a")).toEqual({ state: "working", ts: 5 });
    expect(m.get("b")).toEqual({ state: "idle", ts: 9 });
    expect(m.has("c")).toBe(false);
    expect(m.get("d")?.state).toBe("unknown");
  });
  it("returns empty map when dir missing", () => {
    expect(readStatuses(join(tmpdir(), "nope-zzz-xyz")).size).toBe(0);
  });
});
