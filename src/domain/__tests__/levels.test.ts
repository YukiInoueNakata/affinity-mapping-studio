import { describe, it, expect } from 'vitest';
import type { Card, Group, GroupMembership, Label, ProjectData } from '@shared/types/domain';
import { backfillProjectData } from '@shared/types/project';
import {
  buildLevelTable,
  computeLevelLayout,
  findFrameAt,
  getLevelItems,
  levelPositionId,
  makeLevelPosition,
  tableToCsv,
  LEVEL_FRAME_HEADER,
  LEVEL_FRAME_PADDING,
} from '../levels.js';
import {
  makeCompositeCommand,
  makeDeleteGroupCommand,
  makeSetLevelPositionsCommand,
} from '../../stores/commands.js';

const NOW = '2026-11-04T00:00:00.000Z';

function g(id: string, level: number, parent: string | null, createdAt = NOW): Group {
  return { id, name: id, level, parentGroupId: parent, collapsed: false, createdAt, updatedAt: NOW };
}
function card(id: string, code: string, body: string): Card {
  return { id, participantId: 'p1', code, serialNumber: 0, body, status: 'active', createdAt: NOW, updatedAt: NOW };
}
function mem(cardId: string, groupId: string): GroupMembership {
  return { id: `m-${cardId}`, cardId, groupId, createdAt: NOW };
}
function label(groupId: string, text: string): Label {
  return { id: `l-${groupId}`, groupId, text, sharedMemo: '', basisMemo: '', holdMemo: '', createdAt: NOW, updatedAt: NOW };
}

/**
 * a1,a2 (第1段) → A (第2段)
 * b1 (第1段) → B (第2段)
 * A, B → X (第3段)
 * c1 (第1段) は親なし
 */
function sample(): ProjectData {
  const d = backfillProjectData({});
  d.groups = [
    g('a1', 1, 'A', '2026-01-01'),
    g('a2', 1, 'A', '2026-01-02'),
    g('b1', 1, 'B', '2026-01-03'),
    g('c1', 1, null, '2026-01-04'),
    g('A', 2, 'X', '2026-02-01'),
    g('B', 2, 'X', '2026-02-02'),
    g('X', 3, null, '2026-03-01'),
  ];
  d.group_positions = [
    { groupId: 'a1', x: 0, y: 0, width: 300, height: 200 },
    { groupId: 'a2', x: 400, y: 0, width: 300, height: 200 },
    { groupId: 'b1', x: 0, y: 500, width: 300, height: 200 },
    { groupId: 'c1', x: 900, y: 900, width: 300, height: 200 },
    { groupId: 'A', x: -20, y: -50, width: 800, height: 300 },
    { groupId: 'B', x: -20, y: 450, width: 400, height: 300 },
    { groupId: 'X', x: -40, y: -90, width: 900, height: 900 },
  ];
  d.labels = [label('a1', 'りんご'), label('A', '果物'), label('X', '食べ物')];
  d.cards = [card('k1', 'P1-001', '赤い'), card('k2', 'P1-002', '甘い'), card('k3', 'P1-003', '浮いている')];
  d.group_memberships = [mem('k1', 'a1'), mem('k2', 'b1')];
  return d;
}

describe('getLevelItems', () => {
  it('第 2 段: 箱は第 1 段のグループ，枠は第 2 段のグループ', () => {
    const { boxes, frames } = getLevelItems(sample(), 2);
    expect(boxes.map((b) => b.id).sort()).toEqual(['a1', 'a2', 'b1', 'c1']);
    expect(frames.map((f) => f.id).sort()).toEqual(['A', 'B']);
  });
  it('第 3 段: 箱は第 2 段のグループと，親の無い第 1 段のグループ', () => {
    const { boxes, frames } = getLevelItems(sample(), 3);
    expect(boxes.map((b) => b.id).sort()).toEqual(['A', 'B', 'c1']);
    expect(frames.map((f) => f.id)).toEqual(['X']);
  });
});

describe('computeLevelLayout', () => {
  it('行が無ければ第 1 段の位置を既定にし，枠は中の箱を囲む', () => {
    const lay = computeLevelLayout(sample(), 2);
    expect(lay.boxes.get('a1')).toMatchObject({ x: 0, y: 0 });
    expect(lay.boxes.get('a2')).toMatchObject({ x: 400, y: 0 });
    const A = lay.frames.get('A')!;
    expect(A.x).toBe(0 - LEVEL_FRAME_PADDING);
    expect(A.y).toBe(0 - LEVEL_FRAME_PADDING - LEVEL_FRAME_HEADER);
  });
  it('第 3 段の既定は第 2 段のタブでの枠の左上', () => {
    const d = sample();
    const lay2 = computeLevelLayout(d, 2);
    const lay3 = computeLevelLayout(d, 3);
    expect(lay3.boxes.get('A')).toMatchObject({ x: lay2.frames.get('A')!.x, y: lay2.frames.get('A')!.y });
  });
  it('行があればその位置を使い，同じ id の重複は最初の行を使う', () => {
    const d = sample();
    d.level_positions = [makeLevelPosition(2, 'a1', 50, 60), makeLevelPosition(2, 'a1', 999, 999)];
    const lay = computeLevelLayout(d, 2);
    expect(lay.boxes.get('a1')).toMatchObject({ x: 50, y: 60 });
    // 第 1 段の配置は変わらない
    expect(d.group_positions.find((p) => p.groupId === 'a1')).toMatchObject({ x: 0, y: 0 });
  });
  it('findFrameAt は除外した枠を返さない', () => {
    const lay = computeLevelLayout(sample(), 2);
    expect(findFrameAt(lay, { x: 10, y: 10 })).toBe('A');
    expect(findFrameAt(lay, { x: 10, y: 10 }, 'A')).toBeNull();
  });
});

describe('buildLevelTable', () => {
  it('第 3 段から第 1 段まで: 1 行 = 第 1 段のグループ', () => {
    const rows = buildLevelTable(sample(), { fromLevel: 3, toLevel: 1 });
    expect(rows[0]).toEqual([
      '第3段 コード', '第3段 表札', '第2段 コード', '第2段 表札', '第1段 コード', '第1段 表札',
    ]);
    expect(rows).toHaveLength(5);
    expect(rows[1]).toEqual(['L3-1', '食べ物', 'L2-1', '果物', 'L1-1', 'りんご']);
    // 親の無い c1 は上の段が空欄で末尾
    expect(rows[4]).toEqual(['', '', '', '', 'L1-4', 'c1']);
  });
  it('下の段にカードを選ぶと 1 行 = 1 枚', () => {
    const rows = buildLevelTable(sample(), { fromLevel: 2, toLevel: 0, includeLabels: false });
    expect(rows[0]).toEqual(['第2段 コード', '第1段 コード', 'カード番号', '本文']);
    expect(rows.slice(1)).toEqual([
      ['L2-1', 'L1-1', 'P1-001', '赤い'],
      ['L2-2', 'L1-3', 'P1-002', '甘い'],
      ['', '', 'P1-003', '浮いている'],
    ]);
  });
  it('上下を逆に指定しても同じ', () => {
    const d = sample();
    expect(buildLevelTable(d, { fromLevel: 1, toLevel: 3 })).toEqual(
      buildLevelTable(d, { fromLevel: 3, toLevel: 1 })
    );
  });
});

describe('tableToCsv', () => {
  it('BOM 付きで，カンマ・引用符・改行を囲む', () => {
    const csv = tableToCsv([['a', 'b'], ['x,y', 'he said "hi"\nok']]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toBe('﻿a,b\r\n"x,y","he said ""hi""\nok"\r\n');
  });
  it('= + - @ で始まるセルは先頭に \' を付け，Excel が数式として読まないようにする', () => {
    const csv = tableToCsv([['- 母親の発言', '=SUM(A1)', '+1', '@x', 'ふつう']]);
    expect(csv).toBe("﻿'- 母親の発言,'=SUM(A1),'+1,'@x,ふつう\r\n");
  });
});

describe('level_positions のコマンド', () => {
  it('配置の書き込みは upsert で，revert で元に戻る (新しい行は消える)', () => {
    const d = sample();
    const prev = makeLevelPosition(2, 'a1', 1, 1);
    d.level_positions = [prev];
    const cmd = makeSetLevelPositionsCommand([
      { prev, next: makeLevelPosition(2, 'a1', 5, 5) },
      { prev: undefined, next: makeLevelPosition(2, 'a2', 7, 7) },
    ]);
    const after = cmd.apply(d);
    expect(after.level_positions).toEqual([makeLevelPosition(2, 'a1', 5, 5), makeLevelPosition(2, 'a2', 7, 7)]);
    expect(cmd.revert(after).level_positions).toEqual([prev]);
  });
  it('グループを消すとその段の配置の行も消え，revert で戻る', () => {
    const d = sample();
    d.level_positions = [makeLevelPosition(2, 'c1', 1, 1), makeLevelPosition(2, 'a1', 2, 2)];
    const c1 = d.groups.find((x) => x.id === 'c1')!;
    const cmd = makeDeleteGroupCommand(c1, null, d.group_positions.find((p) => p.groupId === 'c1')!, []);
    const after = cmd.apply(d);
    expect(after.level_positions!.map((p) => p.id)).toEqual([levelPositionId(2, 'a1')]);
    const back = cmd.revert(after);
    expect(back.level_positions!.map((p) => p.id).sort()).toEqual(
      [levelPositionId(2, 'a1'), levelPositionId(2, 'c1')].sort()
    );
  });
  it('undo は，ほかの人がその後で動かした行を戻さない', () => {
    const d = sample();
    const cmd = makeSetLevelPositionsCommand([{ prev: undefined, next: makeLevelPosition(2, 'a1', 5, 5) }]);
    const after = cmd.apply(d);
    // 別の人が同じ箱を動かした (Yjs から届いた)．
    const remote = { ...after, level_positions: [makeLevelPosition(2, 'a1', 9, 9)] };
    expect(cmd.revert(remote).level_positions).toEqual([makeLevelPosition(2, 'a1', 9, 9)]);
  });
  it('redo は，消されたグループの行を書かない', () => {
    const d = sample();
    const cmd = makeSetLevelPositionsCommand([{ prev: undefined, next: makeLevelPosition(2, 'a1', 5, 5) }]);
    const gone = { ...d, groups: d.groups.filter((x) => x.id !== 'a1') };
    expect(cmd.apply(gone).level_positions).toEqual([]);
  });
  it('まとめたコマンドは逆順で戻す', () => {
    const d = sample();
    const c1 = makeSetLevelPositionsCommand([{ prev: undefined, next: makeLevelPosition(2, 'a1', 1, 1) }]);
    const c2 = makeSetLevelPositionsCommand([
      { prev: makeLevelPosition(2, 'a1', 1, 1), next: makeLevelPosition(2, 'a1', 2, 2) },
    ]);
    const comp = makeCompositeCommand('x', [c1, c2]);
    const after = comp.apply(d);
    expect(after.level_positions).toEqual([makeLevelPosition(2, 'a1', 2, 2)]);
    expect(comp.revert(after).level_positions).toEqual([]);
  });
});
