import { SessionState, StatusEntry } from "./types";

// ---- Telling "main is answering" apart from "only subagents are running" ----
//
// The tmux pane title is not enough. Claude paints the braille spinner into the title
// whenever *anything* is running — including a subagent it dispatched — so a session
// whose main conversation is idle and ready for input still reads as "working".
// That is the false "busy" this module fixes.
//
// The pane screen does carry the difference. Two markers, both near the bottom:
//
//  1) the thinking line, shown just above the input box only while MAIN is generating
//     or running a tool. It is one animated glyph, a made-up gerund ending in "…",
//     then an elapsed time in parentheses:
//         ✻ Combobulating… (4m 2s · ↓ 14.2k tokens)
//         · Flambéing… (1m 48s · ↓ 5.6k tokens · still thinking with xhigh effort)
//     The gerund is random and not always ASCII ("Flambéing"), and the glyph cycles
//     (· ✻ ✶ ✽ * …), so neither can be matched literally. The shape can.
//
//  2) the agent tray, near the last lines of the screen while subagents run:
//         ● main
//         ◯ general-purpose         Reading foo.ts
//         ◯ chageun:plan-validator  Checking the plan
//     "● main" never carries the main conversation's own activity — it stays bare even
//     while main is thinking — so the tray answers "which agents", never "is main busy".
//     Marker 1 is the only thing that answers that.
//     The tray is NOT always the last thing on screen. Recorded live (95 captures,
//     2026-08-10) the bottom was:
//         ⏵⏵ bypass permissions on · 1 shell · ← 3 agents
//
//         ● main
//         ◯ general-purpose  Grepping transcripts…   4m 41s · ↓ 115.1k tokens
//         ⧉  branch-explainer
//     — an open-artifact row sits BELOW the tray. Walking up from the very last line and
//     stopping at the first non-tray row therefore found nothing and left every session
//     on "working", which is the bug this comment exists to prevent a second time.
//     Note also "← 3 agents" in the footer is a static hint, not a live count: an idle
//     session waiting on user input shows the same number. It must not be used.
//
// Both were read off live panes rather than guessed; an earlier attempt matched
// "esc to interrupt", which this Claude build does not print at all.

// Only the bottom of the screen is inspected. Everything above is transcript, where a
// finished tool call can leave text that looks like a live status line forever.
export const TAIL_LINES = 30;

// <glyph> <word ending in …> (<elapsed>…   — anchored, so transcript lines such as
// "● Running 1 shell command · 1m 18s…" or "⎿  $ npm run build … (6s)" do not match.
const MAIN_BUSY = /^\s*\S{1,2} \S*…\s*\((?:\d+h\s)?(?:\d+m\s)?\d+s\b/u;

// A tray row: ● (U+25CF) or ◯ (U+25EF), then the agent name.
const TRAY_ROW = /^[●◯]\s+(\S+)/u;

// How many rows may sit below the tray before we give up looking for it. Live captures
// showed one (an open-artifact row); a few more are allowed in case the footer grows.
// It stays small on purpose: the further up we are willing to look, the more likely we
// land on transcript text, which Claude also prints as "● …".
const MAX_ROWS_BELOW_TRAY = 6;

export interface ScreenRead {
  /** main is generating or running a tool right now — do not interrupt */
  mainBusy: boolean;
  /** names of subagents in the tray (main excluded) */
  agents: string[];
}

/** Read the two markers off a captured pane screen (`tmux capture-pane -p`). */
export function readScreen(lines: string[]): ScreenRead {
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === "") end--;

  const mainBusy = lines.slice(Math.max(0, end - TAIL_LINES), end).some((l) => MAIN_BUSY.test(l));

  // Find the tray's bottom row first, skipping the few rows that can sit below it, then
  // read the unbroken block upward from there.
  let bottom = -1;
  for (let i = end - 1; i >= 0 && end - 1 - i < MAX_ROWS_BELOW_TRAY; i--) {
    if (TRAY_ROW.test(lines[i].trim())) { bottom = i; break; }
  }
  const names: string[] = [];
  for (let i = bottom; i >= 0; i--) {
    const m = TRAY_ROW.exec(lines[i].trim());
    if (!m) break;
    names.unshift(m[1]);
  }
  // A real tray always leads with "● main". Requiring it keeps a stray transcript line
  // that happens to start with ● from being read as an agent; if a future Claude build
  // drops that row we simply stop reporting "agents" and fall back to today's "working",
  // which is wrong in the harmless direction.
  if (!names.includes("main")) return { mainBusy, agents: [] };
  return { mainBusy, agents: names.filter((n) => n !== "main") };
}

/**
 * Split the title-derived "working" into "working" (main is answering) and "agents"
 * (main is free, subagents are still running).
 *
 * `capture` is injected so the decision can be tested against recorded screens, and so
 * the caller can stop capturing once it has spent its time budget — an empty result
 * leaves the session on "working", i.e. exactly what it reported before this existed.
 * Only "working" sessions are captured: everything else already knows its answer, and
 * every capture costs one tmux process.
 */
export function refineWithScreen(
  base: Map<string, StatusEntry>,
  capture: (session: string) => string[],
): Map<string, StatusEntry> {
  const out = new Map<string, StatusEntry>();
  for (const [name, entry] of base) {
    if (entry.state !== "working") { out.set(name, entry); continue; }
    const read = readScreen(capture(name));
    if (read.mainBusy || read.agents.length === 0) { out.set(name, entry); continue; }
    const state: SessionState = "agents";
    out.set(name, { ...entry, state, agents: read.agents });
  }
  return out;
}
