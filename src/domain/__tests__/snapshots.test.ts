import { describe, it, expect } from 'vitest';
import { buildSnapshot, diffSnapshots, rotateAutoSnapshots } from '../snapshots.js';
import type { ProjectData } from '@shared/types/domain';
import type { Snapshot } from '@shared/types/project';

const NOW = '2026-05-22T15:00:00Z';

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

function cardLike(id: string, code: string, body: string) {
  return {
    id,
    participantId: 'P01',
    code,
    serialNumber: 1,
    body,
    status: 'active' as const,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function groupLike(id: string, name: string, level = 1) {
  return {
    id,
    name,
    level,
    parentGroupId: null,
    collapsed: false,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe('buildSnapshot', () => {
  it('captures metadata and deep-clones data', () => {
    const data = emptyData();
    data.cards.push(cardLike('c1', 'P01-001', 'hello'));
    const snap = buildSnapshot({
      data,
      kind: 'manual',
      label: 'milestone',
      comment: 'after intro',
      now: NOW,
    });
    expect(snap.metadata.kind).toBe('manual');
    expect(snap.metadata.label).toBe('milestone');
    expect(snap.metadata.comment).toBe('after intro');
    expect(snap.metadata.timestamp).toBe(NOW);
    expect(snap.data.cards.length).toBe(1);
    // Mutating original data should not affect snapshot (deep clone)
    data.cards[0].body = 'mutated';
    expect(snap.data.cards[0].body).toBe('hello');
  });

  it('strips empty label / comment', () => {
    const snap = buildSnapshot({
      data: emptyData(),
      kind: 'auto',
      label: '',
      comment: '  ',
      now: NOW,
    });
    expect(snap.metadata.label).toBeUndefined();
    expect(snap.metadata.comment).toBeUndefined();
  });
});

describe('diffSnapshots', () => {
  it('reports added / removed / changed', () => {
    const a = emptyData();
    a.cards.push(cardLike('c1', 'P01-001', 'first'));
    a.cards.push(cardLike('c2', 'P01-002', 'kept'));
    const b = emptyData();
    b.cards.push(cardLike('c2', 'P01-002', 'kept'));
    b.cards.push(cardLike('c3', 'P01-003', 'new'));
    b.cards.push(cardLike('c4', 'P01-004', 'also new'));
    const diff = diffSnapshots(a, b);
    expect(diff.cards.added.map((c) => c.id).sort()).toEqual(['c3', 'c4']);
    expect(diff.cards.removed.map((c) => c.id)).toEqual(['c1']);
    expect(diff.counts.cardsBefore).toBe(2);
    expect(diff.counts.cardsAfter).toBe(3);
  });

  it('reports body changes as `changed`', () => {
    const a = emptyData();
    a.cards.push(cardLike('c1', 'P01-001', 'old'));
    const b = emptyData();
    b.cards.push({ ...cardLike('c1', 'P01-001', 'new'), updatedAt: '2026-05-23T00:00:00Z' });
    const diff = diffSnapshots(a, b);
    expect(diff.cards.changed.length).toBe(1);
    expect(diff.cards.changed[0].before.body).toBe('old');
    expect(diff.cards.changed[0].after.body).toBe('new');
  });

  it('reports group changes', () => {
    const a = emptyData();
    a.groups.push(groupLike('g1', 'A'));
    const b = emptyData();
    b.groups.push(groupLike('g1', 'A renamed'));
    b.groups.push(groupLike('g2', 'B'));
    const diff = diffSnapshots(a, b);
    expect(diff.groups.added.map((g) => g.id)).toEqual(['g2']);
    expect(diff.groups.changed.length).toBe(1);
    expect(diff.groups.changed[0].after.name).toBe('A renamed');
  });
});

describe('rotateAutoSnapshots', () => {
  function snap(id: string, kind: 'auto' | 'manual', ts: string): Snapshot {
    return {
      metadata: { id, timestamp: ts, kind },
      data: emptyData(),
    };
  }

  it('keeps all manual + only N most recent auto', () => {
    const list: Snapshot[] = [
      snap('m1', 'manual', '2026-05-22T10:00:00Z'),
      snap('a1', 'auto', '2026-05-22T11:00:00Z'),
      snap('a2', 'auto', '2026-05-22T12:00:00Z'),
      snap('a3', 'auto', '2026-05-22T13:00:00Z'),
      snap('m2', 'manual', '2026-05-22T14:00:00Z'),
      snap('a4', 'auto', '2026-05-22T15:00:00Z'),
    ];
    const out = rotateAutoSnapshots(list, 2);
    const ids = out.map((s) => s.metadata.id);
    expect(ids).toContain('m1');
    expect(ids).toContain('m2');
    // Keep only newest 2 autos
    expect(ids).toContain('a3');
    expect(ids).toContain('a4');
    expect(ids).not.toContain('a1');
    expect(ids).not.toContain('a2');
  });

  it('keep=0 removes all auto snapshots', () => {
    const list: Snapshot[] = [
      snap('m1', 'manual', '2026-05-22T10:00:00Z'),
      snap('a1', 'auto', '2026-05-22T11:00:00Z'),
    ];
    const out = rotateAutoSnapshots(list, 0);
    expect(out.map((s) => s.metadata.id)).toEqual(['m1']);
  });
});
