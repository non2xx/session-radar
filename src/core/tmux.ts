import { execFileSync } from "node:child_process";
import { SessionState, StatusEntry } from "./types";

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

// ---- Live pane state, read straight from tmux (ground truth) ----
// The hook-written status files go stale between events (a long tool run fires no
// hook, so the file freezes). tmux always knows the truth: whether `claude` is the
// foreground process, and Claude's own title glyph (braille spinner = working, ✳ = idle).

function firstGlyph(title: string): string {
  const t = title.replace(/^\s+/, "");
  return t ? [...t][0] : "";
}
// Claude's working spinner is animated braille (U+2800–U+28FF); any frame means "working".
function isSpinnerGlyph(ch: string): boolean {
  const c = ch.codePointAt(0);
  return c !== undefined && c >= 0x2800 && c <= 0x28ff;
}
const rank = (s: SessionState): number => (s === "working" ? 3 : s === "turn" ? 2 : 1);

// Parse `#{session_name}\t#{pane_current_command}\t#{pane_title}\t#{window_activity}` lines.
// A session with multiple panes takes its strongest state (working > turn > inactive).
export function parsePaneStates(raw: string): Map<string, StatusEntry> {
  const out = new Map<string, StatusEntry>();
  for (const line of raw.split("\n")) {
    if (!line) continue;
    const parts = line.split("\t");
    if (parts.length < 4) continue;
    const name = parts[0];
    const cmd = parts[1];
    const activity = parseInt(parts[parts.length - 1], 10) || 0; // window_activity (unix secs)
    const title = parts.slice(2, -1).join("\t"); // title may itself contain tabs
    const g = firstGlyph(title);
    const spinner = isSpinnerGlyph(g);
    const claudeRunning = cmd === "claude" || spinner || g === "✳";
    const state: SessionState = claudeRunning ? (spinner ? "working" : "turn") : "inactive";
    const prev = out.get(name);
    if (!prev) out.set(name, { state, ts: activity });
    else out.set(name, {
      state: rank(state) > rank(prev.state) ? state : prev.state,
      ts: Math.max(prev.ts, activity),
    });
  }
  return out;
}

export function readPaneStates(): Map<string, StatusEntry> {
  try {
    const out = execFileSync(
      "tmux",
      ["list-panes", "-a", "-F", "#{session_name}\t#{pane_current_command}\t#{pane_title}\t#{window_activity}"],
      { encoding: "utf8", timeout: 1000 },
    );
    return parsePaneStates(out);
  } catch {
    return new Map(); // no tmux server / tmux not installed / timed out
  }
}
