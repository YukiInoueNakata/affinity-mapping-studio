import { describe, it, expect } from 'vitest';
import type { ProjectData } from '@shared/types/domain';
import {
  makeCreateRelationCommand,
  makeDeleteRelationCommand,
  makeEditRelationCommand,
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
      { relationType: 'contrasts_with', label: 'A vs B', now: NOW }
    );
    const after = cmd.apply(d);
    expect(after.diagram_relations[0].relationType).toBe('contrasts_with');
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
