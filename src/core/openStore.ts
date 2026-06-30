import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, copyFileSync } from "node:fs";
import { dirname } from "node:path";

function parse(s: string): string[] {
  const a = JSON.parse(s);
  return Array.isArray(a) ? a.filter((x) => typeof x === "string") : [];
}

// Read the open-session name list. On corruption recover from .bak → empty (never throws).
export function loadOpen(file: string): string[] {
  try { return parse(readFileSync(file, "utf8")); }
  catch {
    try { return parse(readFileSync(file + ".bak", "utf8")); }
    catch { return []; }
  }
}

// Atomic save (temp+rename) + one-generation .bak. De-duplicates.
export function saveOpen(file: string, names: string[]): void {
  mkdirSync(dirname(file), { recursive: true });
  if (existsSync(file)) { try { copyFileSync(file, file + ".bak"); } catch { /* best effort */ } }
  const tmp = file + ".tmp";
  writeFileSync(tmp, JSON.stringify([...new Set(names)], null, 2));
  renameSync(tmp, file);
}
