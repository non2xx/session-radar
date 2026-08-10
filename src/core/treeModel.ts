import { Layout, TreeData, SessionNode, StatusEntry, GroupNode } from "./types";
import { AgentsIndex } from "./subagents";

function node(
  name: string,
  layout: Layout,
  statuses: Map<string, StatusEntry>,
  agents?: AgentsIndex,
): SessionNode {
  const st = statuses.get(name);
  const a = agents?.bySession.get(name);
  return {
    name,
    label: layout.aliases[name] || name,
    state: st ? st.state : "unknown",
    ts: st ? st.ts : null,
    path: layout.paths[name],
    agents: st?.agents,
    claude: a?.claude,
    subagents: a?.subagents,
  };
}

/** 나무에 올릴 세션 이름 전부(그룹 + 미분류 + tmux 에서 발견된 것), 숨긴 것은 뺀다. */
export function visibleNames(layout: Layout, discovered: string[]): string[] {
  const hidden = new Set(layout.hidden);
  const out: string[] = [];
  const add = (s: string) => { if (!hidden.has(s) && !out.includes(s)) out.push(s); };
  for (const g of layout.groups) for (const s of g.sessions) add(s);
  for (const s of layout.ungroupedOrder) add(s);
  for (const s of discovered) add(s);
  return out;
}

export function buildTree(
  layout: Layout,
  statuses: Map<string, StatusEntry>,
  discovered: string[],
  agents?: AgentsIndex,
): TreeData {
  const hidden = new Set(layout.hidden);
  const grouped = new Set<string>();
  for (const g of layout.groups) for (const s of g.sessions) grouped.add(s);

  const groups: GroupNode[] = layout.groups.map((g) => ({
    id: g.id,
    name: g.name,
    sessions: g.sessions.filter((s) => !hidden.has(s)).map((s) => node(s, layout, statuses, agents)),
  }));

  // ungrouped: stored order first (still valid), then newly discovered
  const ungroupedNames: string[] = [];
  for (const s of layout.ungroupedOrder) {
    if (!hidden.has(s) && !grouped.has(s) && !ungroupedNames.includes(s)) ungroupedNames.push(s);
  }
  for (const s of discovered) {
    if (!hidden.has(s) && !grouped.has(s) && !ungroupedNames.includes(s)) ungroupedNames.push(s);
  }
  return {
    groups,
    ungrouped: ungroupedNames.map((s) => node(s, layout, statuses, agents)),
    blocked: agents?.blocked ?? [],
  };
}
