import { describe, it, expect } from 'vitest';
import type { ProjectData, SourceSegment } from '@shared/types/domain';
import type { WordComment } from '@shared/types/ipc';
import {
  applySpeakerPrefixes,
  buildCommentsAsCards,
  buildCommentsAsSegments,
  buildImport,
  findSegmentContaining,
  findSegmentForComment,
  guessPattern,
  parseFixedWidthLine,
  parseFixedWidthText,
  splitBySentenceDelimiters,
  validatePlan,
  type CommentImportInput,
  type InterviewImportPlan,
  type SurveyImportPlan,
} from '../importPlan.js';

const NOW = '2026-05-22T00:00:00.000Z';

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

describe('parseFixedWidthLine', () => {
  it('splits a line at break points and trims cells', () => {
    expect(parseFixedWidthLine('Alice    25  female', [0, 9, 13])).toEqual([
      'Alice',
      '25',
      'female',
    ]);
  });

  it('handles missing leading 0 by prepending it', () => {
    expect(parseFixedWidthLine('abcdef', [3])).toEqual(['abc', 'def']);
  });

  it('returns the whole line when no breaks given', () => {
    expect(parseFixedWidthLine('hello', [])).toEqual(['hello']);
  });
});

describe('splitBySentenceDelimiters', () => {
  it('splits at each Japanese full stop, keeping the stop in the segment', () => {
    expect(splitBySentenceDelimiters('こんにちは。今日は晴れです。明日は雨．', '。．')).toEqual([
      'こんにちは。',
      '今日は晴れです。',
      '明日は雨．',
    ]);
  });

  it('keeps trailing text without a terminator', () => {
    expect(splitBySentenceDelimiters('A。B', '。')).toEqual(['A。', 'B']);
  });

  it('supports multiple delimiter characters', () => {
    expect(splitBySentenceDelimiters('Hi!Bye?Done.', '!?.')).toEqual(['Hi!', 'Bye?', 'Done.']);
  });

  it('drops fully empty pieces between consecutive delimiters', () => {
    // Two delimiters with only whitespace between them — the empty chunk is dropped
    expect(splitBySentenceDelimiters('A。   B', '。')).toEqual(['A。', 'B']);
  });

  it('returns the whole trimmed text when delimiters is empty', () => {
    expect(splitBySentenceDelimiters('  hello  ', '')).toEqual(['hello']);
  });
});

describe('parseFixedWidthText', () => {
  it('parses multiple lines', () => {
    const text = 'AaaBbb\nCccDdd\n';
    expect(parseFixedWidthText(text, [0, 3])).toEqual([
      ['Aaa', 'Bbb'],
      ['Ccc', 'Ddd'],
    ]);
  });
});

describe('guessPattern', () => {
  it('detects survey pattern when first column has many distinct short values', () => {
    const rows = [
      ['code', 'body'],
      ['P01', '回答1'],
      ['P02', '回答2'],
      ['P03', '回答3'],
      ['P04', '回答4'],
    ];
    expect(guessPattern(rows)).toBe('survey');
  });

  it('detects interview pattern when most rows share the same speaker', () => {
    const rows = [
      ['speaker', 'body'],
      ['I', '質問1'],
      ['R', '回答1'],
      ['I', '質問2'],
      ['R', '回答2'],
      ['I', '質問3'],
      ['R', '回答3'],
      ['I', '質問4'],
      ['R', '回答4'],
    ];
    expect(guessPattern(rows)).toBe('interview');
  });

  it('falls back to interview for tiny inputs', () => {
    expect(guessPattern([['a']])).toBe('interview');
  });
});

describe('validatePlan', () => {
  it('requires at least one body column', () => {
    const plan: InterviewImportPlan = {
      pattern: 'interview',
      participantId: 'p1',
      fileName: 'a.csv',
      headerRowIndex: 0,
      dataStartRowIndex: 1,
      columns: [{ index: 0, role: 'speaker', label: '話者' }],
    };
    expect(validatePlan(plan)).toContain('本文列を 1 つ以上指定してください');
  });

  it('allows zero participant_code columns for survey (auto-numbering kicks in)', () => {
    const plan: SurveyImportPlan = {
      pattern: 'survey',
      fileName: 'a.csv',
      headerRowIndex: 0,
      dataStartRowIndex: 1,
      columns: [{ index: 1, role: 'body', label: '回答' }],
    };
    expect(validatePlan(plan)).toEqual([]);
  });

  it('rejects more than one participant_code column for survey', () => {
    const plan: SurveyImportPlan = {
      pattern: 'survey',
      fileName: 'a.csv',
      headerRowIndex: 0,
      dataStartRowIndex: 1,
      columns: [
        { index: 0, role: 'participant_code', label: 'ID' },
        { index: 1, role: 'participant_code', label: 'Sub' },
        { index: 2, role: 'body', label: '回答' },
      ],
    };
    expect(
      validatePlan(plan).some((e) => e.includes('参加者コード列は 1 つだけ'))
    ).toBe(true);
  });

  it('flags duplicate custom labels', () => {
    const plan: InterviewImportPlan = {
      pattern: 'interview',
      participantId: 'p1',
      fileName: 'a.csv',
      headerRowIndex: 0,
      dataStartRowIndex: 1,
      columns: [
        { index: 0, role: 'body', label: '本文' },
        { index: 1, role: 'custom', label: 'X' },
        { index: 2, role: 'custom', label: 'X' },
      ],
    };
    const errs = validatePlan(plan);
    expect(errs.some((e) => e.includes('列名が重複'))).toBe(true);
  });
});

describe('buildImport — interview', () => {
  it('builds segments with speaker and customFields', () => {
    const data = emptyData();
    data.participants.push({
      id: 'p1',
      code: 'P01',
      displayName: 'P01',
      createdAt: NOW,
    });
    const plan: InterviewImportPlan = {
      pattern: 'interview',
      participantId: 'p1',
      fileName: 'i.xlsx',
      headerRowIndex: 0,
      dataStartRowIndex: 1,
      columns: [
        { index: 0, role: 'speaker', label: '話者' },
        { index: 1, role: 'body', label: '発話' },
        { index: 2, role: 'custom', label: '時刻' },
      ],
    };
    const rows = [
      ['話者', '発話', '時刻'],
      ['I', 'こんにちは', '00:00'],
      ['R', 'よろしく', '00:05'],
    ];
    const result = buildImport(data, plan, rows, NOW);
    expect(result.newParticipants).toEqual([]);
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0].speaker).toBe('I');
    expect(result.segments[0].customFields).toEqual({ 時刻: '00:00' });
    expect(result.segments[1].speaker).toBe('R');
    expect(result.cards).toHaveLength(0);
  });

  it('joins multiple body columns with newlines', () => {
    const data = emptyData();
    data.participants.push({
      id: 'p1',
      code: 'P01',
      displayName: 'P01',
      createdAt: NOW,
    });
    const plan: InterviewImportPlan = {
      pattern: 'interview',
      participantId: 'p1',
      fileName: 'i.csv',
      headerRowIndex: null,
      dataStartRowIndex: 0,
      columns: [
        { index: 0, role: 'body', label: '質問' },
        { index: 1, role: 'body', label: '回答' },
      ],
    };
    const rows = [['q1', 'a1']];
    const result = buildImport(data, plan, rows, NOW);
    expect(result.segments[0].text).toBe('q1\na1');
  });

  it('skips rows where body is empty', () => {
    const data = emptyData();
    data.participants.push({
      id: 'p1',
      code: 'P01',
      displayName: 'P01',
      createdAt: NOW,
    });
    const plan: InterviewImportPlan = {
      pattern: 'interview',
      participantId: 'p1',
      fileName: 'i.csv',
      headerRowIndex: null,
      dataStartRowIndex: 0,
      columns: [{ index: 0, role: 'body', label: 'b' }],
    };
    const rows = [['hi'], [''], ['  '], ['ok']];
    expect(buildImport(data, plan, rows, NOW).segments).toHaveLength(2);
  });
});

describe('buildImport — survey', () => {
  it('creates a new participant per distinct code', () => {
    const data = emptyData();
    const plan: SurveyImportPlan = {
      pattern: 'survey',
      fileName: 's.xlsx',
      headerRowIndex: 0,
      dataStartRowIndex: 1,
      columns: [
        { index: 0, role: 'participant_code', label: 'ID' },
        { index: 1, role: 'body', label: '自由記述' },
      ],
    };
    const rows = [
      ['ID', '自由記述'],
      ['R01', '回答 A'],
      ['R02', '回答 B'],
      ['R01', '同じ人の追加回答'],
    ];
    const result = buildImport(data, plan, rows, NOW);
    expect(result.newParticipants).toHaveLength(2);
    expect(result.newParticipants.map((p) => p.code).sort()).toEqual(['R01', 'R02']);
    expect(result.segments).toHaveLength(3);
    // First and third segments belong to the same (R01) participant
    expect(result.segments[0].participantId).toBe(result.segments[2].participantId);
    expect(result.segments[0].participantId).not.toBe(result.segments[1].participantId);
  });

  it('reuses an existing participant when the code matches', () => {
    const data = emptyData();
    data.participants.push({
      id: 'existing',
      code: 'R01',
      displayName: '既存',
      createdAt: NOW,
    });
    const plan: SurveyImportPlan = {
      pattern: 'survey',
      fileName: 's.csv',
      headerRowIndex: null,
      dataStartRowIndex: 0,
      columns: [
        { index: 0, role: 'participant_code', label: 'ID' },
        { index: 1, role: 'body', label: '本文' },
      ],
    };
    const rows = [['R01', '新規回答']];
    const result = buildImport(data, plan, rows, NOW);
    expect(result.newParticipants).toEqual([]);
    expect(result.segments[0].participantId).toBe('existing');
  });

  it('auto-numbers participants when the code cell is empty', () => {
    const data = emptyData();
    const plan: SurveyImportPlan = {
      pattern: 'survey',
      fileName: 's.csv',
      headerRowIndex: null,
      dataStartRowIndex: 0,
      columns: [
        { index: 0, role: 'participant_code', label: 'ID' },
        { index: 1, role: 'body', label: '本文' },
      ],
    };
    const rows = [
      ['', '無コードの回答 A'],
      ['', '無コードの回答 B'],
      ['R01', '通常の回答'],
    ];
    const result = buildImport(data, plan, rows, NOW);
    expect(result.segments).toHaveLength(3);
    expect(result.skipped).toHaveLength(0);
    expect(result.newParticipants).toHaveLength(3);
    const codes = result.newParticipants.map((p) => p.code).sort();
    expect(codes).toEqual(['P001', 'P002', 'R01']);
  });

  it('auto-numbers all rows when no participant_code column is specified', () => {
    const data = emptyData();
    const plan: SurveyImportPlan = {
      pattern: 'survey',
      fileName: 's.csv',
      headerRowIndex: null,
      dataStartRowIndex: 0,
      columns: [{ index: 0, role: 'body', label: '本文' }],
    };
    const rows = [['回答1'], ['回答2'], ['回答3']];
    const result = buildImport(data, plan, rows, NOW);
    expect(result.newParticipants.map((p) => p.code)).toEqual(['P001', 'P002', 'P003']);
    expect(result.segments).toHaveLength(3);
  });

  it('seeds auto-numbering so it does not collide with existing P-codes', () => {
    const data = emptyData();
    data.participants.push({ id: 'a', code: 'P002', displayName: 'P002', createdAt: NOW });
    const plan: SurveyImportPlan = {
      pattern: 'survey',
      fileName: 's.csv',
      headerRowIndex: null,
      dataStartRowIndex: 0,
      columns: [{ index: 0, role: 'body', label: '本文' }],
    };
    const result = buildImport(data, plan, [['新規回答']], NOW);
    expect(result.newParticipants[0].code).toBe('P003');
  });

  it('honours dataStartRowIndex to skip Qualtrics-style metadata rows', () => {
    // 1: header / 2: question text / 3: ImportId / 4+: data
    const data = emptyData();
    const plan: SurveyImportPlan = {
      pattern: 'survey',
      fileName: 's.csv',
      headerRowIndex: 0,
      dataStartRowIndex: 3,
      columns: [{ index: 0, role: 'body', label: 'Q1' }],
    };
    const rows = [
      ['Q1'],
      ['質問文の説明'],
      ['ImportId=xyz'],
      ['実回答 A'],
      ['実回答 B'],
    ];
    const result = buildImport(data, plan, rows, NOW);
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0].text).toBe('実回答 A');
    expect(result.segments[1].text).toBe('実回答 B');
  });

  it('skips only rows with invalid (not empty) participant codes', () => {
    const data = emptyData();
    const plan: SurveyImportPlan = {
      pattern: 'survey',
      fileName: 's.csv',
      headerRowIndex: null,
      dataStartRowIndex: 0,
      columns: [
        { index: 0, role: 'participant_code', label: 'ID' },
        { index: 1, role: 'body', label: '本文' },
      ],
    };
    const rows = [
      ['1bad', '英字始まりではない'],
      ['OK01', '有効'],
      ['', '空コード→自動連番'],
    ];
    const result = buildImport(data, plan, rows, NOW);
    expect(result.segments).toHaveLength(2);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toContain('1bad');
  });
});

describe('findSegmentContaining', () => {
  it('returns the segment that contains the target as substring', () => {
    const segs: SourceSegment[] = [
      {
        id: 's1',
        participantId: 'p1',
        sourceFile: 'a.docx',
        importedAt: NOW,
        order: 0,
        text: '前置きから始まる長い文章で，ここに対象テキストがあり，さらに続く．',
        previousVersionId: null,
        deletedAt: null,
      },
    ];
    const result = findSegmentContaining(segs, '対象テキスト');
    expect(result).not.toBeNull();
    expect(result!.segment.id).toBe('s1');
    expect(result!.snapshot).toBe('対象テキスト');
  });

  it('returns null when nothing matches', () => {
    expect(findSegmentContaining([], 'x')).toBeNull();
  });

  it('falls back to paragraphText when commentedText fails to match', () => {
    const segs: SourceSegment[] = [
      {
        id: 's1',
        participantId: 'p1',
        sourceFile: 'a.docx',
        importedAt: NOW,
        order: 0,
        text: 'インタビュアー: 最近の出来事を教えてください．\n回答者: 先週引っ越したばかりです．',
        previousVersionId: null,
        deletedAt: null,
      },
    ];
    // commentedText is empty (point comment), but paragraphText covers the paragraph
    const result = findSegmentForComment(segs, {
      commentedText: '',
      paragraphText: 'インタビュアー: 最近の出来事を教えてください．回答者: 先週引っ越したばかりです．',
    });
    expect(result).not.toBeNull();
    expect(result!.segment.id).toBe('s1');
  });

  it('returns null when neither range nor paragraph is provided', () => {
    expect(findSegmentForComment([], {})).toBeNull();
  });

  it('matches across newlines/whitespace (Word coalesced range vs mammoth-paragraphed text)', () => {
    const segs: SourceSegment[] = [
      {
        id: 's1',
        participantId: 'p1',
        sourceFile: 'a.docx',
        importedAt: NOW,
        order: 0,
        text: '先頭の文．\nここがコメント対象の\n複数行に渡る文章\nです．\n末尾の文．',
        previousVersionId: null,
        deletedAt: null,
      },
    ];
    // Word's range, coalesced without newlines:
    const result = findSegmentContaining(segs, 'ここがコメント対象の複数行に渡る文章です．');
    expect(result).not.toBeNull();
    expect(result!.segment.id).toBe('s1');
    // start should be the index of 'ここ' in the original text
    expect(segs[0].text.slice(result!.start, result!.end)).toContain('ここがコメント対象');
  });
});

describe('buildCommentsAsSegments', () => {
  const baseInput: Omit<CommentImportInput, 'authorHandling'> = {
    comments: [
      { id: '0', author: 'Yuki', text: 'a' },
      { id: '1', text: '' },
      { id: '2', author: 'Tanaka', text: 'b' },
    ] as WordComment[],
    candidateSegments: [],
    participantId: 'p1',
    participantCode: 'P01',
    sourceFile: 'i.docx',
    serialStart: 1,
    now: NOW,
  };

  it('include: prefixes body with [author]', () => {
    const result = buildCommentsAsSegments({ ...baseInput, authorHandling: 'include' });
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0].sourceFile).toBe('i.docx (コメント)');
    expect(result.segments[0].text).toBe('[Yuki] a');
    expect(result.segments[1].text).toBe('[Tanaka] b');
    expect(result.segments[0].customFields).toBeUndefined();
  });

  it('remove: drops the author entirely', () => {
    const result = buildCommentsAsSegments({ ...baseInput, authorHandling: 'remove' });
    expect(result.segments[0].text).toBe('a');
    expect(result.segments[1].text).toBe('b');
    expect(result.segments[0].customFields).toBeUndefined();
  });

  it('tag: leaves body plain and stores author in customFields["コメント者"]', () => {
    const result = buildCommentsAsSegments({ ...baseInput, authorHandling: 'tag' });
    expect(result.segments[0].text).toBe('a');
    expect(result.segments[0].customFields).toEqual({ コメント者: 'Yuki' });
    expect(result.segments[1].customFields).toEqual({ コメント者: 'Tanaka' });
  });

  it('tag + authorRemap: substitutes the remapped value when present', () => {
    const result = buildCommentsAsSegments({
      ...baseInput,
      authorHandling: 'tag',
      authorRemap: { Yuki: 'yy', Tanaka: '   ' /* whitespace falls through */ },
    });
    expect(result.segments[0].customFields).toEqual({ コメント者: 'yy' });
    expect(result.segments[1].customFields).toEqual({ コメント者: 'Tanaka' });
  });
});

describe('buildCommentsAsCards', () => {
  const segments: SourceSegment[] = [
    {
      id: 'seg1',
      participantId: 'p1',
      sourceFile: 'i.docx',
      importedAt: NOW,
      order: 0,
      text: 'インタビュアー: 最近の出来事を教えてください．\n回答者: 先週引っ越したばかりです．',
      previousVersionId: null,
      deletedAt: null,
    },
  ];

  const baseCardsInput: Omit<CommentImportInput, 'authorHandling'> = {
    comments: [
      { id: '0', author: 'Y', text: '生活変化の話題', commentedText: '先週引っ越したばかりです' },
      { id: '1', text: 'リンクなしコメント' },
    ] as WordComment[],
    candidateSegments: segments,
    participantId: 'p1',
    participantCode: 'P01',
    sourceFile: 'i.docx',
    serialStart: 1,
    now: NOW,
  };

  it('include: card.body is prefixed with [author], no tag', () => {
    const result = buildCommentsAsCards({ ...baseCardsInput, authorHandling: 'include' });
    expect(result.cards).toHaveLength(2);
    expect(result.cards[0].code).toBe('P01-001');
    expect(result.cards[0].body).toBe('[Y] 生活変化の話題');
    expect(result.cards[0].placement).toBe('unclassified');
    expect(result.cards[0].tags).toBeUndefined();
    expect(result.cardLinks).toHaveLength(1);
    expect(result.cardLinks[0].segmentId).toBe('seg1');
    expect(result.cardLinks[0].selectedTextSnapshot).toBe('先週引っ越したばかりです');
  });

  it('remove: card.body is plain, no tag', () => {
    const result = buildCommentsAsCards({ ...baseCardsInput, authorHandling: 'remove' });
    expect(result.cards[0].body).toBe('生活変化の話題');
    expect(result.cards[0].tags).toBeUndefined();
  });

  it('tag: card.body is plain and tags=[author]', () => {
    const result = buildCommentsAsCards({ ...baseCardsInput, authorHandling: 'tag' });
    expect(result.cards[0].body).toBe('生活変化の話題');
    expect(result.cards[0].tags).toEqual(['Y']);
    // Second comment has no author → still no tag
    expect(result.cards[1].tags).toBeUndefined();
  });

  it('tag + authorRemap: tags use the remapped short name', () => {
    const result = buildCommentsAsCards({
      ...baseCardsInput,
      authorHandling: 'tag',
      authorRemap: { Y: 'YN' },
    });
    expect(result.cards[0].tags).toEqual(['YN']);
  });

  it('links using paragraphText when commentedText fails to match', () => {
    // Simulates: Word coalesces the comment range without newlines, the user's
    // imported segment has line breaks, but the enclosing paragraph contains
    // a string that does substring-match the segment.
    const segs: SourceSegment[] = [
      {
        id: 'segP',
        participantId: 'p1',
        sourceFile: 'a.docx',
        importedAt: NOW,
        order: 0,
        text: '研究の動機について教えてください．\n— もともと興味があったんです．',
        previousVersionId: null,
        deletedAt: null,
      },
    ];
    const result = buildCommentsAsCards({
      comments: [
        {
          id: '0',
          author: 'YN',
          text: '重要な動機の語り',
          commentedText: '見つからない文字列',
          paragraphText: '研究の動機について教えてください．— もともと興味があったんです．',
        },
      ] as WordComment[],
      candidateSegments: segs,
      participantId: 'p1',
      participantCode: 'P01',
      sourceFile: 'a.docx',
      serialStart: 1,
      authorHandling: 'tag',
      now: NOW,
    });
    expect(result.cardLinks).toHaveLength(1);
    expect(result.cardLinks[0].segmentId).toBe('segP');
  });
});

describe('buildImport — auto cards', () => {
  it('creates one card per non-empty auto_card cell, linked to its segment', () => {
    const data = emptyData();
    data.participants.push({
      id: 'p1',
      code: 'P01',
      displayName: 'P01',
      createdAt: NOW,
    });
    const plan: InterviewImportPlan = {
      pattern: 'interview',
      participantId: 'p1',
      fileName: 'a.xlsx',
      headerRowIndex: 0,
      dataStartRowIndex: 1,
      columns: [
        { index: 0, role: 'body', label: '本文' },
        { index: 1, role: 'auto_card', label: '要約' },
      ],
    };
    const rows = [
      ['本文', '要約'],
      ['長い発話 A', '要約 A'],
      ['長い発話 B', ''],
      ['長い発話 C', '要約 C'],
    ];
    const result = buildImport(data, plan, rows, NOW);
    expect(result.segments).toHaveLength(3);
    expect(result.cards).toHaveLength(2);
    expect(result.cards[0].code).toBe('P01-001');
    expect(result.cards[1].code).toBe('P01-002');
    expect(result.cards[0].placement).toBe('unclassified');
    expect(result.cardLinks).toHaveLength(2);
    expect(result.cardLinks[0].cardId).toBe(result.cards[0].id);
    expect(result.cardPositions).toHaveLength(2);
  });
});

describe('applySpeakerPrefixes', () => {
  const PUNCT_COLONS = [':', '：'];
  it('strips colon-suffixed prefixes and emits [speaker, body]', () => {
    const rows = [
      ['Q: 今日はどうでしたか'],
      ['A: 楽しかったです'],
      ['Q：もう少し具体的に'],
    ];
    const out = applySpeakerPrefixes(rows, {
      prefixes: ['Q', 'A'],
      punctuations: PUNCT_COLONS,
      allowSpace: true,
      continueOnUnmatched: false,
    });
    expect(out).toEqual([
      ['Q', '今日はどうでしたか'],
      ['A', '楽しかったです'],
      ['Q', 'もう少し具体的に'],
    ]);
  });

  it('emits empty speaker when no prefix matches and continueOnUnmatched=false', () => {
    const rows = [['Q: 質問'], ['ふつうの行']];
    const out = applySpeakerPrefixes(rows, {
      prefixes: ['Q', 'A'],
      punctuations: PUNCT_COLONS,
      allowSpace: true,
      continueOnUnmatched: false,
    });
    expect(out[1]).toEqual(['', 'ふつうの行']);
  });

  it('inherits previous speaker on unmatched when continueOnUnmatched=true', () => {
    const rows = [['Q: 質問'], ['続きの説明'], ['A: 回答']];
    const out = applySpeakerPrefixes(rows, {
      prefixes: ['Q', 'A'],
      punctuations: PUNCT_COLONS,
      allowSpace: true,
      continueOnUnmatched: true,
    });
    expect(out).toEqual([
      ['Q', '質問'],
      ['Q', '続きの説明'],
      ['A', '回答'],
    ]);
  });

  it('prefers longer prefixes when one is a prefix of another', () => {
    const rows = [['学生1: 一郎が話す'], ['学生10: 十郎が話す']];
    const out = applySpeakerPrefixes(rows, {
      prefixes: ['学生1', '学生10'],
      punctuations: [':'],
      allowSpace: true,
      continueOnUnmatched: false,
    });
    expect(out).toEqual([
      ['学生1', '一郎が話す'],
      ['学生10', '十郎が話す'],
    ]);
  });

  it('supports comma punctuation and full-width variant', () => {
    const rows = [['司会, 開会の挨拶'], ['回答者，意見を述べる']];
    const out = applySpeakerPrefixes(rows, {
      prefixes: ['司会', '回答者'],
      punctuations: [',', '，'],
      allowSpace: true,
      continueOnUnmatched: false,
    });
    expect(out).toEqual([
      ['司会', '開会の挨拶'],
      ['回答者', '意見を述べる'],
    ]);
  });

  it('returns input unchanged when no prefixes given', () => {
    const rows = [['普通の行 1'], ['普通の行 2']];
    const out = applySpeakerPrefixes(rows, {
      prefixes: [],
      punctuations: [':'],
      allowSpace: true,
      continueOnUnmatched: false,
    });
    expect(out).toEqual(rows);
  });

  it('passes multi-column rows through unchanged (tabular path)', () => {
    const rows = [['Q', '質問列'], ['A', '回答列']];
    const out = applySpeakerPrefixes(rows, {
      prefixes: ['Q', 'A'],
      punctuations: [':'],
      allowSpace: true,
      continueOnUnmatched: false,
    });
    expect(out).toEqual(rows);
  });
});
