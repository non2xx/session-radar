import { describe, it, expect } from "vitest";
import { Item, itemId, sessionItemId } from "../src/core/treeItems";
import { SessionNode, SubagentNode, BlockedEntry } from "../src/core/types";

const sessionNode = (name: string): SessionNode =>
  ({ name, label: name, state: "working", ts: 1 });
const agentNode = (id: string): SubagentNode =>
  ({ id, description: "d", agentType: "t", depth: 1, running: true, updatedAt: 1, children: [] });
const blocked = (sessionId: string): BlockedEntry => ({
  session: { sessionId, cwd: "/c", name: "n", kind: "background", startedAt: 1, activity: "blocked", blocked: true },
  ageMs: 1,
});

describe("itemId — 접힘 기억이 여기에 달려 있다", () => {
  const all: Item[] = [
    { kind: "group", id: "g1", name: "G" },
    { kind: "ungroupedRoot" },
    { kind: "blockedRoot", count: 4 },
    { kind: "blockedSession", entry: blocked("S9") },
    { kind: "session", node: sessionNode("chageun"), groupId: null },
    { kind: "session", node: sessionNode("chageun"), groupId: "g1" },
    { kind: "subagent", node: agentNode("a1"), ownerId: "s:-:chageun" },
    { kind: "moreAgents", count: 3, ownerId: "s:-:chageun" },
  ];

  it("모든 줄이 서로 다른 id 를 갖는다 (겹치면 VS Code 가 화를 낸다)", () => {
    const ids = all.map(itemId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("★ 같은 값이 두 번 나와도 그대로다 (3초마다 다시 그려도 접힘이 유지되는 근거)", () => {
    for (const e of all) expect(itemId(e)).toBe(itemId({ ...e } as Item));
  });

  it("★ 같은 이름이라도 그룹이 다르면 id 가 다르다", () => {
    expect(sessionItemId(null, "x")).not.toBe(sessionItemId("g1", "x"));
  });

  it("종류마다 앞머리가 달라 서로 안 부딪힌다", () => {
    expect(itemId({ kind: "session", node: sessionNode("x"), groupId: null })).toBe("s:-:x");
    expect(itemId({ kind: "blockedSession", entry: blocked("x") })).toBe("b:x");
    expect(itemId({ kind: "subagent", node: agentNode("x"), ownerId: "o" })).toBe("a:o:x");
    expect(itemId({ kind: "moreAgents", count: 1, ownerId: "o" })).toBe("m:o");
  });

  it("한 세션의 서브에이전트끼리도 안 부딪힌다", () => {
    const owner = sessionItemId(null, "chageun");
    const ids = ["a1", "a2", "a3"].map((i) => itemId({ kind: "subagent", node: agentNode(i), ownerId: owner }));
    expect(new Set(ids).size).toBe(3);
  });

  it("다른 세션의 같은 이름 에이전트도 안 부딪힌다", () => {
    const a = itemId({ kind: "subagent", node: agentNode("same"), ownerId: sessionItemId(null, "A") });
    const b = itemId({ kind: "subagent", node: agentNode("same"), ownerId: sessionItemId(null, "B") });
    expect(a).not.toBe(b);
  });
});
