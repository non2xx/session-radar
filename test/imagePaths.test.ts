import { describe, it, expect } from "vitest";
import { findImageSpans, resolveImagePath, extractImagePaths } from "../src/core/imagePaths";
import { homedir } from "node:os";
import { join } from "node:path";

// 존재 확인을 가짜로 바꿔 파일시스템 없이 시험한다.
const has = (...ok: string[]) => (p: string) => ok.includes(p);

describe("findImageSpans — 터미널 한 줄에서 이미지 구간 찾기", () => {
  it("클로드가 실제로 찍는 [image] 줄에서 경로만 집는다", () => {
    const line = "  › [image] ~/.cache/claude-tmp/shots/hover-1.png (206.2KB)";
    const spans = findImageSpans(line);
    expect(spans).toHaveLength(1);
    expect(spans[0].raw).toBe("~/.cache/claude-tmp/shots/hover-1.png");
    // start 가 정확해야 터미널에 밑줄이 제자리에 그려진다.
    expect(line.slice(spans[0].start, spans[0].start + spans[0].raw.length)).toBe(spans[0].raw);
  });

  it("한 줄에 여러 장이 있으면 다 집는다", () => {
    const spans = findImageSpans("/a/1.png 그리고 /b/2.jpeg 를 비교");
    expect(spans.map((s) => s.raw)).toEqual(["/a/1.png", "/b/2.jpeg"]);
  });

  it("앞에 붙은 괄호·꺾쇠·불릿을 떼고 start 를 민다", () => {
    const line = "(/home/a.png)";
    const [s] = findImageSpans(line);
    expect(s.raw).toBe("/home/a.png"); // 뒤 괄호는 정규식이 애초에 안 물고, 앞 괄호는 떼어낸다
    expect(line.slice(s.start, s.start + s.raw.length)).toBe(s.raw);
  });

  it("이미지가 아니면 안 잡는다", () => {
    expect(findImageSpans("readme.md 와 script.ts 를 봤습니다")).toEqual([]);
  });
});

describe("resolveImagePath — 실제 파일로 바꾸기", () => {
  it("물결(~)을 홈 폴더로 편다", () => {
    const real = join(homedir(), ".cache/shots/hover-1.png");
    expect(resolveImagePath("~/.cache/shots/hover-1.png", [], has(real))).toBe(real);
  });

  it("문장 끝에 붙은 괄호·마침표를 떼어낸다", () => {
    expect(resolveImagePath("/home/a.png).", [], has("/home/a.png"))).toBe("/home/a.png");
  });

  it("역슬래시로 복사된 경로도 받는다", () => {
    const t = "\\home\\mokgam\\projects\\.claude\\image_1786116924194.png";
    expect(resolveImagePath(t, [], has("/home/mokgam/projects/.claude/image_1786116924194.png")))
      .toBe("/home/mokgam/projects/.claude/image_1786116924194.png");
  });

  it("상대경로는 작업 폴더 기준으로 찾는다", () => {
    expect(resolveImagePath("decks/out.png", ["/home/mokgam/projects/note"], has("/home/mokgam/projects/note/decks/out.png")))
      .toBe("/home/mokgam/projects/note/decks/out.png");
  });

  it("없는 파일이면 undefined — VS Code 기본 동작에 넘긴다", () => {
    expect(resolveImagePath("/home/없음.png", [], has())).toBeUndefined();
  });

  it("이미지가 아니면 undefined", () => {
    expect(resolveImagePath("/home/a.md", [], has("/home/a.md"))).toBeUndefined();
  });
});

describe("extractImagePaths — 붙여넣은 글 전체에서", () => {
  it("여러 줄에서 모으고 중복은 한 번만", () => {
    const t = `› [image] /a/1.png (10KB)
› [image] /a/2.png (12KB)
› [image] /a/1.png (10KB)`;
    expect(extractImagePaths(t, [], has("/a/1.png", "/a/2.png"))).toEqual(["/a/1.png", "/a/2.png"]);
  });

  it("따옴표로 감싸면 공백 든 경로도 살린다", () => {
    expect(extractImagePaths('@"/home/사진 하나.png"', [], has("/home/사진 하나.png")))
      .toEqual(["/home/사진 하나.png"]);
  });

  it("없는 파일과 이미지 아닌 것은 뺀다", () => {
    const t = "/a/1.png /a/readme.md /a/없음.png";
    expect(extractImagePaths(t, [], has("/a/1.png"))).toEqual(["/a/1.png"]);
  });

  it("찾은 게 없으면 빈 배열", () => {
    expect(extractImagePaths("아무 이미지도 없는 글", [], has())).toEqual([]);
  });
});
