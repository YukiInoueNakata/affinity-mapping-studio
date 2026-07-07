import { describe, it, expect } from 'vitest';
import type { Card, Participant, ProjectData } from '@shared/types/domain';
import {
  makeCreateRelationCommand,
  makeDeleteGtaCategoryCommand,
  makeDeleteMGtaCategoryCommand,
  makeDeleteRelationCommand,
  makeEditRelationCommand,
  makeMergeParticipantsCommand,
  makeMoveGroupWithChildrenCommand,
  type PositionDelta,
} from '../commands.js';

const NOW = '2026-05-21T00:00:00.000Z';

function baseData(): ProjectData {
  return {
    participants: [],
    source_segments: [],
    cards: [],
    card_source_links: [],
    card_positions: [
      { cardId: 'c1', x: 100, y: 100 },
      { cardId: 'c2', x: 200, y: 100 },
    ],
    groups: [
      { id: 'g1', name: 'g', level: 1, parentGroupId: null, collapsed: false, createdAt: NOW, updatedAt: NOW },
    ],
    group_memberships: [
      { id: 'm1', cardId: 'c1', groupId: 'g1', createdAt: NOW },
      { id: 'm2', cardId: 'c2', groupId: 'g1', createdAt: NOW },
    ],
    labels: [],
    group_positions: [{ groupId: 'g1', x: 50, y: 50, width: 300, height: 200 }],
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

describe('makeMoveGroupWithChildrenCommand', () => {
  it('moves the group and its member cards together', () => {
    const data = baseData();
    const childMoves: PositionDelta[] = [
      { id: 'c1', type: 'card', from: { x: 100, y: 100 }, to: { x: 120, y: 130 } },
      { id: 'c2', type: 'card', from: { x: 200, y: 100 }, to: { x: 220, y: 130 } },
    ];
    const cmd = makeMoveGroupWithChildrenCommand(
      'g1',
      { x: 50, y: 50 },
      { x: 70, y: 80 },
      childMoves
    );
    const after = cmd.apply(data);
    expect(after.group_positions.find((p) => p.groupId === 'g1')).toMatchObject({ x: 70, y: 80 });
    expect(after.card_positions.find((p) => p.cardId === 'c1')).toMatchObject({ x: 120, y: 130 });
    expect(after.card_positions.find((p) => p.cardId === 'c2')).toMatchObject({ x: 220, y: 130 });
    const reverted = cmd.revert(after);
    expect(reverted.group_positions.find((p) => p.groupId === 'g1')).toMatchObject({ x: 50, y: 50 });
    expect(reverted.card_positions.find((p) => p.cardId === 'c1')).toMatchObject({ x: 100, y: 100 });
    expect(reverted.card_positions.find((p) => p.cardId === 'c2')).toMatchObject({ x: 200, y: 100 });
  });

  it('moves a parent group together with child groups (level=2)', () => {
    const data = baseData();
    data.groups.push({
      id: 'p',
      name: 'P',
      level: 2,
      parentGroupId: null,
      collapsed: false,
      createdAt: NOW,
      updatedAt: NOW,
    });
    data.group_positions.push({ groupId: 'p', x: 0, y: 0, width: 600, height: 400 });
    const childMoves: PositionDelta[] = [
      { id: 'g1', type: 'group', from: { x: 50, y: 50 }, to: { x: 80, y: 90 } },
      { id: 'c1', type: 'card', from: { x: 100, y: 100 }, to: { x: 130, y: 140 } },
      { id: 'c2', type: 'card', from: { x: 200, y: 100 }, to: { x: 230, y: 140 } },
    ];
    const cmd = makeMoveGroupWithChildrenCommand(
      'p',
      { x: 0, y: 0 },
      { x: 30, y: 40 },
      childMoves
    );
    const after = cmd.apply(data);
    expect(after.group_positions.find((p) => p.groupId === 'p')).toMatchObject({ x: 30, y: 40 });
    expect(after.group_positions.find((p) => p.groupId === 'g1')).toMatchObject({ x: 80, y: 90 });
    expect(after.card_positions.find((p) => p.cardId === 'c1')).toMatchObject({ x: 130, y: 140 });
    expect(after.card_positions.find((p) => p.cardId === 'c2')).toMatchObject({ x: 230, y: 140 });
  });

  it('leaves untouched a delta of (0,0)', () => {
    const data = baseData();
    const cmd = makeMoveGroupWithChildrenCommand('g1', { x: 50, y: 50 }, { x: 50, y: 50 }, []);
    const after = cmd.apply(data);
    expect(after.group_positions[0]).toMatchObject({ x: 50, y: 50 });
  });
});

describe('makeMergeParticipantsCommand (2026-07 レビュー Critical A6)', () => {
  const part = (id: string, code: string): Participant => ({
    id,
    code,
    displayName: code,
    createdAt: NOW,
  });
  const card = (
    id: string,
    participantId: string,
    code: string,
    serial: number
  ): Card => ({
    id,
    participantId,
    code,
    serialNumber: serial,
    body: `body-${id}`,
    status: 'active',
    createdAt: NOW,
    updatedAt: NOW,
  });

  function mergeData(): ProjectData {
    const d = baseData();
    d.participants.push(part('pTo', 'P12'), part('pFrom', 'P13'));
    // to 側: serial 1-2
    d.cards.push(card('t1', 'pTo', 'P12-001', 1), card('t2', 'pTo', 'P12-002', 2));
    // from 側: serial 1-2 + 分割階層コードの子
    d.cards.push(
      card('f1', 'pFrom', 'P13-001', 1),
      card('f2', 'pFrom', 'P13-002', 2),
      card('f3', 'pFrom', 'P13-002-01', 9)
    );
    d.source_segments.push({
      id: 'seg1',
      participantId: 'pFrom',
      sourceFile: 'x.txt',
      importedAt: NOW,
      order: 0,
      text: 't',
      previousVersionId: null,
      deletedAt: null,
    });
    return d;
  }

  const snapshot = (d: ProjectData) => ({
    participants: d.participants.map((p) => ({ ...p })),
    cards: d.cards.map((c) => ({ ...c })),
    source_segments: d.source_segments.map((s) => ({ ...s })),
  });

  it('assigns unique serialNumbers and codes (no collision with nextCardSerial)', () => {
    const d = mergeData();
    const cmd = makeMergeParticipantsCommand('pFrom', 'pTo', snapshot(d));
    const after = cmd.apply(d);
    const toCards = after.cards.filter((c) => c.participantId === 'pTo');
    // serial 一意
    const serials = toCards.map((c) => c.serialNumber);
    expect(new Set(serials).size).toBe(serials.length);
    // code 一意
    const codes = toCards.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    // 全カードが P12- 接頭
    expect(codes.every((c) => c.startsWith('P12-'))).toBe(true);
    // マージ後の max serial より小さい新規採番が起きない (= 衝突しない)
    const maxSerial = Math.max(...serials);
    expect(maxSerial).toBeGreaterThanOrEqual(toCards.length);
  });

  it('preserves hierarchical split suffix (P13-002-01 → P12-NNN-01)', () => {
    const d = mergeData();
    const cmd = makeMergeParticipantsCommand('pFrom', 'pTo', snapshot(d));
    const after = cmd.apply(d);
    const f2 = after.cards.find((c) => c.id === 'f2')!;
    const f3 = after.cards.find((c) => c.id === 'f3')!;
    // 同じ基底番号を保ち，suffix -01 が残る
    expect(f3.code).toBe(`${f2.code}-01`);
  });

  it('revert is id-scoped: does not clobber cards added after the merge', () => {
    const d = mergeData();
    const cmd = makeMergeParticipantsCommand('pFrom', 'pTo', snapshot(d));
    const after = cmd.apply(d);
    // マージ後に (他クライアントが) カードを追加した状況を模す
    const withConcurrent: ProjectData = {
      ...after,
      cards: [...after.cards, card('new1', 'pTo', 'P12-099', 99)],
    };
    const reverted = cmd.revert(withConcurrent);
    // 並行追加されたカードが生き残る (旧実装は snapshot 丸ごと差し戻しで消えた)
    expect(reverted.cards.find((c) => c.id === 'new1')).toBeDefined();
    // 元 from カードは復元される
    const f1 = reverted.cards.find((c) => c.id === 'f1')!;
    expect(f1.participantId).toBe('pFrom');
    expect(f1.code).toBe('P13-001');
    expect(f1.serialNumber).toBe(1);
    // 参加者も戻る
    expect(reverted.participants.some((p) => p.id === 'pFrom')).toBe(true);
  });
});

describe('category delete undo restores categoryId (2026-07 レビュー W4)', () => {
  it('M-GTA: concepts regain categoryId on revert', () => {
    const d = baseData();
    const cat = { id: 'cat1', name: 'カテゴリ', definition: '', createdAt: NOW, updatedAt: NOW };
    d.m_gta_categories.push(cat);
    d.m_gta_concepts.push(
      {
        id: 'con1',
        settingsId: 'set1',
        name: '概念1',
        definition: '',
        categoryId: 'cat1',
        status: 'active',
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: 'con2',
        settingsId: 'set1',
        name: '概念2',
        definition: '',
        categoryId: undefined,
        status: 'active',
        createdAt: NOW,
        updatedAt: NOW,
      }
    );
    const cmd = makeDeleteMGtaCategoryCommand(cat);
    const after = cmd.apply(d);
    expect(after.m_gta_concepts.find((c) => c.id === 'con1')?.categoryId).toBeUndefined();
    const back = cmd.revert(after);
    expect(back.m_gta_categories.some((c) => c.id === 'cat1')).toBe(true);
    expect(back.m_gta_concepts.find((c) => c.id === 'con1')?.categoryId).toBe('cat1');
    // 元々未分類だった概念は未分類のまま
    expect(back.m_gta_concepts.find((c) => c.id === 'con2')?.categoryId).toBeUndefined();
  });

  it('GTA: codes regain categoryId on revert', () => {
    const d = baseData();
    const cat = { id: 'gcat1', name: 'GTAカテゴリ', definition: '', createdAt: NOW, updatedAt: NOW };
    d.gta_categories.push(cat);
    d.gta_codes.push({
      id: 'code1',
      name: 'コード1',
      definition: '',
      codeType: 'open',
      status: 'active',
      categoryId: 'gcat1',
      createdAt: NOW,
      updatedAt: NOW,
    });
    const cmd = makeDeleteGtaCategoryCommand(cat);
    const after = cmd.apply(d);
    expect(after.gta_codes[0].categoryId).toBeUndefined();
    const back = cmd.revert(after);
    expect(back.gta_codes[0].categoryId).toBe('gcat1');
  });
});

describe('diagram relation commands', () => {
  const REL = {
    id: 'r1',
    sourceObjectType: 'group' as const,
    sourceObjectId: 'g1',
    targetObjectType: 'group' as const,
    targetObjectId: 'g2',
    relationType: 'causes' as const,
    memoIds: [],
    createdAt: NOW,
    updatedAt: NOW,
  };

  it('create / revert', () => {
    const d = baseData();
    const cmd = makeCreateRelationCommand(REL);
    const after = cmd.apply(d);
    expect(after.diagram_relations.length).toBe(1);
    const back = cmd.revert(after);
    expect(back.diagram_relations.length).toBe(0);
  });

  it('edit / revert', () => {
    const d = baseData();
    d.diagram_relations.push(REL);
    const cmd = makeEditRelationCommand(
      REL.id,
      { relationType: 'causes', label: undefined },
      { relationType: 'opposes', label: 'A vs B', now: NOW }
    );
    const after = cmd.apply(d);
    expect(after.diagram_relations[0].relationType).toBe('opposes');
    expect(after.diagram_relations[0].label).toBe('A vs B');
    const back = cmd.revert(after);
    expect(back.diagram_relations[0].relationType).toBe('causes');
    expect(back.diagram_relations[0].label).toBeUndefined();
  });

  it('delete / revert', () => {
    const d = baseData();
    d.diagram_relations.push(REL);
    const cmd = makeDeleteRelationCommand(REL);
    const after = cmd.apply(d);
    expect(after.diagram_relations.length).toBe(0);
    const back = cmd.revert(after);
    expect(back.diagram_relations.length).toBe(1);
    expect(back.diagram_relations[0].id).toBe('r1');
  });
});
