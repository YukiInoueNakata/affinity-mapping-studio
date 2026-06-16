import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { useProjectStore } from '../projectStore.js';
import { YjsSyncBridge } from '../../sync/yjsBridge.js';
import {
  makeAddParticipantCommand,
  makeImportSegmentsCommand,
} from '../commands.js';
import { newId } from '../../domain/ids.js';
import { makeEmptyProject } from '@shared/types/project';
import type { ProjectFile } from '@shared/types/project';
import type { Participant, SourceSegment } from '@shared/types/domain';

const NOW = '2026-05-26T00:00:00.000Z';

function freshProject(name = 'sync-test'): ProjectFile {
  return makeEmptyProject(name, 'proj-' + newId(), NOW);
}

function makeParticipant(code: string): Participant {
  return { id: newId(), code, displayName: code, createdAt: NOW };
}

function makeSegment(participantId: string, text: string, order = 0): SourceSegment {
  return {
    id: newId(),
    participantId,
    sourceFile: 'i.txt',
    importedAt: NOW,
    order,
    text,
    previousVersionId: null,
    deletedAt: null,
  };
}

// The store is a Zustand singleton.  Reset it between tests so state doesn't
// leak across cases.
const initial = useProjectStore.getState();

beforeEach(() => {
  // Detach any bridge before resetting
  useProjectStore.getState().attachSyncBridge(null);
  useProjectStore.setState(initial, true);
});

afterEach(() => {
  useProjectStore.getState().attachSyncBridge(null);
});

describe('projectStore + YjsSyncBridge — local edits mirror to Y.Doc', () => {
  it('applyCommand updates store AND Y.Doc when bridge is attached', () => {
    const store = useProjectStore.getState();
    const project = freshProject();
    store.loadProject(null, project);

    const bridge = new YjsSyncBridge();
    store.attachSyncBridge(bridge);

    const alice = makeParticipant('P01');
    store.applyCommand(makeAddParticipantCommand(alice));

    // Store has the new participant
    const after = useProjectStore.getState();
    expect(after.project?.data.participants).toHaveLength(1);
    expect(after.project?.data.participants[0].code).toBe('P01');

    // Bridge's Y.Doc reflects it
    const dumped = bridge.toProjectData();
    expect(dumped.participants).toHaveLength(1);
    expect(dumped.participants[0].code).toBe('P01');
  });

  it('undo / redo also mirror to Y.Doc', () => {
    const store = useProjectStore.getState();
    store.loadProject(null, freshProject());

    const bridge = new YjsSyncBridge();
    store.attachSyncBridge(bridge);

    store.applyCommand(makeAddParticipantCommand(makeParticipant('P01')));
    expect(bridge.toProjectData().participants).toHaveLength(1);

    useProjectStore.getState().undo();
    expect(useProjectStore.getState().project?.data.participants).toHaveLength(0);
    expect(bridge.toProjectData().participants).toHaveLength(0);

    useProjectStore.getState().redo();
    expect(bridge.toProjectData().participants).toHaveLength(1);
  });
});

describe('projectStore + YjsSyncBridge — remote changes flow into store', () => {
  it('a remote Y.Doc update propagates into store.project', () => {
    const store = useProjectStore.getState();
    const project = freshProject();
    store.loadProject(null, project);

    // Attach our local bridge
    const localBridge = new YjsSyncBridge();
    store.attachSyncBridge(localBridge);

    // Simulate a remote peer: a separate bridge that we sync via Y.update
    const remoteBridge = new YjsSyncBridge();
    Y.applyUpdate(remoteBridge.doc, Y.encodeStateAsUpdate(localBridge.doc));

    // Remote appends a participant
    remoteBridge.appendRecord('participants', {
      id: 'remote-p1',
      code: 'R01',
      displayName: 'R01',
      createdAt: NOW,
    });

    // Transfer the diff back into our local doc — this triggers observe()
    Y.applyUpdate(
      localBridge.doc,
      Y.encodeStateAsUpdate(remoteBridge.doc, Y.encodeStateVector(localBridge.doc))
    );

    const after = useProjectStore.getState();
    expect(after.project?.data.participants).toHaveLength(1);
    expect(after.project?.data.participants[0].code).toBe('R01');
  });

  it('two stores via two bridges converge after exchanging updates', () => {
    // Set up store A
    const storeA = useProjectStore.getState();
    storeA.loadProject(null, freshProject('A'));
    const bridgeA = new YjsSyncBridge();
    // bridgeA is the origin peer that establishes the shared table structure
    // (in production this role is the server doc).  It must seed so the table
    // Y.Arrays exist exactly once before bridgeB clones them — otherwise both
    // bridges create separate 'participants' arrays and the tables.set conflict
    // silently drops one side's rows (concurrent-root-creation hazard).
    storeA.attachSyncBridge(bridgeA, { seed: true });

    // Set up bridge B (independent doc, no store binding for simplicity —
    // we just verify B's Y.Doc converges with A's).  Cloning AFTER bridgeA
    // seeded means B inherits the same shared arrays.
    const bridgeB = new YjsSyncBridge();
    Y.applyUpdate(bridgeB.doc, Y.encodeStateAsUpdate(bridgeA.doc));

    // A adds a participant via the store
    storeA.applyCommand(makeAddParticipantCommand(makeParticipant('P01')));
    // B adds a different one directly
    bridgeB.appendRecord('participants', {
      id: 'p-b',
      code: 'PB',
      displayName: 'PB',
      createdAt: NOW,
    });

    // Bidirectional sync
    Y.applyUpdate(
      bridgeB.doc,
      Y.encodeStateAsUpdate(bridgeA.doc, Y.encodeStateVector(bridgeB.doc))
    );
    Y.applyUpdate(
      bridgeA.doc,
      Y.encodeStateAsUpdate(bridgeB.doc, Y.encodeStateVector(bridgeA.doc))
    );

    const codesA = useProjectStore.getState().project!.data.participants.map((p) => p.code).sort();
    const codesB = bridgeB.toProjectData().participants.map((p) => p.code).sort();
    expect(codesA).toEqual(['P01', 'PB']);
    expect(codesB).toEqual(['P01', 'PB']);
  });
});

describe('projectStore + YjsSyncBridge — segments mirror', () => {
  it('multi-row import propagates as Y.Doc records', () => {
    const store = useProjectStore.getState();
    store.loadProject(null, freshProject());
    const bridge = new YjsSyncBridge();
    store.attachSyncBridge(bridge);

    const alice = makeParticipant('P01');
    store.applyCommand(makeAddParticipantCommand(alice));

    const segs = [
      makeSegment(alice.id, '原文1', 0),
      makeSegment(alice.id, '原文2', 1),
      makeSegment(alice.id, '原文3', 2),
    ];
    store.applyCommand(makeImportSegmentsCommand(segs));

    const dumped = bridge.toProjectData();
    expect(dumped.source_segments).toHaveLength(3);
    expect(dumped.source_segments.map((s) => s.text)).toEqual(['原文1', '原文2', '原文3']);
  });
});

describe('projectStore + YjsSyncBridge — metadata mirror (Codex-W2)', () => {
  it('setProjectName が Y.Doc の metadata にミラーされる', () => {
    const store = useProjectStore.getState();
    store.loadProject(null, freshProject('before'));
    const bridge = new YjsSyncBridge();
    store.attachSyncBridge(bridge);

    useProjectStore.getState().setProjectName('after');

    expect(useProjectStore.getState().project?.metadata.name).toBe('after');
    expect(bridge.doc.getMap('metadata').get('name')).toBe('after');
  });

  it('setDisplaySettings が Y.Doc の metadata にミラーされる', () => {
    const store = useProjectStore.getState();
    store.loadProject(null, freshProject());
    const bridge = new YjsSyncBridge();
    store.attachSyncBridge(bridge);

    const settings = { cardFontScale: 1.25 } as never;
    useProjectStore.getState().setDisplaySettings(settings);

    const mirrored = bridge.doc.getMap('metadata').get('displaySettings') as {
      cardFontScale: number;
    };
    expect(mirrored?.cardFontScale).toBe(1.25);
  });

  it('リモートの metadata 変更が store.project へ反映される', () => {
    const store = useProjectStore.getState();
    store.loadProject(null, freshProject('local'));
    const localBridge = new YjsSyncBridge();
    store.attachSyncBridge(localBridge);

    const remoteBridge = new YjsSyncBridge();
    Y.applyUpdate(remoteBridge.doc, Y.encodeStateAsUpdate(localBridge.doc));
    remoteBridge.applyDiff(remoteBridge.toProjectData(), {
      ...useProjectStore.getState().project!.metadata,
      name: 'renamed-by-remote',
    });
    Y.applyUpdate(
      localBridge.doc,
      Y.encodeStateAsUpdate(remoteBridge.doc, Y.encodeStateVector(localBridge.doc))
    );

    expect(useProjectStore.getState().project?.metadata.name).toBe('renamed-by-remote');
  });
});

describe('projectStore + YjsSyncBridge — restoreSnapshot mirror (Codex-W3)', () => {
  it('restoreSnapshot が復元データを Y.Doc へミラーする', () => {
    const store = useProjectStore.getState();
    store.loadProject(null, freshProject());
    const bridge = new YjsSyncBridge();
    store.attachSyncBridge(bridge);

    // 状態1: P01 のみ．この時点を snapshot として保存．
    store.applyCommand(makeAddParticipantCommand(makeParticipant('P01')));
    const snapData = JSON.parse(
      JSON.stringify(useProjectStore.getState().project!.data)
    );
    useProjectStore.getState().addSnapshot({
      metadata: { id: 'snap-1', timestamp: NOW, kind: 'manual', label: 'P01 のみ' },
      data: snapData,
    });

    // 状態2: P02 を追加 (合計 2 名)．bridge にも反映済．
    useProjectStore.getState().applyCommand(makeAddParticipantCommand(makeParticipant('P02')));
    expect(bridge.toProjectData().participants).toHaveLength(2);

    // 復元: snapshot (P01 のみ) へ戻す → bridge も 1 名へ収束するはず．
    useProjectStore.getState().restoreSnapshot('snap-1');

    const local = useProjectStore.getState().project!.data.participants;
    expect(local.map((p) => p.code)).toEqual(['P01']);
    const mirrored = bridge.toProjectData().participants;
    expect(mirrored.map((p) => p.code)).toEqual(['P01']);
  });
});

describe('projectStore — detach', () => {
  it('detaching the bridge stops local-→Y.Doc mirroring', () => {
    const store = useProjectStore.getState();
    store.loadProject(null, freshProject());
    const bridge = new YjsSyncBridge();
    store.attachSyncBridge(bridge);

    store.applyCommand(makeAddParticipantCommand(makeParticipant('P01')));
    expect(bridge.toProjectData().participants).toHaveLength(1);

    store.attachSyncBridge(null);

    store.applyCommand(makeAddParticipantCommand(makeParticipant('P02')));
    // Store sees both, bridge only sees the first (post-detach edit not mirrored)
    expect(useProjectStore.getState().project!.data.participants).toHaveLength(2);
    expect(bridge.toProjectData().participants).toHaveLength(1);
  });
});
