import { Layout } from "./types";

const clone = (l: Layout): Layout => JSON.parse(JSON.stringify(l));
const removeEverywhere = (l: Layout, name: string) => {
  for (const g of l.groups) g.sessions = g.sessions.filter((s) => s !== name);
  l.ungroupedOrder = l.ungroupedOrder.filter((s) => s !== name);
};

export function addGroup(l: Layout, name: string, id: string): Layout {
  const n = clone(l); n.groups.push({ id, name, sessions: [] }); return n;
}
export function renameGroup(l: Layout, id: string, name: string): Layout {
  const n = clone(l); const g = n.groups.find((g) => g.id === id); if (g) g.name = name; return n;
}
export function deleteGroup(l: Layout, id: string): Layout {
  const n = clone(l);
  const g = n.groups.find((g) => g.id === id);
  if (g) { for (const s of g.sessions) if (!n.ungroupedOrder.includes(s)) n.ungroupedOrder.push(s); }
  n.groups = n.groups.filter((g) => g.id !== id);
  return n;
}
export function setAlias(l: Layout, name: string, alias: string): Layout {
  const n = clone(l);
  if (alias.trim()) n.aliases[name] = alias.trim(); else delete n.aliases[name];
  return n;
}
export function hideSession(l: Layout, name: string): Layout {
  const n = clone(l); removeEverywhere(n, name);
  if (!n.hidden.includes(name)) n.hidden.push(name);
  return n;
}
export function unhideSession(l: Layout, name: string): Layout {
  const n = clone(l); n.hidden = n.hidden.filter((s) => s !== name); return n;
}
export function moveSession(l: Layout, name: string, targetGroupId: string | null, index: number): Layout {
  const n = clone(l);
  removeEverywhere(n, name);
  n.hidden = n.hidden.filter((s) => s !== name);
  const arr = targetGroupId === null
    ? n.ungroupedOrder
    : (n.groups.find((g) => g.id === targetGroupId)?.sessions ?? n.ungroupedOrder);
  const i = Math.max(0, Math.min(index, arr.length));
  arr.splice(i, 0, name);
  return n;
}
