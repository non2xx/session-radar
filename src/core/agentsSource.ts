import { execFile } from "node:child_process";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ClaudeSession, SubagentSummary } from "./types";
import { parseClaudeAgents, pickSessionFor, blockedSessions } from "./claudeAgents";
import {
  AgentsIndex, SubagentFs, buildAgentsIndex, emptyAgentsIndex, scanSubagents, subagentsDir,
} from "./subagents";

// ---- 값비싼 두 가지를 바깥에서 격리하는 곳 ----
//
// 1) `claude agents --json` — 실측 0.6초. 3초 주기 새로고침에 동기로 넣으면 확장 호스트가
//    그동안 멈춘다(단일 스레드). 그래서 **따로 도는 주기**로 비동기로만 부르고 결과를 캐시한다.
//    화면은 언제나 캐시만 읽는다 — 처음 몇 초는 비어 있고, 그건 예전 화면과 똑같다.
// 2) 폴더 훑기 — 실측 3~5ms(10세션 245파일). 싸지만 getTreeData() 가 새로고침 한 번에
//    여러 번 불리므로 tmux 쪽과 같은 방식으로 짧은 TTL 을 둔다.

const CLAUDE_TIMEOUT_MS = 10_000;
const SCAN_TTL_MS = 1000;
/** 훑기가 이 시간을 넘기면 남은 세션은 이번 판에서 건너뛴다(다음 판에 다시 시도). */
const SCAN_BUDGET_MS = 150;

/** ~/.claude — CLAUDE_CONFIG_DIR 로 자리를 옮긴 사람도 있어서 그것을 먼저 본다. */
export function claudeDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
}

export const realSubagentFs: SubagentFs = {
  list(dir) {
    try { return readdirSync(dir); } catch { return []; }
  },
  mtime(path) {
    try { return statSync(path).mtimeMs; } catch { return null; }
  },
  readJson(path) {
    try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
  },
};

let _sessions: ClaudeSession[] = [];
let _inFlight = false;
let _lastError = "";

/** 마지막으로 받아 둔 세션 목록(캐시). 화면은 이것만 읽는다. */
export function cachedClaudeSessions(): ClaudeSession[] { return _sessions; }
/** 마지막 실패 사유(진단용). 성공하면 빈 글자. */
export function lastAgentsError(): string { return _lastError; }

/** 테스트에서 캐시를 채우거나 비운다. */
export function setCachedClaudeSessions(list: ClaudeSession[]): void { _sessions = list; }

/**
 * `claude agents --json` 을 비동기로 부르고 캐시를 갈아 끼운다. 겹쳐 부르지 않는다.
 * 명령이 없거나(PATH 밖) 느리면 조용히 실패하고 예전 캐시를 그대로 둔다.
 */
export function refreshClaudeSessions(command: string, onDone?: () => void): void {
  if (_inFlight) return;
  _inFlight = true;
  execFile(command, ["agents", "--json"], { timeout: CLAUDE_TIMEOUT_MS, maxBuffer: 4 << 20 },
    (err, stdout) => {
      _inFlight = false;
      if (err) { _lastError = String(err.message || err); onDone?.(); return; }
      const parsed = parseClaudeAgents(stdout);
      _lastError = "";
      _sessions = parsed;
      onDone?.();
    });
}

let _index: { ts: number; value: AgentsIndex } | null = null;

/** 캐시를 버려 다음 호출이 폴더를 다시 훑게 한다(세션을 새로 만든 직후 등). */
export function invalidateAgentsIndex(): void { _index = null; }

/**
 * 화면이 쓰는 한 덩이. 동기이지만 안에서 파일만 만지고, TTL 과 예산이 둘 다 걸려 있다.
 */
export function readAgentsIndex(names: string[], paths: Record<string, string>): AgentsIndex {
  const now = Date.now();
  if (_index && now - _index.ts < SCAN_TTL_MS) return _index.value;
  const started = Date.now();
  const dir = claudeDir();
  const scan = (s: ClaudeSession): SubagentSummary | undefined => {
    if (Date.now() - started > SCAN_BUDGET_MS) return undefined; // 예산 초과 → 이번 판은 생략
    return scanSubagents(subagentsDir(dir, s.cwd, s.sessionId), realSubagentFs, Date.now());
  };
  let value: AgentsIndex;
  try {
    value = buildAgentsIndex(_sessions, names, paths, scan, now, pickSessionFor, blockedSessions);
  } catch {
    value = emptyAgentsIndex(); // 어떤 이유로든 못 읽으면 예전 화면 그대로(아무것도 안 붙는다)
  }
  _index = { ts: now, value };
  return value;
}
