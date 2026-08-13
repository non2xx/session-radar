// "agents": main is free (you can type) but subagents it dispatched are still running.
export type SessionState = "working" | "agents" | "turn" | "inactive" | "unknown";
export interface StatusEntry { state: SessionState; ts: number; agents?: string[]; }

export interface Group { id: string; name: string; sessions: string[]; }
export interface Layout {
  groups: Group[];
  ungroupedOrder: string[];
  aliases: Record<string, string>;
  hidden: string[];
  paths: Record<string, string>;
}
export interface SessionNode {
  name: string;          // real key
  label: string;         // alias || name
  state: SessionState;
  ts: number | null;
  path?: string;         // configured project path (for -c on open / tooltip)
  agents?: string[];     // running subagents, when state is "agents"
  claude?: ClaudeSession;      // `claude agents --json` 에서 이 세션으로 짝지어진 줄
  subagents?: SubagentSummary; // 세션 폴더에서 읽은 서브에이전트 나무
}
export interface GroupNode { id: string; name: string; sessions: SessionNode[]; }
export interface TreeData { groups: GroupNode[]; ungrouped: SessionNode[]; blocked: BlockedEntry[]; }

// ---- `claude agents --json` 한 줄 ----
// 상태 칸 이름이 kind 마다 다르다: interactive 는 `status`, background 는 `state`.
// 둘 다 읽어 `activity` 한 칸으로 합친다(원본 글자 그대로 — 모르는 값도 버리지 않는다).
export type ClaudeKind = "interactive" | "background";
export interface ClaudeSession {
  sessionId: string;
  cwd: string;
  name: string;
  kind: ClaudeKind;
  startedAt: number | null; // epoch ms
  activity: string;         // busy | idle | blocked | waiting | …
  blocked: boolean;
  waitingFor?: string;
}

// ---- 세션 폴더 아래 subagents/agent-<id>.meta.json 한 개 ----
export interface SubagentNode {
  id: string;            // agent-<id>.jsonl 의 <id>
  description: string;   // 나무의 이름표(무슨 일을 시켰나)
  agentType: string;     // general-purpose · chageun:pr-reviewer …
  depth: number;         // spawnDepth (없으면 1)
  parentId?: string;     // parentAgentId — 있으면 그 밑으로 들여쓴다
  model?: string;
  running: boolean;      // .jsonl 이 방금 갱신됐나
  updatedAt: number;     // .jsonl 수정 시각(ms)
  children: SubagentNode[];
}
export interface SubagentSummary {
  running: number;         // 지금 도는 개수
  shown: SubagentNode[];   // 화면에 그릴 것(도는 것 + 최근 몇 개), parentId 로 중첩됨
  hidden: number;          // 접어 둔 지난 기록 수
  total: number;           // 이 세션이 지금까지 부른 총 개수
}

// 몇 주씩 막혀 있는 세션(기간은 켠 시각 기준). 이 기능의 핵심 — tmux 세션이 아예 없어도 보여야 한다.
export interface BlockedEntry { session: ClaudeSession; subagents?: SubagentSummary; ageMs: number; }
