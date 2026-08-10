/**
 * 이미지를 편집기 **격자**로 펼칠 배치를 계산한다. (vscode 에 안 기대는 순수 계산)
 *
 * 왼쪽에는 원래 쓰던 칸(채팅 터미널이나 코드)을 그대로 두고, 오른쪽만 격자로 쪼갠다.
 * 가로로만 늘리면 장수가 늘수록 채팅과 사진이 다 같이 좁아진다 — 4장이면 사진 한 장이
 * 손가락 두 개 폭이 된다. 격자는 오른쪽 넓이를 나눠 쓰므로 왼쪽 폭이 그대로다.
 *
 * VS Code 의 `vscode.setEditorLayout` 이 받는 모양을 그대로 만든다.
 * 중첩될 때마다 가로/세로가 번갈아 바뀌므로, 뿌리를 가로로 두면 그 자식은 세로로 쪼개진다.
 */

/** 오른쪽 격자를 위에서부터 몇 칸씩 나눌지. */
export function gridRows(n: number): number[] {
  switch (n) {
    case 1: return [1];
    case 2: return [1, 1];   // 위아래 (가로로 긴 사진이 제일 크게 보인다)
    case 3: return [2, 1];   // 위 둘, 아래 하나 (넓게)
    case 4: return [2, 2];
    case 5: return [3, 2];
    default: return [3, 3];
  }
}

export const MAX_IMAGES = 6;
const LEFT_SHARE = 0.45; // 왼쪽(채팅·코드)이 가져가는 폭

export interface GridPlan {
  /** `vscode.setEditorLayout` 에 그대로 넘길 값 */
  layout: unknown;
  /** 사진 1장째부터 순서대로 들어갈 칸 번호 */
  columns: number[];
}

/**
 * @param baseGroups 사진에 안 쓰고 그대로 둘 왼쪽 칸 수(비어 있는 칸은 세지 않는다)
 * @param n          펼칠 사진 장수 (1 이상 MAX_IMAGES 이하)
 */
export function planGrid(baseGroups: number, n: number): GridPlan {
  const count = Math.max(1, Math.min(MAX_IMAGES, Math.floor(n)));
  const base = Math.max(0, Math.floor(baseGroups));
  const rows = gridRows(count);

  const cell = () => ({});
  const grid: Record<string, unknown> =
    rows.length === 1 && rows[0] === 1
      ? cell()
      : { groups: rows.map((c) => (c === 1 ? cell() : { groups: Array.from({ length: c }, cell) })) };

  const leftShare = base === 0 ? 0 : LEFT_SHARE;
  const left = Array.from({ length: base }, () => ({ size: leftShare / base }));
  const layout = {
    orientation: 0, // 0 = 가로. 뿌리를 가로로 둬야 "왼쪽 | 오른쪽 격자"가 된다.
    groups: [...left, { ...grid, size: 1 - leftShare }],
  };

  return { layout, columns: Array.from({ length: count }, (_, i) => base + 1 + i) };
}

/**
 * 사진을 다 치우고 원래 칸만 남기는 배치. 사진을 연 세션을 떠날 때 되돌리는 용도다.
 * 왼쪽 칸이 없었으면 한 칸짜리(기본 상태)로 돌린다.
 */
export function planBase(baseGroups: number): unknown {
  const n = Math.max(1, Math.floor(baseGroups));
  return { orientation: 0, groups: Array.from({ length: n }, () => ({})) };
}

/**
 * 지금 열린 칸들의 탭 개수를 보고, 사진에 안 쓰고 남겨 둘 왼쪽 칸 수를 정한다.
 * 빈 칸은 세지 않는다 — 세어 버리면 아무것도 없는 칸을 왼쪽에 남긴 채 사진이 오른쪽으로
 * 밀려서, 예전에 잡았던 "빈 탭 하나가 먼저 뜨는" 증상이 그대로 돌아온다.
 */
export function baseGroupCount(tabCounts: number[]): number {
  return tabCounts.filter((c) => c > 0).length;
}
