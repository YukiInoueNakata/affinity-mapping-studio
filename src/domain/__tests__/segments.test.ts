import { describe, it, expect } from 'vitest';
import type { ProjectData, SourceSegment } from '@shared/types/domain';
import {
  buildEditedSegment,
  buildInsertedSegment,
  findLatestVersion,
  getVisibleSegments,
  isCurrentSegment,
  SegmentEditError,
  splitTextIntoSegments,
  tryRelinkToLatest,
} from '../segments.js';

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

function seg(
  id: string,
  text: string,
  order = 0,
  opts: Partial<SourceSegment> = {}
): SourceSegment {
  return {
    id,
    participantId: 'p1',
    sourceFile: 'a.txt',
    importedAt: NOW,
    order,
    text,
    previousVersionId: null,
    deletedAt: null,
    ...opts,
  };
}

describe('splitTextIntoSegments', () => {
  it('splits by blank line', () => {
    const text = 'A\n\nB\nC\n\nD';
    expect(splitTextIntoSegments(text, 'blank-line')).toEqual(['A', 'B\nC', 'D']);
  });

  it('splits by single line', () => {
    const text = 'A\nB\nC';
    expect(splitTextIntoSegments(text, 'line')).toEqual(['A', 'B', 'C']);
  });

  it('handles CRLF', () => {
    const text = 'A\r\n\r\nB';
    expect(splitTextIntoSegments(text, 'blank-line')).toEqual(['A', 'B']);
  });

  it('drops empty trailing segments', () => {
    expect(splitTextIntoSegments('A\n\n\n', 'blank-line')).toEqual(['A']);
  });
});

describe('segment versioning (v3)', () => {
  it('isCurrentSegment: latest non-deleted is current', () => {
    const d = emptyData();
    d.source_segments.push(seg('a', 'old'), seg('b', 'new', 0, { previousVersionId: 'a' }));
    expect(isCurrentSegment(d, 'a')).toBe(false);
    expect(isCurrentSegment(d, 'b')).toBe(true);
  });

  it('isCurrentSegment: deleted segments are not current', () => {
    const d = emptyData();
    d.source_segments.push(seg('a', 'x', 0, { deletedAt: NOW }));
    expect(isCurrentSegment(d, 'a')).toBe(false);
  });

  it('getVisibleSegments excludes superseded and deleted', () => {
    const d = emptyData();
    d.source_segments.push(
      seg('a', 'old'),
      seg('b', 'new', 0, { previousVersionId: 'a' }),
      seg('c', 'gone', 1, { deletedAt: NOW }),
      seg('d', 'alive', 2)
    );
    const ids = getVisibleSegments(d).map((s) => s.id);
    expect(ids.sort()).toEqual(['b', 'd']);
  });

  it('findLatestVersion walks the chain', () => {
    const d = emptyData();
    d.source_segments.push(
      seg('a', 'v1'),
      seg('b', 'v2', 0, { previousVersionId: 'a' }),
      seg('c', 'v3', 0, { previousVersionId: 'b' })
    );
    expect(findLatestVersion(d, 'a')?.id).toBe('c');
  });

  it('findLatestVersion returns null if latest is deleted', () => {
    const d = emptyData();
    d.source_segments.push(
      seg('a', 'v1'),
      seg('b', 'v2', 0, { previousVersionId: 'a', deletedAt: NOW })
    );
    expect(findLatestVersion(d, 'a')).toBeNull();
  });

  it('buildEditedSegment yields a new segment chained to old', () => {
    const d = emptyData();
    d.source_segments.push(seg('a', 'こんにちは'));
    const out = buildEditedSegment(d, { segmentId: 'a', newText: 'こんばんは', now: NOW });
    expect(out.newSegment.previousVersionId).toBe('a');
    expect(out.newSegment.order).toBe(0);
    expect(out.newSegment.text).toBe('こんばんは');
  });

  it('buildEditedSegment refuses no-change edits', () => {
    const d = emptyData();
    d.source_segments.push(seg('a', 'x'));
    expect(() =>
      buildEditedSegment(d, { segmentId: 'a', newText: 'x', now: NOW })
    ).toThrow(SegmentEditError);
  });

  it('buildEditedSegment refuses editing a superseded segment', () => {
    const d = emptyData();
    d.source_segments.push(seg('a', 'old'), seg('b', 'new', 0, { previousVersionId: 'a' }));
    expect(() =>
      buildEditedSegment(d, { segmentId: 'a', newText: 'changed', now: NOW })
    ).toThrow(SegmentEditError);
  });

  it('buildInsertedSegment uses midpoint order between visible neighbors', () => {
    const d = emptyData();
    d.source_segments.push(seg('a', 'A', 0), seg('b', 'B', 1));
    const inserted = buildInsertedSegment(d, {
      participantId: 'p1',
      sourceFile: 'a.txt',
      afterSegmentId: 'a',
      text: 'middle',
      now: NOW,
    });
    expect(inserted.order).toBeCloseTo(0.5);
  });

  it('buildInsertedSegment appends after last', () => {
    const d = emptyData();
    d.source_segments.push(seg('a', 'A', 0));
    const inserted = buildInsertedSegment(d, {
      participantId: 'p1',
      sourceFile: 'a.txt',
      afterSegmentId: 'a',
      text: 'after',
      now: NOW,
    });
    expect(inserted.order).toBe(1);
  });

  it('tryRelinkToLatest finds snapshot in latest version', () => {
    const d = emptyData();
    d.source_segments.push(
      seg('a', 'AAA BBB CCC'),
      seg('b', 'AAA --- BBB --- CCC', 0, { previousVersionId: 'a' })
    );
    const result = tryRelinkToLatest(d, {
      segmentId: 'a',
      selectedTextSnapshot: 'BBB',
      startOffset: 4,
      endOffset: 7,
    });
    expect(result?.newSegmentId).toBe('b');
    expect(result?.newStartOffset).toBe(8);
    expect(result?.newEndOffset).toBe(11);
  });

  it('tryRelinkToLatest returns null when snapshot not found', () => {
    const d = emptyData();
    d.source_segments.push(seg('a', 'old'), seg('b', 'totally different', 0, { previousVersionId: 'a' }));
    expect(
      tryRelinkToLatest(d, {
        segmentId: 'a',
        selectedTextSnapshot: 'XXX',
        startOffset: 0,
        endOffset: 3,
      })
    ).toBeNull();
  });
});
