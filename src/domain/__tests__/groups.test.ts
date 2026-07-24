import { describe, it, expect } from 'vitest';
import type { Card, ProjectData } from '@shared/types/domain';
import {
  buildGroupFromCards,
  buildParentGroup,
  collectGroupDescendantsForDrag,
  computeGroupCodes,
  flattenGroupTree,
  getCardGroupId,
  getGroupMembers,
  getUngroupedCards,
  levelPrefix,
  nextGroupName,
} from '../groups.js';

const NOW = '2026-05-18T00:00:00.000Z';

function emptyData(): ProjectData {
  return {
    participants: [],
    source_segments: [],
    cards: [],
    card_source_links: [],
    card_positions: [],
    groups: [],
    group_memberships: [],
    labels: [],
    group_positions: [],
    text_revisions: [],
    analysis_methods: [],
    analysis_sessions: [],
    analytic_object_links: [],
    m_gta_settings: [],
    m_gta_concepts: [],
    m_gta_variations: [],
    m_gta_categories: [],
    theoretical_memos: [],
    diagram_relations: [],
    gta_codes: [],
    gta_code_applications: [],
    gta_categories: [],
  };
}

function makeCard(id: string, code: string): Card {
  return {
    id,
    participantId: 'pid-P01',
    code,
    serialNumber: parseInt(code.split('-')[1] ?? '1', 10),
    body: '',
    status: 'active',
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe('nextGroupName', () => {
  it('returns グループレベル1 1 when empty', () => {
    expect(nextGroupName(emptyData())).toBe('グループレベル1 1');
  });

  it('skips used names', () => {
    const data = emptyData();
    data.groups.push({
      id: 'g1',
      name: 'グループレベル1 1',
      level: 1,
      parentGroupId: null,
      collapsed: false,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(nextGroupName(data)).toBe('グループレベル1 2');
  });
});

describe('buildGroupFromCards', () => {
  it('creates group/label/position/memberships with no prior memberships', () => {
    const data = emptyData();
    data.cards.push(makeCard('c1', 'P01-001'), makeCard('c2', 'P01-002'));
    data.card_positions.push(
      { cardId: 'c1', x: 100, y: 200 },
      { cardId: 'c2', x: 350, y: 220 }
    );
    const out = buildGroupFromCards(data, {
      cardIds: ['c1', 'c2'],
      cardPositions: data.card_positions,
      now: NOW,
    });
    expect(out.group.name).toBe('グループレベル1 1');
    expect(out.group.parentGroupId).toBeNull();
    expect(out.group.level).toBe(1);
    expect(out.label.groupId).toBe(out.group.id);
    expect(out.label.text).toBe('');
    expect(out.label.sharedMemo).toBe('');
    expect(out.memberships).toHaveLength(2);
    expect(out.memberships.map((m) => m.cardId).sort()).toEqual(['c1', 'c2']);
    expect(out.conflictingMemberships).toHaveLength(0);
    expect(out.position.width).toBeGreaterThan(280);
  });

  it('reports conflicting memberships for cards already in another group', () => {
    const data = emptyData();
    data.cards.push(makeCard('c1', 'P01-001'));
    data.card_positions.push({ cardId: 'c1', x: 0, y: 0 });
    data.group_memberships.push({
      id: 'm-old',
      cardId: 'c1',
      groupId: 'g-old',
      createdAt: NOW,
    });
    const out = buildGroupFromCards(data, {
      cardIds: ['c1'],
      cardPositions: data.card_positions,
      now: NOW,
    });
    expect(out.conflictingMemberships).toHaveLength(1);
    expect(out.conflictingMemberships[0].id).toBe('m-old');
  });
});

describe('collectGroupDescendantsForDrag', () => {
  it('returns member card positions for a level=1 group', () => {
    const data = emptyData();
    data.cards.push(makeCard('c1', 'P01-001'), makeCard('c2', 'P01-002'));
    data.card_positions.push(
      { cardId: 'c1', x: 100, y: 200 },
      { cardId: 'c2', x: 350, y: 220 }
    );
    data.groups.push({
      id: 'g1',
      name: 'g',
      level: 1,
      parentGroupId: null,
      collapsed: false,
      createdAt: NOW,
      updatedAt: NOW,
    });
    data.group_memberships.push(
      { id: 'm1', cardId: 'c1', groupId: 'g1', createdAt: NOW },
      { id: 'm2', cardId: 'c2', groupId: 'g1', createdAt: NOW }
    );
    const desc = collectGroupDescendantsForDrag(data, 'g1');
    expect(desc).toHaveLength(2);
    expect(desc.every((d) => d.type === 'card')).toBe(true);
    expect(desc.map((d) => d.id).sort()).toEqual(['c1', 'c2']);
  });

  it('returns child groups + their cards for a level=2 group', () => {
    const data = emptyData();
    data.cards.push(makeCard('c1', 'P01-001'), makeCard('c2', 'P01-002'));
    data.card_positions.push(
      { cardId: 'c1', x: 10, y: 20 },
      { cardId: 'c2', x: 30, y: 40 }
    );
    data.groups.push(
      { id: 'p', name: 'P', level: 2, parentGroupId: null, collapsed: false, createdAt: NOW, updatedAt: NOW },
      { id: 'cg1', name: 'CG1', level: 1, parentGroupId: 'p', collapsed: false, createdAt: NOW, updatedAt: NOW }
    );
    data.group_positions.push({ groupId: 'p', x: 0, y: 0, width: 400, height: 300 });
    data.group_positions.push({ groupId: 'cg1', x: 5, y: 5, width: 200, height: 150 });
    data.group_memberships.push(
      { id: 'm1', cardId: 'c1', groupId: 'cg1', createdAt: NOW },
      { id: 'm2', cardId: 'c2', groupId: 'cg1', createdAt: NOW }
    );
    const desc = collectGroupDescendantsForDrag(data, 'p');
    const cgEntry = desc.find((d) => d.id === 'cg1');
    expect(cgEntry).toBeDefined();
    expect(cgEntry?.type).toBe('group');
    const cardEntries = desc.filter((d) => d.type === 'card');
    expect(cardEntries.map((d) => d.id).sort()).toEqual(['c1', 'c2']);
  });

  it('returns empty for a non-existent group', () => {
    expect(collectGroupDescendantsForDrag(emptyData(), 'nope')).toEqual([]);
  });
});

describe('unlimited hierarchy', () => {
  it('buildParentGroup yields level=2 over level=1 children', () => {
    const data = emptyData();
    data.groups.push(
      { id: 'g1', name: 'g1', level: 1, parentGroupId: null, collapsed: false, createdAt: NOW, updatedAt: NOW },
      { id: 'g2', name: 'g2', level: 1, parentGroupId: null, collapsed: false, createdAt: NOW, updatedAt: NOW }
    );
    data.group_positions.push(
      { groupId: 'g1', x: 0, y: 0, width: 300, height: 200 },
      { groupId: 'g2', x: 320, y: 0, width: 300, height: 200 }
    );
    const out = buildParentGroup(data, { childGroupIds: ['g1', 'g2'], now: NOW });
    expect(out.parent.level).toBe(2);
    expect(out.parent.name).toBe('グループレベル2 1');
  });

  it('buildParentGroup yields level=3 when nesting two level=2 groups', () => {
    const data = emptyData();
    data.groups.push(
      { id: 'p1', name: 'グループレベル2 1', level: 2, parentGroupId: null, collapsed: false, createdAt: NOW, updatedAt: NOW },
      { id: 'p2', name: 'グループレベル2 2', level: 2, parentGroupId: null, collapsed: false, createdAt: NOW, updatedAt: NOW }
    );
    data.group_positions.push(
      { groupId: 'p1', x: 0, y: 0, width: 600, height: 400 },
      { groupId: 'p2', x: 700, y: 0, width: 600, height: 400 }
    );
    const out = buildParentGroup(data, { childGroupIds: ['p1', 'p2'], now: NOW });
    expect(out.parent.level).toBe(3);
    expect(out.parent.name).toBe('グループレベル3 1');
  });

  it('levelPrefix returns expected labels', () => {
    expect(levelPrefix(1)).toBe('グループレベル1');
    expect(levelPrefix(2)).toBe('グループレベル2');
    expect(levelPrefix(3)).toBe('グループレベル3');
    expect(levelPrefix(4)).toBe('グループレベル4');
  });

  it('flattenGroupTree returns nodes in tree order with depth', () => {
    const data = emptyData();
    data.groups.push(
      { id: 'p', name: 'P', level: 3, parentGroupId: null, collapsed: false, createdAt: NOW, updatedAt: NOW },
      { id: 'c1', name: 'C1', level: 2, parentGroupId: 'p', collapsed: false, createdAt: NOW, updatedAt: NOW },
      { id: 'c2', name: 'C2', level: 2, parentGroupId: 'p', collapsed: false, createdAt: NOW, updatedAt: NOW },
      { id: 'gc', name: 'GC', level: 1, parentGroupId: 'c1', collapsed: false, createdAt: NOW, updatedAt: NOW },
      { id: 'orph', name: 'Orph', level: 1, parentGroupId: null, collapsed: false, createdAt: NOW, updatedAt: NOW }
    );
    const flat = flattenGroupTree(data);
    expect(flat.map((n) => n.group.id)).toEqual(['p', 'c1', 'gc', 'c2', 'orph']);
    expect(flat.find((n) => n.group.id === 'gc')?.depth).toBe(2);
    expect(flat.find((n) => n.group.id === 'orph')?.depth).toBe(0);
  });

  it('collectGroupDescendantsForDrag recurses into grand-children', () => {
    const data = emptyData();
    data.cards.push(makeCard('c1', 'P01-001'));
    data.card_positions.push({ cardId: 'c1', x: 10, y: 10 });
    data.groups.push(
      { id: 'p', name: 'P', level: 3, parentGroupId: null, collapsed: false, createdAt: NOW, updatedAt: NOW },
      { id: 'm', name: 'M', level: 2, parentGroupId: 'p', collapsed: false, createdAt: NOW, updatedAt: NOW },
      { id: 'leaf', name: 'L', level: 1, parentGroupId: 'm', collapsed: false, createdAt: NOW, updatedAt: NOW }
    );
    data.group_positions.push(
      { groupId: 'p', x: 0, y: 0, width: 800, height: 600 },
      { groupId: 'm', x: 5, y: 5, width: 500, height: 400 },
      { groupId: 'leaf', x: 10, y: 10, width: 200, height: 150 }
    );
    data.group_memberships.push({ id: 'mem1', cardId: 'c1', groupId: 'leaf', createdAt: NOW });
    const desc = collectGroupDescendantsForDrag(data, 'p');
    const ids = desc.map((d) => d.id).sort();
    expect(ids).toEqual(['c1', 'leaf', 'm']);
  });
});

describe('group membership queries', () => {
  it('getCardGroupId returns the group id', () => {
    const data = emptyData();
    data.group_memberships.push({
      id: 'm1',
      cardId: 'c1',
      groupId: 'g1',
      createdAt: NOW,
    });
    expect(getCardGroupId(data, 'c1')).toBe('g1');
    expect(getCardGroupId(data, 'c2')).toBeNull();
  });

  it('getGroupMembers and getUngroupedCards partition cards', () => {
    const data = emptyData();
    data.cards.push(makeCard('c1', 'P01-001'), makeCard('c2', 'P01-002'), makeCard('c3', 'P01-003'));
    data.group_memberships.push(
      { id: 'm1', cardId: 'c1', groupId: 'g1', createdAt: NOW },
      { id: 'm2', cardId: 'c2', groupId: 'g1', createdAt: NOW }
    );
    expect(getGroupMembers(data, 'g1').map((c) => c.id).sort()).toEqual(['c1', 'c2']);
    expect(getUngroupedCards(data).map((c) => c.id)).toEqual(['c3']);
  });
});

describe('computeGroupCodes（グループ連番コード）', () => {
  const g = (id: string, level: number, createdAt: string) => ({
    id,
    name: id,
    level,
    parentGroupId: null,
    collapsed: false,
    createdAt,
    updatedAt: createdAt,
  });

  it('レベルごとに createdAt 順で 1 始まりの連番を振る', () => {
    const groups = [
      g('b', 1, '2026-05-18T00:00:02.000Z'),
      g('a', 1, '2026-05-18T00:00:01.000Z'),
      g('p', 2, '2026-05-18T00:00:03.000Z'),
    ];
    const codes = computeGroupCodes(groups);
    expect(codes.get('a')).toBe('L1-1');
    expect(codes.get('b')).toBe('L1-2');
    expect(codes.get('p')).toBe('L2-1');
  });

  it('createdAt が同値なら id で安定ソートする（全クライアントで一致）', () => {
    const groups = [
      g('z', 1, '2026-05-18T00:00:00.000Z'),
      g('a', 1, '2026-05-18T00:00:00.000Z'),
    ];
    const codes = computeGroupCodes(groups);
    expect(codes.get('a')).toBe('L1-1');
    expect(codes.get('z')).toBe('L1-2');
  });

  it('空配列では空の Map を返す', () => {
    expect(computeGroupCodes([]).size).toBe(0);
  });
});
