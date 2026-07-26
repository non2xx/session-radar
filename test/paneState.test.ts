import { describe, it, expect } from "vitest";
import { parsePaneStates } from "../src/core/tmux";

// One tmux `list-panes -F` line: session \t current_command \t pane_title \t window_activity
const line = (name: string, cmd: string, title: string, activity = 1000) =>
  [name, cmd, title, String(activity)].join("\t");

describe("parsePaneStates", () => {
  it("claude + braille spinner title → working", () => {
    expect(parsePaneStates(line("note", "claude", "⠋ note")).get("note")?.state).toBe("working");
  });

  it("claude + ✳ title → turn (내 차례)", () => {
    expect(parsePaneStates(line("vp-erp", "claude", "✳ vp-erp")).get("vp-erp")?.state).toBe("turn");
  });

  it("plain shell (claude not running) → inactive", () => {
    expect(parsePaneStates(line("ppt-maker", "bash", "mokgam")).get("ppt-maker")?.state).toBe("inactive");
  });

  it("detects claude by title glyph even when command isn't literally 'claude'", () => {
    expect(parsePaneStates(line("x", "node", "⠹ building")).get("x")?.state).toBe("working");
  });

  it("carries window_activity as ts", () => {
    expect(parsePaneStates(line("note", "claude", "⠋ note", 1720000000)).get("note")?.ts).toBe(1720000000);
  });

  it("multi-pane session takes the strongest state and newest activity", () => {
    const raw = [
      line("multi", "claude", "✳ idle pane", 500),
      line("multi", "claude", "⠸ busy pane", 900),
    ].join("\n");
    const e = parsePaneStates(raw).get("multi");
    expect(e?.state).toBe("working"); // working > turn
    expect(e?.ts).toBe(900);          // max activity
  });

  it("ignores malformed lines", () => {
    expect(parsePaneStates("garbage\n\nname\tonly-two").size).toBe(0);
  });

  it("handles a title that itself contains a tab (activity is always the last field)", () => {
    const e = parsePaneStates("s\tclaude\t⠋ a\tb\t1234").get("s");
    expect(e?.state).toBe("working");
    expect(e?.ts).toBe(1234);
  });
});
