import { ClaudeSession, SubagentNode, SubagentSummary, BlockedEntry } from "./types";

// ---- 세션 폴더에서 서브에이전트 읽기 ----
//
// 경로(실측 확인, 2026-08-10):
//   ~/.claude/projects/<cwd 를 인코딩한 이름>/<sessionId>/subagents/agent-<id>.jsonl
//   ~/.claude/projects/<cwd 를 인코딩한 이름>/<sessionId>/subagents/agent-<id>.meta.json
//
// ⚠ .jsonl 은 절대 열지 않는다. 이 기계에서 가장 큰 것이 168MB 였다. 파일 하나가 통째로
//   한 줄인 경우도 있어 "끝부분만 조금" 읽는 요령도 안 통한다. 쓰는 것은 **수정 시각**뿐이다.
// ⚠ 기록이 1,600개가 넘는다. .meta.json 은 화면에 그릴 것만 골라 읽는다(작은 파일, 150바이트쯤).

/** 이만큼 안에 .jsonl 이 갱신됐으면 "도는 중". 실측: 도는 에이전트는 1~3분 안에 계속 쓴다. */
export const RUNNING_MS = 90_000;
/** 끝났지만 최근이라 이름은 보여 줄 구간. */
export const RECENT_MS = 3 * 60 * 60_000;
/** 끝난 것 중 몇 줄까지 펼칠지. 나머지는 "지난 기록 N개" 한 줄로 접는다. */
export const MAX_HISTORY_ROWS = 5;

/** 경로의 [^A-Za-z0-9] 를 전부 `-` 로. 예 /home/u/a.b → -home-u-a-b (실측으로 확인한 규칙) */
export function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, "-");
}

/** ~/.claude 아래 그 세션의 subagents 폴더. join 을 직접 하는 이유는 테스트에서 경로를 갈아끼우려고. */
export function subagentsDir(claudeDir: string, cwd: string, sessionId: string): string {
  return `${claudeDir}/projects/${encodeProjectDir(cwd)}/${sessionId}/subagents`;
}

/** 파일 만지는 부분은 전부 여기로 모은다 → 테스트는 가짜 폴더를 끼워 넣는다. */
export interface SubagentFs {
  /** 폴더 안 파일 이름들. 폴더가 없으면 [] */
  list(dir: string): string[];
  /** 수정 시각(ms). 없으면 null */
  mtime(path: string): number | null;
  /** 작은 JSON 하나. 못 읽으면 null */
  readJson(path: string): any;
}

const AGENT_LOG = /^agent-(.+)\.jsonl$/;

/**
 * 한 세션의 서브에이전트 폴더를 훑는다.
 *
 * 훑기 = (폴더 목록 1회) + (.jsonl 마다 수정 시각) + (**그릴 것만** .meta.json 읽기).
 * 실측: 10개 세션 245개 파일에 3~5ms.
 *
 * 기록이 하나도 없으면 undefined 를 준다 — 세션 줄에 아무것도 안 붙이기 위해서.
 */
export function scanSubagents(
  dir: string,
  fs: SubagentFs,
  now: number,
  limits: { runningMs?: number; recentMs?: number; maxHistory?: number } = {},
): SubagentSummary | undefined {
  const runningMs = limits.runningMs ?? RUNNING_MS;
  const recentMs = limits.recentMs ?? RECENT_MS;
  const maxHistory = limits.maxHistory ?? MAX_HISTORY_ROWS;

  const rows: { id: string; mtime: number }[] = [];
  for (const name of fs.list(dir)) {
    const m = AGENT_LOG.exec(name);
    if (!m) continue;
    rows.push({ id: m[1], mtime: fs.mtime(`${dir}/${name}`) ?? 0 });
  }
  if (!rows.length) return undefined;
  rows.sort((a, b) => b.mtime - a.mtime);

  // 시계가 어긋나 미래 시각이 찍혀도 "도는 중"으로 본다(now - mtime 이 음수).
  const age = (mtime: number) => now - mtime;
  const running = rows.filter((r) => age(r.mtime) <= runningMs);
  const history = rows
    .filter((r) => age(r.mtime) > runningMs && age(r.mtime) <= recentMs)
    .slice(0, maxHistory);

  const picked = [...running, ...history];
  const nodes: SubagentNode[] = picked.map((r) => {
    const meta = fs.readJson(`${dir}/agent-${r.id}.meta.json`) ?? {};
    const depth = typeof meta.spawnDepth === "number" && meta.spawnDepth >= 1
      ? Math.floor(meta.spawnDepth) : 1;
    return {
      id: r.id,
      // 빈 글자 그대로 실어 나른다. 무엇을 대신 보일지는 agentLabel() 한 곳에서만 정한다
      // (.meta.json 이 아예 없는 오래된 기록이 실제로 있다 — 실측 7건).
      description: typeof meta.description === "string" ? meta.description.trim() : "",
      agentType: typeof meta.agentType === "string" ? meta.agentType.trim() : "",
      depth,
      parentId: typeof meta.parentAgentId === "string" ? meta.parentAgentId : undefined,
      model: typeof meta.model === "string" ? meta.model : undefined,
      running: age(r.mtime) <= runningMs,
      updatedAt: r.mtime,
      children: [],
    };
  });

  return {
    running: running.length,
    shown: nest(nodes),
    hidden: rows.length - picked.length,
    total: rows.length,
  };
}

/**
 * parentAgentId 로 한 단계 더 들여쓴다(spawnDepth 2 이상이 실제로 있다 — 이 기계에 112건).
 * 부모가 화면에 안 뽑힌 경우(오래돼서 접힘)는 자식을 그냥 맨 위에 둔다 — 안 보이는 것보다 낫다.
 */
function nest(nodes: SubagentNode[]): SubagentNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const roots: SubagentNode[] = [];
  for (const n of nodes) {
    const parent = n.parentId ? byId.get(n.parentId) : undefined;
    // 부모를 타고 올라가다 자기 자신으로 돌아오면 고리다 → 뿌리로 둔다(무한 중첩 방지).
    if (parent && parent !== n && !isAncestor(n, parent, byId)) parent.children.push(n);
    else roots.push(n);
  }
  return roots;
}

function isAncestor(maybe: SubagentNode, from: SubagentNode, byId: Map<string, SubagentNode>): boolean {
  let cur: SubagentNode | undefined = from;
  for (let i = 0; i < 32 && cur; i++) {
    if (cur === maybe) return true;
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return false;
}

// ---- 화면에 뿌릴 글자 ----
//
// 이름(description)은 남이 짓는다. 실측(최근 이틀 123개)에서 대부분 영어였고 가장 긴 것이
// 44글자였다. 사이드바 한 줄에 그대로 넣으면 옆 정보가 밀려난다 → 여기서 자르고, 원문은
// 툴팁에만 둔다. 이미 쌓인 1,981개의 이름은 고칠 수 없으니 화면 쪽에서 받아 내는 게 맞다.

/** 한 줄에 보일 글자 수. 한글 20자쯤. */
export const LABEL_MAX = 20;

/**
 * 글자 수로 자른다 — `.length`(코드 단위)로 자르면 이모지가 반 토막 나고 한글도 셈이 어긋난다.
 * [...s] 는 코드 포인트 단위라 이모지 한 개를 한 글자로 센다.
 */
export function truncate(s: string, max = LABEL_MAX): string {
  const chars = [...s];
  return chars.length <= max ? s : chars.slice(0, max).join("") + "…";
}

/** 한 줄에 뭐라고 쓸지. 이름 → 종류 → "이름 없음" 순서. 빈 줄은 절대 만들지 않는다. */
export function agentLabel(n: { description: string; agentType: string }): string {
  return n.description || n.agentType || "이름 없음";
}

/**
 * 줄 오른쪽에 쓸 글자. **시간만** 쓴다.
 *
 * 🛑 종류(`general-purpose` 등)를 여기 넣지 말 것. 좁은 패널에서 그게 자리를 먹어
 * **이름이 먼저 잘린다**(실측 화면: `계획서…` · `P…`). 종류는 `agentTooltip` 에 있다.
 *
 * 나무 뷰와 카드 뷰가 **이 함수 하나**를 쓴다. 각자 한 줄씩 베껴 두면 한쪽만 고쳐져
 * 두 화면이 어긋나고, 나무 뷰(`src/ui/`)는 vscode 를 import 해서 시험이 못 닿기 때문에
 * 그쪽 원복은 아무도 못 잡는다. 규칙을 시험이 닿는 자리에 두는 것이 이 함수의 존재 이유다.
 */
export function agentRowMeta(n: { updatedAt: number }, now: number): string {
  return formatAge(now - n.updatedAt);
}

/** 마우스를 올렸을 때: 전체 이름 + 종류 + 지난 시간. */
export function agentTooltip(n: SubagentNode, now: number): string {
  const lines = [agentLabel(n)];
  if (n.agentType) lines.push(`종류: ${n.agentType}`);
  if (n.model) lines.push(`모델: ${n.model}`);
  lines.push(n.running ? `도는 중 · ${formatAge(now - n.updatedAt)} 전 갱신`
                       : `${formatAge(now - n.updatedAt)} 전에 멈춤`);
  if (n.depth > 1) lines.push(`깊이 ${n.depth} (에이전트가 부른 에이전트)`);
  return lines.join("\n");
}

/** 중첩된 나무를 화면 순서대로 편다(카드 뷰처럼 들여쓰기만 되는 곳에서 쓴다). */
export function flattenAgents(
  nodes: SubagentNode[],
  level = 0,
): { node: SubagentNode; level: number }[] {
  const out: { node: SubagentNode; level: number }[] = [];
  for (const n of nodes) {
    out.push({ node: n, level });
    if (n.children.length) out.push(...flattenAgents(n.children, level + 1));
  }
  return out;
}

// 막힌 세션에 붙는 기간의 **말**은 여기 하나뿐이다. 값은 now - startedAt, 즉 세션을
// 켠 시각 기준이라 "막힌 지"가 아니다. 두 화면이 이 문장을 각자 베껴 쓰다가 한쪽만
// 고쳐져 줄과 hover 가 서로 반대말을 한 적이 있어, 한 곳으로 모았다.
export function blockedAgeLabel(ageMs: number): string {
  return `켠 지 ${formatAge(ageMs)}`;
}
export function blockedAgeTip(name: string, ageMs: number): string {
  return `${name}: ${blockedAgeLabel(ageMs)} (막힌 시각이 아니라 세션을 켠 시각 기준)`;
}

/** "방금 / 3분 / 5시간 / 12일" — 생활어 한 토막. */
export function formatAge(ms: number): string {
  if (!isFinite(ms) || ms < 0) return "방금";
  const s = Math.floor(ms / 1000);
  if (s < 60) return "방금";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간`;
  return `${Math.floor(h / 24)}일`;
}

// ---- 세션 목록 + 폴더 훑기를 하나로 ----

export interface SessionAgents { claude?: ClaudeSession; subagents?: SubagentSummary; }
export interface AgentsIndex {
  bySession: Map<string, SessionAgents>; // key = tmux 세션 이름
  blocked: BlockedEntry[];
}

export const emptyAgentsIndex = (): AgentsIndex => ({ bySession: new Map(), blocked: [] });

/**
 * tmux 세션 이름들에 claude 세션과 서브에이전트를 붙이고, 막힌 세션은 따로 모은다.
 * `scan` 을 주입받으므로 파일 없이도 통째로 시험할 수 있다.
 */
export function buildAgentsIndex(
  sessions: ClaudeSession[],
  names: string[],
  paths: Record<string, string>,
  scan: (s: ClaudeSession) => SubagentSummary | undefined,
  now: number,
  pick: (sessions: ClaudeSession[], name: string, path?: string) => ClaudeSession | undefined,
  blockedOf: (sessions: ClaudeSession[]) => ClaudeSession[],
): AgentsIndex {
  const bySession = new Map<string, SessionAgents>();
  for (const name of names) {
    const claude = pick(sessions, name, paths[name]);
    if (!claude) continue;
    bySession.set(name, { claude, subagents: scan(claude) });
  }
  const blocked: BlockedEntry[] = blockedOf(sessions).map((s) => ({
    session: s,
    subagents: scan(s),
    ageMs: s.startedAt ? Math.max(0, now - s.startedAt) : 0,
  }));
  return { bySession, blocked };
}
