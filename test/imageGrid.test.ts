import { describe, it, expect } from "vitest";
import { planGrid, planBase, gridRows, baseGroupCount, MAX_IMAGES } from "../src/core/imageGrid";

/** 배치 나무에서 잎(칸) 개수를 센다. VS Code 가 만들 칸 수와 같아야 한다. */
function countCells(node: any): number {
  if (!node?.groups) return 1;
  return node.groups.reduce((a: number, g: any) => a + countCells(g), 0);
}

describe("planGrid — 사진을 격자로 펼칠 배치", () => {
  it("칸 번호는 왼쪽 칸 다음부터 순서대로", () => {
    expect(planGrid(1, 4).columns).toEqual([2, 3, 4, 5]);
    expect(planGrid(2, 3).columns).toEqual([3, 4, 5]);
    expect(planGrid(0, 2).columns).toEqual([1, 2]);
  });

  it("★ 만들어지는 칸 수가 왼쪽 칸 + 사진 장수와 정확히 같다 (남는 빈 칸 없음)", () => {
    for (let base = 0; base <= 3; base++) {
      for (let n = 1; n <= MAX_IMAGES; n++) {
        expect(countCells(planGrid(base, n).layout)).toBe(base + n);
      }
    }
  });

  it("한 장이면 오른쪽을 쪼개지 않는다", () => {
    const g: any = planGrid(1, 1).layout;
    expect(g.groups).toHaveLength(2);      // 왼쪽 1 + 오른쪽 1
    expect(g.groups[1].groups).toBeUndefined();
  });

  it("두 장은 위아래로 (가로로 긴 사진이 크게 보이게)", () => {
    expect(gridRows(2)).toEqual([1, 1]);
    const g: any = planGrid(1, 2).layout;
    expect(g.groups[1].groups).toHaveLength(2);
    expect(g.groups[1].groups[0].groups).toBeUndefined(); // 각 줄은 더 안 쪼갬
  });

  it("세 장은 위 둘 아래 하나", () => {
    expect(gridRows(3)).toEqual([2, 1]);
    const g: any = planGrid(1, 3).layout;
    expect(g.groups[1].groups[0].groups).toHaveLength(2); // 윗줄 2칸
    expect(g.groups[1].groups[1].groups).toBeUndefined(); // 아랫줄 통째로
  });

  it("네 장은 2x2", () => {
    expect(gridRows(4)).toEqual([2, 2]);
    const g: any = planGrid(1, 4).layout;
    expect(g.groups[1].groups.map((r: any) => r.groups.length)).toEqual([2, 2]);
  });

  it("장수를 벗어난 값은 1~6 안으로 당긴다", () => {
    expect(planGrid(1, 0).columns).toHaveLength(1);
    expect(planGrid(1, 99).columns).toHaveLength(MAX_IMAGES);
  });

  it("뿌리는 가로. 왼쪽이 없으면 오른쪽이 전부를 쓴다", () => {
    const g: any = planGrid(0, 4).layout;
    expect(g.orientation).toBe(0);
    expect(g.groups).toHaveLength(1);
    expect(g.groups[0].size).toBe(1);
  });

  it("왼쪽 칸이 여럿이면 폭을 나눠 갖고, 오른쪽 몫은 그대로", () => {
    const g: any = planGrid(2, 4).layout;
    expect(g.groups[0].size).toBeCloseTo(0.225);
    expect(g.groups[1].size).toBeCloseTo(0.225);
    expect(g.groups[2].size).toBeCloseTo(0.55);
  });
});

describe("baseGroupCount — 남겨 둘 왼쪽 칸 수", () => {
  it("★ 빈 칸은 세지 않는다 (빈 탭이 먼저 뜨던 증상 방지)", () => {
    expect(baseGroupCount([0])).toBe(0);
    expect(baseGroupCount([])).toBe(0);
    expect(baseGroupCount([1, 0])).toBe(1);
  });

  it("탭이 있는 칸만 센다", () => {
    expect(baseGroupCount([3])).toBe(1);
    expect(baseGroupCount([2, 5])).toBe(2);
  });
});

describe("planBase — 사진을 치우고 원래 칸만", () => {
  it("왼쪽 칸 수만큼만 남긴다", () => {
    const g: any = planBase(2);
    expect(g.orientation).toBe(0);
    expect(g.groups).toHaveLength(2);
  });

  it("★ 0 이어도 한 칸은 남긴다 (칸이 0개면 VS Code 가 이상해진다)", () => {
    expect((planBase(0) as any).groups).toHaveLength(1);
  });
});
