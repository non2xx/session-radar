import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadLayout, saveLayout, emptyLayout } from "../src/core/layoutStore";

describe("layoutStore", () => {
  it("round-trips a layout", () => {
    const file = join(mkdtempSync(join(tmpdir(), "ly-")), "layout.json");
    const l = emptyLayout();
    l.groups.push({ id: "g1", name: "GroupX", sessions: ["alpha"] });
    l.aliases["alpha"] = "Alpha ERP";
    saveLayout(file, l);
    expect(loadLayout(file)).toEqual(l);
  });
  it("returns empty layout when file missing", () => {
    expect(loadLayout(join(tmpdir(), "missing-zzz.json"))).toEqual(emptyLayout());
  });
  it("normalizes a corrupt/partial file", () => {
    const file = join(mkdtempSync(join(tmpdir(), "ly2-")), "layout.json");
    writeFileSync(file, '{"groups":"oops"}');
    expect(loadLayout(file)).toEqual(emptyLayout());
  });
  it("recovers from .bak when the main file is corrupt (H3)", () => {
    const file = join(mkdtempSync(join(tmpdir(), "ly3-")), "layout.json");
    const good = emptyLayout(); good.groups.push({ id: "g1", name: "G", sessions: ["s1"] });
    saveLayout(file, good);
    saveLayout(file, good); // second save creates file.bak == good
    writeFileSync(file, "CORRUPT");
    expect(loadLayout(file)).toEqual(good);
  });
  it("does not leave a .tmp behind (atomic)", () => {
    const file = join(mkdtempSync(join(tmpdir(), "ly4-")), "layout.json");
    saveLayout(file, emptyLayout());
    expect(existsSync(file + ".tmp")).toBe(false);
  });
});
