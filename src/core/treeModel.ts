import { Layout, TreeData, SessionNode, StatusEntry, GroupNode } from "./types";

function node(name: string, layout: Layout, statuses: Map<string, StatusEntry>): SessionNode {
  const st = statuses.get(name);
  return {
    name,
    label: layout.aliases[name] || name,
    state: st ? st.state : "unknown",
    ts: st ? st.ts : null,
  };
}

export function buildTree(layout: Layout, statuses: Map<string, StatusEntry>, discovered: string[]): TreeData {
  const hidden = new Set(layout.hidden);
  const grouped = new Set<string>();
  for (const g of layout.groups) for (const s of g.sessions) grouped.add(s);

  const groups: GroupNode[] = layout.groups.map((g) => ({
    id: g.id,
    name: g.name,
    sessions: g.sessions.filter((s) => !hidden.has(s)).map((s) => node(s, layout, statuses)),
  }));

  // ungrouped: stored order first (still valid), then newly discovered
  const ungroupedNames: string[] = [];
  for (const s of layout.ungroupedOrder) {
    if (!hidden.has(s) && !grouped.has(s) && !ungroupedNames.includes(s)) ungroupedNames.push(s);
  }
  for (const s of discovered) {
    if (!hidden.has(s) && !grouped.has(s) && !ungroupedNames.includes(s)) ungroupedNames.push(s);
  }
  return { groups, ungrouped: ungroupedNames.map((s) => node(s, layout, statuses)) };
}
