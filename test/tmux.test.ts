import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isSafeSessionName, attachCommand, listSessions } from "../src/core/tmux";

describe("isSafeSessionName", () => {
  it("accepts simple names", () => {
    for (const n of ["beta", "alpha", "vp_web", "a.b", "A1"]) expect(isSafeSessionName(n)).toBe(true);
  });
  it("rejects unsafe names", () => {
    for (const n of ["", "a b", "a;rm", "../x", "a/b", "a'b", "a$b", "a`b"]) expect(isSafeSessionName(n)).toBe(false);
  });
});

describe("attachCommand", () => {
  it("builds an attach-or-create command", () => {
    expect(attachCommand("alpha")).toBe("tmux new-session -A -s 'alpha'");
  });
});

describe("attachCommand with cwd", () => {
  it("no cwd → unchanged", () => {
    expect(attachCommand("web")).toBe("tmux new-session -A -s 'web'");
  });
  it("with cwd appends -c quoted", () => {
    expect(attachCommand("web", "/home/u/web"))
      .toBe("tmux new-session -A -s 'web' -c '/home/u/web'");
  });
  it("quotes spaces and unicode paths", () => {
    expect(attachCommand("web", "/home/u/내 프로젝트"))
      .toBe("tmux new-session -A -s 'web' -c '/home/u/내 프로젝트'");
  });
  it("escapes embedded single quote in path", () => {
    expect(attachCommand("web", "/home/u/a'b"))
      .toBe("tmux new-session -A -s 'web' -c '/home/u/a'\\''b'");
  });
});

describe("listSessions (fake tmux)", () => {
  function withFakeTmux(script: string): string[] {
    const bin = mkdtempSync(join(tmpdir(), "tbin-"));
    writeFileSync(join(bin, "tmux"), `#!/bin/bash\n${script}\n`, { mode: 0o755 });
    const old = process.env.PATH;
    process.env.PATH = `${bin}:${old}`;
    try { return listSessions(0); } finally { process.env.PATH = old; } // ttl=0 bypasses cache
  }
  it("parses session names, ignores blanks", () => {
    expect(withFakeTmux('printf "beta\\n\\ngamma\\n"')).toEqual(["beta", "gamma"]);
  });
  it("returns [] when tmux errors (no server)", () => {
    expect(withFakeTmux("exit 1")).toEqual([]);
  });
});
