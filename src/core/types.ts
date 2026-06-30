export type SessionState = "working" | "waiting" | "idle" | "unknown";
export interface StatusEntry { state: SessionState; ts: number; }

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
}
export interface GroupNode { id: string; name: string; sessions: SessionNode[]; }
export interface TreeData { groups: GroupNode[]; ungrouped: SessionNode[]; }
