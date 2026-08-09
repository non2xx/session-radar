import { existsSync, statSync, readdirSync } from "node:fs";
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
export const MAX_LINE = 4000;  // 아주 긴 한 줄(빌드 로그 등)에서 시간을 쓰지 않게
export const MAX_SPANS = 20;   // 이미지가 잔뜩 든 폴더를 ls 한 줄에서 파일조회가 폭주하지 않게

export function findImageSpans(line: string): ImageSpan[] {
  if (line.length > MAX_LINE) return [];
  const re = new RegExp(`\\S+\\.(?:${EXT_ALT})\\b`, "gi");
  const out: ImageSpan[] = [];
  for (const m of line.matchAll(re)) {
    if (out.length >= MAX_SPANS) break;
    let raw = m[0];
    let start = m.index ?? 0;
    const lead = raw.match(/^[@(\[<'"`›»\-]+/);
    if (lead) { raw = raw.slice(lead[0].length); start += lead[0].length; }
    if (raw) out.push({ start, raw });
  }
  return out;
}

/** 파일 조회를 시험에서 갈아 끼우기 위한 최소 창구. */
export interface FileProbe {
  isFile(p: string): boolean;
  isDir(p: string): boolean;
  list(dir: string): string[];
}

const realProbe: FileProbe = {
  isFile,
  isDir: (p) => { try { return statSync(p).isDirectory(); } catch { return false; } },
  list: (d) => { try { return readdirSync(d).slice(0, MAX_DIR_ENTRIES); } catch { return []; } },
};

export const MIN_TRUNCATED = 12;   // 이보다 짧은 조각은 우연히 걸리기 쉬워 손대지 않는다
export const MAX_DESCEND = 4;      // 폴더를 따라 내려가는 깊이 한도
export const MAX_DIR_ENTRIES = 500;

/**
 * 줄 끝에서 **잘린** 경로 조각을 원래 파일로 되살린다.
 *
 * 터미널 창이 좁아지면 긴 경로가 두 줄로 접히는데, 확장은 VS Code 에서 한 줄씩만 받는다.
 * 그래서 앞조각(확장자가 없음)도 뒷조각(앞이 잘림)도 실제 파일로 이어지지 않아 링크가 죽는다.
 * 여기서는 **앞조각**을 살린다. 조각은 접힌 자리, 즉 줄 맨 끝에서 끝나므로:
 * 실제로 있는 가장 깊은 폴더까지 따라간 뒤, 남은 글자로 시작하는 항목이 **딱 하나**일 때만
 * 그것을 답으로 친다. 후보가 둘 이상이면 손대지 않는다(엉뚱한 파일을 여는 것보다 안 열리는 게 낫다).
 */
export function findTruncatedSpan(
  line: string,
  probe: FileProbe = realProbe,
): (ImageSpan & { file: string }) | undefined {
  if (line.length > MAX_LINE) return undefined;
  const trimmed = line.replace(/\s+$/, "");
  const m = trimmed.match(/(?:~\/|\/)\S*$/); // 줄 맨 끝까지 이어지는 경로 모양 조각만
  if (!m || m[0].length < MIN_TRUNCATED) return undefined;

  const raw = m[0];
  let p = raw.startsWith("~/") ? join(homedir(), raw.slice(2)) : raw;
  if (!isAbsolute(p)) return undefined;
  // 확장자까지 멀쩡히 있는 경로는 잘린 게 아니다 — 평소 경로로 처리되거나, 없는 파일이거나.
  if (new RegExp(`\\.(?:${EXT_ALT})$`, "i").test(p) || probe.isFile(p)) return undefined;

  const cut = p.lastIndexOf("/");
  let dir = p.slice(0, cut) || "/";
  let head = p.slice(cut + 1);
  for (let depth = 0; depth < MAX_DESCEND; depth++) {
    if (!probe.isDir(dir)) return undefined;
    const hits = probe.list(dir).filter((n) => n.startsWith(head));
    if (hits.length !== 1) return undefined; // 후보가 없거나 여럿이면 포기
    const cand = join(dir, hits[0]);
    if (probe.isFile(cand)) {
      if (!new RegExp(`\\.(?:${EXT_ALT})$`, "i").test(cand)) return undefined;
      return { start: m.index ?? 0, raw, file: cand };
    }
    if (!probe.isDir(cand)) return undefined;
    dir = cand;
    head = ""; // 폴더 안으로 한 칸 내려간다. 항목이 딱 하나일 때만 계속된다.
  }
  return undefined;
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
