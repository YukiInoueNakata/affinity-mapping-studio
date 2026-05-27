import { create } from 'zustand';
import type { ProjectFile } from '@shared/types/project';
import type { DisplaySettings, ProjectData } from '@shared/types/domain';
import type { DomainCommand } from './commands.js';
import type { YjsSyncBridge } from '../sync/yjsBridge.js';

const MAX_HISTORY = 200;

// Sync bridge is held as a module-scoped reference (not in Zustand state) so
// React subscribers don't re-render every time it changes and so we don't
// have to serialise it.  Actions read it via `getSyncBridge()`.
let _syncBridge: YjsSyncBridge | null = null;
let _unsubscribeRemote: (() => void) | null = null;

export function getSyncBridge(): YjsSyncBridge | null {
  return _syncBridge;
}

/** True when applying a remote-originated update; suppresses re-mirroring. */
let _applyingRemote = false;

function mirrorToBridge(nextData: ProjectData): void {
  if (!_syncBridge || _applyingRemote) {
    console.debug(
      '[sync] mirrorToBridge skipped',
      { hasBridge: !!_syncBridge, applyingRemote: _applyingRemote }
    );
    return;
  }
  // PoC strategy: bulk replace the bridge's Y.Doc tables with the new
  // ProjectData inside a single transaction tagged with our localOrigin.
  // This is heavy (re-creates Y.Map records each call) but correct;
  // Phase 4b-4 can optimise to incremental diff if perf demands it.
  _syncBridge.applyLocal(() => {
    _syncBridge!.seedFromProjectData(nextData);
  });
  console.debug('[sync] mirrored to Y.Doc', {
    participants: nextData.participants.length,
    source_segments: nextData.source_segments.length,
    cards: nextData.cards.length,
    groups: nextData.groups.length,
  });
}

export type AppMode = 'kj' | 'm_gta' | 'gta';

export interface ProjectStoreState {
  filePath: string | null;
  project: ProjectFile | null;
  mode: AppMode;
  selectedCardId: string | null;
  selectedCardIds: string[];
  selectedGroupId: string | null;
  selectedGroupIds: string[];
  selectedSegmentId: string | null;
  selectedParticipantId: string | null;
  selectedRelationId: string | null;
  selectedConceptId: string | null;
  selectedCodeId: string | null;
  isDirty: boolean;
  past: DomainCommand[];
  future: DomainCommand[];

  loadProject(filePath: string | null, project: ProjectFile): void;
  closeProject(): void;
  markSaved(filePath: string, updatedAt: string): void;

  applyCommand(command: DomainCommand): void;
  undo(): void;
  redo(): void;

  selectCard(cardId: string | null): void;
  selectCardIds(cardIds: string[]): void;
  selectGroup(groupId: string | null): void;
  selectGroupIds(groupIds: string[]): void;
  /** Set both card and group selection at once (for mixed click+shift cases). */
  selectMixed(cardIds: string[], groupIds: string[]): void;
  selectSegment(segmentId: string | null): void;
  selectParticipant(participantId: string | null): void;
  selectRelation(relationId: string | null): void;
  selectConcept(conceptId: string | null): void;
  selectCode(codeId: string | null): void;
  setMode(mode: AppMode): void;

  setProjectName(name: string): void;
  setDisplaySettings(settings: DisplaySettings | undefined): void;

  /** Append a snapshot to project.snapshots (not via Command — snapshots are
   * file-state, not undoable edit history). */
  addSnapshot(snapshot: import('@shared/types/project').Snapshot): void;
  /** Remove a snapshot by id. */
  removeSnapshot(snapshotId: string): void;
  /** Replace the active ProjectData with a snapshot's data (restore). */
  restoreSnapshot(snapshotId: string): void;
  /** Replace the entire snapshots list (e.g. after auto-rotation). */
  setSnapshots(snapshots: import('@shared/types/project').Snapshot[]): void;

  /** Phase 4b-3c: attach a YjsSyncBridge so local edits propagate to a shared
   *  Y.Doc and remote changes flow back into the store.  Pass null to detach. */
  attachSyncBridge(bridge: YjsSyncBridge | null): void;
}

function withData(project: ProjectFile, data: ProjectData): ProjectFile {
  return { ...project, data };
}

export const useProjectStore = create<ProjectStoreState>((set, get) => ({
  filePath: null,
  project: null,
  mode: 'kj',
  selectedCardId: null,
  selectedCardIds: [],
  selectedGroupId: null,
  selectedGroupIds: [],
  selectedSegmentId: null,
  selectedParticipantId: null,
  selectedRelationId: null,
  selectedConceptId: null,
  selectedCodeId: null,
  isDirty: false,
  past: [],
  future: [],

  loadProject(filePath, project) {
    set({
      filePath,
      project,
      selectedCardId: null,
      selectedCardIds: [],
      selectedGroupId: null,
      selectedSegmentId: null,
      selectedParticipantId: null,
      selectedRelationId: null,
      selectedConceptId: null,
      selectedCodeId: null,
      isDirty: false,
      past: [],
      future: [],
    });
  },

  closeProject() {
    set({
      filePath: null,
      project: null,
      selectedCardId: null,
      selectedCardIds: [],
      selectedGroupId: null,
      selectedSegmentId: null,
      selectedParticipantId: null,
      selectedRelationId: null,
      selectedConceptId: null,
      selectedCodeId: null,
      isDirty: false,
      past: [],
      future: [],
    });
  },

  markSaved(filePath, updatedAt) {
    const { project } = get();
    if (!project) return;
    set({
      filePath,
      project: {
        ...project,
        metadata: { ...project.metadata, updated_at: updatedAt },
      },
      isDirty: false,
    });
  },

  applyCommand(command) {
    const { project, past } = get();
    if (!project) return;
    const nextData = command.apply(project.data);
    const nextPast = [...past, command].slice(-MAX_HISTORY);
    set({
      project: withData(project, nextData),
      past: nextPast,
      future: [],
      isDirty: true,
    });
    mirrorToBridge(nextData);
  },

  undo() {
    const { project, past, future } = get();
    if (!project || past.length === 0) return;
    const command = past[past.length - 1];
    const nextPast = past.slice(0, -1);
    const nextData = command.revert(project.data);
    set({
      project: withData(project, nextData),
      past: nextPast,
      future: [...future, command],
      isDirty: true,
    });
    mirrorToBridge(nextData);
  },

  redo() {
    const { project, past, future } = get();
    if (!project || future.length === 0) return;
    const command = future[future.length - 1];
    const nextFuture = future.slice(0, -1);
    const nextData = command.apply(project.data);
    set({
      project: withData(project, nextData),
      past: [...past, command],
      future: nextFuture,
      isDirty: true,
    });
    mirrorToBridge(nextData);
  },

  selectCard(cardId) {
    set({
      selectedCardId: cardId,
      selectedCardIds: cardId ? [cardId] : [],
      selectedGroupId: null,
      selectedGroupIds: [],
      selectedRelationId: cardId ? null : get().selectedRelationId,
    });
  },

  selectCardIds(cardIds) {
    set({
      selectedCardIds: cardIds,
      selectedCardId: cardIds.length === 1 ? cardIds[0] : null,
      selectedGroupId: cardIds.length > 0 ? null : get().selectedGroupId,
      selectedGroupIds: cardIds.length > 0 ? [] : get().selectedGroupIds,
    });
  },

  selectGroup(groupId) {
    set({
      selectedGroupId: groupId,
      selectedGroupIds: groupId ? [groupId] : [],
      selectedCardId: groupId ? null : get().selectedCardId,
      selectedCardIds: groupId ? [] : get().selectedCardIds,
      selectedRelationId: groupId ? null : get().selectedRelationId,
    });
  },

  selectGroupIds(groupIds) {
    set({
      selectedGroupIds: groupIds,
      selectedGroupId: groupIds.length === 1 ? groupIds[0] : null,
      selectedCardId: groupIds.length > 0 ? null : get().selectedCardId,
      selectedCardIds: groupIds.length > 0 ? [] : get().selectedCardIds,
    });
  },

  selectMixed(cardIds, groupIds) {
    set({
      selectedCardIds: cardIds,
      selectedCardId: cardIds.length === 1 ? cardIds[0] : null,
      selectedGroupIds: groupIds,
      selectedGroupId: groupIds.length === 1 ? groupIds[0] : null,
    });
  },

  selectSegment(segmentId) {
    set({ selectedSegmentId: segmentId });
  },

  selectParticipant(participantId) {
    set({ selectedParticipantId: participantId });
  },

  selectRelation(relationId) {
    set({
      selectedRelationId: relationId,
      selectedCardId: relationId ? null : get().selectedCardId,
      selectedCardIds: relationId ? [] : get().selectedCardIds,
      selectedGroupId: relationId ? null : get().selectedGroupId,
      selectedGroupIds: relationId ? [] : get().selectedGroupIds,
    });
  },

  selectConcept(conceptId) {
    set({ selectedConceptId: conceptId });
  },

  selectCode(codeId) {
    set({ selectedCodeId: codeId });
  },

  setMode(mode) {
    set({ mode });
  },

  setProjectName(name) {
    const { project } = get();
    if (!project) return;
    set({
      project: { ...project, metadata: { ...project.metadata, name } },
      isDirty: true,
    });
  },

  setDisplaySettings(settings) {
    const { project } = get();
    if (!project) return;
    set({
      project: { ...project, metadata: { ...project.metadata, displaySettings: settings } },
      isDirty: true,
    });
  },

  addSnapshot(snapshot) {
    const { project } = get();
    if (!project) return;
    set({
      project: {
        ...project,
        snapshots: [...(project.snapshots ?? []), snapshot],
      },
      isDirty: true,
    });
  },

  removeSnapshot(snapshotId) {
    const { project } = get();
    if (!project) return;
    set({
      project: {
        ...project,
        snapshots: (project.snapshots ?? []).filter(
          (s) => s.metadata.id !== snapshotId
        ),
      },
      isDirty: true,
    });
  },

  restoreSnapshot(snapshotId) {
    const { project } = get();
    if (!project) return;
    const snap = (project.snapshots ?? []).find(
      (s) => s.metadata.id === snapshotId
    );
    if (!snap) return;
    // Deep-clone so the active store does not share refs with the stored snapshot
    const restoredData = JSON.parse(JSON.stringify(snap.data));
    set({
      project: withData(project, restoredData),
      past: [],
      future: [],
      isDirty: true,
      selectedCardId: null,
      selectedCardIds: [],
      selectedGroupId: null,
      selectedGroupIds: [],
      selectedRelationId: null,
    });
  },

  setSnapshots(snapshots) {
    const { project } = get();
    if (!project) return;
    set({
      project: { ...project, snapshots },
      isDirty: true,
    });
  },

  attachSyncBridge(bridge) {
    // Detach any existing bridge first
    if (_unsubscribeRemote) {
      _unsubscribeRemote();
      _unsubscribeRemote = null;
    }
    _syncBridge = bridge;
    if (!bridge) return;

    // Seed the bridge with the currently-loaded ProjectData (if any) so the
    // first remote peer sees our state.  This itself triggers Y.Doc updates
    // but they are tagged with localOrigin and won't echo back through observe.
    const { project } = get();
    if (project) {
      bridge.applyLocal(() => {
        bridge.seedFromProjectData(project.data, project.metadata);
      });
      console.debug('[sync] attachSyncBridge seeded', {
        participants: project.data.participants.length,
        source_segments: project.data.source_segments.length,
        cards: project.data.cards.length,
        groups: project.data.groups.length,
      });
    } else {
      console.debug('[sync] attachSyncBridge: no project loaded — empty seed');
    }

    // Mirror remote-originated changes into the store.  We temporarily set
    // `_applyingRemote = true` so the subsequent set() doesn't bounce back
    // into mirrorToBridge.
    _unsubscribeRemote = bridge.observe((remoteData) => {
      const { project: cur } = get();
      if (!cur) return;
      _applyingRemote = true;
      try {
        set({
          project: withData(cur, remoteData),
          isDirty: true,
        });
      } finally {
        _applyingRemote = false;
      }
    });
  },
}));

// ---- Cross-window BroadcastChannel sync ----
// When multiple Electron renderer windows are open (e.g. the SourceViewer pop-out),
// keep their stores in sync by broadcasting the project/filePath/isDirty fields.
// Selection state is intentionally NOT synced (each window has its own focus).

type SyncMessage =
  | {
      type: 'state';
      project: ProjectFile | null;
      filePath: string | null;
      isDirty: boolean;
    }
  | { type: 'request' };

let applyingRemote = false;
let lastBroadcastProject: ProjectFile | null = null;
let lastBroadcastFilePath: string | null = null;
const channel: BroadcastChannel | null =
  typeof BroadcastChannel !== 'undefined'
    ? new BroadcastChannel('kj-trace-studio-sync')
    : null;

function broadcastCurrentState() {
  if (!channel) return;
  const state = useProjectStore.getState();
  if (!state.project) return;
  const msg: SyncMessage = {
    type: 'state',
    project: state.project,
    filePath: state.filePath,
    isDirty: state.isDirty,
  };
  try {
    channel.postMessage(msg);
  } catch {
    // ignore (likely the structured clone failed on something)
  }
}

if (channel) {
  channel.addEventListener('message', (e: MessageEvent<SyncMessage>) => {
    if (!e.data) return;
    if (e.data.type === 'request') {
      // Another window just connected and is asking for the current state.
      // Reply with a fresh broadcast if we have something to share.
      broadcastCurrentState();
      return;
    }
    if (e.data.type === 'state') {
      applyingRemote = true;
      try {
        useProjectStore.setState({
          project: e.data.project,
          filePath: e.data.filePath,
          isDirty: e.data.isDirty,
          past: [],
          future: [],
        });
      } finally {
        applyingRemote = false;
      }
    }
  });

  useProjectStore.subscribe((state) => {
    if (applyingRemote) return;
    if (
      state.project === lastBroadcastProject &&
      state.filePath === lastBroadcastFilePath
    ) {
      return;
    }
    lastBroadcastProject = state.project;
    lastBroadcastFilePath = state.filePath;
    const msg: SyncMessage = {
      type: 'state',
      project: state.project,
      filePath: state.filePath,
      isDirty: state.isDirty,
    };
    try {
      channel.postMessage(msg);
    } catch {
      // ignore
    }
  });

  // On startup, ask peers for their current state. If we are the only window
  // (or the main one), nothing happens; if a sibling already has a project
  // loaded, it responds with a fresh "state" message.
  if (typeof window !== 'undefined') {
    setTimeout(() => {
      try {
        channel.postMessage({ type: 'request' } satisfies SyncMessage);
      } catch {
        // ignore
      }
    }, 50);
  }
}
