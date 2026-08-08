import { existsSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { homedir } from "node:os";

export const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"];
const EXT_ALT = IMAGE_EXT.join("|");

/** 줄 안에서 이미지 경로처럼 보이는 구간. startIndex 는 터미널 링크를 그릴 때 그대로 쓴다. */
export interface ImageSpan {
  start: number;
  raw: string;
}

/** 파일이 실제로 있는지. 권한/IO 예외도 "없음"으로 본다. */
const isFile = (p: string): boolean => {
  try { return existsSync(p) && statSync(p).isFile(); } catch { return false; }
};

/**
 * 한 줄에서 이미지 경로 구간을 찾는다.
 *
 * 클로드가 찍는 줄은 이런 모양이다:
 *   `› [image] ~/.cache/.../shots/hover-1.png (206.2KB)`
 * 공백이 없는 덩어리만 본다(터미널 링크는 어차피 공백 든 경로를 못 다룬다).
 * 앞뒤에 붙은 장식 문자(`@("'<` 등)는 떼고 start 를 그만큼 밀어 준다.
 */
export function findImageSpans(line: string): ImageSpan[] {
  const re = new RegExp(`\\S+\\.(?:${EXT_ALT})\\b`, "gi");
  const out: ImageSpan[] = [];
  for (const m of line.matchAll(re)) {
    let raw = m[0];
    let start = m.index ?? 0;
    const lead = raw.match(/^[@(\[<'"`›»\-]+/);
    if (lead) { raw = raw.slice(lead[0].length); start += lead[0].length; }
    if (raw) out.push({ start, raw });
  }
  return out;
}

/**
 * 경로 하나를 실제 파일로 바꾼다. 못 찾으면 undefined.
 * `~/` 는 홈으로, 역슬래시만 쓰인 경로(`\home\a\b.png`)는 슬래시로 바꾼다.
 * 상대경로는 `roots`(열려 있는 작업 폴더) 기준으로 찾아본다.
 */
export function resolveImagePath(
  raw: string,
  roots: string[] = [],
  exists: (p: string) => boolean = isFile,
): string | undefined {
  let p = raw.trim().replace(/^[@(\[<'"`]+/, "").replace(/[)\]>,.;:'"`]+$/, "");
  if (!p) return undefined;
  if (p.includes("\\") && !p.includes("/")) p = p.replace(/\\/g, "/");
  if (!new RegExp(`\\.(?:${EXT_ALT})$`, "i").test(p)) return undefined;
  if (p.startsWith("~/")) p = join(homedir(), p.slice(2));

  const candidates = isAbsolute(p) ? [p] : roots.map((r) => join(r, p));
  for (const c of candidates) if (exists(c)) return c;
  return undefined;
}

/**
 * 붙여넣은 글 전체에서 실제로 존재하는 이미지 파일만 추려 낸다(중복 제거).
 * 따옴표로 감싼 경로는 공백이 들어 있어도 살린다.
 */
export function extractImagePaths(
  text: string,
  roots: string[] = [],
  exists: (p: string) => boolean = isFile,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const quoted = (text.match(/["'`]([^"'`\n]+)["'`]/g) ?? []).map((q) => q.slice(1, -1));
  const bare = text.split(/[\s,]+/);
  for (const raw of [...quoted, ...bare]) {
    const p = resolveImagePath(raw, roots, exists);
    if (!p || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}
