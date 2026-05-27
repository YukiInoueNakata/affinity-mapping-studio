import { describe, it, expect } from 'vitest';
import {
  alignNodes,
  arrangeInGrid,
  distributeNodes,
  type AlignNodeInput,
} from '../align.js';

function n(id: string, x: number, y: number, w = 100, h = 50): AlignNodeInput {
  return { id, x, y, width: w, height: h };
}

describe('alignNodes', () => {
  const items = [n('a', 10, 0), n('b', 50, 20), n('c', 100, 40)];

  it('left aligns to min x', () => {
    const out = alignNodes(items, 'left');
    expect(out.map((o) => o.x)).toEqual([10, 10, 10]);
  });

  it('right aligns so right edges match max right', () => {
    const out = alignNodes(items, 'right');
    // max right = 100 + 100 = 200 ; new x = 200 - 100 = 100 for each
    expect(out.map((o) => o.x)).toEqual([100, 100, 100]);
  });

  it('top aligns to min y', () => {
    const out = alignNodes(items, 'top');
    expect(out.map((o) => o.y)).toEqual([0, 0, 0]);
  });

  it('hcenter aligns horizontal centers to mean center', () => {
    // centers = 60, 100, 150 ; mean = 103.33
    const out = alignNodes(items, 'hcenter');
    const centers = out.map((o) => o.x + 100 / 2);
    expect(centers.every((c) => Math.abs(c - centers[0]) < 0.01)).toBe(true);
  });
});

describe('distributeNodes (B3 — equal gap)', () => {
  it('horizontal: equal gap between varying-width nodes', () => {
    const items = [n('a', 0, 0, 100, 50), n('b', 200, 0, 50, 50), n('c', 400, 0, 100, 50)];
    // span (edge to edge) = 500 ; sizeSum = 250 ; gap = (500-250)/2 = 125
    // a: x=0 (left), b: x=0+100+125=225, c: x=225+50+125=400
    const out = distributeNodes(items, 'horizontal');
    expect(out.find((o) => o.id === 'a')?.x).toBe(0);
    expect(out.find((o) => o.id === 'b')?.x).toBe(225);
    expect(out.find((o) => o.id === 'c')?.x).toBe(400);
  });

  it('returns single-item input unchanged', () => {
    const items = [n('a', 10, 20)];
    const out = distributeNodes(items, 'horizontal');
    expect(out).toEqual([{ id: 'a', x: 10, y: 20 }]);
  });
});

describe('arrangeInGrid', () => {
  it('uniform: places 4 items in 2 rows with cell = max size', () => {
    const items = [n('a', 0, 0), n('b', 0, 0), n('c', 0, 0), n('d', 0, 0)];
    const out = arrangeInGrid(items, { kind: 'rows', count: 2 }, {
      baseX: 0,
      baseY: 0,
      gap: 10,
      cellMode: 'uniform',
    });
    // 2 rows × 2 cols. cell = 100 x 50, gap = 10
    expect(out).toEqual([
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 110, y: 0 },
      { id: 'c', x: 0, y: 60 },
      { id: 'd', x: 110, y: 60 },
    ]);
  });

  it('variable: per-col width and per-row height', () => {
    // 4 nodes, 2 cols → 2 rows; col widths and row heights from max in each
    const items = [
      n('a', 0, 0, 100, 50), // row 0 col 0
      n('b', 0, 0, 200, 80), // row 0 col 1
      n('c', 0, 0, 150, 40), // row 1 col 0
      n('d', 0, 0, 80, 100), // row 1 col 1
    ];
    const out = arrangeInGrid(items, { kind: 'cols', count: 2 }, {
      baseX: 0,
      baseY: 0,
      gap: 10,
      cellMode: 'variable',
    });
    // col widths: col0 = max(100,150) = 150 ; col1 = max(200, 80) = 200
    // row heights: row0 = max(50, 80) = 80 ; row1 = max(40, 100) = 100
    // a: (0, 0), b: (150+10=160, 0)
    // c: (0, 80+10=90), d: (160, 90)
    expect(out).toEqual([
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 160, y: 0 },
      { id: 'c', x: 0, y: 90 },
      { id: 'd', x: 160, y: 90 },
    ]);
  });

  it('default (no cellMode) uses variable sizing', () => {
    const items = [n('a', 0, 0, 100, 50), n('b', 0, 0, 200, 50)];
    const out = arrangeInGrid(items, { kind: 'cols', count: 2 }, {
      baseX: 0,
      baseY: 0,
      gap: 10,
    });
    // variable: col0 = 100, col1 = 200, row0 = 50
    expect(out).toEqual([
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 110, y: 0 },
    ]);
  });
});
