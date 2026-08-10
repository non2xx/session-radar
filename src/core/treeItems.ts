import { SessionNode, SubagentNode, BlockedEntry } from "./types";

// 나무에 놓이는 줄의 종류와 그 id. vscode 를 안 부르는 자리에 둔다 — id 가 판마다 그대로인지가
// 접힘 기억의 전부라서, 시험으로 붙잡아 둘 수 있어야 한다.

export type Item =
  | { kind: "group"; id: string; name: string }
  | { kind: "session"; node: SessionNode; groupId: string | null }
  | { kind: "ungroupedRoot" }
  | { kind: "blockedRoot"; count: number }
  | { kind: "blockedSession"; entry: BlockedEntry }
  | { kind: "subagent"; node: SubagentNode; ownerId: string }
  | { kind: "moreAgents"; count: number; ownerId: string };

/**
 * 그룹 id 를 세션 id 앞에 붙이는 이유: 손으로 고친 layout.json 에 같은 이름이 두 그룹에
 * 들어가도 두 줄이 서로 다른 id 를 갖게 하려는 것. VS Code 는 id 가 겹치면 화를 낸다.
 * (그룹을 옮기면 접힘이 처음으로 돌아가는데, 자리가 바뀐 것이라 그게 맞다.)
 */
export const sessionItemId = (groupId: string | null, name: string) => `s:${groupId ?? "-"}:${name}`;

/** 판이 바뀌어도 그대로인 id. 접힘 기억과 TreeItem.id 가 **같은 값**을 써야 한다. */
export function itemId(e: Item): string {
  switch (e.kind) {
    case "group": return `g:${e.id}`;
    case "ungroupedRoot": return "ungroupedRoot";
    case "blockedRoot": return "blockedRoot";
    case "blockedSession": return `b:${e.entry.session.sessionId}`;
    case "subagent": return `a:${e.ownerId}:${e.node.id}`;
    case "moreAgents": return `m:${e.ownerId}`;
    case "session": return sessionItemId(e.groupId, e.node.name);
  }
}
