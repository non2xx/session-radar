import { describe, it, expect } from "vitest";
import { findImageSpans, findTruncatedSpan, resolveImagePath, extractImagePaths } from "../src/core/imagePaths";
import type { FileProbe } from "../src/core/imagePaths";
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
    const t = "\\home\\user\\pics\\image_1786116924194.png";
    expect(resolveImagePath(t, [], has("/home/user/pics/image_1786116924194.png")))
      .toBe("/home/user/pics/image_1786116924194.png");
  });

  it("상대경로는 작업 폴더 기준으로 찾는다", () => {
    expect(resolveImagePath("decks/out.png", ["/home/user/proj"], has("/home/user/proj/decks/out.png")))
      .toBe("/home/user/proj/decks/out.png");
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

describe("상한 — 느린 마운트에서 창이 멎지 않게", () => {
  it("아주 긴 한 줄은 통째로 건너뛴다", () => {
    const long = "/a/x.png ".repeat(1000); // 9000자
    expect(long.length).toBeGreaterThan(4000);
    expect(findImageSpans(long)).toEqual([]);
  });

  it("한 줄에서 검사하는 후보는 20개까지", () => {
    const many = Array.from({ length: 50 }, (_, i) => `/a/${i}.png`).join(" ");
    expect(many.length).toBeLessThan(4000);
    expect(findImageSpans(many)).toHaveLength(20);
  });
});

// 가짜 파일 시스템. 키는 전체 경로, 값이 배열이면 폴더·null 이면 파일.
function probeOf(tree: Record<string, string[] | null>): FileProbe {
  return {
    isFile: (p) => p in tree && tree[p] === null,
    isDir: (p) => Array.isArray(tree[p]),
    // 진짜 probe 와 같은 계약: 접두사로 거르고 두 개까지만 (개수 판정이 잘림에 안 흔들리게)
    list: (d, prefix) => ((tree[d] as string[] | undefined) ?? []).filter((n) => n.startsWith(prefix)).slice(0, 2),
  };
}

describe("findTruncatedSpan — 줄바꿈으로 잘린 경로 되살리기", () => {
  const tree: Record<string, string[] | null> = {
    "/home/u/shots": ["very_long_folder_name_here"],
    "/home/u/shots/very_long_folder_name_here": ["wrapped_image_three.png"],
    "/home/u/shots/very_long_folder_name_here/wrapped_image_three.png": null,
  };
  const probe = probeOf(tree);

  it("★ 파일 이름 도중에 잘려도 딱 하나면 찾아낸다", () => {
    const line = "  /home/u/shots/very_long_folder_name_here/wrapped_ima";
    const r = findTruncatedSpan(line, probe);
    expect(r?.file).toBe("/home/u/shots/very_long_folder_name_here/wrapped_image_three.png");
    expect(line.slice(r!.start, r!.start + r!.raw.length)).toBe(r!.raw);
  });

  it("★ 폴더 이름 도중에 잘려도 한 칸씩 내려가 찾아낸다", () => {
    const r = findTruncatedSpan("/home/u/shots/very_long_folder_na", probe);
    expect(r?.file).toBe("/home/u/shots/very_long_folder_name_here/wrapped_image_three.png");
  });

  it("후보가 여럿이면 손대지 않는다 (엉뚱한 파일을 여느니 안 여는 게 낫다)", () => {
    const many = probeOf({
      "/home/u/shots": ["a1.png", "a2.png"],
      "/home/u/shots/a1.png": null,
      "/home/u/shots/a2.png": null,
    });
    expect(findTruncatedSpan("/home/u/shots/a", many)).toBeUndefined();
  });

  it("찾아낸 게 이미지가 아니면 안 연다", () => {
    const txt = probeOf({ "/home/u/shots": ["notes_long_name.txt"], "/home/u/shots/notes_long_name.txt": null });
    expect(findTruncatedSpan("/home/u/shots/notes_long", txt)).toBeUndefined();
  });

  it("확장자까지 멀쩡한 경로는 여기서 처리하지 않는다 (평소 경로 처리에 맡김)", () => {
    expect(findTruncatedSpan("/home/u/shots/very_long_folder_name_here/wrapped_image_three.png", probe)).toBeUndefined();
  });

  it("줄 끝이 아니면 잘린 게 아니다", () => {
    expect(findTruncatedSpan("/home/u/shots/very_long_folder_na 뒤에 글자가 더 있음", probe)).toBeUndefined();
  });

  it("너무 짧은 조각은 무시한다", () => {
    expect(findTruncatedSpan("/home/u/s", probe)).toBeUndefined();
  });

  it("★ 상대경로를 절대경로로 오해하지 않는다", () => {
    // 루트가 진짜로 있는 트리. 예전 정규식은 낱말 안의 첫 슬래시부터 잡아서
    // `artifacts/tmp/preview_ab` 를 `/tmp/preview_ab` 로 읽고 엉뚱한 파일을 열었다.
    const withRoot = probeOf({
      "/": ["tmp"],
      "/tmp": ["preview_abcdef.png"],
      "/tmp/preview_abcdef.png": null,
    });
    expect(findTruncatedSpan("/tmp/preview_ab", withRoot)?.file).toBe("/tmp/preview_abcdef.png");
    expect(findTruncatedSpan("artifacts/tmp/preview_ab", withRoot)).toBeUndefined();
  });

  it("★ 폴더 이름 중간에 잘렸는데 그 폴더에 파일이 여럿이면 포기한다", () => {
    const busy = probeOf({
      "/home/u/shots": ["very_long_folder_name_here"],
      "/home/u/shots/very_long_folder_name_here": ["a.png", "b.png"],
      "/home/u/shots/very_long_folder_name_here/a.png": null,
      "/home/u/shots/very_long_folder_name_here/b.png": null,
    });
    expect(findTruncatedSpan("/home/u/shots/very_long_folder_na", busy)).toBeUndefined();
  });

  it("없는 폴더면 조용히 포기한다", () => {
    expect(findTruncatedSpan("/nope/nothing_here_at_all", probe)).toBeUndefined();
  });
});
