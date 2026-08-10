import { describe, it, expect } from "vitest";
import {
  RUNNING_MS, agentLabel, agentTooltip, buildAgentsIndex, encodeProjectDir, flattenAgents,
  formatAge, scanSubagents, subagentsDir, truncate, SubagentFs,
} from "../src/core/subagents";
import { blockedSessions, parseClaudeAgents, pickSessionFor } from "../src/core/claudeAgents";
import { ClaudeSession, SubagentSummary } from "../src/core/types";

const NOW = 1_786_373_000_000;

// 가짜 폴더. 파일 이름 → 수정 시각, 그리고 .meta.json 내용.
// 실제 파일을 안 만들므로 168MB 짜리 .jsonl 을 열 위험 자체가 테스트에도 없다.
function fakeFs(files: Record<string, number>, metas: Record<string, any> = {}): SubagentFs & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    list(dir) {
      const p = dir + "/";
      return Object.keys(files).filter((f) => f.startsWith(p)).map((f) => f.slice(p.length));
    },
    mtime(path) {
      return path in files ? files[path] : null;
    },
    readJson(path) {
      reads.push(path);
      return metas[path] ?? null;
    },
  };
}

describe("encodeProjectDir / subagentsDir", () => {
  it("★ 실측 규칙: 영문·숫자가 아닌 글자는 전부 -", () => {
    expect(encodeProjectDir("/home/mokgam/projects/honclwd")).toBe("-home-mokgam-projects-honclwd");
    expect(encodeProjectDir("/home/mokgam/projects/VALVEPARK-ERP"))
      .toBe("-home-mokgam-projects-VALVEPARK-ERP");
    expect(encodeProjectDir("/home/mokgam/projects")).toBe("-home-mokgam-projects");
  });
  it("점·밑줄도 - 로 바뀐다 (실측: .cache → --cache)", () => {
    expect(encodeProjectDir("/home/mokgam/.cache/claude-tmp"))
      .toBe("-home-mokgam--cache-claude-tmp");
    expect(encodeProjectDir("/a/b.c_d")).toBe("-a-b-c-d");
  });
  // 한글 경로를 쓰는 프로젝트가 이 기계에 없어 실측을 못 했다. 규칙에서 따라 나오는 값만 적는다.
  it("한글은 한 글자당 - 하나", () => {
    expect(encodeProjectDir("/내 폴더")).toBe("-----");
  });
  it("세션 폴더 경로", () => {
    expect(subagentsDir("/h/.claude", "/home/u/app", "SID"))
      .toBe("/h/.claude/projects/-home-u-app/SID/subagents");
  });
});

describe("scanSubagents", () => {
  const dir = "/c/projects/-p/SID/subagents";
  const f = (id: string) => `${dir}/agent-${id}.jsonl`;
  const m = (id: string) => `${dir}/agent-${id}.meta.json`;

  it("최근에 갱신된 .jsonl 은 '도는 중'", () => {
    const fs = fakeFs({ [f("a1")]: NOW - 2000, [f("a2")]: NOW - 10 * 60_000 },
      { [m("a1")]: { agentType: "general-purpose", description: "일 하나", spawnDepth: 1 },
        [m("a2")]: { agentType: "chageun:pr-reviewer", description: "다 본 것", spawnDepth: 1 } });
    const s = scanSubagents(dir, fs, NOW)!;
    expect(s.running).toBe(1);
    expect(s.total).toBe(2);
    expect(s.shown.map((n) => [n.description, n.running]))
      .toEqual([["일 하나", true], ["다 본 것", false]]);
  });

  it("★ .jsonl 은 절대 열지 않는다 — 읽는 건 .meta.json 뿐", () => {
    const fs = fakeFs({ [f("a1")]: NOW }, { [m("a1")]: { description: "x" } });
    scanSubagents(dir, fs, NOW);
    expect(fs.reads.every((p) => p.endsWith(".meta.json"))).toBe(true);
  });

  it("★ 오래된 것은 세기만 하고 .meta.json 도 안 읽는다", () => {
    const files: Record<string, number> = {};
    for (let i = 0; i < 50; i++) files[f(`old${i}`)] = NOW - 40 * 24 * 3600_000;
    files[f("live")] = NOW - 1000;
    const fs = fakeFs(files, { [m("live")]: { description: "지금 것" } });
    const s = scanSubagents(dir, fs, NOW)!;
    expect(s.total).toBe(51);
    expect(s.running).toBe(1);
    expect(s.hidden).toBe(50);
    expect(s.shown).toHaveLength(1);
    expect(fs.reads).toEqual([m("live")]); // 50개는 손도 안 댔다
  });

  it("끝난 지 얼마 안 된 것은 몇 줄만 펼치고 나머지는 접는다", () => {
    const files: Record<string, number> = {};
    for (let i = 0; i < 9; i++) files[f(`r${i}`)] = NOW - (10 + i) * 60_000;
    const s = scanSubagents(dir, fakeFs(files), NOW)!;
    expect(s.running).toBe(0);
    expect(s.shown).toHaveLength(5); // MAX_HISTORY_ROWS
    expect(s.hidden).toBe(4);
  });

  it("새것이 위로 온다", () => {
    const files = { [f("old")]: NOW - 5000, [f("new")]: NOW - 100 };
    const s = scanSubagents(dir, fakeFs(files), NOW)!;
    expect(s.shown.map((n) => n.id)).toEqual(["new", "old"]);
  });

  it("★ parentAgentId 로 한 단계 더 들여쓴다 (spawnDepth 2 가 실제로 있다)", () => {
    const fs = fakeFs(
      { [f("parent")]: NOW - 1000, [f("child")]: NOW - 500 },
      { [m("parent")]: { description: "부모", spawnDepth: 1 },
        [m("child")]: { description: "자식", spawnDepth: 2, parentAgentId: "parent" } });
    const s = scanSubagents(dir, fs, NOW)!;
    expect(s.shown).toHaveLength(1);
    expect(s.shown[0].description).toBe("부모");
    expect(s.shown[0].children.map((c) => c.description)).toEqual(["자식"]);
    expect(s.shown[0].children[0].depth).toBe(2);
  });

  it("부모가 접혀서 안 뽑혔으면 자식을 맨 위에 둔다 (안 보이는 것보단 낫다)", () => {
    const fs = fakeFs(
      { [f("child")]: NOW - 500 },
      { [m("child")]: { description: "혼자 남은 자식", spawnDepth: 2, parentAgentId: "없는부모" } });
    const s = scanSubagents(dir, fs, NOW)!;
    expect(s.shown.map((n) => n.description)).toEqual(["혼자 남은 자식"]);
  });

  it("부모-자식이 서로를 가리켜도 무한히 들어가지 않는다", () => {
    const fs = fakeFs(
      { [f("a")]: NOW - 100, [f("b")]: NOW - 200 },
      { [m("a")]: { description: "A", parentAgentId: "b" },
        [m("b")]: { description: "B", parentAgentId: "a" } });
    const s = scanSubagents(dir, fs, NOW)!;
    expect(flattenAgents(s.shown)).toHaveLength(2);
  });

  it(".meta.json 이 없어도 줄은 남는다 (실측 7건)", () => {
    const s = scanSubagents(dir, fakeFs({ [f("bare")]: NOW - 100 }), NOW)!;
    expect(s.shown[0].description).toBe("");
    expect(s.shown[0].agentType).toBe("");
    expect(agentLabel(s.shown[0])).toBe("이름 없음");
  });

  it("spawnDepth 가 없으면 1", () => {
    const fs = fakeFs({ [f("x")]: NOW }, { [m("x")]: { description: "d", agentType: "t" } });
    expect(scanSubagents(dir, fs, NOW)!.shown[0].depth).toBe(1);
  });

  it("agent-*.jsonl 이 아닌 것은 세지 않는다", () => {
    const fs = fakeFs({
      [`${dir}/agent-a.meta.json`]: NOW, [`${dir}/notes.txt`]: NOW, [`${dir}/agent-a.jsonl`]: NOW,
    });
    expect(scanSubagents(dir, fs, NOW)!.total).toBe(1);
  });

  it("기록이 없으면 undefined (세션 줄에 아무것도 안 붙는다)", () => {
    expect(scanSubagents(dir, fakeFs({}), NOW)).toBeUndefined();
  });

  it("시계가 어긋나 미래 시각이 찍혀도 '도는 중'으로 본다", () => {
    const s = scanSubagents(dir, fakeFs({ [f("x")]: NOW + 60_000 }), NOW)!;
    expect(s.running).toBe(1);
  });

  it("경계: 딱 RUNNING_MS 는 도는 중, 1ms 더 지나면 아니다", () => {
    expect(scanSubagents(dir, fakeFs({ [f("x")]: NOW - RUNNING_MS }), NOW)!.running).toBe(1);
    expect(scanSubagents(dir, fakeFs({ [f("x")]: NOW - RUNNING_MS - 1 }), NOW)!.running).toBe(0);
  });
});

describe("화면에 뿌릴 글자", () => {
  it("★ 긴 이름은 잘리고 … 가 붙는다 (실측 최대 44글자)", () => {
    expect(truncate("Fable adversarial check on worktree decision"))
      .toBe("Fable adversarial ch…");
    expect([...truncate("Fable adversarial check on worktree decision")]).toHaveLength(21);
  });
  it("짧으면 그대로", () => {
    expect(truncate("계획 검수")).toBe("계획 검수");
  });
  it("★ 글자 수는 코드 단위가 아니라 실제 글자로 센다 (이모지가 반 토막 나면 안 된다)", () => {
    const s = "👩‍🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀";
    const cut = truncate(s, 5);
    expect(cut.endsWith("…")).toBe(true);
    expect([...cut].join("")).toBe(cut);          // 되짚어도 같은 글자 (깨짐 없음)
    expect(cut.includes("�")).toBe(false);
  });
  it("한글 20자는 안 자르고 21자는 자른다", () => {
    expect(truncate("가".repeat(20))).toBe("가".repeat(20));
    expect(truncate("가".repeat(21))).toBe("가".repeat(20) + "…");
  });
  it("이름 → 종류 → '이름 없음' 순서. 빈 줄은 안 만든다", () => {
    expect(agentLabel({ description: "일감", agentType: "t" })).toBe("일감");
    expect(agentLabel({ description: "", agentType: "general-purpose" })).toBe("general-purpose");
    expect(agentLabel({ description: "", agentType: "" })).toBe("이름 없음");
  });
  it("툴팁에는 자르기 전 전체 이름이 그대로 들어간다", () => {
    const long = "Fable adversarial check on worktree decision";
    const tip = agentTooltip({
      id: "x", description: long, agentType: "general-purpose", depth: 2,
      running: true, updatedAt: NOW - 5000, children: [],
    }, NOW);
    expect(tip).toContain(long);
    expect(tip).toContain("general-purpose");
    expect(tip).toContain("도는 중");
    expect(tip).toContain("깊이 2");
  });
  it("경과 시간은 생활어로", () => {
    expect(formatAge(3000)).toBe("방금");
    expect(formatAge(5 * 60_000)).toBe("5분");
    expect(formatAge(3 * 3600_000)).toBe("3시간");
    expect(formatAge(49 * 24 * 3600_000)).toBe("49일");
    expect(formatAge(-5)).toBe("방금");
  });
});

describe("flattenAgents", () => {
  it("중첩을 화면 순서대로 펴고 단계를 붙인다", () => {
    const leaf = (id: string, children: any[] = []) => ({
      id, description: id, agentType: "t", depth: 1, running: true, updatedAt: NOW, children,
    });
    const rows = flattenAgents([leaf("a", [leaf("a1"), leaf("a2")]), leaf("b")] as any);
    expect(rows.map((r) => [r.node.id, r.level])).toEqual([["a", 0], ["a1", 1], ["a2", 1], ["b", 0]]);
  });
});

describe("buildAgentsIndex", () => {
  const raw = JSON.stringify([
    { pid: 1, cwd: "/p/honclwd", kind: "interactive", startedAt: NOW - 1000,
      sessionId: "S1", name: "chageun", status: "busy" },
    { id: "z", cwd: "/p/erp", kind: "background", startedAt: NOW - 49 * 24 * 3600_000,
      sessionId: "S2", name: "vp-erp", state: "blocked" },
  ]);
  const sessions = parseClaudeAgents(raw);
  const summary = (running: number): SubagentSummary =>
    ({ running, shown: [], hidden: 0, total: running });
  const scan = (s: ClaudeSession) => summary(s.sessionId === "S1" ? 3 : 1);
  const build = (names: string[], paths: Record<string, string> = {}) =>
    buildAgentsIndex(sessions, names, paths, scan, NOW, pickSessionFor, blockedSessions);

  it("이름이 맞는 세션에 붙는다", () => {
    const idx = build(["chageun", "note"]);
    expect(idx.bySession.get("chageun")?.subagents?.running).toBe(3);
    expect(idx.bySession.has("note")).toBe(false); // 짝 없는 세션은 예전 그대로
  });

  it("★ 막힌 세션은 tmux 이름과 상관없이 따로 모인다", () => {
    const idx = build(["chageun"]); // tmux 목록에 vp-erp 가 아예 없다
    expect(idx.blocked).toHaveLength(1);
    expect(idx.blocked[0].session.name).toBe("vp-erp");
    expect(idx.blocked[0].subagents?.running).toBe(1);
  });

  it("막힌 기간을 잰다", () => {
    expect(formatAge(build([]).blocked[0].ageMs)).toBe("49일");
  });

  it("막힌 세션이 tmux 이름과 같아도 그 세션 줄을 물들이지 않는다", () => {
    const idx = build(["vp-erp"]);
    expect(idx.bySession.has("vp-erp")).toBe(false);
    expect(idx.blocked).toHaveLength(1);
  });

  it("경로로도 짝을 짓는다", () => {
    const idx = build(["별명"], { "별명": "/p/honclwd" });
    expect(idx.bySession.get("별명")?.claude?.sessionId).toBe("S1");
  });
});
