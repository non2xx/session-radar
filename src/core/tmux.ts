import { execFileSync } from "node:child_process";
import { SessionState, StatusEntry } from "./types";
import { refineWithScreen } from "./paneScreen";

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
  _states = null;
}

// ---- Live pane state, read straight from tmux (ground truth) ----
// The hook-written status files go stale between events (a long tool run fires no
// hook, so the file freezes). tmux always knows the truth: whether `claude` is the
// foreground process, and Claude's own title glyph (braille spinner = working, ✳ = turn).

// tmux keeps the last pane title after the program that set it exits, and inside tmux the
// distro .bashrc does not repaint it (its title code only runs for TERM=xterm*). So a pane
// where Claude has quit can sit there wearing "✳ name" forever and read as "your turn".
// The foreground command is the reliable tie-breaker: a bare shell is never Claude.
const SHELLS = new Set(["bash", "zsh", "sh", "fish", "dash", "ksh", "tmux"]);

function firstGlyph(title: string): string {
  const t = title.replace(/^\s+/, "");
  return t ? [...t][0] : "";
}
// Claude's working spinner: any frame of it in the title means "working".
// Two alphabets, because the glyph set is a Claude Code build detail that has already
// changed once under us:
//   1) braille (U+2800–U+28FF) — ⠋⠙⠹…, what older builds painted.
//   2) half-circles (U+25D0–U+25D3) — ◐◓◑◒, what 2.1.231 paints. Measured live
//      2026-08-13: sessions that were mid-answer wore titles like "◐ alpha", which
//      matched neither range and fell through to "turn". Every busy session read as
//      "your turn", and because refineWithScreen only inspects sessions that are
//      already "working", the whole agents/working split went dark with it.
// Keep both: a title glyph is cheap to accept and the cost of missing one is the
// silent failure above. ✳ (turn) is checked separately by the caller.
function isSpinnerGlyph(ch: string): boolean {
  const c = ch.codePointAt(0);
  if (c === undefined) return false;
  return (c >= 0x2800 && c <= 0x28ff) || (c >= 0x25d0 && c <= 0x25d3);
}
const rank = (s: SessionState): number =>
  s === "working" ? 4 : s === "agents" ? 3 : s === "turn" ? 2 : 1;

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
    const claudeRunning = cmd === "claude" || (!SHELLS.has(cmd) && (spinner || g === "✳"));
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

// Reading the screen costs one tmux process per candidate session, and the extension host
// is single-threaded, so two limits keep the panel cheap:
//  - CAPTURE_BUDGET_MS: stop capturing once this much wall time is gone this round.
//    Sessions past the budget keep their title-only "working" (measured: ~12ms per pane,
//    ~195ms for all 16 sessions here, so the budget is normally never reached).
//  - STATE_TTL_MS: getTreeData() runs several times per refresh — once for the tree root,
//    once per group, once for the card view — and the poll fires every 3s. Without this
//    each refresh would re-shell every session. One read per second is plenty.
const CAPTURE_BUDGET_MS = 250;
const CAPTURE_TIMEOUT_MS = 300;
const STATE_TTL_MS = 1000;
let _states: { ts: number; map: Map<string, StatusEntry> } | null = null;

export function readPaneStates(): Map<string, StatusEntry> {
  const now = Date.now();
  if (_states && now - _states.ts < STATE_TTL_MS) return _states.map;
  let map: Map<string, StatusEntry>;
  try {
    const out = execFileSync(
      "tmux",
      ["list-panes", "-a", "-F", "#{session_name}\t#{pane_current_command}\t#{pane_title}\t#{window_activity}"],
      { encoding: "utf8", timeout: 1000 },
    );
    const started = Date.now();
    map = refineWithScreen(parsePaneStates(out), (s) =>
      Date.now() - started > CAPTURE_BUDGET_MS ? [] : capturePane(s, 0, CAPTURE_TIMEOUT_MS),
    );
  } catch {
    map = new Map(); // no tmux server / tmux not installed / timed out
  }
  _states = { ts: now, map };
  return map;
}

/**
 * tmux 가 들고 있는 화면 글자를 그대로 가져온다.
 *
 * 확장은 VS Code 에서 터미널을 **한 줄씩만** 받는다. 창이 좁아 경로가 두 줄로 접히면
 * 어느 쪽도 완전한 경로가 아니라 링크가 죽는다. 원본은 tmux 가 갖고 있으니, 추측해서
 * 되살리는 대신 직접 읽어서 두 줄을 붙인다.
 *
 * back=0 이면 지금 보이는 화면만 가져온다(스크롤백 없음) — 상태 판정이 쓰는 방식.
 */
export function capturePane(session: string, back = 200, timeoutMs = 800): string[] {
  if (!isSafeSessionName(session)) return [];
  try {
    const out = execFileSync(
      "tmux",
      ["capture-pane", "-p", "-t", session, "-S", `-${Math.max(0, Math.floor(back))}`],
      { encoding: "utf8", timeout: timeoutMs, maxBuffer: 2 << 20 },
    );
    return out.split("\n");
  } catch {
    return []; // tmux 없음 / 그런 세션 없음 / 시간초과
  }
}
