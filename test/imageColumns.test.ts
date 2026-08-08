import { describe, it, expect } from "vitest";
import { pickColumn } from "../src/core/imageColumns";

/** 편집기 칸들의 "탭 개수" 목록을 흉내낸다. [0] = 빈 칸 하나. */
describe("pickColumn — 이미지를 어느 칸에 열까", () => {
  it("편집기가 비어 있으면 1번 칸을 쓴다 (빈 탭을 남기지 않는다)", () => {
    expect(pickColumn([0], [], 3, 0)).toEqual({ col: 1, used: [1] });
  });

  it("칸이 아예 없어도 1번 칸", () => {
    expect(pickColumn([], [], 3, 0)).toEqual({ col: 1, used: [1] });
  });

  it("코드가 열려 있으면 그 옆(2번) 칸", () => {
    expect(pickColumn([1], [], 3, 0)).toEqual({ col: 2, used: [2] });
  });

  it("연달아 누르면 오른쪽으로 한 칸씩 늘린다 (max 는 '이미지 칸' 수)", () => {
    let s = pickColumn([1], [], 3, 0);              // 코드1칸 → 2번
    expect(s.col).toBe(2);
    s = pickColumn([1, 1], s.used, 3, 0);           // → 3번
    expect(s.col).toBe(3);
    s = pickColumn([1, 1, 1], s.used, 3, 0);        // → 4번 (이미지 칸 3개째)
    expect(s.col).toBe(4);
    expect(s.used).toEqual([2, 3, 4]);
    s = pickColumn([1, 1, 1, 1], s.used, 3, 0);     // 꽉 찼으니 첫 이미지 칸 재사용
    expect(s.col).toBe(2);
  });

  it("★ 이미지를 닫아 칸이 사라지면 다시 그 자리부터 — 빈 칸을 건너뛰지 않는다", () => {
    // 전에 2·3번 칸을 썼는데 둘 다 닫혀 지금은 1칸(빈 칸)만 남은 상황
    const s = pickColumn([0], [2, 3], 3, 0);
    expect(s.col).toBe(1);   // 2번이 아니라 1번. 이게 빈 탭 버그의 핵심
    expect(s.used).toEqual([1]);
  });

  it("칸 하나만 닫혔으면 남은 것 다음 칸", () => {
    const s = pickColumn([1], [1, 2], 3, 0);  // 2번은 사라짐
    expect(s.col).toBe(2);
    expect(s.used).toEqual([1, 2]);
  });

  it("있는 칸 수보다 2 이상 큰 번호는 절대 안 고른다", () => {
    for (const n of [0, 1, 2, 3, 4]) {
      const counts = Array(n).fill(1);
      const { col } = pickColumn(counts, [], 5, 0);
      expect(col).toBeLessThanOrEqual(n + 1);
    }
  });

  it("꽉 차면 왼쪽부터 돌아가며 재사용한다", () => {
    const used = [1, 2];
    expect(pickColumn([1, 1], used, 2, 0).col).toBe(1);
    expect(pickColumn([1, 1], used, 2, 1).col).toBe(2);
    expect(pickColumn([1, 1], used, 2, 2).col).toBe(1);
  });

  it("max=1 이면 늘 같은 칸 (예전처럼 한 자리)", () => {
    let s = pickColumn([0], [], 1, 0);
    expect(s.col).toBe(1);
    expect(pickColumn([1], s.used, 1, 1).col).toBe(1);
  });
});
