import * as vscode from "vscode";
import { homedir } from "node:os";
import { join } from "node:path";
import { readdirSync } from "node:fs";
import { readStatuses } from "../core/statusReader";
import { loadLayout, saveLayout } from "../core/layoutStore";
import { buildTree } from "../core/treeModel";
import { moveSession } from "../core/mutations";
import { computeContainerOrder } from "../core/order";
import { listSessions } from "../core/tmux";
import { SessionState, SessionNode, TreeData } from "../core/types";

export const STATUS_DIR = join(homedir(), ".claude", "session-status");
export const LAYOUT_FILE = join(homedir(), ".claude", "session-radar", "layout.json");
export const OPEN_FILE = join(homedir(), ".claude", "session-radar", "open.json");
const DND_MIME = "application/vnd.code.tree.sessionradar";

export type Item =
  | { kind: "group"; id: string; name: string }
  | { kind: "session"; node: SessionNode; groupId: string | null }
  | { kind: "ungroupedRoot" };

function statusIcon(state: SessionState): vscode.ThemeIcon {
  switch (state) {
    case "working": return new vscode.ThemeIcon("loading~spin", new vscode.ThemeColor("charts.red"));
    case "waiting": return new vscode.ThemeIcon("circle-filled", new vscode.ThemeColor("charts.yellow"));
    case "idle": return new vscode.ThemeIcon("circle-filled", new vscode.ThemeColor("charts.green"));
    default: return new vscode.ThemeIcon("circle-outline");
  }
}

function discover(): string[] {
  const names = new Set<string>();
  try {
    for (const f of readdirSync(STATUS_DIR)) if (f.endsWith(".json")) names.add(f.slice(0, -5));
  } catch { /* no status dir yet */ }
  for (const s of listSessions()) names.add(s); // live tmux sessions (even without a status file)
  return [...names];
}

// Shared by the tree view and the card view so both render identical data.
export function getTreeData(): TreeData {
  return buildTree(loadLayout(LAYOUT_FILE), readStatuses(STATUS_DIR), discover());
}

// Shared by tree drop and card drop: move sessions into a container at a position.
export function moveSessionsTo(names: string[], targetGroupId: string | null, beforeName: string | null): void {
  let layout = loadLayout(LAYOUT_FILE);
  if (targetGroupId !== null && !layout.groups.find((g) => g.id === targetGroupId)) targetGroupId = null; // unknown group → ungrouped
  const data = getTreeData();
  const visible = targetGroupId === null
    ? data.ungrouped.map((s) => s.name)
    : (data.groups.find((g) => g.id === targetGroupId)?.sessions ?? []).map((s) => s.name);
  const finalOrder = computeContainerOrder(visible, names, beforeName);
  for (const n of names) layout = moveSession(layout, n, targetGroupId, 0);
  if (targetGroupId === null) layout.ungroupedOrder = finalOrder;
  else { const g = layout.groups.find((g) => g.id === targetGroupId); if (g) g.sessions = finalOrder; }
  saveLayout(LAYOUT_FILE, layout);
}

export class SessionRadarProvider
  implements vscode.TreeDataProvider<Item>, vscode.TreeDragAndDropController<Item> {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;
  refresh() { this._onDidChange.fire(); }
  onChanged: () => void = () => this.refresh(); // extension overrides with refreshAll (refresh both views)

  readonly dropMimeTypes = [DND_MIME];
  readonly dragMimeTypes = [DND_MIME];

  getTreeItem(e: Item): vscode.TreeItem {
    if (e.kind === "ungroupedRoot") {
      const t = new vscode.TreeItem("미분류", vscode.TreeItemCollapsibleState.Expanded);
      t.contextValue = "ungroupedRoot";
      return t;
    }
    if (e.kind === "group") {
      const t = new vscode.TreeItem(e.name, vscode.TreeItemCollapsibleState.Expanded);
      t.contextValue = "group";
      t.iconPath = new vscode.ThemeIcon("folder");
      return t;
    }
    const t = new vscode.TreeItem(e.node.label, vscode.TreeItemCollapsibleState.None);
    t.contextValue = "session";
    t.iconPath = statusIcon(e.node.state);
    if (e.node.ts) {
      const mins = Math.max(0, Math.round((Date.now() / 1000 - e.node.ts) / 60));
      t.description = `${mins}m`;
    }
    if (e.node.label !== e.node.name) t.tooltip = e.node.name;
    t.command = { command: "sessionRadar.jump", title: "Jump", arguments: [e.node.name] };
    return t;
  }

  getChildren(e?: Item): Item[] {
    const data = getTreeData();
    if (!e) {
      const roots: Item[] = data.groups.map((g) => ({ kind: "group", id: g.id, name: g.name } as Item));
      roots.push({ kind: "ungroupedRoot" });
      return roots;
    }
    if (e.kind === "group") {
      const g = data.groups.find((g) => g.id === e.id);
      return (g?.sessions ?? []).map((n) => ({ kind: "session", node: n, groupId: e.id } as Item));
    }
    if (e.kind === "ungroupedRoot") {
      return data.ungrouped.map((n) => ({ kind: "session", node: n, groupId: null } as Item));
    }
    return [];
  }

  handleDrag(source: Item[], dt: vscode.DataTransfer): void {
    const names = source.filter((s) => s.kind === "session").map((s) => (s as any).node.name);
    dt.set(DND_MIME, new vscode.DataTransferItem(JSON.stringify(names)));
  }

  handleDrop(target: Item | undefined, dt: vscode.DataTransfer): void {
    const raw = dt.get(DND_MIME);
    if (!raw) return;
    let names: string[];
    try { names = JSON.parse(raw.value as string); } catch { return; }
    if (!names.length) return;
    let targetGroupId: string | null = null;
    let beforeName: string | null = null;
    if (target?.kind === "group") { targetGroupId = target.id; } // drop on group header → end of that group
    else if (target?.kind === "session") { targetGroupId = target.groupId; beforeName = target.node.name; }
    moveSessionsTo(names, targetGroupId, beforeName);
    this.onChanged(); // refresh BOTH views (set to refreshAll by extension)
  }
}
