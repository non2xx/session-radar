import { describe, it, expect } from "vitest";
import { parseClaudeAgents, pickSessionFor, blockedSessions } from "../src/core/claudeAgents";

// 이 기계에서 실제로 나온 출력 모양(2026-08-10). 이름·경로만 그대로 두고 줄 수만 줄였다.
const REAL = JSON.stringify([
  { id: "f627850e", cwd: "/home/mokgam/projects/VALVEPARK-ERP", kind: "background",
    startedAt: 1782193582958, sessionId: "f627850e-f6f9", name: "vp-erp", state: "blocked" },
  { pid: 10687, cwd: "/home/mokgam/projects/honclwd", kind: "interactive",
    startedAt: 1786260973721, sessionId: "3bd9f10e-5ab9", name: "chageun", status: "busy" },
  { pid: 291471, cwd: "/home/mokgam/projects/design-system", kind: "interactive",
    startedAt: 1786264204404, sessionId: "ce59bd2c", name: "design-system",
    status: "waiting", waitingFor: "input needed" },
]);

describe("parseClaudeAgents", () => {
  it("interactive 는 status, background 는 state — 둘 다 activity 로 읽는다", () => {
    const list = parseClaudeAgents(REAL);
    expect(list.map((s) => `${s.name}:${s.activity}`))
      .toEqual(["vp-erp:blocked", "chageun:busy", "design-system:waiting"]);
    expect(list[0].kind).toBe("background");
    expect(list[1].kind).toBe("interactive");
  });

  it("blocked 는 따로 표시된다", () => {
    const list = parseClaudeAgents(REAL);
    expect(list.map((s) => s.blocked)).toEqual([true, false, false]);
  });

  it("문서에 없던 status(waiting/waitingFor)도 버리지 않는다", () => {
    const s = parseClaudeAgents(REAL)[2];
    expect(s.activity).toBe("waiting");
    expect(s.waitingFor).toBe("input needed");
  });

  it("깨진 JSON·배열이 아닌 것 → 빈 목록 (화면은 예전 그대로)", () => {
    expect(parseClaudeAgents("")).toEqual([]);
    expect(parseClaudeAgents("not json")).toEqual([]);
    expect(parseClaudeAgents('{"a":1}')).toEqual([]);
  });

  it("sessionId 나 cwd 가 없는 줄만 건너뛴다 (나머지는 살린다)", () => {
    const list = parseClaudeAgents(JSON.stringify([
      { cwd: "/a", name: "no-id" },
      { sessionId: "s2", name: "no-cwd" },
      null, 7, "x",
      { sessionId: "s3", cwd: "/c", name: "ok", status: "idle" },
    ]));
    expect(list.map((s) => s.name)).toEqual(["ok"]);
  });

  it("이름이 없으면 경로 마지막 칸을 쓴다", () => {
    const list = parseClaudeAgents(JSON.stringify([{ sessionId: "s", cwd: "/home/u/my-app/" }]));
    expect(list[0].name).toBe("my-app");
  });

  it("startedAt 이 없거나 숫자가 아니면 null", () => {
    const list = parseClaudeAgents(JSON.stringify([
      { sessionId: "s", cwd: "/a", startedAt: "어제" },
      { sessionId: "t", cwd: "/b" },
    ]));
    expect(list.map((s) => s.startedAt)).toEqual([null, null]);
  });
});

describe("pickSessionFor — tmux 세션 한 개에 짝 지을 claude 세션", () => {
  const list = parseClaudeAgents(REAL);

  it("이름이 같은 interactive 를 고른다", () => {
    expect(pickSessionFor(list, "chageun")?.sessionId).toBe("3bd9f10e-5ab9");
  });

  it("★ 이름이 같아도 background(막힌) 줄은 붙이지 않는다", () => {
    // 실측: 이름 'vp-erp'가 tmux 세션에도 있고 7주 막힌 background 줄에도 있었다.
    // 붙여 버리면 멀쩡한 창이 남의 '막힘'을 뒤집어쓴다.
    expect(pickSessionFor(list, "vp-erp")).toBeUndefined();
  });

  it("이름이 안 맞으면 설정된 경로로 찾는다", () => {
    expect(pickSessionFor(list, "별명", "/home/mokgam/projects/honclwd")?.name).toBe("chageun");
  });

  it("이름이 맞는 게 있으면 경로는 보지 않는다", () => {
    expect(pickSessionFor(list, "chageun", "/전혀/다른/곳")?.name).toBe("chageun");
  });

  it("같은 이름이 여럿이면 가장 최근에 뜬 것", () => {
    const two = parseClaudeAgents(JSON.stringify([
      { sessionId: "old", cwd: "/a", kind: "interactive", name: "dup", startedAt: 1, status: "idle" },
      { sessionId: "new", cwd: "/a", kind: "interactive", name: "dup", startedAt: 2, status: "idle" },
    ]));
    expect(pickSessionFor(two, "dup")?.sessionId).toBe("new");
  });

  it("짝이 없으면 undefined", () => {
    expect(pickSessionFor(list, "없는세션")).toBeUndefined();
  });
});

describe("blockedSessions", () => {
  it("막힌 것만, 오래 방치된 것이 위로", () => {
    const list = parseClaudeAgents(JSON.stringify([
      { sessionId: "b", cwd: "/b", kind: "background", name: "새것", startedAt: 200, state: "blocked" },
      { sessionId: "a", cwd: "/a", kind: "background", name: "묵은것", startedAt: 100, state: "blocked" },
      { sessionId: "c", cwd: "/c", kind: "interactive", name: "멀쩡", startedAt: 300, status: "idle" },
    ]));
    expect(blockedSessions(list).map((s) => s.name)).toEqual(["묵은것", "새것"]);
  });
});
