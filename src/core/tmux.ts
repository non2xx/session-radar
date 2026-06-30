import { execFileSync } from "node:child_process";

const SAFE = /^[A-Za-z0-9._-]+$/;

export function isSafeSessionName(name: string): boolean {
  return SAFE.test(name);
}

// POSIX single-quote a string; escape any embedded single quote as '\''.
function shQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

// Attach if the session exists, otherwise create it with that name (in cwd if given).
// Name is expected to be validated by isSafeSessionName first; we single-quote defensively.
// `-c cwd` is honored by tmux only on creation; when -A attaches an existing session it is ignored.
export function attachCommand(name: string, cwd?: string): string {
  const base = `tmux new-session -A -s ${shQuote(name)}`;
  return cwd ? `${base} -c ${shQuote(cwd)}` : base;
}

// Cached + timeout-guarded: the refresh hot-path calls this many times per cycle, so a
// short TTL avoids spawning tmux repeatedly, and the timeout stops a stalled tmux server
// from blocking the (single-threaded) extension host. Pass ttlMs=0 in tests to bypass.
let _cache: { ts: number; names: string[] } | null = null;
export function listSessions(ttlMs = 3000): string[] {
  const now = Date.now();
  if (_cache && now - _cache.ts < ttlMs) return _cache.names;
  let names: string[] = [];
  try {
    const out = execFileSync("tmux", ["list-sessions", "-F", "#{session_name}"], {
      encoding: "utf8",
      timeout: 1000, // ms — never hang the extension host on a stuck tmux
    });
    names = out.split("\n").map((s) => s.trim()).filter((s) => s.length > 0);
  } catch {
    names = []; // no tmux server / tmux not installed / timed out
  }
  _cache = { ts: now, names };
  return names;
}

// Drop the cache so the next listSessions() re-queries tmux immediately
// (used right after creating a session so the panel shows it without waiting for TTL).
export function invalidateSessionCache(): void {
  _cache = null;
}
