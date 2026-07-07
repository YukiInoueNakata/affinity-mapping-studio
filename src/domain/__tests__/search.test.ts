import { describe, it, expect } from 'vitest';
import { matchCardCodes, searchProject } from '../search.js';
import type { Card, Participant, ProjectData } from '@shared/types/domain';

const NOW = '2026-07-01T00:00:00.000Z';

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

function part(code: string): Participant {
  return { id: `pid-${code}`, code, displayName: code, createdAt: NOW };
}

function card(code: string, serial: number, participantId: string, body: string): Card {
  return {
    id: `card-${code}`,
    participantId,
    code,
    serialNumber: serial,
    body,
    status: 'active',
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function setup(): ProjectData {
  const data = emptyData();
  const p02 = part('P02');
  data.participants.push(p02);
  // 近い番号のカードを並べる (024 検索が 026/029 に漏れないか検証)．
  for (const n of [24, 25, 26, 29, 48, 49]) {
    data.cards.push(card(`P02-0${n}`, n, p02.id, `本文${n}`));
  }
  return data;
}

describe('searchProject code matching (2026-07 tightening)', () => {
  it('02-024 does not spill into 026 / 029', () => {
    const data = setup();
    const hits = searchProject(data, '02-024');
    const codes = hits.filter((h) => h.kind === 'card').map((h) => h.title);
    expect(codes).toContain('P02-024');
    expect(codes).not.toContain('P02-026');
    expect(codes).not.toContain('P02-029');
    expect(codes).not.toContain('P02-025');
  });

  it('full code P02-024 matches exactly and ranks the exact card', () => {
    const data = setup();
    const hits = searchProject(data, 'P02-024');
    expect(hits[0]?.title).toBe('P02-024');
  });

  it('bare serial 024 finds the P02-024 card without fuzzy neighbours', () => {
    const data = setup();
    const codes = searchProject(data, '024')
      .filter((h) => h.kind === 'card')
      .map((h) => h.title);
    expect(codes).toContain('P02-024');
    expect(codes).not.toContain('P02-026');
  });
});

describe('code search: 新旧ID・ゼロ埋め有無・階層コード', () => {
  function setupCodes(): ProjectData {
    const data = emptyData();
    const p02 = part('P02');
    data.participants.push(p02);
    data.cards.push(card('P02-020', 20, p02.id, '本文20'));
    // P02-020 を 2 分割した子カード (階層コード)．
    data.cards.push(card('P02-020-01', 121, p02.id, '分割1'));
    data.cards.push(card('P02-020-02', 122, p02.id, '分割2'));
    data.cards.push(card('P02-021', 21, p02.id, '本文21'));
    return data;
  }

  const cardTitles = (data: ProjectData, q: string) =>
    searchProject(data, q)
      .filter((h) => h.kind === 'card')
      .map((h) => h.title);

  it('bare "20" matches P02-020 and its split children', () => {
    const codes = cardTitles(setupCodes(), '20');
    expect(codes).toContain('P02-020');
    expect(codes).toContain('P02-020-01');
    expect(codes).toContain('P02-020-02');
    expect(codes).not.toContain('P02-021');
  });

  it('unpadded "P02-20" matches the padded P02-020 and its children', () => {
    const codes = cardTitles(setupCodes(), 'P02-20');
    expect(codes).toContain('P02-020');
    expect(codes).toContain('P02-020-01');
    // コードマッチャ単体では P02-021 を拾わない (厳密な番号一致)．
    // searchProject 全体は "p02" 本文/表札トークンで同参加者の他カードも
    // 拾いうるが，それは接頭での本文検索として妥当なので除外は求めない．
    const codeMatchTitles = matchCardCodes(setupCodes(), 'P02-20').map((h) => h.title);
    expect(codeMatchTitles).toContain('P02-020');
    expect(codeMatchTitles).not.toContain('P02-021');
  });

  it('full hierarchical "P02-020-01" ranks the exact child first', () => {
    const hits = searchProject(setupCodes(), 'P02-020-01');
    expect(hits[0]?.title).toBe('P02-020-01');
  });

  it('bare "20" does NOT hit participant P20\'s cards (segment boundary)', () => {
    const data = setupCodes();
    const p20 = part('P20');
    data.participants.push(p20);
    data.cards.push(card('P20-001', 1, p20.id, 'P20の本文'));
    const codes = matchCardCodes(data, '20').map((h) => h.title);
    expect(codes).toContain('P02-020');
    expect(codes).not.toContain('P20-001');
  });

  it('participant-prefixed "02-024" still matches via trailing digits of P02', () => {
    const data = setupCodes();
    data.cards.push(card('P02-024', 24, data.participants[0].id, '本文24'));
    const codes = matchCardCodes(data, '02-024').map((h) => h.title);
    expect(codes).toContain('P02-024');
    expect(codes).not.toContain('P02-020');
  });
});
