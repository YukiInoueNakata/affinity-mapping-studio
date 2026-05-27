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
    storeA.attachSyncBridge(bridgeA);

    // Set up bridge B (independent doc, no store binding for simplicity —
    // we just verify B's Y.Doc converges with A's)
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
