import { describe, it, expect } from 'vitest';
import {
  createEmptyFinalDiagram,
  createFinalShape,
  getFinalDiagram,
  getGroupNarrative,
  orderedGroupMemberCardIds,
  resolveFinalGroupPosition,
  seedFinalLayoutFromCanvas,
} from '../finalDiagram.js';
import type {
  FinalDiagram,
  Group,
  GroupPosition,
  ProjectData,
} from '@shared/types/domain';

const NOW = '2026-05-31T00:00:00.000Z';

function dataWith(final_diagram?: FinalDiagram): ProjectData {
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
    final_diagram,
  };
}

describe('createEmptyFinalDiagram', () => {
  it('returns an empty diagram with empty layout and shapes', () => {
    const fd = createEmptyFinalDiagram();
    expect(fd.groupLayout).toEqual({});
    expect(fd.shapes).toEqual([]);
    expect(fd.title).toBeUndefined();
    expect(fd.annotation).toBeUndefined();
  });
});

describe('getFinalDiagram', () => {
  it('returns empty when data is null/undefined (backward compat with pre-v9)', () => {
    expect(getFinalDiagram(undefined).groupLayout).toEqual({});
    expect(getFinalDiagram(null).shapes).toEqual([]);
  });

  it('returns empty when data has no final_diagram (pre-v9 project)', () => {
    expect(getFinalDiagram(dataWith(undefined)).shapes).toEqual([]);
  });

  it('returns a defensive copy of the diagram when present', () => {
    const fd: FinalDiagram = {
      title: 'My KJ',
      annotation: { date: '2026-05-31', authors: '中田' },
      groupLayout: { 'g-1': { x: 10, y: 20 } },
      shapes: [],
    };
    const out = getFinalDiagram(dataWith(fd));
    expect(out.title).toBe('My KJ');
    expect(out.annotation?.authors).toBe('中田');
    expect(out.groupLayout['g-1']).toEqual({ x: 10, y: 20 });
    // annotation is a fresh object (not aliased)
    expect(out.annotation).not.toBe(fd.annotation);
  });

  it('defensively fills missing groupLayout/shapes when partial', () => {
    // simulate a corrupted file where finalDiagram is partially missing fields
    const partial = { title: 'X' } as unknown as FinalDiagram;
    const out = getFinalDiagram(dataWith(partial));
    expect(out.groupLayout).toEqual({});
    expect(out.shapes).toEqual([]);
  });
});

describe('seedFinalLayoutFromCanvas', () => {
  it('copies KJ canvas group_positions into a layout map', () => {
    const positions: GroupPosition[] = [
      { groupId: 'g-a', x: 0, y: 0, width: 100, height: 60 },
      { groupId: 'g-b', x: 200, y: 100, width: 150, height: 80 },
    ];
    const layout = seedFinalLayoutFromCanvas(positions);
    expect(layout['g-a']).toEqual({ x: 0, y: 0, width: 100, height: 60 });
    expect(layout['g-b']).toEqual({ x: 200, y: 100, width: 150, height: 80 });
  });

  it('returns an empty object when there are no positions', () => {
    expect(seedFinalLayoutFromCanvas([])).toEqual({});
  });
});

describe('resolveFinalGroupPosition', () => {
  const fd: FinalDiagram = {
    groupLayout: { 'g-own': { x: 555, y: 444 } },
    shapes: [],
  };
  const fb: GroupPosition[] = [
    { groupId: 'g-own', x: 0, y: 0, width: 50, height: 30 },
    { groupId: 'g-fb', x: 11, y: 22, width: 60, height: 40 },
  ];

  it('prefers the finalDiagram own layout when present', () => {
    const r = resolveFinalGroupPosition(fd, fb, 'g-own');
    expect(r).toEqual({ x: 555, y: 444 });
  });

  it('falls back to KJ canvas position when own layout is missing', () => {
    const r = resolveFinalGroupPosition(fd, fb, 'g-fb');
    expect(r).toEqual({ x: 11, y: 22, width: 60, height: 40 });
  });

  it('returns null if neither is present', () => {
    expect(resolveFinalGroupPosition(fd, fb, 'g-unknown')).toBeNull();
  });
});

describe('createFinalShape', () => {
  it('creates a shape with defaults for a relation-type kind', () => {
    const s = createFinalShape('causes', 100, 50, NOW);
    expect(s.kind).toBe('causes');
    expect(s.x).toBe(100);
    expect(s.y).toBe(50);
    expect(s.width).toBe(120);
    expect(s.height).toBe(80);
    expect(s.rotation).toBe(0);
    expect(s.anchorGroupId).toBeNull();
    expect(s.createdAt).toBe(NOW);
    expect(s.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('uses kind-specific defaults for "text"', () => {
    const s = createFinalShape('text', 0, 0, NOW);
    expect(s.width).toBe(160);
    expect(s.height).toBe(40);
  });

  it('uses kind-specific defaults for "arrow_standalone"', () => {
    const s = createFinalShape('arrow_standalone', 0, 0, NOW);
    expect(s.width).toBe(140);
    expect(s.height).toBe(30);
  });

  it('respects explicit overrides', () => {
    const s = createFinalShape('rect', 0, 0, NOW, {
      width: 200,
      height: 100,
      rotation: 45,
      label: 'メモ',
      color: '#ff0000',
      anchorGroupId: 'g-1',
      z: 10,
    });
    expect(s.width).toBe(200);
    expect(s.height).toBe(100);
    expect(s.rotation).toBe(45);
    expect(s.label).toBe('メモ');
    expect(s.color).toBe('#ff0000');
    expect(s.anchorGroupId).toBe('g-1');
    expect(s.z).toBe(10);
  });
});

describe('getGroupNarrative', () => {
  it('returns empty string when group is null/undefined or has no narrative', () => {
    expect(getGroupNarrative(undefined)).toBe('');
    expect(getGroupNarrative(null)).toBe('');
    const g: Group = {
      id: 'g',
      name: 'x',
      level: 1,
      parentGroupId: null,
      collapsed: false,
      createdAt: NOW,
      updatedAt: NOW,
    };
    expect(getGroupNarrative(g)).toBe('');
  });

  it('returns the narrative when present', () => {
    const g: Group = {
      id: 'g',
      name: 'x',
      level: 1,
      parentGroupId: null,
      collapsed: false,
      narrative: '島 A は B を促進する',
      createdAt: NOW,
      updatedAt: NOW,
    };
    expect(getGroupNarrative(g)).toBe('島 A は B を促進する');
  });
});

describe('orderedGroupMemberCardIds', () => {
  it('returns member cardIds filtered by groupId in original order', () => {
    const memberships = [
      { cardId: 'c-1', groupId: 'g-a' },
      { cardId: 'c-2', groupId: 'g-b' },
      { cardId: 'c-3', groupId: 'g-a' },
    ];
    expect(orderedGroupMemberCardIds('g-a', memberships)).toEqual(['c-1', 'c-3']);
    expect(orderedGroupMemberCardIds('g-b', memberships)).toEqual(['c-2']);
    expect(orderedGroupMemberCardIds('g-none', memberships)).toEqual([]);
  });
});
