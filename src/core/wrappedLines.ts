/**
 * 접혀서 두 줄이 된 경로를 화면 원본에서 다시 이어 붙인다. (vscode 에 안 기대는 순수 계산)
 *
 * 확장은 VS Code 에서 터미널을 한 줄씩만 받는다. 창이 좁으면 클로드는 경로를 이렇게 접는다:
 *
 *   `  ~/projects/note/기술제안_..._v4.pptx.imgs/`
 *   `  s01.png`
 *
 * 윗줄에는 폴더만, 아랫줄에는 파일 이름만 있어 어느 쪽도 실제 파일이 아니다.
 * 앞조각으로 파일을 추측하는 방법은 사진이 여러 장 든 폴더에서 늘 실패한다(후보가 여럿이라
 * 포기하는 게 맞다). 그래서 추측하지 않고 **원본 화면에서 이웃 줄을 찾아 붙인다.**
 * 붙인 결과가 진짜 파일일 때만 쓰므로, 엉뚱하게 붙으면 그냥 버려진다.
 */

/** 어느 줄과 붙였는지. 밑줄을 어디에 그릴지가 달라진다. */
export type JoinSide = "prev" | "next";

export interface JoinCandidate {
  text: string;
  side: JoinSide;
}

export const MAX_JOINS = 4; // 같은 글자의 줄이 여러 번 나올 때 살펴볼 개수

/**
 * `line` 과 같은 줄을 화면(`lines`)에서 찾아, 위/아래 줄과 붙인 후보를 만든다.
 *
 * 붙일 때 이음매의 공백은 없앤다 — 클로드가 접으면서 넣는 들여쓰기 때문에
 * `.../imgs/` + `  s01.png` 가 되어 그냥 이으면 경로가 깨진다.
 */
export function joinCandidates(lines: string[], line: string): JoinCandidate[] {
  const key = line.replace(/\s+$/, "");
  if (!key.trim()) return [];
  const out: JoinCandidate[] = [];
  for (let i = 0; i < lines.length && out.length < MAX_JOINS * 2; i++) {
    if (lines[i].replace(/\s+$/, "") !== key) continue;
    const prev = i > 0 ? lines[i - 1].replace(/\s+$/, "") : "";
    const next = i + 1 < lines.length ? lines[i + 1].replace(/\s+$/, "") : "";
    if (prev.trim()) out.push({ text: prev + key.replace(/^\s+/, ""), side: "prev" });
    if (next.trim()) out.push({ text: key + next.replace(/^\s+/, ""), side: "next" });
  }
  return out;
}

/**
 * 이웃 줄과 붙여 본 결과에서 **답이 하나로 모일 때만** 그 파일을 돌려준다.
 *
 * 접힌 윗줄(폴더까지만 있는 줄)은 화면에 똑같은 모양으로 여러 번 나온다. 사진 여러 장을
 * 같은 폴더에서 줄줄이 열면 늘 그렇다. 그때 "처음 만난 것"을 쓰면 s03 의 윗줄을 눌렀는데
 * s01 이 열린다(실제로 재현됐다). 답이 갈리면 아무것도 안 하는 편이 낫다.
 *
 * @param resolve 붙인 글줄에서 실제 파일을 찾아 주는 함수(없으면 undefined)
 */
export function resolveJoined(
  lines: string[],
  line: string,
  resolve: (text: string) => string | undefined,
): { file: string; side: JoinSide } | undefined {
  let found: { file: string; side: JoinSide } | undefined;
  for (const cand of joinCandidates(lines, line)) {
    const file = resolve(cand.text);
    if (!file) continue;
    if (!found) found = { file, side: cand.side };
    else if (found.file !== file) return undefined; // 답이 갈린다 → 포기
  }
  return found;
}

/**
 * 붙여서 찾은 경로에 대해, **지금 보고 있는 줄**의 어디에 밑줄을 그을지.
 *
 * 아랫줄을 보고 있었다면(윗줄과 붙임) 그 줄의 글자 부분 전체가 경로의 뒷부분이다.
 * 윗줄을 보고 있었다면(아랫줄과 붙임) 줄 끝의 낱말이 경로의 앞부분이다.
 */
export function underlineRange(line: string, side: JoinSide): { start: number; length: number } {
  const trimmedEnd = line.replace(/\s+$/, "");
  if (side === "prev") {
    const start = trimmedEnd.length - trimmedEnd.replace(/^\s+/, "").length;
    return { start, length: trimmedEnd.length - start };
  }
  const token = trimmedEnd.split(/\s/).pop() ?? "";
  return { start: trimmedEnd.length - token.length, length: token.length };
}
