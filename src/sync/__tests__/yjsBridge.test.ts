import { describe, it, expect } from 'vitest';
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
