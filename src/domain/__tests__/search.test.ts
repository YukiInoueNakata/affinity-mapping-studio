import { describe, it, expect } from 'vitest';
import { searchProject } from '../search.js';
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
