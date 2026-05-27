import { describe, it, expect } from 'vitest';
import {
  buildCard,
  buildMergedCard,
  buildSplitCards,
  MergeError,
  nextCardSerial,
  SplitError,
} from '../cards.js';
import type { ProjectData, Participant, SourceSegment } from '@shared/types/domain';

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

function p(code: string, id = `pid-${code}`): Participant {
  return { id, code, displayName: code, createdAt: '2026-05-18T00:00:00.000Z' };
}

function seg(participantId: string, text: string, id = 'seg-1'): SourceSegment {
  return {
    id,
    participantId,
    sourceFile: 'a.txt',
    importedAt: '2026-05-18T00:00:00.000Z',
    order: 0,
    text,
    previousVersionId: null,
    deletedAt: null,
  };
}

describe('nextCardSerial', () => {
  it('starts at 1 when no cards exist', () => {
    const data = emptyData();
    expect(nextCardSerial(data, 'pid-P01')).toBe(1);
  });

  it('returns max+1 (永久欠番) even if cards were deleted', () => {
    const data = emptyData();
    data.cards.push(
      {
        id: 'c1',
        participantId: 'pid-P01',
        code: 'P01-001',
        serialNumber: 1,
        body: '',
        status: 'active',
        createdAt: '2026-05-18T00:00:00.000Z',
        updatedAt: '2026-05-18T00:00:00.000Z',
      },
      {
        id: 'c2',
        participantId: 'pid-P01',
        code: 'P01-003',
        serialNumber: 3,
        body: '',
        status: 'active',
        createdAt: '2026-05-18T00:00:00.000Z',
        updatedAt: '2026-05-18T00:00:00.000Z',
      }
    );
    expect(nextCardSerial(data, 'pid-P01')).toBe(4);
  });

  it('counts only the specified participant', () => {
    const data = emptyData();
    data.cards.push({
      id: 'c1',
      participantId: 'pid-P02',
      code: 'P02-001',
      serialNumber: 1,
      body: '',
      status: 'active',
      createdAt: '2026-05-18T00:00:00.000Z',
      updatedAt: '2026-05-18T00:00:00.000Z',
    });
    expect(nextCardSerial(data, 'pid-P01')).toBe(1);
  });
});

describe('buildCard', () => {
  it('creates card / link / position with correct code for a single range', () => {
    const data = emptyData();
    const participant = p('P01');
    const s = seg(participant.id, 'こんにちは、世界');
    const out = buildCard(data, {
      participant,
      ranges: [
        {
          segment: s,
          startOffset: 0,
          endOffset: 5,
          selectedText: 'こんにちは',
        },
      ],
      now: '2026-05-18T00:00:00.000Z',
    });
    expect(out.card.code).toBe('P01-001');
    expect(out.card.body).toBe('こんにちは');
    expect(out.links).toHaveLength(1);
    expect(out.links[0].cardId).toBe(out.card.id);
    expect(out.links[0].selectedTextSnapshot).toBe('こんにちは');
    expect(out.position.cardId).toBe(out.card.id);
  });

  it('concatenates multi-segment ranges with newlines and creates links per range', () => {
    const data = emptyData();
    const participant = p('P01');
    const s1 = seg(participant.id, 'AAA BBB', 'seg-1');
    const s2 = seg(participant.id, 'CCC DDD', 'seg-2');
    const out = buildCard(data, {
      participant,
      ranges: [
        { segment: s1, startOffset: 4, endOffset: 7, selectedText: 'BBB' },
        { segment: s2, startOffset: 0, endOffset: 3, selectedText: 'CCC' },
      ],
      now: '2026-05-18T00:00:00.000Z',
    });
    expect(out.card.body).toBe('BBB\nCCC');
    expect(out.links).toHaveLength(2);
    expect(out.links.map((l) => l.segmentId).sort()).toEqual(['seg-1', 'seg-2']);
  });

  it('throws when no ranges are provided', () => {
    const data = emptyData();
    const participant = p('P01');
    expect(() =>
      buildCard(data, { participant, ranges: [], now: '2026-05-18T00:00:00.000Z' })
    ).toThrow();
  });
});

describe('buildMergedCard', () => {
  const NOW = '2026-05-21T00:00:00.000Z';
  function setupTwoCards(): ProjectData {
    const data = emptyData();
    const part = p('P01');
    data.participants.push(part);
    data.cards.push(
      {
        id: 'c1',
        participantId: part.id,
        code: 'P01-001',
        serialNumber: 1,
        body: 'カード1の本文',
        status: 'active',
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: 'c2',
        participantId: part.id,
        code: 'P01-002',
        serialNumber: 2,
        body: 'カード2の本文',
        status: 'active',
        createdAt: NOW,
        updatedAt: NOW,
      }
    );
    data.card_positions.push(
      { cardId: 'c1', x: 100, y: 100 },
      { cardId: 'c2', x: 200, y: 200 }
    );
    data.card_source_links.push(
      {
        id: 'l1',
        cardId: 'c1',
        segmentId: 'seg-1',
        startOffset: 0,
        endOffset: 5,
        selectedTextSnapshot: 'A',
        createdAt: NOW,
      },
      {
        id: 'l2',
        cardId: 'c2',
        segmentId: 'seg-2',
        startOffset: 0,
        endOffset: 5,
        selectedTextSnapshot: 'B',
        createdAt: NOW,
      }
    );
    return data;
  }

  it('merges two cards: body concatenated, new code, average position', () => {
    const data = setupTwoCards();
    const out = buildMergedCard(data, { cardIds: ['c1', 'c2'], now: NOW });
    expect(out.newCard.code).toBe('P01-003');
    expect(out.newCard.body).toBe('カード1の本文カード2の本文');
    expect(out.newPosition.x).toBe(150);
    expect(out.newPosition.y).toBe(150);
    expect(out.newLinks).toHaveLength(2);
    expect(out.newLinks.map((l) => l.segmentId).sort()).toEqual(['seg-1', 'seg-2']);
    expect(out.newLinks.every((l) => l.cardId === out.newCard.id)).toBe(true);
    expect(out.oldCards.map((c) => c.id).sort()).toEqual(['c1', 'c2']);
    expect(out.newMembership).toBeNull();
  });

  it('keeps the shared group when all merged cards belong to the same group', () => {
    const data = setupTwoCards();
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
    const out = buildMergedCard(data, { cardIds: ['c1', 'c2'], now: NOW });
    expect(out.newMembership?.groupId).toBe('g1');
    expect(out.oldMemberships.map((m) => m.id).sort()).toEqual(['m1', 'm2']);
  });

  it('drops membership when merged cards are in different groups', () => {
    const data = setupTwoCards();
    data.groups.push(
      { id: 'g1', name: 'g1', level: 1, parentGroupId: null, collapsed: false, createdAt: NOW, updatedAt: NOW },
      { id: 'g2', name: 'g2', level: 1, parentGroupId: null, collapsed: false, createdAt: NOW, updatedAt: NOW }
    );
    data.group_memberships.push(
      { id: 'm1', cardId: 'c1', groupId: 'g1', createdAt: NOW },
      { id: 'm2', cardId: 'c2', groupId: 'g2', createdAt: NOW }
    );
    const out = buildMergedCard(data, { cardIds: ['c1', 'c2'], now: NOW });
    expect(out.newMembership).toBeNull();
  });

  it('throws when fewer than 2 cards', () => {
    const data = setupTwoCards();
    expect(() => buildMergedCard(data, { cardIds: ['c1'], now: NOW })).toThrow(MergeError);
  });

  it('throws when cards have different participants', () => {
    const data = setupTwoCards();
    const part2 = p('P02', 'pid-P02');
    data.participants.push(part2);
    data.cards.push({
      id: 'c3',
      participantId: part2.id,
      code: 'P02-001',
      serialNumber: 1,
      body: '',
      status: 'active',
      createdAt: NOW,
      updatedAt: NOW,
    });
    data.card_positions.push({ cardId: 'c3', x: 0, y: 0 });
    expect(() => buildMergedCard(data, { cardIds: ['c1', 'c3'], now: NOW })).toThrow(MergeError);
  });
});

describe('buildSplitCards', () => {
  const NOW = '2026-05-21T00:00:00.000Z';
  function setupOneCard(body: string): ProjectData {
    const data = emptyData();
    const part = p('P01');
    data.participants.push(part);
    data.cards.push({
      id: 'c1',
      participantId: part.id,
      code: 'P01-001',
      serialNumber: 1,
      body,
      status: 'active',
      createdAt: NOW,
      updatedAt: NOW,
    });
    data.card_positions.push({ cardId: 'c1', x: 200, y: 300 });
    data.card_source_links.push({
      id: 'l1',
      cardId: 'c1',
      segmentId: 'seg-1',
      startOffset: 0,
      endOffset: 5,
      selectedTextSnapshot: 'X',
      createdAt: NOW,
    });
    return data;
  }

  it('splits a card into N parts with sequential card codes', () => {
    const data = setupOneCard('AAA\nBBB\nCCC');
    const out = buildSplitCards(data, {
      cardId: 'c1',
      bodyParts: ['AAA', 'BBB', 'CCC'],
      now: NOW,
    });
    expect(out.newCards).toHaveLength(3);
    expect(out.newCards.map((c) => c.code)).toEqual(['P01-002', 'P01-003', 'P01-004']);
    expect(out.newCards.map((c) => c.body)).toEqual(['AAA', 'BBB', 'CCC']);
    expect(out.oldCard.id).toBe('c1');
  });

  it('clones source_links to each new card', () => {
    const data = setupOneCard('AAA\nBBB');
    const out = buildSplitCards(data, {
      cardId: 'c1',
      bodyParts: ['AAA', 'BBB'],
      now: NOW,
    });
    expect(out.newLinks).toHaveLength(2);
    expect(out.newLinks.map((l) => l.cardId).sort()).toEqual(
      out.newCards.map((c) => c.id).sort()
    );
    expect(out.newLinks.every((l) => l.segmentId === 'seg-1')).toBe(true);
  });

  it('inherits group membership when present', () => {
    const data = setupOneCard('AAA\nBBB');
    data.groups.push({
      id: 'g1',
      name: 'g',
      level: 1,
      parentGroupId: null,
      collapsed: false,
      createdAt: NOW,
      updatedAt: NOW,
    });
    data.group_memberships.push({ id: 'm1', cardId: 'c1', groupId: 'g1', createdAt: NOW });
    const out = buildSplitCards(data, {
      cardId: 'c1',
      bodyParts: ['AAA', 'BBB'],
      now: NOW,
    });
    expect(out.newMemberships).toHaveLength(2);
    expect(out.newMemberships.every((m) => m.groupId === 'g1')).toBe(true);
  });

  it('throws when fewer than 2 non-empty parts', () => {
    const data = setupOneCard('AAA');
    expect(() =>
      buildSplitCards(data, { cardId: 'c1', bodyParts: ['AAA'], now: NOW })
    ).toThrow(SplitError);
    expect(() =>
      buildSplitCards(data, { cardId: 'c1', bodyParts: ['AAA', '   '], now: NOW })
    ).toThrow(SplitError);
  });
});
