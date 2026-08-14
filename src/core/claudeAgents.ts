import { ClaudeSession, ClaudeKind } from "./types";

// ---- `claude agents --json` 읽기 ----
//
// 실측한 출력(2026-08-10, 이 기계 10줄). 이름·경로는 공개용 예시로 바꿨고, 칸 구성과
// 값의 모양은 실측 그대로다:
//   {"pid":10687,"cwd":"…/project-a","kind":"interactive","startedAt":1786260973721,
//    "sessionId":"3bd9f10e-…","name":"alpha","status":"busy"}
//   {"id":"f627850e","cwd":"…/PROJECT-B","kind":"background","startedAt":1782193582958,
//    "sessionId":"f627850e-…","name":"beta","state":"blocked"}
//
// 세 가지를 조심한다.
//  1) 상태 칸 이름이 kind 마다 다르다 — interactive 는 `status`, background 는 `state`.
//  2) 실측에 문서에 없던 값이 하나 더 있었다: status "waiting" + waitingFor "input needed".
//     그래서 아는 값만 통과시키지 않고 글자를 그대로 실어 나른다.
//  3) 이 명령은 죽은 기록도 들고 있다(7주 된 background 줄이 그대로 남아 있었다).

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** 출력 한 덩이를 우리 쪽 모양으로. 깨진 줄은 통째로 버리지 않고 그 줄만 건너뛴다. */
export function parseClaudeAgents(raw: string): ClaudeSession[] {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const out: ClaudeSession[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const sessionId = str(o.sessionId);
    const cwd = str(o.cwd);
    if (!sessionId || !cwd) continue; // 이 둘이 없으면 폴더를 못 찾는다 → 쓸모 없음
    const kind: ClaudeKind = o.kind === "background" ? "background" : "interactive";
    const activity = str(o.status) ?? str(o.state) ?? "unknown";
    out.push({
      sessionId,
      cwd,
      name: str(o.name) ?? baseName(cwd),
      kind,
      startedAt: typeof o.startedAt === "number" && isFinite(o.startedAt) ? o.startedAt : null,
      activity,
      blocked: activity === "blocked",
      waitingFor: str(o.waitingFor),
    });
  }
  return out;
}

function baseName(cwd: string): string {
  const parts = cwd.split("/").filter((p) => p.length > 0);
  return parts.length ? parts[parts.length - 1] : cwd;
}

/**
 * tmux 세션 한 개에 짝지을 claude 세션 고르기.
 *
 * 짝은 **살아 있는 interactive 줄에만** 짓는다. background 줄은 tmux 창에서 도는 게 아니라
 * 따로 떠 있는 것이라, 이름이 같다는 이유로 붙이면 멀쩡한 창이 남의 상태를 뒤집어쓴다
 * (실측: 한 이름이 tmux 세션에도 있고 7주 막힌 background 줄에도 있었다. 아래 예시에서는
 *  그 이름을 "gamma"로 적는다).
 *
 * 이름이 먼저, 없으면 설정된 경로(cwd)로. 같은 이름이 여럿이면 가장 최근에 뜬 것.
 */
export function pickSessionFor(
  sessions: ClaudeSession[],
  name: string,
  path?: string,
): ClaudeSession | undefined {
  const live = sessions.filter((s) => s.kind === "interactive" && !s.blocked);
  const byName = live.filter((s) => s.name === name);
  const pool = byName.length ? byName : path ? live.filter((s) => s.cwd === path) : [];
  if (!pool.length) return undefined;
  return pool.reduce((a, b) => ((b.startedAt ?? 0) > (a.startedAt ?? 0) ? b : a));
}

/** 막힌 것만. 먼저 켠 것이 위로 온다(startedAt 오름차순 - "막힌 지 오래"가 아니라 "켠 지 오래"다). */
export function blockedSessions(sessions: ClaudeSession[]): ClaudeSession[] {
  return sessions
    .filter((s) => s.blocked)
    .sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
}
