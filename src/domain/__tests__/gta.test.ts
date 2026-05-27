import { describe, it, expect } from 'vitest';
import type { ProjectData } from '@shared/types/domain';
import {
  buildCodeApplication,
  buildCodeFromKjGroup,
  buildGtaCategory,
  buildGtaCode,
  GTA_CODE_STATUS_LABELS,
  GTA_CODE_TYPE_LABELS,
  getApplicationsForCard,
  getApplicationsForCode,
  GtaError,
  nextCodeName,
} from '../gta.js';

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

describe('nextCodeName', () => {
  it('starts at コード 1', () => {
    expect(nextCodeName(emptyData())).toBe('コード 1');
  });
  it('skips used names', () => {
    const d = emptyData();
    d.gta_codes.push(buildGtaCode({ name: 'コード 1', now: NOW }));
    expect(nextCodeName(d)).toBe('コード 2');
  });
});

describe('buildGtaCode', () => {
  it('defaults type to open and status to draft', () => {
    const c = buildGtaCode({ now: NOW });
    expect(c.codeType).toBe('open');
    expect(c.status).toBe('draft');
  });
});

describe('buildCodeApplication', () => {
  it('captures target and snapshot', () => {
    const a = buildCodeApplication({
      codeId: 'c1',
      targetType: 'card',
      targetId: 'card-1',
      selectedTextSnapshot: '抜粋',
      now: NOW,
    });
    expect(a.targetType).toBe('card');
    expect(a.targetId).toBe('card-1');
    expect(a.selectedTextSnapshot).toBe('抜粋');
  });
});

describe('buildCodeFromKjGroup', () => {
  it('uses label text as code name when present', () => {
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
      text: '回避',
      sharedMemo: '',
      basisMemo: '回避行動の根拠',
      holdMemo: '',
      createdAt: NOW,
      updatedAt: NOW,
    });
    const code = buildCodeFromKjGroup(d, { groupId: 'g1', now: NOW });
    expect(code.name).toBe('回避');
    expect(code.definition).toBe('回避行動の根拠');
  });

  it('falls back to group name when label is missing', () => {
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
    expect(buildCodeFromKjGroup(d, { groupId: 'g1', now: NOW }).name).toBe('グループ 1');
  });

  it('throws when group is missing', () => {
    expect(() => buildCodeFromKjGroup(emptyData(), { groupId: 'nope', now: NOW })).toThrow(
      GtaError
    );
  });
});

describe('queries', () => {
  it('getApplicationsForCode filters by codeId', () => {
    const d = emptyData();
    d.gta_code_applications.push(
      buildCodeApplication({ codeId: 'c1', targetType: 'card', targetId: 'card-1', now: NOW }),
      buildCodeApplication({ codeId: 'c2', targetType: 'card', targetId: 'card-1', now: NOW })
    );
    expect(getApplicationsForCode(d, 'c1')).toHaveLength(1);
  });
  it('getApplicationsForCard filters by card target', () => {
    const d = emptyData();
    d.gta_code_applications.push(
      buildCodeApplication({ codeId: 'c1', targetType: 'card', targetId: 'card-1', now: NOW }),
      buildCodeApplication({ codeId: 'c1', targetType: 'source_segment', targetId: 'seg-1', now: NOW })
    );
    expect(getApplicationsForCard(d, 'card-1')).toHaveLength(1);
  });
});

describe('buildGtaCategory', () => {
  it('trims and accepts core flag', () => {
    const c = buildGtaCategory({ name: '  自律性  ', isCoreCategory: true, now: NOW });
    expect(c.name).toBe('自律性');
    expect(c.isCoreCategory).toBe(true);
  });
});

describe('label tables', () => {
  it('returns Japanese labels', () => {
    expect(GTA_CODE_TYPE_LABELS.open).toBe('オープン');
    expect(GTA_CODE_TYPE_LABELS.in_vivo).toBe('インビボ');
    expect(GTA_CODE_STATUS_LABELS.active).toBe('採用');
  });
});
