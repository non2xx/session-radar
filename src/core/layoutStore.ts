import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, copyFileSync } from "node:fs";
import { dirname } from "node:path";
import { Layout, Group } from "./types";

export function emptyLayout(): Layout {
  return { groups: [], ungroupedOrder: [], aliases: {}, hidden: [] };
}

export function normalize(raw: any): Layout {
  const l = emptyLayout();
  if (!raw || typeof raw !== "object") return l;
  if (Array.isArray(raw.groups)) {
    l.groups = raw.groups
      .filter((g: any) => g && typeof g.id === "string" && typeof g.name === "string")
      .map((g: any): Group => ({
        id: g.id, name: g.name,
        sessions: Array.isArray(g.sessions) ? g.sessions.filter((s: any) => typeof s === "string") : [],
      }));
  }
  if (Array.isArray(raw.ungroupedOrder)) l.ungroupedOrder = raw.ungroupedOrder.filter((s: any) => typeof s === "string");
  if (raw.aliases && typeof raw.aliases === "object") {
    for (const [k, v] of Object.entries(raw.aliases)) if (typeof v === "string") l.aliases[k] = v;
  }
  if (Array.isArray(raw.hidden)) l.hidden = raw.hidden.filter((s: any) => typeof s === "string");
  return l;
}

export function loadLayout(file: string): Layout {
  try { return normalize(JSON.parse(readFileSync(file, "utf8"))); }
  catch {
    // H3: a corrupt/half-written layout must NOT silently wipe user config.
    // Try the one-generation backup before falling back to empty.
    try { return normalize(JSON.parse(readFileSync(file + ".bak", "utf8"))); }
    catch { return emptyLayout(); }
  }
}

export function saveLayout(file: string, l: Layout): void {
  mkdirSync(dirname(file), { recursive: true });
  if (existsSync(file)) { try { copyFileSync(file, file + ".bak"); } catch { /* best effort */ } }
  const tmp = file + ".tmp";
  writeFileSync(tmp, JSON.stringify(l, null, 2)); // atomic: write temp then rename
  renameSync(tmp, file);
}
