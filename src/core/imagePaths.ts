import { existsSync, statSync, opendirSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { homedir } from "node:os";

export const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"];
const EXT_ALT = IMAGE_EXT.join("|");
const IMAGE_EXT_RE = new RegExp(`\\.(?:${EXT_ALT})$`, "i");

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

/**
 * 파일 조회를 시험에서 갈아 끼우기 위한 최소 창구.
 *
 * `list` 는 **접두사를 받아서** 맞는 것만 돌려준다. 목록을 다 받아 온 뒤 자르면
 * "후보가 딱 하나"라는 이 기능의 안전장치가 깨진다 — 진짜 후보가 둘인데 잘린 쪽에
 * 하나가 들어가면 하나로 보여서 엉뚱한 파일을 확정해 버린다.
 * 답은 "하나인가 둘 이상인가"만 알면 되므로 **두 개까지만** 돌려주면 된다.
 */
export interface FileProbe {
  isFile(p: string): boolean;
  isDir(p: string): boolean;
  list(dir: string, prefix: string): string[];
}

const realProbe: FileProbe = {
  isFile,
  isDir: (p) => { try { return statSync(p).isDirectory(); } catch { return false; } },
  // 폴더를 훑다가 두 번째로 맞는 게 나오면 바로 멈춘다(마우스가 스칠 때마다 도는 자리라
  // 통째로 읽으면 /mnt/c 같은 느린 폴더에서 화면이 잠깐 멈춘다).
  list: (d, prefix) => {
    const out: string[] = [];
    let handle;
    try { handle = opendirSync(d); } catch { return out; }
    try {
      let scanned = 0;
      for (let e = handle.readSync(); e !== null; e = handle.readSync()) {
        if (++scanned > MAX_DIR_SCAN) return []; // 너무 큰 폴더는 통째로 포기(안전한 실패)
        if (!e.name.startsWith(prefix)) continue;
        out.push(e.name);
        if (out.length > 1) break;
      }
    } catch {
      return [];
    } finally {
      try { handle.closeSync(); } catch { /* 이미 닫혔으면 그만 */ }
    }
    return out;
  },
};

export const MIN_TRUNCATED = 12;   // 이보다 짧은 조각은 우연히 걸리기 쉬워 손대지 않는다
export const MAX_DESCEND = 4;      // 폴더를 따라 내려가는 깊이 한도
export const MAX_DIR_SCAN = 5000;  // 이 개수를 넘게 훑어야 하는 폴더는 손대지 않는다

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
  const token = trimmed.split(/\s/).pop() ?? "";
  const tokenStart = trimmed.length - token.length;

  // 시작 자리를 **여러 개** 시도한다. 접히면서 앞줄 글자가 달라붙는 일이 있어서
  // (`가~/projects/...`), 낱말 첫 글자만 보면 그 줄을 통째로 놓친다.
  //
  // 단 잘라 보는 자리는 `~/` 뿐이다. `~` 는 낱말 안에 우연히 끼기 어려워 "여기가 경로 시작"이
  // 거의 확실하다. 반면 안쪽 `/` 까지 자르면 상대경로 `artifacts/tmp/preview_ab` 가
  // `/tmp/preview_ab` 로 둔갑해, 가리킨 적도 없는 폴더의 사진이 열린다.
  // 여긴 파일 이름이 잘려 있어서 "그 파일이 진짜 있나"로 걸러낼 수도 없다.
  for (const off of pathStarts(token, true)) {
    const raw = token.slice(off);
    if (raw.length < MIN_TRUNCATED) continue;
    // 줄이 접히는 대신 **잘릴** 때는 끝에 표시가 붙기도 하고(…), 테두리 상자 안이면
    // 세로줄이 붙는다. 그대로 두면 폴더 안에서 그 글자로 시작하는 게 없어 늘 실패한다.
    for (const cand of [raw, raw.replace(TRAIL_MARK, "")]) {
      if (cand.length < MIN_TRUNCATED) continue;
      const file = walkTruncated(cand, probe);
      if (file) return { start: tokenStart + off, raw: cand, file };
    }
  }
  return undefined;
}

/** 잘림 표시·테두리 글자. 경로 글자로는 안 쓰이는 것만 골랐다. */
const TRAIL_MARK = /[…⋯»›|│┃‥]+$/;

/** 잘린 경로 하나를 폴더를 따라가며 되살린다. 못 찾으면 undefined. */
function walkTruncated(raw: string, probe: FileProbe): string | undefined {
  const p = raw.startsWith("~/") ? join(homedir(), raw.slice(2)) : raw;
  // 확장자까지 멀쩡히 있는 경로는 잘린 게 아니다 — 평소 경로로 처리되거나, 없는 파일이거나.
  if (IMAGE_EXT_RE.test(p) || probe.isFile(p)) return undefined;

  const cut = p.lastIndexOf("/");
  let dir = p.slice(0, cut) || "/";
  let head = p.slice(cut + 1);
  for (let depth = 0; depth < MAX_DESCEND; depth++) {
    if (!probe.isDir(dir)) return undefined;
    const hits = probe.list(dir, head);
    if (hits.length !== 1) return undefined; // 후보가 없거나 여럿이면 포기
    const cand = join(dir, hits[0]);
    if (probe.isFile(cand)) return IMAGE_EXT_RE.test(cand) ? cand : undefined;
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
  if (!IMAGE_EXT_RE.test(p)) return undefined;
  if (p.startsWith("~/")) p = join(homedir(), p.slice(2));

  const candidates = isAbsolute(p) ? [p] : roots.map((r) => join(r, p));
  for (const c of candidates) if (exists(c)) return c;
  return undefined;
}

export const MAX_CUTS = 8; // 앞을 잘라 보는 횟수 상한

/**
 * 이 글자덩어리에서 "경로가 시작될 법한 자리"들. 앞에서부터 시도할 순서로 돌려준다.
 * 0번(통째로)이 먼저이고, 그다음이 안쪽 `/` · `~/` 자리다.
 */
function pathStarts(raw: string, tildeOnly = false): number[] {
  const out: number[] = [0];
  for (let i = 1; i < raw.length && out.length <= MAX_CUTS; i++) {
    const tilde = raw[i] === "~" && raw[i + 1] === "/";
    if (tilde || (!tildeOnly && raw[i] === "/")) out.push(i);
  }
  return out;
}

/**
 * 경로 앞에 딴 글자가 붙어 있어도 살려 낸다.
 *
 * 터미널이 줄을 접을 때 앞줄의 글자가 경로에 붙어 나오는 일이 있다(실제로 겪은 모양:
 * `가~/projects/.../s04.png`). 파이썬 오류의 `File "/home/...` 처럼 장식이 붙는 경우도 같다.
 * 붙은 글자를 종류로 판별하려 들면 한글 폴더 이름(`기술제안_.../s01.png`)까지 잘라 먹으므로,
 * **잘라 본 뒤 실제로 파일이 있을 때만** 받아들인다. 잘못 자르면 그냥 안 맞아서 버려진다.
 *
 * @returns 찾은 파일과, 원래 글자에서 몇 칸 뒤부터가 진짜 경로인지(offset)
 */
export function resolveSpanPath(
  raw: string,
  roots: string[] = [],
  exists: (p: string) => boolean = isFile,
): { file: string; offset: number } | undefined {
  for (const off of pathStarts(raw)) {
    const file = resolveImagePath(raw.slice(off), roots, exists);
    if (file) return { file, offset: off };
  }
  return undefined;
}

export const MAX_RECENT_DIRS = 8;

/**
 * 접힌 **뒷조각**을, 최근에 연 사진들의 폴더에 비춰 되살린다.
 *
 * 앞조각만으로는 한계가 뚜렷하다. 사진이 여러 장 든 폴더면 남은 글자로 시작하는 후보가
 * 여럿이라 늘 포기한다(그게 맞는 판단이다). 그런데 뒷조각에는 보통 **파일 이름이 통째로**
 * 들어 있다. 모자란 건 폴더뿐이고, 그 폴더는 조금 전에 연 사진이 알려 준다.
 *
 * 아무 폴더나 대보지 않는다. 조각이 그 파일 경로의 **꼬리와 정확히 맞아떨어질 때만** 받는다.
 * `밸브_v4.pptx.imgs/s04.png` 는 `/…/기술제안_…_v4.pptx.imgs/s04.png` 의 꼬리라서 맞고,
 * 우연히 이름만 같은 남의 파일은 대개 여기서 걸린다.
 */
export function resolveByRecentDirs(
  raw: string,
  recentDirs: string[],
  exists: (p: string) => boolean = isFile,
): string | undefined {
  const span = raw.trim().replace(/^[@(\[<'"`]+/, "").replace(/[)\]>,.;:'"`]+$/, "");
  // 앞이 잘린 조각은 `/s04.png` 처럼 슬래시로 시작하기도 한다(그 자체로는 없는 경로다).
  // 이 함수는 평소 방법이 이미 실패한 뒤에만 불리므로 그런 모양도 받아 준다.
  if (!span || !IMAGE_EXT_RE.test(span)) return undefined;
  const cut = span.lastIndexOf("/");
  const base = cut < 0 ? span : span.slice(cut + 1);
  if (!base) return undefined;

  for (const dir of recentDirs.slice(0, MAX_RECENT_DIRS)) {
    const cand = join(dir, base);
    if (cand.endsWith(span) && exists(cand)) return cand;
  }
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
