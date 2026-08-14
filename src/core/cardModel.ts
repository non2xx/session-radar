import { SubagentSummary, TreeData } from "./types";
import { agentLabel, agentRowMeta, agentTooltip, blockedAgeLabel, blockedAgeTip, flattenAgents, truncate } from "./subagents";

/** 카드 한 장 밑에 몇 줄까지 붙일지. 16개 세션이 한 화면이라 길어지면 못 쓴다. */
export const CARD_AGENT_ROWS = 4;

/**
 * 웹뷰에 넘길 글자를 **여기서** 만든다. 자르기·시간 표기를 카드 뷰의 인라인 스크립트에
 * 한 벌 더 베껴 두면 한쪽만 고쳐져 나무 뷰와 어긋난다 — 같은 함수를 쓰게 한다.
 */
export function agentRows(sub: SubagentSummary | undefined, now: number) {
  if (!sub) return [];
  return flattenAgents(sub.shown)
    .filter((r) => r.node.running)
    .slice(0, CARD_AGENT_ROWS)
    .map((r) => ({
      label: truncate(agentLabel(r.node)),
      // 나무 뷰와 **같은 함수**를 쓴다 — 규칙이 한 곳에만 있어야 두 화면이 안 어긋난다.
      meta: agentRowMeta(r.node, now),
      tip: agentTooltip(r.node, now),
      level: r.level,
    }));
}

/** 카드 뷰가 그릴 수 있는 모양으로 트리 데이터를 한 번 손본다(원본은 안 건드린다). */
export function decorate(data: TreeData, now: number) {
  const sessions = (list: TreeData["ungrouped"]) =>
    list.map((s) => ({ ...s, running: s.subagents?.running ?? 0, rows: agentRows(s.subagents, now) }));
  return {
    groups: data.groups.map((g) => ({ ...g, sessions: sessions(g.sessions) })),
    ungrouped: sessions(data.ungrouped),
    blocked: data.blocked.map((b) => ({
      name: b.session.name,
      cwd: b.session.cwd,
      age: blockedAgeLabel(b.ageMs),
      tip: [
        blockedAgeTip(b.session.name, b.ageMs),
        `📁 ${b.session.cwd}`,
        `세션 ID: ${b.session.sessionId}`,
      ].join("\n"),
    })),
  };
}
