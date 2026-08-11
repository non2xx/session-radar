import * as vscode from "vscode";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadLayout, saveLayout } from "../core/layoutStore";
import { buildTree, visibleNames } from "../core/treeModel";
import { moveSession } from "../core/mutations";
import { computeContainerOrder } from "../core/order";
import { listSessions, readPaneStates } from "../core/tmux";
import { readAgentsIndex } from "../core/agentsSource";
import { agentLabel, agentRowMeta, agentTooltip, formatAge, truncate } from "../core/subagents";
import { Item, itemId, sessionItemId } from "../core/treeItems";
import { SessionState, SessionNode, TreeData, SubagentNode, BlockedEntry } from "../core/types";

export const LAYOUT_FILE = join(homedir(), ".claude", "session-radar", "layout.json");
export const OPEN_FILE = join(homedir(), ".claude", "session-radar", "open.json");
const DND_MIME = "application/vnd.code.tree.sessionradar";

export { Item } from "../core/treeItems";

function statusIcon(state: SessionState): vscode.ThemeIcon {
  switch (state) {
    case "working": return new vscode.ThemeIcon("loading~spin", new vscode.ThemeColor("charts.green"));
    // 파란 톱니 = 뒤에서 에이전트만 돈다(말 걸어도 된다). 초록 스피너와 색·모양 둘 다 다르게 둔다.
    case "agents":  return new vscode.ThemeIcon("gear~spin", new vscode.ThemeColor("charts.blue"));
    case "turn":    return new vscode.ThemeIcon("circle-filled", new vscode.ThemeColor("charts.yellow"));
    default:        return new vscode.ThemeIcon("circle-outline", new vscode.ThemeColor("disabledForeground")); // inactive/unknown
  }
}

function findSession(data: TreeData, name: string): SessionNode | undefined {
  for (const g of data.groups) { const s = g.sessions.find((n) => n.name === name); if (s) return s; }
  return data.ungrouped.find((n) => n.name === name);
}

/** 세션(또는 막힌 세션) 밑에 달 줄들: 서브에이전트 + 접어 둔 지난 기록 한 줄. */
function agentItems(sub: SessionNode["subagents"], ownerId: string): Item[] {
  if (!sub) return [];
  const items: Item[] = sub.shown.map((n) => ({ kind: "subagent", node: n, ownerId } as Item));
  if (sub.hidden > 0) items.push({ kind: "moreAgents", count: sub.hidden, ownerId });
  return items;
}

/** 접힘 상태 한 칸 고르기: 달 것이 없으면 화살표 없음, 손으로 바꾼 적 있으면 그것, 아니면 기본값. */
function foldState(hasRows: boolean, toggled: boolean | undefined, openByDefault: boolean) {
  if (!hasRows) return vscode.TreeItemCollapsibleState.None;
  const open = toggled ?? openByDefault;
  return open ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
}

function subagentItem(n: SubagentNode, id: string, toggled?: boolean): vscode.TreeItem {
  const t = new vscode.TreeItem(
    truncate(agentLabel(n)), // 이름은 남이 짓는다(실측 최대 44글자) → 여기서 자른다
    foldState(n.children.length > 0, toggled, true),
  );
  t.id = id;
  t.contextValue = "subagent";
  t.iconPath = n.running
    ? new vscode.ThemeIcon("sync~spin", new vscode.ThemeColor("charts.blue"))
    : new vscode.ThemeIcon("circle-outline", new vscode.ThemeColor("disabledForeground"));
  // 오른쪽 글자 규칙은 `agentRowMeta` 하나뿐이다(왜 종류를 안 쓰는지는 그 주석에).
  // 이 파일은 vscode 를 import 해서 시험이 못 닿으므로, 규칙을 여기 베끼면 원복을 아무도 못 잡는다.
  const now = Date.now();
  t.description = agentRowMeta(n, now);
  t.tooltip = agentTooltip(n, now); // 잘리기 전 전체 이름과 종류는 여기에
  return t;
}

function blockedRootItem(count: number, id: string, toggled?: boolean): vscode.TreeItem {
  const t = new vscode.TreeItem(`막힌 세션 ${count}`, foldState(true, toggled, true));
  t.id = id;
  t.contextValue = "blockedRoot";
  t.iconPath = new vscode.ThemeIcon("warning", new vscode.ThemeColor("charts.red"));
  t.tooltip = "누가 대답해 주기를 기다리다 멈춘 세션이에요. tmux 창이 없어도 여기에는 보입니다.";
  return t;
}

function blockedSessionItem(b: BlockedEntry, id: string, toggled?: boolean): vscode.TreeItem {
  const sub = b.subagents;
  const rows = sub ? sub.shown.length + (sub.hidden > 0 ? 1 : 0) : 0;
  // 막힌 세션은 접어서 시작한다 — 목록이 길고, 여기서 알고 싶은 건 "얼마나 방치됐나"라서.
  const t = new vscode.TreeItem(b.session.name, foldState(rows > 0, toggled, false));
  t.id = id;
  t.contextValue = "blockedSession";
  t.iconPath = new vscode.ThemeIcon("debug-pause", new vscode.ThemeColor("charts.red"));
  t.description = `${formatAge(b.ageMs)} 방치`;
  t.tooltip = [
    `${b.session.name} — ${formatAge(b.ageMs)}째 막혀 있어요`,
    `📁 ${b.session.cwd}`,
    `종류: ${b.session.kind} · 상태: ${b.session.activity}`,
    `세션 ID: ${b.session.sessionId}`,
  ].join("\n");
  return t;
}

function discover(): string[] {
  // tmux is the source of truth now: a session shows if it's a live tmux session.
  // (Layout-configured sessions are added by buildTree regardless of tmux.)
  return [...new Set(listSessions())];
}

// 서브에이전트 나무를 켤지. 끄면 `claude agents --json` 도 안 부르고 폴더도 안 훑는다.
export function subagentsEnabled(): boolean {
  return vscode.workspace.getConfiguration("sessionRadar").get<boolean>("showSubagents", true);
}

// Shared by the tree view and the card view so both render identical data.
export function getTreeData(): TreeData {
  const layout = loadLayout(LAYOUT_FILE);
  const discovered = discover();
  // 에이전트 쪽은 캐시만 읽는다(느린 `claude agents --json` 은 별도 주기로 돈다).
  const agents = subagentsEnabled()
    ? readAgentsIndex(visibleNames(layout, discovered), layout.paths)
    : undefined;
  return buildTree(layout, readPaneStates(), discovered, agents);
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

  /**
   * 사용자가 손으로 접거나 편 것(id → 폈나). 3초마다 다시 그리므로 이걸 기억하지 않으면
   * "도는 에이전트가 있으면 펼침" 규칙이 매 판 사용자의 선택을 덮어쓸 수 있다.
   * 기억은 이 창이 살아 있는 동안만 — 저장할 만큼 중요한 값이 아니다.
   */
  private userToggled = new Map<string, boolean>();
  noteExpansion(e: Item, expanded: boolean): void { this.userToggled.set(itemId(e), expanded); }

  readonly dropMimeTypes = [DND_MIME];
  readonly dragMimeTypes = [DND_MIME];

  getTreeItem(e: Item): vscode.TreeItem {
    // 사용자가 손으로 접은 것은 어떤 줄이든 그대로 둔다. 그룹 머리줄도 포함 — id 를 붙인
    // 뒤로는 매 판 Expanded 로 되돌려 놓는 셈이 되어서, 여기서 같이 막아야 한다.
    const id = itemId(e);
    const toggled = this.userToggled.get(id);
    if (e.kind === "ungroupedRoot") {
      const t = new vscode.TreeItem("미분류", foldState(true, toggled, true));
      t.id = id;
      t.contextValue = "ungroupedRoot";
      return t;
    }
    if (e.kind === "group") {
      const t = new vscode.TreeItem(e.name, foldState(true, toggled, true));
      t.id = id;
      t.contextValue = "group";
      t.iconPath = new vscode.ThemeIcon("folder");
      return t;
    }
    if (e.kind === "blockedRoot") return blockedRootItem(e.count, id, toggled);
    if (e.kind === "blockedSession") return blockedSessionItem(e.entry, id, toggled);
    if (e.kind === "subagent") return subagentItem(e.node, id, toggled);
    if (e.kind === "moreAgents") {
      const t = new vscode.TreeItem(`지난 기록 ${e.count}개`, vscode.TreeItemCollapsibleState.None);
      t.id = id;
      t.contextValue = "moreAgents";
      t.iconPath = new vscode.ThemeIcon("history", new vscode.ThemeColor("disabledForeground"));
      t.tooltip = "오래된 기록은 접어 뒀어요 (이름만 세고 파일은 열지 않습니다)";
      return t;
    }

    const sub = e.node.subagents;
    // 접었다 폈다: 서브에이전트가 없으면 화살표 자체를 없앤다(눌러도 빈 것이 안 나오게).
    // 도는 게 있으면 펼친 채로 시작 — 16개 세션을 매번 손으로 펼치지 않도록.
    const rows = sub ? sub.shown.length + (sub.hidden > 0 ? 1 : 0) : 0;
    // 화살표는 달 것이 있을 때만. 도는 게 있으면 펼친 채로 시작하고, 그 뒤로는 사용자 선택이 먼저.
    const t = new vscode.TreeItem(e.node.label, foldState(rows > 0, toggled, !!sub && sub.running > 0));
    // id 가 판마다 그대로여야 사용자가 편 것이 3초 새로고침에 도로 접히지 않는다.
    t.id = id;
    t.contextValue = "session";
    t.iconPath = statusIcon(e.node.state);
    const isOpen = vscode.window.terminals.some((term) => term.name === e.node.name);
    const parts: string[] = [];
    if (isOpen) parts.push("●"); // 터미널이 열려 있음(존재 기준)
    if (sub && sub.running > 0) {
      // 파일에서 센 것이 화면에서 읽은 것보다 정확하다(화면은 떠 있을 때만 읽힌다).
      parts.push(`●${sub.running}`);
    } else if (e.node.state === "agents" && e.node.agents?.length) {
      // 경과시간 자리를 대신 쓴다. 지금 알고 싶은 건 "몇 분 됐나"가 아니라 "뭐가 도나"라서.
      parts.push(`에이전트 ${e.node.agents.length}`);
    } else if (e.node.ts && e.node.state !== "inactive") { // 카드 뷰와 동일: 비활성엔 경과시간 숨김
      const mins = Math.max(0, Math.round((Date.now() / 1000 - e.node.ts) / 60));
      parts.push(`${mins}m`);
    }
    if (parts.length) t.description = parts.join(" ");
    const tip: string[] = [];
    if (e.node.label !== e.node.name) tip.push(e.node.name);
    if (sub && sub.running > 0) tip.push(`도는 서브에이전트 ${sub.running}개 (누르면 펼쳐집니다)`);
    else if (e.node.agents?.length) tip.push(`도는 중: ${e.node.agents.join(", ")}`);
    if (e.node.claude?.waitingFor) tip.push(`기다리는 것: ${e.node.claude.waitingFor}`);
    if (e.node.path) tip.push(`📁 ${e.node.path}`);
    if (tip.length) t.tooltip = tip.join("\n");
    t.command = { command: "sessionRadar.jump", title: "Jump", arguments: [e.node.name] };
    return t;
  }

  getChildren(e?: Item): Item[] {
    const data = getTreeData();
    if (!e) {
      const roots: Item[] = data.groups.map((g) => ({ kind: "group", id: g.id, name: g.name } as Item));
      roots.push({ kind: "ungroupedRoot" });
      // 몇 주씩 막혀 있던 세션들. tmux 세션이 없어 여태 어디에도 안 보이던 것이라 따로 세운다.
      if (data.blocked.length) roots.push({ kind: "blockedRoot", count: data.blocked.length });
      return roots;
    }
    if (e.kind === "group") {
      const g = data.groups.find((g) => g.id === e.id);
      return (g?.sessions ?? []).map((n) => ({ kind: "session", node: n, groupId: e.id } as Item));
    }
    if (e.kind === "ungroupedRoot") {
      return data.ungrouped.map((n) => ({ kind: "session", node: n, groupId: null } as Item));
    }
    if (e.kind === "blockedRoot") {
      return data.blocked.map((b) => ({ kind: "blockedSession", entry: b } as Item));
    }
    if (e.kind === "session") {
      // 펼칠 때 다시 찾는다 — 담아 둔 것보다 방금 읽은 쪽이 새것이다.
      const fresh = findSession(data, e.node.name) ?? e.node;
      return agentItems(fresh.subagents, sessionItemId(e.groupId, fresh.name));
    }
    if (e.kind === "blockedSession") {
      const fresh = data.blocked.find((b) => b.session.sessionId === e.entry.session.sessionId) ?? e.entry;
      return agentItems(fresh.subagents, `b:${fresh.session.sessionId}`);
    }
    if (e.kind === "subagent") {
      return e.node.children.map((c) => ({ kind: "subagent", node: c, ownerId: e.ownerId } as Item));
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
    // 서브에이전트·막힌 세션 줄 위에 떨어뜨린 것은 무시한다. 그냥 두면 "미분류로 보내기"로
    // 읽혀서 세션이 엉뚱한 데로 옮겨간다(새 줄이 생기며 같이 생긴 구멍).
    if (target && target.kind !== "group" && target.kind !== "session" && target.kind !== "ungroupedRoot") return;
    let targetGroupId: string | null = null;
    let beforeName: string | null = null;
    if (target?.kind === "group") { targetGroupId = target.id; } // drop on group header → end of that group
    else if (target?.kind === "session") { targetGroupId = target.groupId; beforeName = target.node.name; }
    moveSessionsTo(names, targetGroupId, beforeName);
    this.onChanged(); // refresh BOTH views (set to refreshAll by extension)
  }
}
