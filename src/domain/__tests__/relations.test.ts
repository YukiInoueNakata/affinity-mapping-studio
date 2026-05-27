import { describe, it, expect } from 'vitest';
import type { ProjectData } from '@shared/types/domain';
import {
  buildRelation,
  RELATION_TYPE_LABELS,
  RelationError,
  relationDisplayLabel,
  relationExists,
} from '../relations.js';

const NOW = '2026-05-21T00:00:00.000Z';

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

describe('buildRelation', () => {
  it('creates a relation between two groups', () => {
    const r = buildRelation({
      sourceObjectType: 'group',
      sourceObjectId: 'g1',
      targetObjectType: 'group',
      targetObjectId: 'g2',
      relationType: 'causes',
      now: NOW,
    });
    expect(r.sourceObjectId).toBe('g1');
    expect(r.targetObjectId).toBe('g2');
    expect(r.relationType).toBe('causes');
    expect(r.memoIds).toEqual([]);
  });

  it('rejects self-loops', () => {
    expect(() =>
      buildRelation({
        sourceObjectType: 'group',
        sourceObjectId: 'g1',
        targetObjectType: 'group',
        targetObjectId: 'g1',
        relationType: 'causes',
        now: NOW,
      })
    ).toThrow(RelationError);
  });

  it('allows custom label override', () => {
    const r = buildRelation({
      sourceObjectType: 'group',
      sourceObjectId: 'a',
      targetObjectType: 'group',
      targetObjectId: 'b',
      relationType: 'custom',
      label: '相互依存',
      now: NOW,
    });
    expect(r.label).toBe('相互依存');
  });
});

describe('relationExists', () => {
  it('detects duplicates by source/target pair (directed)', () => {
    const d = emptyData();
    d.diagram_relations.push({
      id: 'r1',
      sourceObjectType: 'group',
      sourceObjectId: 'g1',
      targetObjectType: 'group',
      targetObjectId: 'g2',
      relationType: 'causes',
      memoIds: [],
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(relationExists(d, 'group', 'g1', 'group', 'g2')).toBe(true);
    expect(relationExists(d, 'group', 'g2', 'group', 'g1')).toBe(false);
  });
});

describe('relationDisplayLabel', () => {
  it('returns the custom label when present', () => {
    const r = {
      id: 'r',
      sourceObjectType: 'group' as const,
      sourceObjectId: 'a',
      targetObjectType: 'group' as const,
      targetObjectId: 'b',
      relationType: 'causes' as const,
      label: 'カスタムラベル',
      memoIds: [],
      createdAt: NOW,
      updatedAt: NOW,
    };
    expect(relationDisplayLabel(r)).toBe('カスタムラベル');
  });

  it('falls back to the type label when custom label is empty', () => {
    const r = {
      id: 'r',
      sourceObjectType: 'group' as const,
      sourceObjectId: 'a',
      targetObjectType: 'group' as const,
      targetObjectId: 'b',
      relationType: 'contrasts_with' as const,
      memoIds: [],
      createdAt: NOW,
      updatedAt: NOW,
    };
    expect(relationDisplayLabel(r)).toBe(RELATION_TYPE_LABELS.contrasts_with);
  });
});
