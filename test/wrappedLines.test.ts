import { describe, it, expect } from "vitest";
import { joinCandidates, resolveJoined, underlineRange } from "../src/core/wrappedLines";

// 폭 62 에서 실제로 찍힌 모양 (tmux capture-pane 으로 확인한 원문)
const screen = [
  "  아래 한 장만 Ctrl+클릭해 주세요.",
  "  ~/projects/note/기술제안_v4.pptx.imgs/",
  "  s01.png",
  "",
  "  그 상태로 두시고 답장 주세요.",
];
const FULL = "  ~/projects/note/기술제안_v4.pptx.imgs/s01.png";

describe("joinCandidates — 접힌 두 줄 다시 붙이기", () => {
  it("★ 아랫줄을 보고 있으면 윗줄과 붙여 완전한 경로가 된다", () => {
    const got = joinCandidates(screen, "  s01.png");
    expect(got.some((c) => c.side === "prev" && c.text === FULL)).toBe(true);
  });

  it("★ 윗줄을 보고 있으면 아랫줄과 붙여 완전한 경로가 된다", () => {
    const got = joinCandidates(screen, "  ~/projects/note/기술제안_v4.pptx.imgs/");
    expect(got.some((c) => c.side === "next" && c.text === FULL)).toBe(true);
  });

  it("이음매의 들여쓰기를 없앤다 (그냥 이으면 경로가 깨진다)", () => {
    const [c] = joinCandidates(["  /a/dir/", "      name.png"], "      name.png");
    expect(c.text).toBe("  /a/dir/name.png");
  });

  it("빈 줄과는 붙이지 않는다", () => {
    expect(joinCandidates(["", "  /a/b.png", ""], "  /a/b.png")).toEqual([]);
  });

  it("화면에 없는 줄이면 빈 결과", () => {
    expect(joinCandidates(screen, "  없는 줄")).toEqual([]);
  });

  it("공백뿐인 줄은 아예 안 본다", () => {
    expect(joinCandidates(screen, "   ")).toEqual([]);
  });

  it("같은 글자의 줄이 여러 번 나와도 개수를 제한한다", () => {
    const many = Array.from({ length: 40 }, () => ["  /a/dir/", "  x.png"]).flat();
    expect(joinCandidates(many, "  x.png").length).toBeLessThanOrEqual(8);
  });
});

describe("underlineRange — 밑줄을 어디에 그을지", () => {
  it("아랫줄이면 그 줄의 글자 전체", () => {
    const r = underlineRange("  s01.png", "prev");
    expect("  s01.png".slice(r.start, r.start + r.length)).toBe("s01.png");
  });

  it("윗줄이면 줄 끝의 낱말", () => {
    const line = "  경로: ~/projects/note/기술제안_v4.pptx.imgs/";
    const r = underlineRange(line, "next");
    expect(line.slice(r.start, r.start + r.length)).toBe("~/projects/note/기술제안_v4.pptx.imgs/");
  });

  it("뒤 공백이 있어도 밑줄이 글자에만 그어진다", () => {
    const line = "  /a/b.png    ";
    const r = underlineRange(line, "prev");
    expect(line.slice(r.start, r.start + r.length)).toBe("/a/b.png");
  });
});

describe("resolveJoined — 답이 갈리면 포기", () => {
  // 같은 폴더에서 사진을 줄줄이 열면 윗줄(폴더 줄)이 똑같은 모양으로 여러 번 나온다.
  const dup = [
    "  /a/imgs/", "  s01.png",
    "  /a/imgs/", "  s03.png",
  ];
  const resolve = (t: string) => {
    const m = t.replace(/\s+/g, "").match(/\/a\/imgs\/s0\d\.png/);
    return m ? m[0] : undefined;
  };

  it("★ 윗줄이 여러 번 나와 답이 갈리면 아무것도 안 한다 (엉뚱한 사진 방지)", () => {
    expect(resolveJoined(dup, "  /a/imgs/", resolve)).toBeUndefined();
  });

  it("아랫줄은 파일 이름이 달라 답이 하나로 모인다", () => {
    expect(resolveJoined(dup, "  s03.png", resolve)).toEqual({ file: "/a/imgs/s03.png", side: "prev" });
  });

  it("같은 아랫줄이 여러 번 나와도 답이 같으면 받는다", () => {
    const same = ["  /a/imgs/", "  s01.png", "  /a/imgs/", "  s01.png"];
    expect(resolveJoined(same, "  s01.png", resolve)?.file).toBe("/a/imgs/s01.png");
  });

  it("아무것도 안 맞으면 undefined", () => {
    expect(resolveJoined(dup, "  s01.png", () => undefined)).toBeUndefined();
  });
});
