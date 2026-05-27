import { describe, it, expect } from 'vitest';
import type { ProjectData } from '@shared/types/domain';
import {
  DEFAULT_SCOPE,
  findBulkReplaceHits,
  type BulkReplaceFieldKind,
} from '../bulkReplace.js';

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

function fullScope(): Set<BulkReplaceFieldKind> {
  return new Set(DEFAULT_SCOPE);
}

describe('findBulkReplaceHits', () => {
  it('returns empty when query is empty', () => {
    expect(
      findBulkReplaceHits(emptyData(), {
        query: '',
        replacement: 'x',
        caseSensitive: false,
        wholeWord: false,
        scope: fullScope(),
      })
    ).toEqual([]);
  });

  it('matches card body case-insensitive by default', () => {
    const d = emptyData();
    d.cards.push({
      id: 'c1',
      participantId: 'p1',
      code: 'P01-001',
      serialNumber: 1,
      body: 'Hello WORLD',
      status: 'active',
      createdAt: NOW,
      updatedAt: NOW,
    });
    const hits = findBulkReplaceHits(d, {
      query: 'world',
      replacement: '世界',
      caseSensitive: false,
      wholeWord: false,
      scope: fullScope(),
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('card_body');
    expect(hits[0].nextValue).toBe('Hello 世界');
    expect(hits[0].matchCount).toBe(1);
  });

  it('case sensitive mode misses different casing', () => {
    const d = emptyData();
    d.cards.push({
      id: 'c1',
      participantId: 'p1',
      code: 'P01-001',
      serialNumber: 1,
      body: 'Hello WORLD',
      status: 'active',
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(
      findBulkReplaceHits(d, {
        query: 'world',
        replacement: 'X',
        caseSensitive: true,
        wholeWord: false,
        scope: fullScope(),
      })
    ).toHaveLength(0);
  });

  it('respects scope filter', () => {
    const d = emptyData();
    d.cards.push({
      id: 'c1',
      participantId: 'p1',
      code: 'P01-001',
      serialNumber: 1,
      body: 'hello',
      memo: 'hello memo',
      status: 'active',
      createdAt: NOW,
      updatedAt: NOW,
    });
    const onlyBody = new Set<BulkReplaceFieldKind>(['card_body']);
    const hits = findBulkReplaceHits(d, {
      query: 'hello',
      replacement: 'hi',
      caseSensitive: false,
      wholeWord: false,
      scope: onlyBody,
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('card_body');
  });

  it('matches label fields', () => {
    const d = emptyData();
    d.labels.push({
      id: 'l1',
      groupId: 'g1',
      text: '回避タイトル',
      sharedMemo: '共有メモに回避を含む',
      basisMemo: '',
      holdMemo: '',
      createdAt: NOW,
      updatedAt: NOW,
    });
    const hits = findBulkReplaceHits(d, {
      query: '回避',
      replacement: '逃避',
      caseSensitive: false,
      wholeWord: false,
      scope: fullScope(),
    });
    expect(hits.length).toBeGreaterThanOrEqual(2);
    const kinds = hits.map((h) => h.kind).sort();
    expect(kinds).toContain('label_text');
    expect(kinds).toContain('label_sharedMemo');
  });

  it('reports correct match counts for multi-match strings', () => {
    const d = emptyData();
    d.cards.push({
      id: 'c1',
      participantId: 'p1',
      code: 'P01-001',
      serialNumber: 1,
      body: 'aaa bbb aaa ccc aaa',
      status: 'active',
      createdAt: NOW,
      updatedAt: NOW,
    });
    const hits = findBulkReplaceHits(d, {
      query: 'aaa',
      replacement: 'XXX',
      caseSensitive: false,
      wholeWord: false,
      scope: fullScope(),
    });
    expect(hits[0].matchCount).toBe(3);
    expect(hits[0].nextValue).toBe('XXX bbb XXX ccc XXX');
  });
});
