import { describe, it, expect } from 'vitest';
import type { ProjectData } from '@shared/types/domain';
import {
  buildConcept,
  buildConceptFromCards,
  buildConceptFromGroup,
  buildMGtaCategory,
  buildSettings,
  buildVariation,
  CONCEPT_STATUS_LABELS,
  getActiveSettings,
  getConceptsForCategory,
  getVariationsForConcept,
  MGtaError,
  nextConceptName,
  VARIATION_ROLE_LABELS,
} from '../mgta.js';

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

describe('buildSettings', () => {
  it('trims theme and focal person', () => {
    const s = buildSettings({
      analysisTheme: '  自律性の発達  ',
      focalPerson: '  中学生  ',
      now: NOW,
    });
    expect(s.analysisTheme).toBe('自律性の発達');
    expect(s.focalPerson).toBe('中学生');
  });
});

describe('getActiveSettings', () => {
  it('returns null when no settings exist', () => {
    expect(getActiveSettings(emptyData())).toBeNull();
  });
  it('returns the most recently updated settings', () => {
    const d = emptyData();
    d.m_gta_settings.push(
      buildSettings({ analysisTheme: '旧', focalPerson: 'X', now: '2026-05-20T00:00:00.000Z' }),
      buildSettings({ analysisTheme: '新', focalPerson: 'Y', now: '2026-05-21T00:00:00.000Z' })
    );
    expect(getActiveSettings(d)?.analysisTheme).toBe('新');
  });
});

describe('buildConcept', () => {
  it('creates a draft concept with sane defaults', () => {
    const c = buildConcept({ settingsId: 's1', now: NOW });
    expect(c.status).toBe('draft');
    expect(c.name).toBe('');
    expect(c.definition).toBe('');
    expect(c.settingsId).toBe('s1');
  });
});

describe('nextConceptName', () => {
  it('starts at 概念 1', () => {
    expect(nextConceptName(emptyData())).toBe('概念 1');
  });
  it('skips used names', () => {
    const d = emptyData();
    d.m_gta_concepts.push(
      buildConcept({ settingsId: 's1', name: '概念 1', now: NOW })
    );
    expect(nextConceptName(d)).toBe('概念 2');
  });
});

describe('buildVariation', () => {
  it('throws when source-typed variation has no sourceId', () => {
    expect(() =>
      buildVariation({
        conceptId: 'c1',
        sourceType: 'card',
        now: NOW,
      })
    ).toThrow(MGtaError);
  });
  it('accepts free_text without sourceId', () => {
    const v = buildVariation({
      conceptId: 'c1',
      sourceType: 'free_text',
      interpretation: 'メモ',
      now: NOW,
    });
    expect(v.role).toBe('variation');
    expect(v.sourceType).toBe('free_text');
  });
});

describe('buildConceptFromGroup', () => {
  it('uses the group label text as concept name when not specified', () => {
    const d = emptyData();
    d.groups.push({
      id: 'g1',
      name: 'グループ 1',
      level: 1,
      parentGroupId: null,
      collapsed: false,
      createdAt: NOW,
      updatedAt: NOW,
    });
    d.labels.push({
      id: 'l1',
      groupId: 'g1',
      text: '自律性の試み',
      sharedMemo: 'チーム全員で共有',
      basisMemo: '',
      holdMemo: '',
      createdAt: NOW,
      updatedAt: NOW,
    });
    d.cards.push({
      id: 'c1',
      participantId: 'p1',
      code: 'P01-001',
      serialNumber: 1,
      body: '親に反抗してみた',
      status: 'active',
      createdAt: NOW,
      updatedAt: NOW,
    });
    d.group_memberships.push({ id: 'm1', cardId: 'c1', groupId: 'g1', createdAt: NOW });
    const out = buildConceptFromGroup(d, {
      groupId: 'g1',
      settingsId: 's1',
      includeMemberCards: true,
      includeLabelAsDefinition: true,
      now: NOW,
    });
    expect(out.concept.name).toBe('自律性の試み');
    expect(out.concept.definition).toBe('チーム全員で共有');
    expect(out.concept.derivedFromGroupId).toBe('g1');
    expect(out.variations).toHaveLength(1);
    expect(out.variations[0].sourceType).toBe('card');
    expect(out.variations[0].sourceId).toBe('c1');
  });

  it('does not include cards when includeMemberCards is false', () => {
    const d = emptyData();
    d.groups.push({
      id: 'g1',
      name: 'g',
      level: 1,
      parentGroupId: null,
      collapsed: false,
      createdAt: NOW,
      updatedAt: NOW,
    });
    d.cards.push({
      id: 'c1',
      participantId: 'p1',
      code: 'P01-001',
      serialNumber: 1,
      body: '',
      status: 'active',
      createdAt: NOW,
      updatedAt: NOW,
    });
    d.group_memberships.push({ id: 'm1', cardId: 'c1', groupId: 'g1', createdAt: NOW });
    const out = buildConceptFromGroup(d, {
      groupId: 'g1',
      settingsId: 's1',
      includeMemberCards: false,
      includeLabelAsDefinition: false,
      now: NOW,
    });
    expect(out.variations).toHaveLength(0);
  });
});

describe('buildConceptFromCards', () => {
  it('creates a concept with variations from selected cards', () => {
    const d = emptyData();
    d.cards.push(
      {
        id: 'c1',
        participantId: 'p1',
        code: 'P01-001',
        serialNumber: 1,
        body: 'A',
        status: 'active',
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: 'c2',
        participantId: 'p1',
        code: 'P01-002',
        serialNumber: 2,
        body: 'B',
        status: 'active',
        createdAt: NOW,
        updatedAt: NOW,
      }
    );
    const out = buildConceptFromCards(d, {
      cardIds: ['c1', 'c2'],
      settingsId: 's1',
      conceptName: '新しい概念',
      role: 'similar_example',
      now: NOW,
    });
    expect(out.concept.name).toBe('新しい概念');
    expect(out.variations).toHaveLength(2);
    expect(out.variations.every((v) => v.role === 'similar_example')).toBe(true);
  });

  it('throws when no cards selected', () => {
    expect(() =>
      buildConceptFromCards(emptyData(), {
        cardIds: [],
        settingsId: 's1',
        conceptName: 'x',
        now: NOW,
      })
    ).toThrow(MGtaError);
  });
});

describe('getVariationsForConcept / getConceptsForCategory', () => {
  it('partitions concepts by category', () => {
    const d = emptyData();
    d.m_gta_concepts.push(
      buildConcept({ settingsId: 's1', name: 'A', categoryId: 'cat1', now: NOW }),
      buildConcept({ settingsId: 's1', name: 'B', categoryId: 'cat1', now: NOW }),
      buildConcept({ settingsId: 's1', name: 'C', now: NOW })
    );
    expect(getConceptsForCategory(d, 'cat1').map((c) => c.name).sort()).toEqual(['A', 'B']);
    expect(getConceptsForCategory(d, null).map((c) => c.name)).toEqual(['C']);
  });

  it('returns only variations for a given concept', () => {
    const d = emptyData();
    d.m_gta_variations.push(
      buildVariation({ conceptId: 'c1', sourceType: 'free_text', interpretation: 'x', now: NOW }),
      buildVariation({ conceptId: 'c2', sourceType: 'free_text', interpretation: 'y', now: NOW })
    );
    expect(getVariationsForConcept(d, 'c1')).toHaveLength(1);
    expect(getVariationsForConcept(d, 'c1')[0].interpretation).toBe('x');
  });
});

describe('label tables', () => {
  it('exports labels for variation roles and concept statuses', () => {
    expect(VARIATION_ROLE_LABELS.variation).toBe('ヴァリエーション');
    expect(VARIATION_ROLE_LABELS.opposite_example).toBe('対極例');
    expect(CONCEPT_STATUS_LABELS.draft).toBe('草案');
  });
});

describe('buildMGtaCategory', () => {
  it('trims name and defaults parent to undefined', () => {
    const c = buildMGtaCategory({ name: '  カテゴリ 1  ', now: NOW });
    expect(c.name).toBe('カテゴリ 1');
    expect(c.parentCategoryId).toBeUndefined();
  });
});
