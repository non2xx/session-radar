import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadOpen, saveOpen } from "../src/core/openStore";

function tmp() { return join(mkdtempSync(join(tmpdir(), "sr-open-")), "open.json"); }

describe("openStore", () => {
  it("save then load round-trips and dedupes", () => {
    const f = tmp();
    saveOpen(f, ["a", "b", "a"]);
    expect(loadOpen(f).sort()).toEqual(["a", "b"]);
  });
  it("missing file → empty", () => {
    expect(loadOpen(join(tmpdir(), "nope-sr", "open.json"))).toEqual([]);
  });
  it("corrupt file → recover from .bak", () => {
    const f = tmp();
    saveOpen(f, ["x"]);          // creates f (no .bak yet)
    saveOpen(f, ["x", "y"]);     // now f.bak = ["x"]
    writeFileSync(f, "{ broken");
    expect(loadOpen(f).sort()).toEqual(["x"]); // from .bak
  });
  it("corrupt file and no bak → empty", () => {
    const f = tmp();
    writeFileSync(f, "not json");
    expect(loadOpen(f)).toEqual([]);
  });
  it("ignores non-string entries", () => {
    const f = tmp();
    writeFileSync(f, JSON.stringify(["a", 1, null, "b"]));
    expect(loadOpen(f).sort()).toEqual(["a", "b"]);
  });
});
