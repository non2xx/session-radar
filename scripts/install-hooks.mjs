import { readFileSync, writeFileSync, existsSync, copyFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const settings = join(homedir(), ".claude", "settings.json");
const sh = join(homedir(), ".claude", "session-status.sh");
const cmd = (state) => `bash ${sh} ${state}`;
const entry = (matcher, state) => ({ matcher, hooks: [{ type: "command", command: cmd(state), timeout: 5 }] });

// "waiting" events: keep the ones that actually fire in your setup (permission/question prompts).
const WANTED = [
  ["UserPromptSubmit", entry("", "working")],
  ["PostToolUse",      entry("", "working")],   // M1: back to working after tool/approval
  ["Stop",             entry("", "idle")],
  ["SessionEnd",       entry("", "end")],       // remove status file when a session closes (no ghosts)
  ["PreToolUse",       entry("AskUserQuestion", "waiting")],
  ["Notification",     entry("permission_prompt", "waiting")], // probe may replace with:
  // ["PermissionRequest", entry("", "waiting")],
  // ["Elicitation",       entry("", "waiting")],
];

if (!existsSync(settings)) { console.error("settings.json not found:", settings); process.exit(1); }
const before = readFileSync(settings, "utf8");
const data = JSON.parse(before);                 // abort if already invalid
data.hooks ??= {};
// Record every pre-existing hook command so we can verify our write drops none of them.
const existingCmds = new Set();
for (const arr of Object.values(data.hooks)) for (const e of arr || []) for (const h of (e.hooks || [])) if (h && typeof h.command === "string") existingCmds.add(h.command);

const has = (arr, e) => arr.some((x) => x.matcher === e.matcher &&
  (x.hooks || []).some((h) => h.command === e.hooks[0].command));
for (const [evt, e] of WANTED) {
  data.hooks[evt] ??= [];
  if (!has(data.hooks[evt], e)) data.hooks[evt].push(e); // idempotent, additive only
}

const out = JSON.stringify(data, null, 2);
JSON.parse(out);                                  // serializable check
copyFileSync(settings, `${settings}.bak-${Date.now()}`);  // H1: timestamped backup
const tmp = `${settings}.tmp`;
writeFileSync(tmp, out);
renameSync(tmp, settings);                         // atomic replace

const afterData = JSON.parse(readFileSync(settings, "utf8")); // verify still valid JSON
const afterCmds = new Set();
for (const arr of Object.values(afterData.hooks || {})) for (const e of arr || []) for (const h of (e.hooks || [])) if (h && typeof h.command === "string") afterCmds.add(h.command);
for (const c of existingCmds) {
  if (!afterCmds.has(c)) throw new Error("ABORT: a pre-existing hook went missing after write — restore the latest settings.json.bak-* now.");
}
console.log("session-radar hooks installed (atomic, backed up). existing hooks preserved.");
