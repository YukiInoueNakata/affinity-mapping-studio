import type {
  Card,
  Group,
  GroupMembership,
  GroupPosition,
  Label,
  ProjectData,
} from '@shared/types/domain';
import { newId } from './ids.js';

export function nextGroupName(data: ProjectData): string {
  return nextHierarchyGroupName(data, 1);
}

export function nextGroupPosition(
  data: ProjectData,
  cardPositions: { x: number; y: number }[] = []
): { x: number; y: number; width: number; height: number } {
  if (cardPositions.length > 0) {
    const minX = Math.min(...cardPositions.map((p) => p.x));
    const minY = Math.min(...cardPositions.map((p) => p.y));
    const maxX = Math.max(...cardPositions.map((p) => p.x));
    const maxY = Math.max(...cardPositions.map((p) => p.y));
    const padding = 24;
    const cardW = 220;
    const cardH = 80;
    return {
      x: minX - padding,
      y: minY - padding - 28,
      width: Math.max(maxX + cardW - minX + padding * 2, 280),
      height: Math.max(maxY + cardH - minY + padding * 2 + 28, 160),
    };
  }
  const count = data.groups.length;
  return {
    x: 60 + (count % 6) * 40,
    y: 60 + Math.floor(count / 6) * 40,
    width: 320,
    height: 200,
  };
}

export interface BuildGroupInput {
  cardIds: string[];
  cardPositions: { cardId: string; x: number; y: number }[];
  now: string;
}

export interface BuildGroupOutput {
  group: Group;
  label: Label;
  position: GroupPosition;
  memberships: GroupMembership[];
  conflictingMemberships: GroupMembership[];
}

export function buildGroupFromCards(
  data: ProjectData,
  input: BuildGroupInput
): BuildGroupOutput {
  const groupId = newId();
  const group: Group = {
    id: groupId,
    name: nextGroupName(data),
    level: 1,
    parentGroupId: null,
    collapsed: false,
    createdAt: input.now,
    updatedAt: input.now,
  };
  const label: Label = {
    id: newId(),
    groupId,
    text: '',
    sharedMemo: '',
    basisMemo: '',
    holdMemo: '',
    createdAt: input.now,
    updatedAt: input.now,
  };
  const cardPositionMap = new Map(input.cardPositions.map((p) => [p.cardId, p]));
  const positionsForCards = input.cardIds
    .map((id) => cardPositionMap.get(id))
    .filter((p): p is { cardId: string; x: number; y: number } => p !== undefined);
  const rect = nextGroupPosition(data, positionsForCards);
  const position: GroupPosition = { groupId, ...rect };

  const memberships: GroupMembership[] = input.cardIds.map((cardId) => ({
    id: newId(),
    cardId,
    groupId,
    createdAt: input.now,
  }));

  const cardIdSet = new Set(input.cardIds);
  const conflictingMemberships = data.group_memberships.filter((m) =>
    cardIdSet.has(m.cardId)
  );

  return { group, label, position, memberships, conflictingMemberships };
}

export function getCardGroupId(data: ProjectData, cardId: string): string | null {
  const m = data.group_memberships.find((mm) => mm.cardId === cardId);
  return m?.groupId ?? null;
}

export function getGroupMembers(data: ProjectData, groupId: string): Card[] {
  const cardIds = new Set(
    data.group_memberships.filter((m) => m.groupId === groupId).map((m) => m.cardId)
  );
  // Filter to cards that exist AND are on canvas (matches displayed count).
  // Cards moved to "unclassified" / "pending" retain their membership data
  // but are not counted as currently-visible members.
  return data.cards.filter((c) => {
    if (!cardIds.has(c.id)) return false;
    const placement = c.placement ?? 'canvas';
    return placement === 'canvas';
  });
}

export function getUngroupedCards(data: ProjectData): Card[] {
  const grouped = new Set(data.group_memberships.map((m) => m.cardId));
  return data.cards.filter((c) => !grouped.has(c.id));
}

export function getGroupLabel(data: ProjectData, groupId: string): Label | null {
  return data.labels.find((l) => l.groupId === groupId) ?? null;
}

export function getGroupPosition(data: ProjectData, groupId: string): GroupPosition | null {
  return data.group_positions.find((p) => p.groupId === groupId) ?? null;
}

export function getChildGroups(data: ProjectData, parentGroupId: string): Group[] {
  return data.groups.filter((g) => g.parentGroupId === parentGroupId);
}

export interface BuildParentGroupInput {
  childGroupIds: string[];
  now: string;
}

export interface BuildParentGroupOutput {
  parent: Group;
  parentLabel: Label;
  parentPosition: GroupPosition;
  childGroups: Group[];
}

export function buildParentGroup(
  data: ProjectData,
  input: BuildParentGroupInput
): BuildParentGroupOutput {
  const parentId = newId();
  const childGroupsForLevel = data.groups.filter((g) =>
    input.childGroupIds.includes(g.id)
  );
  const parentLevel =
    childGroupsForLevel.length > 0
      ? Math.max(...childGroupsForLevel.map((g) => g.level)) + 1
      : 2;
  const parent: Group = {
    id: parentId,
    name: nextHierarchyGroupName(data, parentLevel),
    level: parentLevel,
    parentGroupId: null,
    collapsed: false,
    createdAt: input.now,
    updatedAt: input.now,
  };
  const parentLabel: Label = {
    id: newId(),
    groupId: parentId,
    text: '',
    sharedMemo: '',
    basisMemo: '',
    holdMemo: '',
    createdAt: input.now,
    updatedAt: input.now,
  };
  const childRects = input.childGroupIds
    .map((id) => data.group_positions.find((p) => p.groupId === id))
    .filter((p): p is GroupPosition => p !== undefined);
  const padding = 28;
  let x = 60;
  let y = 60;
  let width = 360;
  let height = 240;
  if (childRects.length > 0) {
    const minX = Math.min(...childRects.map((r) => r.x));
    const minY = Math.min(...childRects.map((r) => r.y));
    const maxX = Math.max(...childRects.map((r) => r.x + r.width));
    const maxY = Math.max(...childRects.map((r) => r.y + r.height));
    x = minX - padding;
    y = minY - padding - 32;
    width = Math.max(maxX - minX + padding * 2, 360);
    height = Math.max(maxY - minY + padding * 2 + 32, 240);
  }
  const parentPosition: GroupPosition = { groupId: parentId, x, y, width, height };
  const childGroups = data.groups.filter((g) => input.childGroupIds.includes(g.id));
  return { parent, parentLabel, parentPosition, childGroups };
}

export function nextParentGroupName(data: ProjectData): string {
  return nextHierarchyGroupName(data, 2);
}

export function levelPrefix(level: number): string {
  // Unified, scalable naming. Level 1 = the smallest grouping built directly
  // from cards. Higher levels are parent groupings.
  return `グループレベル${Math.max(1, level)}`;
}

export function nextHierarchyGroupName(data: ProjectData, level: number): string {
  const prefix = levelPrefix(level);
  const used = new Set(data.groups.map((g) => g.name));
  let n = 1;
  while (used.has(`${prefix} ${n}`)) n++;
  return `${prefix} ${n}`;
}

export interface FlatGroupNode {
  group: Group;
  depth: number;
}

export function flattenGroupTree(data: ProjectData): FlatGroupNode[] {
  const byParent = new Map<string | null, Group[]>();
  for (const g of data.groups) {
    const key = g.parentGroupId;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(g);
  }
  for (const [, arr] of byParent) arr.sort((a, b) => a.name.localeCompare(b.name));
  const out: FlatGroupNode[] = [];
  const walk = (parentId: string | null, depth: number) => {
    const children = byParent.get(parentId) ?? [];
    for (const g of children) {
      out.push({ group: g, depth });
      walk(g.id, depth + 1);
    }
  };
  // Roots are ordered by level (higher first) then by name, so the hierarchy reads top-down
  const roots = (byParent.get(null) ?? []).slice().sort((a, b) => {
    if (a.level !== b.level) return b.level - a.level;
    return a.name.localeCompare(b.name);
  });
  for (const r of roots) {
    out.push({ group: r, depth: 0 });
    walk(r.id, 1);
  }
  return out;
}

export interface GroupDescendantPosition {
  id: string;
  type: 'card' | 'group';
  startPos: { x: number; y: number };
}

/**
 * Returns the set of node ids that should be hidden because at least one
 * collapsed ancestor exists.  Includes member cards and child groups
 * recursively.  The collapsed group itself stays visible.
 */
export function getHiddenIds(data: ProjectData): Set<string> {
  const hidden = new Set<string>();
  const collect = (gid: string) => {
    for (const m of data.group_memberships) {
      if (m.groupId === gid) hidden.add(m.cardId);
    }
    for (const child of data.groups) {
      if (child.parentGroupId === gid) {
        hidden.add(child.id);
        collect(child.id);
      }
    }
  };
  for (const g of data.groups) {
    if (g.collapsed) collect(g.id);
  }
  return hidden;
}

// Auto-fit constants: a group's rectangle hugs its members with this padding.
// User spec: 「グループのカードの最大y+5, 最小y-5, 最大x+5, 最小x-5」
export const GROUP_AUTOFIT_PADDING = 5;
// Group label sits ABOVE the group's rectangle (CSS: .kj-group-node-header
// top: -22px + a bit of margin). When a child group is nested under this one,
// reserve this much vertical space on top so the child's label does NOT
// overlap with the parent's label.
const CHILD_GROUP_LABEL_OFFSET = 26;
// Conservative defaults tuned to actual card CSS (.card-node width 220, padded
// height ~100 for short bodies). Caller should pass `measuredSizes` whenever
// rendered dimensions are available so the rectangle hugs the real card edges.
const DEFAULT_CARD_W = 220;
const DEFAULT_CARD_H = 100;
const DEFAULT_COLLAPSED_CARD_W = 80;
const DEFAULT_COLLAPSED_CARD_H = 32;
// Visual size of a *collapsed* child group (just its label pill). Used by
// the parent's auto-fit so a collapsed child shrinks the parent accordingly.
const COLLAPSED_GROUP_W = 160;
const COLLAPSED_GROUP_H = 32;

export interface ComputeGroupAutoBoundsOptions {
  /** Override card x/y (e.g. for the card currently being dragged). */
  cardPosOverride?: Map<string, { x: number; y: number }>;
  /** Override group x/y/width/height (e.g. cascaded recompute). */
  groupPosOverride?: Map<
    string,
    { x: number; y: number; width: number; height: number }
  >;
  /** Measured DOM size of cards / child groups (cardId or groupId → w/h). */
  measuredSizes?: Map<string, { width: number; height: number }>;
  /** Card wrap width from project display settings (fallback when measured). */
  defaultCardWidth?: number;
  /** Card body height fallback (fallback when measured). */
  defaultCardHeight?: number;
}

/**
 * Compute the auto-fit rectangle of a single group given its current member
 * cards' positions and its child groups' positions. Returns null if the group
 * has no members (don't shrink it to nothing).
 */
export function computeGroupAutoBounds(
  data: ProjectData,
  groupId: string,
  options: ComputeGroupAutoBoundsOptions = {}
): { x: number; y: number; width: number; height: number } | null {
  const cardPosOverride = options.cardPosOverride ?? new Map();
  const groupPosOverride = options.groupPosOverride ?? new Map();
  const measured = options.measuredSizes ?? new Map();
  const cardW = options.defaultCardWidth ?? DEFAULT_CARD_W;
  const cardH = options.defaultCardHeight ?? DEFAULT_CARD_H;

  const memberCardIds = data.group_memberships
    .filter((m) => m.groupId === groupId)
    .map((m) => m.cardId);
  const childGroupIds = data.groups
    .filter((g) => g.parentGroupId === groupId)
    .map((g) => g.id);

  type Rect = { left: number; top: number; right: number; bottom: number };
  const rects: Rect[] = [];

  for (const cid of memberCardIds) {
    const pos =
      cardPosOverride.get(cid) ??
      data.card_positions.find((p) => p.cardId === cid);
    if (!pos) continue;
    const card = data.cards.find((c) => c.id === cid);
    if (!card) continue;
    // Skip cards that aren't actually drawn on canvas (placement filter).
    const placement = card.placement ?? 'canvas';
    if (placement !== 'canvas') continue;
    const m = measured.get(cid);
    const w = m?.width ?? (card.collapsed ? DEFAULT_COLLAPSED_CARD_W : cardW);
    const h = m?.height ?? (card.collapsed ? DEFAULT_COLLAPSED_CARD_H : cardH);
    rects.push({
      left: pos.x,
      top: pos.y,
      right: pos.x + w,
      bottom: pos.y + h,
    });
  }
  for (const gid of childGroupIds) {
    const pos =
      groupPosOverride.get(gid) ??
      data.group_positions.find((p) => p.groupId === gid);
    if (!pos) continue;
    // If the child group is currently collapsed (only its label pill is
    // visible), shrink its effective rectangle so the parent auto-fit hugs
    // the small pill rather than the full underlying group size.
    const childGroup = data.groups.find((g) => g.id === gid);
    const childCollapsed = childGroup?.collapsed === true;
    const effW = childCollapsed ? COLLAPSED_GROUP_W : pos.width;
    const effH = childCollapsed ? COLLAPSED_GROUP_H : pos.height;
    // Expand top by CHILD_GROUP_LABEL_OFFSET so this parent's rectangle
    // includes the child's label area (which floats above the child's rect).
    // Otherwise child & parent labels stack at nearly the same Y and overlap.
    rects.push({
      left: pos.x,
      top: pos.y - CHILD_GROUP_LABEL_OFFSET,
      right: pos.x + effW,
      bottom: pos.y + effH,
    });
  }

  if (rects.length === 0) return null;
  const minX = Math.min(...rects.map((r) => r.left));
  const minY = Math.min(...rects.map((r) => r.top));
  const maxR = Math.max(...rects.map((r) => r.right));
  const maxB = Math.max(...rects.map((r) => r.bottom));
  const p = GROUP_AUTOFIT_PADDING;
  return {
    x: minX - p,
    y: minY - p,
    width: maxR - minX + p * 2,
    height: maxB - minY + p * 2,
  };
}

export interface PackGroupCardsOptions {
  measuredSizes?: Map<string, { width: number; height: number }>;
  defaultCardWidth?: number;
  defaultCardHeight?: number;
  /** Gap between packed cards (px). */
  gap?: number;
  /** 列基準 ('cols') か行基準 ('rows') か．既定 'cols'． */
  orientation?: 'cols' | 'rows';
  /** 列数 (orientation='cols') または行数 (orientation='rows') の固定値．未指定は √n 自動． */
  count?: number;
}

/**
 * (#3) グループのメンバーカードを，グループ枠の現在の左上 (= ラベル位置) を固定した
 * まま隙間なくグリッド整列する．現在の表示順 (上→下, 左→右) を保持し，列数はおおよそ
 * 正方形になるよう自動決定する．各行の高さはその行の最大カード高に揃える．
 *
 * 戻り値の cardTargets を `makeMoveCardsBulkCommand` に渡し，枠の再フィットは
 * `computeCascadedGroupBoundsUpdates` に新カード位置を渡して算出する (パッキングで
 * カードを枠左上 + padding から並べるため，再フィット後も枠の x,y は不変になる)．
 *
 * メンバーカードのみを対象とし，子グループは移動しない (典型ユースケースは葉グループ)．
 */
export function packGroupCards(
  data: ProjectData,
  groupId: string,
  options: PackGroupCardsOptions = {}
): { cardTargets: Array<{ cardId: string; x: number; y: number }> } | null {
  const pos = data.group_positions.find((p) => p.groupId === groupId);
  if (!pos) return null;
  const measured = options.measuredSizes ?? new Map();
  const dcw = options.defaultCardWidth ?? DEFAULT_CARD_W;
  const dch = options.defaultCardHeight ?? DEFAULT_CARD_H;
  const gap = options.gap ?? 12;

  const memberIds = data.group_memberships
    .filter((m) => m.groupId === groupId)
    .map((m) => m.cardId);
  const items = memberIds
    .map((cid) => {
      const card = data.cards.find((c) => c.id === cid);
      if (!card) return null;
      if ((card.placement ?? 'canvas') !== 'canvas') return null;
      const p = data.card_positions.find((cp) => cp.cardId === cid);
      if (!p) return null;
      const m = measured.get(cid);
      const w = m?.width ?? (card.collapsed ? DEFAULT_COLLAPSED_CARD_W : dcw);
      const h = m?.height ?? (card.collapsed ? DEFAULT_COLLAPSED_CARD_H : dch);
      return { cardId: cid, x: p.x, y: p.y, w, h };
    })
    .filter((v): v is { cardId: string; x: number; y: number; w: number; h: number } => v !== null);
  if (items.length === 0) return null;

  // 現在の表示順 (上→下, 同程度の高さなら左→右) を保持
  items.sort((a, b) => (Math.abs(a.y - b.y) > 20 ? a.y - b.y : a.x - b.x));

  const n = items.length;
  // 列数を決定する．orientation='cols' なら count を列数として，'rows' なら count を
  // 行数として扱い列数を逆算する．count 未指定時は √n でおおよそ正方形に整える．
  const orientation = options.orientation ?? 'cols';
  const fixed =
    options.count && options.count > 0 ? Math.floor(options.count) : undefined;
  const autoBase = Math.ceil(Math.sqrt(n));
  let cols: number;
  if (orientation === 'rows') {
    const rows = Math.max(1, Math.min(n, fixed ?? autoBase));
    cols = Math.ceil(n / rows);
  } else {
    cols = fixed ?? autoBase;
  }
  cols = Math.max(1, Math.min(n, cols));
  const colWidth = Math.max(...items.map((it) => it.w));

  const startX = pos.x + GROUP_AUTOFIT_PADDING;
  const startY = pos.y + GROUP_AUTOFIT_PADDING;

  const rowCount = Math.ceil(n / cols);
  const rowHeights: number[] = [];
  for (let r = 0; r < rowCount; r++) {
    let maxH = dch;
    for (let c = 0; c < cols; c++) {
      const it = items[r * cols + c];
      if (it) maxH = Math.max(maxH, it.h);
    }
    rowHeights.push(maxH);
  }
  const rowY: number[] = [];
  let acc = startY;
  for (let r = 0; r < rowCount; r++) {
    rowY.push(acc);
    acc += rowHeights[r] + gap;
  }

  const cardTargets = items.map((it, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      cardId: it.cardId,
      x: startX + col * (colWidth + gap),
      y: rowY[row],
    };
  });
  return { cardTargets };
}

/**
 * Given a set of card position overrides (cards that just moved), compute the
 * cascaded GroupPosition updates for all touched ancestor groups, bottom-up,
 * so each level's parent sees its children's new positions.
 */
export function computeCascadedGroupBoundsUpdates(
  data: ProjectData,
  cardPosOverride: Map<string, { x: number; y: number }>,
  groupPosOverrideInit: Map<
    string,
    { x: number; y: number; width: number; height: number }
  > = new Map(),
  options: {
    measuredSizes?: Map<string, { width: number; height: number }>;
    defaultCardWidth?: number;
    defaultCardHeight?: number;
  } = {}
): Array<{ prev: GroupPosition; next: GroupPosition }> {
  const cardToGroup = new Map<string, string>();
  for (const m of data.group_memberships) {
    cardToGroup.set(m.cardId, m.groupId);
  }
  const parentOf = new Map<string, string | null>();
  for (const g of data.groups) parentOf.set(g.id, g.parentGroupId);

  // Collect all touched groups (ancestor chain from each affected card, plus
  // ancestors of any group whose position was overridden directly).
  const touched = new Set<string>();
  const walkUp = (gid: string | null | undefined) => {
    let cur: string | null | undefined = gid;
    while (cur) {
      touched.add(cur);
      cur = parentOf.get(cur) ?? null;
    }
  };
  for (const cardId of cardPosOverride.keys()) {
    walkUp(cardToGroup.get(cardId));
  }
  for (const gid of groupPosOverrideInit.keys()) {
    walkUp(parentOf.get(gid) ?? null);
  }

  // Sort bottom-up by level so children are processed before parents.
  const ordered = Array.from(touched).sort((a, b) => {
    const la = data.groups.find((x) => x.id === a)?.level ?? 1;
    const lb = data.groups.find((x) => x.id === b)?.level ?? 1;
    return la - lb;
  });

  const groupPosOverride = new Map(groupPosOverrideInit);
  const updates: Array<{ prev: GroupPosition; next: GroupPosition }> = [];
  for (const groupId of ordered) {
    const nextRect = computeGroupAutoBounds(data, groupId, {
      cardPosOverride,
      groupPosOverride,
      measuredSizes: options.measuredSizes,
      defaultCardWidth: options.defaultCardWidth,
      defaultCardHeight: options.defaultCardHeight,
    });
    if (!nextRect) continue;
    const prev = data.group_positions.find((p) => p.groupId === groupId);
    if (!prev) {
      // No existing entry — skip (group may have just been created without
      // a position yet). We don't try to materialize one.
      continue;
    }
    if (
      prev.x === nextRect.x &&
      prev.y === nextRect.y &&
      prev.width === nextRect.width &&
      prev.height === nextRect.height
    ) {
      continue;
    }
    const next: GroupPosition = { groupId, ...nextRect };
    updates.push({ prev, next });
    groupPosOverride.set(groupId, nextRect);
  }
  return updates;
}

/**
 * Get the set of group ids that are "containers" of a node, meaning the node
 * is allowed to visually sit inside their rectangles. For a card, that is the
 * group it's a direct member of plus all ancestor groups. For a group, that
 * is the group itself plus its ancestor chain.
 */
export function getContainerGroupIds(
  data: ProjectData,
  nodeId: string,
  nodeType: 'card' | 'group'
): Set<string> {
  const out = new Set<string>();
  const parentOf = new Map<string, string | null>();
  for (const g of data.groups) parentOf.set(g.id, g.parentGroupId);

  if (nodeType === 'card') {
    const m = data.group_memberships.find((mm) => mm.cardId === nodeId);
    if (!m) return out;
    let cur: string | null | undefined = m.groupId;
    while (cur) {
      out.add(cur);
      cur = parentOf.get(cur) ?? null;
    }
  } else {
    let cur: string | null | undefined = nodeId;
    while (cur) {
      out.add(cur);
      cur = parentOf.get(cur) ?? null;
    }
  }
  return out;
}

const OVERLAP_PUSH_MARGIN = 8;
const OVERLAP_MAX_ITER = 12;

/**
 * Given a node's desired position+size, push it out of any group rectangle
 * that is not in `containers`. Returns the adjusted position. Uses the
 * shortest push direction per iteration.
 */
export function resolveOverlapWithGroups(
  data: ProjectData,
  desiredPos: { x: number; y: number },
  nodeSize: { width: number; height: number },
  containers: Set<string>
): { x: number; y: number } {
  const blockers = data.group_positions.filter((p) => !containers.has(p.groupId));
  let cur = { x: desiredPos.x, y: desiredPos.y };
  for (let i = 0; i < OVERLAP_MAX_ITER; i++) {
    let moved = false;
    for (const r of blockers) {
      const left = cur.x;
      const right = cur.x + nodeSize.width;
      const top = cur.y;
      const bottom = cur.y + nodeSize.height;
      const overlaps =
        left < r.x + r.width &&
        right > r.x &&
        top < r.y + r.height &&
        bottom > r.y;
      if (!overlaps) continue;
      // Pick the shortest push (left / right / up / down) to escape this rect.
      const pushLeft = r.x - OVERLAP_PUSH_MARGIN - right; // <= 0
      const pushRight = r.x + r.width + OVERLAP_PUSH_MARGIN - left; // >= 0
      const pushUp = r.y - OVERLAP_PUSH_MARGIN - bottom; // <= 0
      const pushDown = r.y + r.height + OVERLAP_PUSH_MARGIN - top; // >= 0
      const candidates: Array<{ dx: number; dy: number; abs: number }> = [
        { dx: pushLeft, dy: 0, abs: Math.abs(pushLeft) },
        { dx: pushRight, dy: 0, abs: Math.abs(pushRight) },
        { dx: 0, dy: pushUp, abs: Math.abs(pushUp) },
        { dx: 0, dy: pushDown, abs: Math.abs(pushDown) },
      ];
      candidates.sort((a, b) => a.abs - b.abs);
      const best = candidates[0];
      cur = { x: cur.x + best.dx, y: cur.y + best.dy };
      moved = true;
      break;
    }
    if (!moved) break;
  }
  return cur;
}

export function collectGroupDescendantsForDrag(
  data: ProjectData,
  groupId: string
): GroupDescendantPosition[] {
  const root = data.groups.find((g) => g.id === groupId);
  if (!root) return [];
  const out: GroupDescendantPosition[] = [];
  const addCardsForGroup = (gid: string) => {
    const cardIds = new Set(
      data.group_memberships.filter((m) => m.groupId === gid).map((m) => m.cardId)
    );
    for (const p of data.card_positions) {
      if (cardIds.has(p.cardId)) {
        out.push({ id: p.cardId, type: 'card', startPos: { x: p.x, y: p.y } });
      }
    }
  };
  const visit = (gid: string) => {
    addCardsForGroup(gid);
    const children = data.groups.filter((g) => g.parentGroupId === gid);
    for (const cg of children) {
      const cgPos = data.group_positions.find((p) => p.groupId === cg.id);
      if (cgPos) {
        out.push({ id: cg.id, type: 'group', startPos: { x: cgPos.x, y: cgPos.y } });
      }
      visit(cg.id);
    }
  };
  visit(root.id);
  return out;
}

