import { describe, it, expect } from "vitest";
import { buildTree, visibleNames } from "../src/core/treeModel";
import { emptyLayout } from "../src/core/layoutStore";
import { agentRowMeta, buildAgentsIndex, emptyAgentsIndex } from "../src/core/subagents";
import { blockedSessions, parseClaudeAgents, pickSessionFor } from "../src/core/claudeAgents";
import { decorate, CARD_AGENT_ROWS } from "../src/core/cardModel";
import { StatusEntry, SubagentNode, SubagentSummary } from "../src/core/types";

const NOW = 1_786_373_000_000;

const agent = (over: Partial<SubagentNode> = {}): SubagentNode => ({
  id: "a1", description: "일감 하나", agentType: "general-purpose", depth: 1,
  running: true, updatedAt: NOW - 2000, children: [], ...over,
});
const summary = (over: Partial<SubagentSummary> = {}): SubagentSummary =>
  ({ running: 1, shown: [agent()], hidden: 0, total: 1, ...over });

const sessions = parseClaudeAgents(JSON.stringify([
  { pid: 1, cwd: "/p/honclwd", kind: "interactive", startedAt: NOW - 1000,
    sessionId: "S1", name: "chageun", status: "busy" },
  { id: "z", cwd: "/p/erp", kind: "background", startedAt: NOW - 49 * 24 * 3600_000,
    sessionId: "S2", name: "vp-erp", state: "blocked" },
]));

const index = (scan: (id: string) => SubagentSummary | undefined, names: string[]) =>
  buildAgentsIndex(sessions, names, {}, (s) => scan(s.sessionId), NOW, pickSessionFor, blockedSessions);

describe("visibleNames", () => {
  it("그룹 + 미분류 + tmux 에서 발견된 것, 숨긴 것은 뺀다", () => {
    const layout = emptyLayout();
    layout.groups.push({ id: "g1", name: "G", sessions: ["a"] });
    layout.ungroupedOrder.push("b");
    layout.hidden.push("c");
    expect(visibleNames(layout, ["b", "c", "d"])).toEqual(["a", "b", "d"]);
  });
});

describe("buildTree + 서브에이전트", () => {
  const statuses = new Map<string, StatusEntry>([["chageun", { state: "working", ts: 5 }]]);

  it("짝지어진 세션에 claude 줄과 서브에이전트가 붙는다", () => {
    const t = buildTree(emptyLayout(), statuses, ["chageun", "note"],
      index(() => summary(), ["chageun", "note"]));
    const chageun = t.ungrouped.find((s) => s.name === "chageun")!;
    expect(chageun.claude?.sessionId).toBe("S1");
    expect(chageun.subagents?.running).toBe(1);
    const note = t.ungrouped.find((s) => s.name === "note")!;
    expect(note.claude).toBeUndefined();
    expect(note.subagents).toBeUndefined(); // 짝 없는 세션은 예전 모양 그대로
  });

  it("★ 막힌 세션은 tmux 세션이 하나도 없어도 나온다", () => {
    const t = buildTree(emptyLayout(), new Map(), [], index(() => undefined, []));
    expect(t.ungrouped).toHaveLength(0);
    expect(t.blocked.map((b) => b.session.name)).toEqual(["vp-erp"]);
  });

  it("에이전트 정보를 안 넘기면 예전과 똑같다", () => {
    const t = buildTree(emptyLayout(), statuses, ["chageun"]);
    expect(t.ungrouped[0].claude).toBeUndefined();
    expect(t.ungrouped[0].subagents).toBeUndefined();
    expect(t.blocked).toEqual([]);
  });

  it("빈 index 여도 안 깨진다", () => {
    const t = buildTree(emptyLayout(), statuses, ["chageun"], emptyAgentsIndex());
    expect(t.ungrouped[0].name).toBe("chageun");
    expect(t.blocked).toEqual([]);
  });

  it("그룹 안 세션에도 붙는다", () => {
    const layout = emptyLayout();
    layout.groups.push({ id: "g1", name: "G", sessions: ["chageun"] });
    const t = buildTree(layout, statuses, [], index(() => summary(), ["chageun"]));
    expect(t.groups[0].sessions[0].subagents?.running).toBe(1);
  });
});

describe("카드 뷰 데이터(decorate)", () => {
  const tree = (sub?: SubagentSummary) =>
    buildTree(emptyLayout(), new Map(), ["chageun"], index(() => sub, ["chageun"]));

  it("도는 개수와 줄이 실려 나간다", () => {
    const d = decorate(tree(summary()), NOW);
    expect(d.ungrouped[0].running).toBe(1);
    expect(d.ungrouped[0].rows[0].label).toBe("일감 하나");
  });

  // 실측(2026-08-11 화면): 오른쪽 칸에 종류를 같이 쓰면 좁은 패널에서 **이름이 먼저 잘려**
  // `계획서…` · `P…` 만 남았다. 이름이 그 줄의 전부여야 한다 — 종류는 tooltip 몫.
  it("옆 칸에 종류를 쓰지 않는다(이름을 밀어내지 않게)", () => {
    const d = decorate(tree(summary()), NOW);
    expect(d.ungrouped[0].rows[0].meta).not.toContain("general-purpose");
    expect(d.ungrouped[0].rows[0].meta).toBe("방금");
    expect(d.ungrouped[0].rows[0].tip).toContain("general-purpose"); // 종류는 여기 남아 있다
  });

  // 🛑 위 검사는 **카드 뷰만** 지킨다. 정작 화면에서 이름이 잘린 건 나무 뷰인데
  // 그 파일(`src/ui/treeProvider.ts`)은 vscode 를 import 해서 시험이 못 닿는다 —
  // 거기에 종류를 도로 넣어도 전 검사가 초록이었다(리뷰 지적). 그래서 두 뷰가 함께 쓰는
  // `agentRowMeta` 를 직접 건다. 이걸 지키면 두 화면이 같이 지켜진다.
  it("★ 두 화면이 함께 쓰는 오른쪽 글자에는 종류가 없다", () => {
    const n = agent({ description: "일감 하나", agentType: "general-purpose" });
    const meta = agentRowMeta(n, NOW);
    expect(meta).toBe("방금");
    expect(meta).not.toContain("general-purpose");
    expect(meta).not.toContain(":"); // `chageun:pr-reviewer` 같은 종류도 못 들어온다
  });

  it("★ 긴 이름은 웹뷰로 넘어가기 전에 잘린다 (자르기 규칙이 한 곳에만 있게)", () => {
    const long = "Fable adversarial check on worktree decision";
    const d = decorate(tree(summary({ shown: [agent({ description: long })] })), NOW);
    expect(d.ungrouped[0].rows[0].label).toBe("Fable adversarial ch…");
    expect(d.ungrouped[0].rows[0].tip).toContain(long); // 전체는 툴팁에
  });

  it("끝난 것은 카드에 안 붙는다(카드는 '지금 도는 것'만)", () => {
    const d = decorate(tree(summary({
      running: 0, shown: [agent({ running: false })], total: 1,
    })), NOW);
    expect(d.ungrouped[0].running).toBe(0);
    expect(d.ungrouped[0].rows).toEqual([]);
  });

  it("줄이 많아도 카드 밑은 몇 줄에서 끊는다", () => {
    const many = Array.from({ length: 9 }, (_, i) => agent({ id: `a${i}` }));
    const d = decorate(tree(summary({ running: 9, shown: many, total: 9 })), NOW);
    expect(d.ungrouped[0].rows).toHaveLength(CARD_AGENT_ROWS);
    expect(d.ungrouped[0].running).toBe(9); // 숫자는 다 센 값
  });

  it("중첩된 것은 들여쓰기 단계를 갖고 넘어간다", () => {
    const nested = agent({ id: "p", description: "부모", children: [agent({ id: "c", description: "자식", depth: 2 })] });
    const d = decorate(tree(summary({ running: 2, shown: [nested], total: 2 })), NOW);
    expect(d.ungrouped[0].rows.map((r) => [r.label, r.level])).toEqual([["부모", 0], ["자식", 1]]);
  });

  it("막힌 세션은 방치 기간과 경로를 갖고 넘어간다", () => {
    const d = decorate(tree(undefined), NOW);
    expect(d.blocked).toHaveLength(1);
    expect(d.blocked[0].age).toBe("49일");
    expect(d.blocked[0].tip).toContain("/p/erp");
  });

  it("에이전트가 없는 세션은 빈 줄만 (예전 화면과 같다)", () => {
    const d = decorate(buildTree(emptyLayout(), new Map(), ["note"]), NOW);
    expect(d.ungrouped[0].running).toBe(0);
    expect(d.ungrouped[0].rows).toEqual([]);
    expect(d.blocked).toEqual([]);
  });
});
