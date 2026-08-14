import { describe, it, expect, vi } from "vitest";
import { readScreen, refineWithScreen } from "../src/core/paneScreen";
import { StatusEntry } from "../src/core/types";

// Fixtures below are shaped after screens captured off live panes with
// `tmux capture-pane -p`; project and file names are replaced with placeholders.
const BOX = (name: string) => [
  "─".repeat(60) + ` ${name} ` + "──",
  "❯ ",
  "─".repeat(64),
  "  5h: 8% (4h 35m left) | 7d: 15% (4d 18h left) | ctx 209k (21%)                /rc",
];
const PERMS = "  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← 3 agents";
const TRANSCRIPT = [
  "● 파일을 먼저 읽겠습니다.",
  "",
  "● Running 1 shell command · 1m 18s…",
  "  ⎿  $ npm run build 2>&1 | tail -3; sleep 10; echo done",
  "     (ctrl+b ctrl+b (twice) to run in background)",
  "",
];
const TRAY = ["", "  ● main", "  ◯ general-purpose         Reading a file", "  ◯ 프로젝트A:plan-validator  Checking the plan"];

const screen = (opts: { spinner?: string; tray?: boolean }) => [
  ...TRANSCRIPT,
  ...(opts.spinner ? [opts.spinner, ""] : []),
  ...BOX("프로젝트A"),
  PERMS,
  ...(opts.tray ? TRAY : []),
];

describe("readScreen — 메인이 답하는 중인지, 뒤에서 에이전트만 도는지", () => {
  it("메인이 생각 중이면 mainBusy", () => {
    const r = readScreen(screen({ spinner: "✻ Combobulating… (4m 2s · ↓ 14.2k tokens)" }));
    expect(r.mainBusy).toBe(true);
    expect(r.agents).toEqual([]);
  });

  it("메인은 비었고 에이전트 트레이만 있으면 에이전트 목록을 준다", () => {
    const r = readScreen(screen({ tray: true }));
    expect(r.mainBusy).toBe(false);
    expect(r.agents).toEqual(["general-purpose", "프로젝트A:plan-validator"]);
  });

  it("둘 다 있으면 메인이 우선(작업중)", () => {
    const r = readScreen(screen({ spinner: "✽ Perusing… (47s · ↓ 2.7k tokens)", tray: true }));
    expect(r.mainBusy).toBe(true);
    expect(r.agents).toEqual(["general-purpose", "프로젝트A:plan-validator"]);
  });

  it("아무 표시도 없으면 둘 다 아님", () => {
    const r = readScreen(screen({}));
    expect(r).toEqual({ mainBusy: false, agents: [] });
  });

  // 실제로 관측된 글자 모양들 — 회전 글리프가 매 프레임 바뀌고, 낱말도 매번 다르며,
  // 아스키가 아닌 낱말(Flambéing)도 나온다. 셋 다 고정으로 못 박으면 안 된다.
  it.each([
    "· Flambéing… (1m 48s · ↓ 5.6k tokens · still thinking with xhigh effort)",
    "✻ Combobulating… (4m 2s · ↓ 14.2k tokens)",
    "✶ Undulating… (1h 4m 54s · ↓ 102.0k tokens)",
    "✽ Flibbertigibbeting… (28s · ↓ 861 tokens)",
    "✢ Perusing… (1m 36s · ↓ 2.7k tokens)",
    "* Warping… (6m 29s · ↓ 13.2k tokens)",
    "✻ Perusing… (5s · thinking with xhigh effort)",
  ])("실제 관측된 작업중 줄을 잡는다: %s", (line) => {
    expect(readScreen(screen({ spinner: line })).mainBusy).toBe(true);
  });

  // 대화 기록에 남아 있는(=끝난) 줄들. 이걸 작업중으로 읽으면 영영 초록이 된다.
  it.each([
    "● Running 1 shell command · 1m 18s…",
    "  ⎿  $ npm run build 2>&1 | tail -3; (npm run dev > /tmp/x.log 2>&1 &) ;",
    "     stash pop (6s)",
    "     (ctrl+b ctrl+b (twice) to run in background)",
    "  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← 3 agents",
    "  ⎿  Tip: Use /clear to start fresh when switching topics and free up context",
    "● Task(Fix the busy detection)",
    "● Bash(git stash pop…)",
  ])("끝난 기록 줄에는 속지 않는다: %s", (line) => {
    expect(readScreen([...TRANSCRIPT, line, ...BOX("프로젝트A"), PERMS]).mainBusy).toBe(false);
  });

  it("화면 위쪽(꼬리 밖)에 남은 작업중 줄은 무시한다", () => {
    const stale = "✻ Combobulating… (4m 2s · ↓ 14.2k tokens)";
    const far = [stale, ...Array(40).fill("● 지난 대화"), ...BOX("프로젝트A"), PERMS];
    expect(readScreen(far).mainBusy).toBe(false);
  });

  it("'● main' 줄이 없으면 트레이로 보지 않는다 (기록의 ● 줄 오인 방지)", () => {
    const r = readScreen([...TRANSCRIPT, ...BOX("프로젝트A"), PERMS, "", "● 다 됐습니다"]);
    expect(r.agents).toEqual([]);
  });

  it("화면 끝의 빈 줄이 트레이를 가리지 않는다", () => {
    const r = readScreen([...screen({ tray: true }), "", "", ""]);
    expect(r.agents).toHaveLength(2);
  });
});

describe("refineWithScreen — 제목만 보던 판정을 화면으로 나눈다", () => {
  const base = (state: StatusEntry["state"]) => new Map([["s", { state, ts: 100 }]]);

  it("작업중 + 에이전트만 → agents (이름을 함께)", () => {
    const out = refineWithScreen(base("working"), () => screen({ tray: true }));
    expect(out.get("s")).toEqual({
      state: "agents",
      ts: 100,
      agents: ["general-purpose", "프로젝트A:plan-validator"],
    });
  });

  it("작업중 + 메인도 답하는 중 → working 유지", () => {
    const out = refineWithScreen(base("working"), () => screen({ spinner: "✽ Perusing… (47s · ↓ 2.7k tokens)", tray: true }));
    expect(out.get("s")?.state).toBe("working");
  });

  it("화면을 못 읽으면(시간예산 소진·빈 결과) working 그대로 — 예전 동작", () => {
    const out = refineWithScreen(base("working"), () => []);
    expect(out.get("s")?.state).toBe("working");
    expect(out.get("s")?.agents).toBeUndefined();
  });

  it("작업중이 아닌 세션은 화면을 아예 읽지 않는다 (창마다 프로세스 하나라서)", () => {
    const capture = vi.fn(() => screen({ tray: true }));
    const states = new Map<string, StatusEntry>([
      ["a", { state: "turn", ts: 1 }],
      ["b", { state: "inactive", ts: 2 }],
      ["c", { state: "working", ts: 3 }],
    ]);
    const out = refineWithScreen(states, capture);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith("c");
    expect(out.get("a")?.state).toBe("turn");
    expect(out.get("b")?.state).toBe("inactive");
    expect(out.get("c")?.state).toBe("agents");
  });

  // 2026-08-10 실제 화면(세션 이름만 공개용 예시로 바꿨다). 트레이 아래에 열린 산출물 줄(⧉)이 하나 더 있어서
  // 맨 밑에서 위로 훑던 옛 코드가 트레이에 닿기도 전에 멈췄다 — 그래서 계속 초록이었다.
  it("트레이 아래에 다른 줄이 있어도 읽는다 (실측 화면)", () => {
    const real = [
      "─────────────────────────────── alpha ──",
      "❯ 그렇게 진행해줘",
      "────────────────────────────────────────",
      "  5h: 27% (1h 55m left) | 7d: 19%      /rc",
      "  ⏵⏵ bypass permissions on · 1 shell · ← 3 agents",
      "",
      "  ● main",
      "  ◯ general-purpose  Grepping transcripts   4m 41s · ↓ 115.1k tokens",
      "  ⧉  branch-explainer",
    ];
    expect(readScreen(real)).toEqual({ mainBusy: false, agents: ["general-purpose"] });
    expect(refineWithScreen(base("working"), () => real).get("s")?.state).toBe("agents");
  });

  it("트레이가 화면에서 너무 멀면 안 읽는다 (기록글의 ● 를 에이전트로 착각 방지)", () => {
    const far = ["● main", "◯ general-purpose", "a", "b", "c", "d", "e", "f", "g"];
    expect(readScreen(far).agents).toEqual([]);
  });
});
