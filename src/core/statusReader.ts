import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SessionState, StatusEntry } from "./types";

const VALID: SessionState[] = ["working", "waiting", "idle"];

export function readStatuses(dir: string): Map<string, StatusEntry> {
  const out = new Map<string, StatusEntry>();
  let files: string[];
  try { files = readdirSync(dir); } catch { return out; }
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const name = f.slice(0, -5);
    try {
      const raw = JSON.parse(readFileSync(join(dir, f), "utf8"));
      const state: SessionState = VALID.includes(raw.state) ? raw.state : "unknown";
      const ts = typeof raw.ts === "number" ? raw.ts : 0;
      out.set(name, { state, ts });
    } catch { /* skip invalid */ }
  }
  return out;
}
