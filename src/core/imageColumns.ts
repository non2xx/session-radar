/**
 * 이미지를 편집기 몇 번 칸에 열지 정한다. (vscode 에 안 기대는 순수 계산)
 *
 * 핵심 규칙은 **"있는 칸 수 + 1"을 넘지 않는 것**이다.
 * 그걸 넘겨서 열면 VS Code 가 사이에 빈 칸을 만들어 버린다
 * (이미지를 닫았다가 다시 열 때 빈 탭이 하나 생기던 원인).
 * 마지막 칸이 비어 있으면 새 칸을 만들지 않고 그 칸을 채운다.
 *
 * @param groupTabCounts 지금 열려 있는 각 칸의 탭 개수. 길이가 곧 칸 수.
 * @param used           이번 묶음에서 이미 쓴 칸 번호들
 * @param max            몇 칸까지 펼칠지
 * @param cycleAt        칸이 꽉 찼을 때 몇 번째 재사용인지
 *
 * `reused` 는 "이번이 새 칸이 아니라 기존 칸 재사용인가". 호출부는 이 값이 참일 때만
 * cycleAt 을 올린다. 이 판정을 호출부에 두면 여기 규칙과 어긋나 재사용 순서가 밀린다.
 */
export function pickColumn(
  groupTabCounts: number[],
  used: number[],
  max: number,
  cycleAt: number,
): { col: number; used: number[]; reused: boolean } {
  const n = groupTabCounts.length;
  const alive = used.filter((c) => c <= n); // 닫혀서 없어진 칸은 뺀다
  if (alive.length >= max) {
    return { col: alive[cycleAt % alive.length], used: alive, reused: true };
  }
  const lastEmpty = n > 0 && groupTabCounts[n - 1] === 0;
  const col = lastEmpty ? n : n + 1;
  return { col, used: alive.includes(col) ? alive : [...alive, col], reused: false };
}
