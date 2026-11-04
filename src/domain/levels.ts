// 段のタブ (第 2 段以降) の配置計算と，段の範囲の表の出力．
//
// 用語: 「段」= Group.level．第 1 段はカードを束ねたグループ，第 n 段は
// 第 n-1 段以下のグループを束ねたグループ．
//
// 第 n 段のタブ (n >= 2) に出すもの:
//   - 箱 (box): 第 n 段より下の段のグループのうち，親が無いか，親が第 n 段以上のもの．
//     = 「第 n 段で束ねる材料」．
//   - 枠 (frame): 第 n 段のグループ．中の箱を囲む大きさを毎回計算する (保存しない)．
// 第 1 段は今のキャンバス (card_positions / group_positions) をそのまま使う．
//
// 配置は level_positions に「動かしたときだけ」書く．行が無い箱は 1 つ下の段の
// タブでの位置 (第 2 段なら第 1 段のキャンバスの位置) を既定にする．

import type {
  Card,
  Group,
  LevelPosition,
  ProjectData,
} from '@shared/types/domain';
import { computeGroupCodes, getGroupLabel } from './groups.js';

export const LEVEL_BOX_WIDTH = 240;
export const LEVEL_BOX_HEIGHT = 110;
export const LEVEL_FRAME_PADDING = 24;
export const LEVEL_FRAME_HEADER = 40;
export const LEVEL_EMPTY_FRAME_WIDTH = 280;
export const LEVEL_EMPTY_FRAME_HEIGHT = 160;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function levelPositionId(level: number, itemId: string): string {
  return `lv${level}-${itemId}`;
}

/** プロジェクトの最上段 (グループが無ければ 0)． */
export function maxGroupLevel(data: ProjectData): number {
  return data.groups.reduce((m, g) => Math.max(m, g.level), 0);
}

/** 第 n 段のタブの箱と枠． */
export function getLevelItems(
  data: ProjectData,
  level: number
): { boxes: Group[]; frames: Group[] } {
  const byId = new Map(data.groups.map((g) => [g.id, g] as const));
  const boxes: Group[] = [];
  const frames: Group[] = [];
  for (const g of data.groups) {
    if (g.level === level) {
      frames.push(g);
      continue;
    }
    if (g.level < level) {
      const parent = g.parentGroupId ? byId.get(g.parentGroupId) : undefined;
      if (!parent || parent.level >= level) boxes.push(g);
    }
  }
  return { boxes, frames };
}

function rowFor(
  rows: Map<string, LevelPosition>,
  level: number,
  itemId: string
): LevelPosition | undefined {
  return rows.get(levelPositionId(level, itemId));
}

/** 枠の大きさ = 中の箱を囲む矩形 + 余白 + 見出し．箱が無いときは null． */
export function frameRectAround(boxRects: Rect[]): Rect | null {
  if (boxRects.length === 0) return null;
  const minX = Math.min(...boxRects.map((r) => r.x));
  const minY = Math.min(...boxRects.map((r) => r.y));
  const maxX = Math.max(...boxRects.map((r) => r.x + r.width));
  const maxY = Math.max(...boxRects.map((r) => r.y + r.height));
  return {
    x: minX - LEVEL_FRAME_PADDING,
    y: minY - LEVEL_FRAME_PADDING - LEVEL_FRAME_HEADER,
    width: maxX - minX + LEVEL_FRAME_PADDING * 2,
    height: maxY - minY + LEVEL_FRAME_PADDING * 2 + LEVEL_FRAME_HEADER,
  };
}

export interface LevelLayout {
  level: number;
  boxes: Map<string, Rect>;
  frames: Map<string, Rect>;
}

/** 第 n 段のタブの配置を計算する (n >= 2)．
 *  箱の位置: level_positions の行 → 無ければ 1 つ下の段のタブでの位置
 *  (箱としての位置か，枠としての左上) → 第 1 段の group_positions → (0, 0)． */
export function computeLevelLayout(data: ProjectData, level: number): LevelLayout {
  const rows = new Map<string, LevelPosition>();
  for (const p of data.level_positions ?? []) {
    if (!rows.has(p.id)) rows.set(p.id, p); // 重複は最初の 1 行 (uniqById と同じ規則)
  }
  const memo = new Map<number, LevelLayout>();
  const layoutAt = (n: number): LevelLayout => {
    const cached = memo.get(n);
    if (cached) return cached;
    const { boxes, frames } = getLevelItems(data, n);
    const prev = n > 2 ? layoutAt(n - 1) : null;
    const boxRects = new Map<string, Rect>();
    for (const g of boxes) {
      const row = rowFor(rows, n, g.id);
      let x: number;
      let y: number;
      if (row) {
        x = row.x;
        y = row.y;
      } else {
        const fromPrev = prev?.boxes.get(g.id) ?? prev?.frames.get(g.id);
        if (fromPrev) {
          x = fromPrev.x;
          y = fromPrev.y;
        } else {
          const gp = data.group_positions.find((p) => p.groupId === g.id);
          x = gp?.x ?? 0;
          y = gp?.y ?? 0;
        }
      }
      boxRects.set(g.id, { x, y, width: LEVEL_BOX_WIDTH, height: LEVEL_BOX_HEIGHT });
    }
    const frameRects = new Map<string, Rect>();
    for (const f of frames) {
      const childRects = boxes
        .filter((b) => b.parentGroupId === f.id)
        .map((b) => boxRects.get(b.id)!)
        .filter(Boolean);
      const around = frameRectAround(childRects);
      if (around) {
        frameRects.set(f.id, around);
        continue;
      }
      // 中が空の枠: 行があればその位置，無ければ第 1 段の位置．
      const row = rowFor(rows, n, f.id);
      const gp = data.group_positions.find((p) => p.groupId === f.id);
      frameRects.set(f.id, {
        x: row?.x ?? gp?.x ?? 0,
        y: row?.y ?? gp?.y ?? 0,
        width: LEVEL_EMPTY_FRAME_WIDTH,
        height: LEVEL_EMPTY_FRAME_HEIGHT,
      });
    }
    const out: LevelLayout = { level: n, boxes: boxRects, frames: frameRects };
    memo.set(n, out);
    return out;
  };
  return layoutAt(level);
}

/** 点を含む枠を探す (excludeId の枠は除く)．重なっていたら面積の小さい方． */
export function findFrameAt(
  layout: LevelLayout,
  point: { x: number; y: number },
  excludeId?: string | null
): string | null {
  let best: { id: string; area: number } | null = null;
  for (const [id, r] of layout.frames) {
    if (id === excludeId) continue;
    if (
      point.x >= r.x &&
      point.x <= r.x + r.width &&
      point.y >= r.y &&
      point.y <= r.y + r.height
    ) {
      const area = r.width * r.height;
      if (!best || area < best.area) best = { id, area };
    }
  }
  return best?.id ?? null;
}

/** 段のタブで動かした箱・中が空の枠の行を作る． */
export function makeLevelPosition(
  level: number,
  itemId: string,
  x: number,
  y: number
): LevelPosition {
  return { id: levelPositionId(level, itemId), level, itemKind: 'group', itemId, x, y };
}

// ---- 段の範囲の表 -----------------------------------------------------------

export interface LevelTableOptions {
  /** 上の段 (例 4)． */
  fromLevel: number;
  /** 下の段 (例 2)．0 のとき 1 行が 1 枚のカード． */
  toLevel: number;
  /** 表札の列を出すか (既定 true)． */
  includeLabels?: boolean;
}

/** 段の範囲の表を 2 次元配列で作る (1 行目は見出し)．
 *  1 行 = 下の段 (toLevel) の項目 1 つ．toLevel が 0 ならカード 1 枚．
 *  列 = 上の段から下の段へ，各段の「コード」「表札」．カードのときは最後に
 *  「カード番号」「本文」．その段の上位グループが無い (束ねられていない) ときは空欄． */
export function buildLevelTable(data: ProjectData, opts: LevelTableOptions): string[][] {
  const hi = Math.max(opts.fromLevel, opts.toLevel);
  const lo = Math.min(opts.fromLevel, opts.toLevel);
  const includeLabels = opts.includeLabels !== false;
  const codes = computeGroupCodes(data.groups);
  const byId = new Map(data.groups.map((g) => [g.id, g] as const));
  const groupLevels: number[] = [];
  for (let lv = hi; lv >= Math.max(lo, 1); lv--) groupLevels.push(lv);

  const header: string[] = [];
  for (const lv of groupLevels) {
    header.push(`第${lv}段 コード`);
    if (includeLabels) header.push(`第${lv}段 表札`);
  }
  if (lo === 0) header.push('カード番号', '本文');

  const labelText = (g: Group): string => getGroupLabel(data, g.id)?.text || g.name;

  /** g から親をたどり，段ごとの祖先 (g 自身を含む) を返す． */
  const chainOf = (start: Group | undefined): Map<number, Group> => {
    const out = new Map<number, Group>();
    let cur = start;
    let hops = 0;
    while (cur && hops < 1000) {
      if (!out.has(cur.level)) out.set(cur.level, cur);
      cur = cur.parentGroupId ? byId.get(cur.parentGroupId) : undefined;
      hops++;
    }
    return out;
  };

  const groupCells = (chain: Map<number, Group>): string[] => {
    const cells: string[] = [];
    for (const lv of groupLevels) {
      const g = chain.get(lv);
      cells.push(g ? codes.get(g.id) ?? '' : '');
      if (includeLabels) cells.push(g ? labelText(g) : '');
    }
    return cells;
  };

  const rows: Array<{ sortKey: string; cells: string[] }> = [];
  if (lo === 0) {
    const groupOfCard = new Map<string, string>();
    for (const m of data.group_memberships) {
      if (!groupOfCard.has(m.cardId)) groupOfCard.set(m.cardId, m.groupId);
    }
    const cards: Card[] = [...data.cards].sort((a, b) => a.code.localeCompare(b.code));
    for (const c of cards) {
      const gid = groupOfCard.get(c.id);
      const chain = chainOf(gid ? byId.get(gid) : undefined);
      const cells = [...groupCells(chain), c.code, c.body];
      rows.push({ sortKey: sortKeyOf(cells, groupLevels.length, includeLabels), cells });
    }
  } else {
    for (const g of data.groups) {
      if (g.level !== lo) continue;
      const cells = groupCells(chainOf(g));
      rows.push({ sortKey: sortKeyOf(cells, groupLevels.length, includeLabels), cells });
    }
  }
  // 上の段のコードの順に並べる (空欄=束ねられていないものは各段の末尾)．
  rows.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
  return [header, ...rows.map((r) => r.cells)];
}

function sortKeyOf(cells: string[], nLevels: number, includeLabels: boolean): string {
  const step = includeLabels ? 2 : 1;
  const parts: string[] = [];
  for (let i = 0; i < nLevels; i++) {
    const code = cells[i * step] ?? '';
    // "L3-12" → 番号を 6 桁に詰めて文字列の順で数の順になるようにする．空欄は末尾．
    const m = /^L\d+-(\d+)$/.exec(code);
    parts.push(m ? m[1].padStart(6, '0') : '999999');
  }
  parts.push(cells[nLevels * step] ?? '');
  return parts.join('|');
}

/** CSV (RFC 4180．Excel で文字化けしないよう先頭に BOM を付ける)． */
export function tableToCsv(rows: string[][]): string {
  // = + - @ (とタブ・CR) で始まるセルは，Excel が数式として読む
  // (「- 母親の発言」が #NAME? になる・数式の注入)．先頭に ' を付けて文字列にする．
  // xlsx の出力は文字列のセルなので要らない．
  const guard = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
  const esc = (raw: string) => {
    const v = guard(raw);
    return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  return '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
}
