import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("session-status.sh", () => {
  it("writes a status file keyed by tmux session name", () => {
    const home = mkdtempSync(join(tmpdir(), "sr-"));
    const binDir = mkdtempSync(join(tmpdir(), "bin-"));
    writeFileSync(join(binDir, "tmux"), '#!/bin/bash\necho "myproj"\n', { mode: 0o755 });
    execFileSync("bash", ["scripts/session-status.sh", "working"], {
      env: { ...process.env, HOME: home, PATH: `${binDir}:${process.env.PATH}` },
    });
    const f = join(home, ".claude", "session-status", "myproj.json");
    expect(existsSync(f)).toBe(true);
    const data = JSON.parse(readFileSync(f, "utf8"));
    expect(data.state).toBe("working");
    expect(typeof data.ts).toBe("number");
  });

  it("rejects names with path separators (M4)", () => {
    const home = mkdtempSync(join(tmpdir(), "sr2-"));
    const binDir = mkdtempSync(join(tmpdir(), "bin2-"));
    writeFileSync(join(binDir, "tmux"), '#!/bin/bash\necho "../evil"\n', { mode: 0o755 });
    execFileSync("bash", ["scripts/session-status.sh", "working"], {
      env: { ...process.env, HOME: home, PATH: `${binDir}:${process.env.PATH}` },
    });
    expect(existsSync(join(home, ".claude", "session-status"))).toBe(false);
  });

  it("end mode removes the status file (no ghosts)", () => {
    const home = mkdtempSync(join(tmpdir(), "sr4-"));
    const binDir = mkdtempSync(join(tmpdir(), "bin4-"));
    writeFileSync(join(binDir, "tmux"), '#!/bin/bash\necho "ending"\n', { mode: 0o755 });
    const env = { ...process.env, HOME: home, PATH: `${binDir}:${process.env.PATH}` };
    execFileSync("bash", ["scripts/session-status.sh", "working"], { env });
    const f = join(home, ".claude", "session-status", "ending.json");
    expect(existsSync(f)).toBe(true);
    execFileSync("bash", ["scripts/session-status.sh", "end"], { env });
    expect(existsSync(f)).toBe(false);
  });

  it("ignores invalid state", () => {
    const home = mkdtempSync(join(tmpdir(), "sr3-"));
    const binDir = mkdtempSync(join(tmpdir(), "bin3-"));
    writeFileSync(join(binDir, "tmux"), '#!/bin/bash\necho "x"\n', { mode: 0o755 });
    execFileSync("bash", ["scripts/session-status.sh", "bogus"], {
      env: { ...process.env, HOME: home, PATH: `${binDir}:${process.env.PATH}` },
    });
    expect(existsSync(join(home, ".claude", "session-status", "x.json"))).toBe(false);
  });
});
