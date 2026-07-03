import { describe, it, expect } from 'vitest';
import type { ProjectData } from '@shared/types/domain';
import {
  buildRelation,
  RELATION_TYPE_LABELS,
  RELATION_TYPE_ORDER,
  RelationError,
  relationDisplayLabel,
  relationExists,
  migrateRelationType,
  normalizeProjectRelations,
  normalizeFinalDiagramShapes,
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
      relationType: 'opposes' as const,
      memoIds: [],
      createdAt: NOW,
      updatedAt: NOW,
    };
    expect(relationDisplayLabel(r)).toBe(RELATION_TYPE_LABELS.opposes);
  });
});

describe('migrateRelationType', () => {
  it('maps every legacy key to a valid new key', () => {
    const legacyToNew: Record<string, string> = {
      causes: 'causes',
      promotes: 'influences',
      inhibits: 'influences',
      precedes: 'presupposes',
      follows: 'results_in',
      contrasts_with: 'opposes',
      supports: 'complements',
      questions: 'refutes',
      part_of: 'subsumes',
      example_of: 'exemplifies',
      abstracts: 'subsumes',
      derived_from: 'defines',
      co_occurs_with: 'parallels',
      custom: 'custom',
    };
    for (const [legacy, expected] of Object.entries(legacyToNew)) {
      expect(migrateRelationType(legacy)).toBe(expected);
      expect(RELATION_TYPE_ORDER).toContain(migrateRelationType(legacy));
    }
  });

  it('passes through new keys unchanged', () => {
    for (const key of RELATION_TYPE_ORDER) {
      expect(migrateRelationType(key)).toBe(key);
    }
  });

  it('passes through decorative shape kinds unchanged', () => {
    for (const kind of ['circle', 'rect', 'cloud', 'bracket', 'arrow_standalone', 'text']) {
      expect(migrateRelationType(kind)).toBe(kind);
    }
  });

  it('coerces unknown relation strings to custom', () => {
    expect(migrateRelationType('totally_unknown')).toBe('custom');
  });
});

describe('normalizeProjectRelations', () => {
  it('rewrites legacy relationType in place', () => {
    const d = emptyData();
    d.diagram_relations.push({
      id: 'r1',
      sourceObjectType: 'group',
      sourceObjectId: 'g1',
      targetObjectType: 'group',
      targetObjectId: 'g2',
      relationType: 'contrasts_with' as never,
      memoIds: [],
      createdAt: NOW,
      updatedAt: NOW,
    });
    normalizeProjectRelations(d);
    expect(d.diagram_relations[0].relationType).toBe('opposes');
  });
});

describe('normalizeFinalDiagramShapes', () => {
  it('migrates relation kinds but keeps decorative kinds', () => {
    const fd = {
      shapes: [
        { id: 's1', kind: 'part_of' },
        { id: 's2', kind: 'circle' },
        { id: 's3', kind: 'mystery' },
      ],
    };
    normalizeFinalDiagramShapes(fd);
    expect(fd.shapes[0].kind).toBe('subsumes');
    expect(fd.shapes[1].kind).toBe('circle');
    expect(fd.shapes[2].kind).toBe('custom');
  });
});
