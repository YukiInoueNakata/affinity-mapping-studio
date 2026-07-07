import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import type { ProjectData } from '@shared/types/domain';
import {
  TABLE_NAMES,
  Y_TEXT_FIELDS,
  YjsSyncBridge,
} from '../yjsBridge.js';

const NOW = '2026-05-25T00:00:00.000Z';

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

function sampleData(): ProjectData {
  const d = emptyData();
  d.participants.push({ id: 'p1', code: 'P01', displayName: 'P01', createdAt: NOW });
  d.cards.push({
    id: 'c1',
    participantId: 'p1',
    code: 'P01-001',
    serialNumber: 1,
    body: 'カード本文',
    status: 'active',
    placement: 'canvas',
    tags: ['重要'],
    displayStyle: { fontSize: 14, color: '#222' },
    createdAt: NOW,
    updatedAt: NOW,
  });
  d.source_segments.push({
    id: 's1',
    participantId: 'p1',
    sourceFile: 'i.txt',
    importedAt: NOW,
    order: 0,
    text: '原文セグメント',
    speaker: 'A さん',
    previousVersionId: null,
    deletedAt: null,
  });
  d.labels.push({
    id: 'lb1',
    groupId: 'g1',
    text: '表札',
    sharedMemo: '共有',
    basisMemo: '根拠',
    holdMemo: '保留',
    createdAt: NOW,
    updatedAt: NOW,
  });
  return d;
}

describe('YjsSyncBridge — schema constants', () => {
  it('TABLE_NAMES covers all 22 ProjectData tables', () => {
    expect(TABLE_NAMES.length).toBe(22);
    const empty = emptyData();
    for (const t of TABLE_NAMES) {
      expect(empty).toHaveProperty(t);
    }
  });

  it('Y_TEXT_FIELDS keys are all valid table names', () => {
    for (const k of Object.keys(Y_TEXT_FIELDS)) {
      expect(TABLE_NAMES).toContain(k);
    }
  });
});

describe('YjsSyncBridge — final_diagram sync (2026-07 レビュー Critical A1)', () => {
  const fd = () => ({
    title: '最終図解',
    annotation: { date: '2026-07-08', authors: '中田' },
    groupLayout: { g1: { x: 10, y: 20, width: 300, height: 200 } },
    shapes: [
      {
        id: 'sh1',
        kind: 'circle' as const,
        x: 1,
        y: 2,
        width: 30,
        height: 40,
        rotation: 0,
        label: '島 A',
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    overallNarrative: '全体叙述',
  });

  it('seed → toProjectData round-trips final_diagram', () => {
    const bridge = new YjsSyncBridge();
    const data = { ...sampleData(), final_diagram: fd() };
    bridge.seedFromProjectData(data);
    const out = bridge.toProjectData();
    expect(out.final_diagram).toBeDefined();
    expect(out.final_diagram?.title).toBe('最終図解');
    expect(out.final_diagram?.shapes).toHaveLength(1);
    expect(out.final_diagram?.groupLayout.g1).toEqual({ x: 10, y: 20, width: 300, height: 200 });
    expect(out.final_diagram?.overallNarrative).toBe('全体叙述');
  });

  it('applyDiff propagates final_diagram edits to another client', () => {
    // client A → update encode → client B の 2 doc 間で伝播することを確認
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const a = new YjsSyncBridge(docA);
    const b = new YjsSyncBridge(docB);
    a.seedFromProjectData({ ...sampleData(), final_diagram: fd() });
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    expect(b.toProjectData().final_diagram?.title).toBe('最終図解');

    // A が表題を変更 → B にも反映
    const next = { ...sampleData(), final_diagram: { ...fd(), title: '改訂表題' } };
    a.applyDiff(next);
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    expect(b.toProjectData().final_diagram?.title).toBe('改訂表題');
  });

  it('applyDiff with undefined final_diagram does NOT wipe the shared one', () => {
    const bridge = new YjsSyncBridge();
    bridge.seedFromProjectData({ ...sampleData(), final_diagram: fd() });
    // 図解を持たない状態 (undefined) の diff — 非破壊であること
    bridge.applyDiff(sampleData());
    expect(bridge.toProjectData().final_diagram?.title).toBe('最終図解');
  });

  it('remote update with unrelated table edit keeps final_diagram in toProjectData', () => {
    const bridge = new YjsSyncBridge();
    bridge.seedFromProjectData({ ...sampleData(), final_diagram: fd() });
    // 無関係なカード編集の diff 後も final_diagram は残る
    const next = { ...sampleData(), final_diagram: fd() };
    next.cards = [{ ...next.cards[0], body: '編集後' }];
    bridge.applyDiff(next);
    const out = bridge.toProjectData();
    expect(out.cards[0].body).toBe('編集後');
    expect(out.final_diagram?.title).toBe('最終図解');
  });
});

describe('YjsSyncBridge — seed + dump round-trip', () => {
  it('preserves all 22 tables', () => {
    const bridge = new YjsSyncBridge();
    bridge.seedFromProjectData(sampleData());
    const out = bridge.toProjectData();
    for (const t of TABLE_NAMES) {
      expect(out[t]).toBeDefined();
      expect(Array.isArray(out[t])).toBe(true);
    }
  });

  it('preserves card body, tags, displayStyle, and segment text', () => {
    const bridge = new YjsSyncBridge();
    bridge.seedFromProjectData(sampleData());
    const out = bridge.toProjectData();
    expect(out.cards[0].body).toBe('カード本文');
    expect(out.cards[0].tags).toEqual(['重要']);
    expect(out.cards[0].displayStyle?.fontSize).toBe(14);
    expect(out.source_segments[0].text).toBe('原文セグメント');
    expect(out.source_segments[0].speaker).toBe('A さん');
    expect(out.source_segments[0].previousVersionId).toBe(null);
  });

  it('preserves all 4 label text fields', () => {
    const bridge = new YjsSyncBridge();
    bridge.seedFromProjectData(sampleData());
    const out = bridge.toProjectData();
    expect(out.labels[0].text).toBe('表札');
    expect(out.labels[0].sharedMemo).toBe('共有');
    expect(out.labels[0].basisMemo).toBe('根拠');
    expect(out.labels[0].holdMemo).toBe('保留');
  });

  it('#134: drops duplicate-id records on hydrate (keeps first)', () => {
    const bridge = new YjsSyncBridge();
    bridge.seedFromProjectData(sampleData());
    // 壊れた room を再現: cards テーブルに同一 id 'c1' のレコードをもう 1 件直接 push
    const cardsArr = bridge.doc.getMap('tables').get('cards') as Y.Array<Y.Map<unknown>>;
    const dup = new Y.Map<unknown>();
    dup.set('id', 'c1');
    dup.set('body', '重複コピー');
    cardsArr.push([dup]);
    expect(cardsArr.length).toBe(2);

    const out = bridge.toProjectData();
    expect(out.cards.length).toBe(1);
    expect(out.cards[0].id).toBe('c1');
    expect(out.cards[0].body).toBe('カード本文');
  });

  it('persists Y.Text fields as Y.Text instances inside Y.Map', () => {
    const bridge = new YjsSyncBridge();
    bridge.seedFromProjectData(sampleData());
    const tables = bridge.doc.getMap('tables');
    const cardsArr = tables.get('cards') as Y.Array<Y.Map<unknown>>;
    const card = cardsArr.get(0);
    expect(card.get('body')).toBeInstanceOf(Y.Text);
    expect((card.get('body') as Y.Text).toString()).toBe('カード本文');
    const labelsArr = tables.get('labels') as Y.Array<Y.Map<unknown>>;
    const label = labelsArr.get(0);
    for (const f of ['text', 'sharedMemo', 'basisMemo', 'holdMemo']) {
      expect(label.get(f)).toBeInstanceOf(Y.Text);
    }
  });
});

describe('YjsSyncBridge — concurrent edits', () => {
  it('two clients converge after exchanging Y.js updates', () => {
    const a = new YjsSyncBridge();
    a.seedFromProjectData(sampleData());

    // Replicate state from A to B
    const b = new YjsSyncBridge();
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc));

    // A and B edit the same card's body simultaneously
    const cardA = (a.doc.getMap('tables').get('cards') as Y.Array<Y.Map<unknown>>).get(0);
    const cardB = (b.doc.getMap('tables').get('cards') as Y.Array<Y.Map<unknown>>).get(0);
    const textA = cardA.get('body') as Y.Text;
    const textB = cardB.get('body') as Y.Text;
    expect(textA.toString()).toBe(textB.toString());

    textA.insert(0, '[A] ');
    textB.insert(textB.length, ' [B]');

    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc, Y.encodeStateVector(b.doc)));
    Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc, Y.encodeStateVector(a.doc)));

    const merged = textA.toString();
    expect(textB.toString()).toBe(merged);
    expect(merged.startsWith('[A] ')).toBe(true);
    expect(merged.endsWith(' [B]')).toBe(true);
  });

  it('appendRecord from both clients merges as union', () => {
    const a = new YjsSyncBridge();
    a.seedFromProjectData(sampleData());
    const b = new YjsSyncBridge();
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc));

    a.appendRecord('cards', {
      id: 'cA',
      participantId: 'p1',
      code: 'P01-002',
      serialNumber: 2,
      body: 'A 追加',
      status: 'active',
      placement: 'canvas',
      createdAt: NOW,
      updatedAt: NOW,
    });
    b.appendRecord('cards', {
      id: 'cB',
      participantId: 'p1',
      code: 'P01-003',
      serialNumber: 3,
      body: 'B 追加',
      status: 'active',
      placement: 'canvas',
      createdAt: NOW,
      updatedAt: NOW,
    });

    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc, Y.encodeStateVector(b.doc)));
    Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc, Y.encodeStateVector(a.doc)));

    const ids = (data: ProjectData) => data.cards.map((c) => c.id).sort();
    expect(ids(a.toProjectData())).toEqual(['c1', 'cA', 'cB']);
    expect(ids(b.toProjectData())).toEqual(['c1', 'cA', 'cB']);
  });
});

describe('YjsSyncBridge — observe filters local vs remote', () => {
  it('observe() callback fires only for remote-origin transactions', () => {
    const local = new YjsSyncBridge();
    local.seedFromProjectData(sampleData());

    // Simulate a remote peer
    const remote = new YjsSyncBridge();
    Y.applyUpdate(remote.doc, Y.encodeStateAsUpdate(local.doc));

    const callbackCalls: ProjectData[] = [];
    const unsubscribe = local.observe((data) => {
      callbackCalls.push(data);
    });

    // (1) local change — should NOT trigger callback
    local.appendRecord('cards', {
      id: 'cLocal',
      participantId: 'p1',
      code: 'P01-099',
      serialNumber: 99,
      body: 'local change',
      status: 'active',
      placement: 'canvas',
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(callbackCalls.length).toBe(0);

    // (2) remote change applied via Y.applyUpdate — SHOULD trigger callback
    remote.appendRecord('cards', {
      id: 'cRemote',
      participantId: 'p1',
      code: 'P01-100',
      serialNumber: 100,
      body: 'remote change',
      status: 'active',
      placement: 'canvas',
      createdAt: NOW,
      updatedAt: NOW,
    });
    Y.applyUpdate(local.doc, Y.encodeStateAsUpdate(remote.doc, Y.encodeStateVector(local.doc)));
    expect(callbackCalls.length).toBeGreaterThanOrEqual(1);
    // The last snapshot should contain both the local-and remote-added cards
    const last = callbackCalls[callbackCalls.length - 1];
    const ids = last.cards.map((c) => c.id);
    expect(ids).toContain('cLocal');
    expect(ids).toContain('cRemote');

    unsubscribe();
  });
});

describe('YjsSyncBridge — applyDiff (incremental mirror)', () => {
  it('seeds an empty doc and round-trips all tables', () => {
    const bridge = new YjsSyncBridge();
    bridge.applyDiff(sampleData());
    const out = bridge.toProjectData();
    expect(out.cards[0].body).toBe('カード本文');
    expect(out.cards[0].tags).toEqual(['重要']);
    expect(out.labels[0].sharedMemo).toBe('共有');
    expect(out.source_segments[0].speaker).toBe('A さん');
  });

  it('preserves id-less position tables across diffs (card_positions/group_positions regression)', () => {
    // Regression: applyDiff once pruned every card_positions/group_positions
    // record because they have no `id` field (keyed by cardId/groupId), so any
    // unrelated edit wiped all positions and stacked every card at the origin.
    const bridge = new YjsSyncBridge();
    const base = emptyData();
    base.card_positions.push({ cardId: 'c1', x: 10, y: 20 } as never);
    base.group_positions.push({ groupId: 'g1', x: 1, y: 2, width: 100, height: 80 } as never);
    bridge.applyDiff(base);
    expect(bridge.toProjectData().card_positions).toHaveLength(1);
    expect(bridge.toProjectData().group_positions).toHaveLength(1);

    // An unrelated metadata-only diff must NOT delete the positions.
    bridge.applyDiff(base, { name: 'x' } as never);
    let out = bridge.toProjectData();
    expect(out.card_positions).toEqual([{ cardId: 'c1', x: 10, y: 20 }]);
    expect(out.group_positions).toEqual([{ groupId: 'g1', x: 1, y: 2, width: 100, height: 80 }]);

    // Moving a card updates its position in place (matched by cardId).
    const moved = emptyData();
    moved.card_positions.push({ cardId: 'c1', x: 999, y: 888 } as never);
    moved.group_positions.push({ groupId: 'g1', x: 1, y: 2, width: 100, height: 80 } as never);
    bridge.applyDiff(moved);
    out = bridge.toProjectData();
    expect(out.card_positions).toEqual([{ cardId: 'c1', x: 999, y: 888 }]);

    // Dropping a position removes only that record.
    const noPos = emptyData();
    noPos.group_positions.push({ groupId: 'g1', x: 1, y: 2, width: 100, height: 80 } as never);
    bridge.applyDiff(noPos);
    out = bridge.toProjectData();
    expect(out.card_positions).toHaveLength(0);
    expect(out.group_positions).toHaveLength(1);
  });

  it('findRecordById/deleteRecordById use the per-table key field for position tables', () => {
    const bridge = new YjsSyncBridge();
    const base = emptyData();
    base.card_positions.push({ cardId: 'c1', x: 5, y: 6 } as never);
    base.group_positions.push({ groupId: 'g1', x: 1, y: 2, width: 10, height: 10 } as never);
    bridge.applyDiff(base);

    // Lookup by the foreign key, not `id`.
    expect(bridge.findRecordById('card_positions', 'c1')).not.toBeNull();
    expect(bridge.findRecordById('group_positions', 'g1')).not.toBeNull();
    expect(bridge.findRecordById('card_positions', 'nope')).toBeNull();

    // Delete by the foreign key removes exactly that record.
    expect(bridge.deleteRecordById('card_positions', 'c1')).toBe(true);
    expect(bridge.toProjectData().card_positions).toHaveLength(0);
    expect(bridge.toProjectData().group_positions).toHaveLength(1);
  });

  it('adds new records and removes deleted ones', () => {
    const bridge = new YjsSyncBridge();
    bridge.applyDiff(sampleData());

    const next = sampleData();
    next.cards.push({
      id: 'c2',
      participantId: 'p1',
      code: 'P01-002',
      serialNumber: 2,
      body: '追加カード',
      status: 'active',
      placement: 'canvas',
      createdAt: NOW,
      updatedAt: NOW,
    });
    bridge.applyDiff(next);
    expect(bridge.toProjectData().cards.map((c) => c.id).sort()).toEqual(['c1', 'c2']);

    const removed = sampleData(); // back to just c1
    bridge.applyDiff(removed);
    expect(bridge.toProjectData().cards.map((c) => c.id)).toEqual(['c1']);
  });

  it('updates a changed scalar field in place', () => {
    const bridge = new YjsSyncBridge();
    bridge.applyDiff(sampleData());

    const next = sampleData();
    next.cards[0].body = '書き換え後';
    next.cards[0].tags = ['重要', '追加'];
    bridge.applyDiff(next);

    const out = bridge.toProjectData();
    expect(out.cards[0].body).toBe('書き換え後');
    expect(out.cards[0].tags).toEqual(['重要', '追加']);
  });

  it('edits Y.Text in place (keeps the same instance for concurrent merge)', () => {
    const bridge = new YjsSyncBridge();
    bridge.applyDiff(sampleData());
    const cardsArr = bridge.doc.getMap('tables').get('cards') as Y.Array<Y.Map<unknown>>;
    const textBefore = cardsArr.get(0).get('body');

    const next = sampleData();
    next.cards[0].body = 'カード本文を編集';
    bridge.applyDiff(next);

    const textAfter = cardsArr.get(0).get('body');
    expect(textAfter).toBeInstanceOf(Y.Text);
    // Same Y.Text instance is edited, not replaced.
    expect(textAfter).toBe(textBefore);
    expect((textAfter as Y.Text).toString()).toBe('カード本文を編集');
  });

  it('does NOT bloat the doc: many single-field edits stay tiny vs re-seed', () => {
    // Anti-regression for the giro2026 incident: the old mirror re-seeded the
    // whole doc each edit, tombstoning everything and growing without bound.
    const seedBridge = new YjsSyncBridge();
    const diffBridge = new YjsSyncBridge();
    const base = sampleData();
    seedBridge.seedFromProjectData(base);
    diffBridge.applyDiff(base);

    for (let i = 0; i < 100; i++) {
      const d = sampleData();
      d.cards[0].body = `編集 ${i}`;
      seedBridge.seedFromProjectData(d); // old pathological path
      diffBridge.applyDiff(d); // new incremental path
    }

    const seedSize = Y.encodeStateAsUpdate(seedBridge.doc).byteLength;
    const diffSize = Y.encodeStateAsUpdate(diffBridge.doc).byteLength;
    // Incremental should be an order of magnitude smaller after 100 edits.
    expect(diffSize).toBeLessThan(seedSize / 5);
    // Both still produce identical observable data.
    expect(diffBridge.toProjectData().cards[0].body).toBe('編集 99');
  });

  it('two clients converge when both use applyDiff', () => {
    const a = new YjsSyncBridge();
    a.applyDiff(sampleData());
    const b = new YjsSyncBridge();
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc));

    const da = sampleData();
    da.cards[0].body = 'A 編集';
    a.applyDiff(da);

    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc, Y.encodeStateVector(b.doc)));
    expect(b.toProjectData().cards[0].body).toBe('A 編集');
  });
});

describe('YjsSyncBridge — Fix #1: Y.Text minimal diff (prefix/suffix preserved)', () => {
  it('pure middle insert does not touch the unchanged suffix (concurrent end-append survives)', () => {
    const a = new YjsSyncBridge();
    const base = sampleData();
    base.cards[0].body = 'ABCDEFG';
    a.applyDiff(base);

    const b = new YjsSyncBridge();
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc));

    // B (a real collaborator) types at the end of the body concurrently.
    const bText = (b.doc.getMap('tables').get('cards') as Y.Array<Y.Map<unknown>>)
      .get(0)
      .get('body') as Y.Text;
    bText.insert(bText.length, ' [end]');

    // A edits the MIDDLE via applyDiff — prefix 'ABC' + suffix 'DEFG' are common.
    const da = sampleData();
    da.cards[0].body = 'ABCXYZDEFG';
    a.applyDiff(da);

    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc, Y.encodeStateVector(b.doc)));
    Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc, Y.encodeStateVector(a.doc)));

    const merged = (a.doc.getMap('tables').get('cards') as Y.Array<Y.Map<unknown>>)
      .get(0)
      .get('body') as Y.Text;
    // Suffix was never deleted, so B's end-append is preserved after the suffix.
    expect(merged.toString()).toBe('ABCXYZDEFG [end]');
  });

  it('middle delete preserves a concurrent edit on the untouched suffix', () => {
    const a = new YjsSyncBridge();
    const base = sampleData();
    base.cards[0].body = 'ABCDEFG';
    a.applyDiff(base);

    const b = new YjsSyncBridge();
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc));
    const bText = (b.doc.getMap('tables').get('cards') as Y.Array<Y.Map<unknown>>)
      .get(0)
      .get('body') as Y.Text;
    bText.insert(bText.length, '!'); // append to suffix region

    // A deletes the single char 'D' in the middle (prefix 'ABC', suffix 'EFG').
    const da = sampleData();
    da.cards[0].body = 'ABCEFG';
    a.applyDiff(da);

    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc, Y.encodeStateVector(b.doc)));
    Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc, Y.encodeStateVector(a.doc)));

    const merged = (a.doc.getMap('tables').get('cards') as Y.Array<Y.Map<unknown>>)
      .get(0)
      .get('body') as Y.Text;
    expect(merged.toString()).toBe('ABCEFG!');
  });

  it('repeated single-char appends grow the doc only marginally (minimal delta)', () => {
    const bridge = new YjsSyncBridge();
    const base = sampleData();
    base.cards[0].body = 'x';
    bridge.applyDiff(base);
    const sizeAfterSeed = Y.encodeStateAsUpdate(bridge.doc).byteLength;

    let body = 'x';
    for (let i = 0; i < 50; i++) {
      body += 'y';
      const d = sampleData();
      d.cards[0].body = body;
      bridge.applyDiff(d);
    }
    const sizeAfterEdits = Y.encodeStateAsUpdate(bridge.doc).byteLength;
    // 50 single-char appends: a full delete+reinsert each time would tombstone
    // ~1300 chars.  Minimal diff appends one char each → small linear growth.
    expect(sizeAfterEdits - sizeAfterSeed).toBeLessThan(1000);
    expect(bridge.toProjectData().cards[0].body).toBe(body);
  });
});

describe('YjsSyncBridge — Fix #2: applyDiff hardening', () => {
  it('canonicalizes a pre-existing duplicate id (keeps first, prunes the rest)', () => {
    const bridge = new YjsSyncBridge();
    bridge.applyDiff(sampleData());
    const cardsArr = bridge.doc.getMap('tables').get('cards') as Y.Array<Y.Map<unknown>>;
    const dup = new Y.Map<unknown>();
    dup.set('id', 'c1');
    dup.set('body', '重複');
    cardsArr.push([dup]);
    expect(cardsArr.length).toBe(2);

    bridge.applyDiff(sampleData()); // next still has a single c1
    expect(cardsArr.length).toBe(1);
    expect(bridge.toProjectData().cards.map((c) => c.id)).toEqual(['c1']);
    expect(bridge.toProjectData().cards[0].body).toBe('カード本文');
  });

  it('prunes id-less garbage rows already in the doc', () => {
    const bridge = new YjsSyncBridge();
    bridge.applyDiff(sampleData());
    const cardsArr = bridge.doc.getMap('tables').get('cards') as Y.Array<Y.Map<unknown>>;
    const garbage = new Y.Map<unknown>();
    garbage.set('body', 'id 無し');
    cardsArr.push([garbage]);
    expect(cardsArr.length).toBe(2);

    bridge.applyDiff(sampleData());
    expect(cardsArr.length).toBe(1);
    expect(bridge.toProjectData().cards[0].id).toBe('c1');
  });

  it('rejects an id-less incoming record (does not insert it)', () => {
    const bridge = new YjsSyncBridge();
    bridge.applyDiff(sampleData());
    const next = sampleData();
    (next.cards as unknown as Array<Record<string, unknown>>).push({ body: 'id 無し追加', status: 'active' });
    bridge.applyDiff(next as unknown as ProjectData);
    expect(bridge.toProjectData().cards.map((c) => c.id)).toEqual(['c1']);
  });

  it('syncs metadata deletions (removed keys disappear from the doc)', () => {
    const bridge = new YjsSyncBridge();
    bridge.applyDiff(sampleData(), { title: 'プロジェクト', note: '一時メモ' } as unknown as import('@shared/types/domain').ProjectMetadata);
    expect(bridge.toMetadata()).toMatchObject({ title: 'プロジェクト', note: '一時メモ' });

    bridge.applyDiff(sampleData(), { title: 'プロジェクト' } as unknown as import('@shared/types/domain').ProjectMetadata);
    const md = bridge.toMetadata() as unknown as Record<string, unknown>;
    expect(md?.title).toBe('プロジェクト');
    expect(md && 'note' in md).toBe(false);
  });
});

describe('YjsSyncBridge — Codex-W4: garbage drop visibility', () => {
  it('warns when a stored duplicate-id row is pruned', () => {
    const bridge = new YjsSyncBridge();
    bridge.applyDiff(sampleData());
    const cardsArr = bridge.doc.getMap('tables').get('cards') as Y.Array<Y.Map<unknown>>;
    const dup = new Y.Map<unknown>();
    dup.set('id', 'c1');
    dup.set('body', '重複');
    cardsArr.push([dup]);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    bridge.applyDiff(sampleData());
    const calls = warn.mock.calls.map((c) => String(c[0]));
    warn.mockRestore();

    expect(calls.length).toBeGreaterThan(0);
    const msg = calls.join('\n');
    expect(msg).toContain('table=cards');
    expect(msg).toContain('dup=1');
  });

  it('warns when an id-less incoming record is rejected', () => {
    const bridge = new YjsSyncBridge();
    bridge.applyDiff(sampleData());
    const next = sampleData();
    (next.cards as unknown as Array<Record<string, unknown>>).push({ body: 'id 無し追加', status: 'active' });

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    bridge.applyDiff(next as unknown as ProjectData);
    const calls = warn.mock.calls.map((c) => String(c[0]));
    warn.mockRestore();

    expect(calls.length).toBeGreaterThan(0);
    expect(calls.join('\n')).toContain('idless=1');
  });

  it('does NOT warn for a legitimate deletion (id removed from next)', () => {
    const bridge = new YjsSyncBridge();
    bridge.applyDiff(sampleData()); // has c1
    const next = sampleData();
    next.cards = []; // legitimately remove c1

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    bridge.applyDiff(next);
    const callCount = warn.mock.calls.length;
    warn.mockRestore();

    expect(callCount).toBe(0);
    expect(bridge.toProjectData().cards).toHaveLength(0);
  });
});

describe('YjsSyncBridge — helper methods', () => {
  it('findRecordById and deleteRecordById', () => {
    const bridge = new YjsSyncBridge();
    bridge.seedFromProjectData(sampleData());
    expect(bridge.findRecordById('cards', 'c1')).not.toBeNull();
    expect(bridge.findRecordById('cards', 'missing')).toBeNull();
    expect(bridge.deleteRecordById('cards', 'c1')).toBe(true);
    expect(bridge.toProjectData().cards.length).toBe(0);
    expect(bridge.deleteRecordById('cards', 'c1')).toBe(false);
  });
});
