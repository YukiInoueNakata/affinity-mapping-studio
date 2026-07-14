import { create } from 'zustand';
import { backfillProjectData, makeEmptyProject, type ProjectFile } from '@shared/types/project';
import type { DisplaySettings, ProjectData, ProjectMetadata } from '@shared/types/domain';
import type { DomainCommand } from './commands.js';
import { confirmBulkOperation, BULK_CONFIRM_THRESHOLD } from '../utils/bulkGuard.js';
import type { YjsSyncBridge } from '../sync/yjsBridge.js';
import {
  normalizeProjectRelations,
  normalizeFinalDiagramShapes,
} from '../domain/relations.js';

const MAX_HISTORY = 200;

// Sync bridge is held as a module-scoped reference (not in Zustand state) so
// React subscribers don't re-render every time it changes and so we don't
// have to serialise it.  Actions read it via `getSyncBridge()`.
let _syncBridge: YjsSyncBridge | null = null;
let _unsubscribeRemote: (() => void) | null = null;

export function getSyncBridge(): YjsSyncBridge | null {
  return _syncBridge;
}

// Sec-003/009 (2026-06-03): viewer ロール時の edit gate．
// sync 層 (syncManager) からプッシュされる．null = 制限なし (= editor 既定 safe fallback)．
let _editGateRole: 'viewer' | 'editor' | 'admin' | null = null;
let _viewerNoticeShown = false;

/** sync 層から呼ぶ．未通知 / 旧サーバー時は null を渡す． */
export function setEditGateRole(role: 'viewer' | 'editor' | 'admin' | null): void {
  if (_editGateRole === role) return;
  _editGateRole = role;
  if (role !== 'viewer') _viewerNoticeShown = false;
}

export function getEditGateRole(): 'viewer' | 'editor' | 'admin' | null {
  return _editGateRole;
}

/** True when applying a remote-originated update; suppresses re-mirroring. */
let _applyingRemote = false;

function mirrorToBridge(nextData: ProjectData, metadata?: ProjectMetadata): void {
  if (!_syncBridge || _applyingRemote) {
    console.debug(
      '[sync] mirrorToBridge skipped',
      { hasBridge: !!_syncBridge, applyingRemote: _applyingRemote }
    );
    return;
  }
  // Incremental reconcile: touch only changed/added/removed records.  The old
  // strategy re-seeded the whole Y.Doc each edit (delete-all + insert-all),
  // which tombstoned the entire document every keystroke and bloated the room
  // unboundedly (giro2026 grew 3 MB → 205 MB in a few hours, freezing the
  // renderer on a single card touch).  applyDiff produces a tiny delta instead.
  _syncBridge.applyDiff(nextData, metadata);
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

  /** 2026-06-02: キャンバス表示フィルタ (runtime, persist しない)．
   *  対象の participantId / groupId / tag に該当するカード/グループは canvas
   *  ノードから除外される．左ペインの一覧で目アイコンクリックでトグル． */
  hiddenParticipantIds: ReadonlyArray<string>;
  hiddenGroupIds: ReadonlyArray<string>;
  hiddenTags: ReadonlyArray<string>;
  toggleParticipantVisible(id: string): void;
  toggleGroupVisible(id: string): void;
  toggleTagVisible(tag: string): void;
  resetVisibility(): void;

  /** 2026-06-02: キャンバスの操作モード (runtime, persist しない)．
   *  - 'pan': キャンバスドラッグで視点移動 (ノードクリックで個別選択)
   *  - 'select': キャンバスドラッグで矩形範囲選択
   *  リボン or キャンバス左下のトグルで切替． */
  canvasInteractionMode: 'pan' | 'select';
  setCanvasInteractionMode(mode: 'pan' | 'select'): void;

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
   *  Y.Doc and remote changes flow back into the store.  Pass null to detach.
   *
   *  `opts.seed` controls whether the currently-loaded ProjectData is pushed
   *  INTO the Y.Doc on attach.  This MUST be false when the Y.Doc already holds
   *  data (e.g. restored from the local IndexedDB cache): seeding calls
   *  seedFromProjectData which deletes existing table contents, and those
   *  deletes are real CRDT ops that would propagate to the server and wipe
   *  everyone's data.  Default is now FALSE (seed only on explicit opt-in):
   *  the single safe populate-an-empty-room path goes through
   *  syncManager.uploadProject (guarded by docHasData), so no attach path
   *  should implicitly seed.  Defaulting off prevents a future caller from
   *  re-triggering the 2026-06 wipe/bloat incident by forgetting seed:false. */
  attachSyncBridge(
    bridge: YjsSyncBridge | null,
    opts?: { seed?: boolean }
  ): void;
  /** Phase 4 (CRDT-first): copy the Y.Doc's current contents into the store
   *  without echoing back to the doc.  Used after the local IndexedDB cache has
   *  loaded into a freshly-attached bridge (whose observe() did not fire for the
   *  already-applied cache transactions), so offline data shows immediately. */
  hydrateFromBridge(bridge: YjsSyncBridge): void;
}

function withData(project: ProjectFile, data: ProjectData): ProjectFile {
  return { ...project, data };
}

/** 旧スキーマ（14 種）の関係種別を論文§2 分類へロード時に正規化する（破壊的・in-place）．
 *  diagram_relations.relationType と final_diagram.shapes[].kind の両方を対象． */
function migrateRelationSchema(
  data?: ProjectData | null,
  metadata?: ProjectMetadata | null
): void {
  if (data) normalizeProjectRelations(data);
  // final_diagram は data 側に保存される (旧レイアウトの metadata 側も
  // 後方互換のため見る)．
  const fdData = (data as { final_diagram?: unknown } | null | undefined)?.final_diagram;
  if (fdData) normalizeFinalDiagramShapes(fdData);
  const fd = (metadata as { final_diagram?: unknown } | null | undefined)?.final_diagram;
  if (fd) normalizeFinalDiagramShapes(fd);
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
  hiddenParticipantIds: [],
  hiddenGroupIds: [],
  hiddenTags: [],

  toggleParticipantVisible(id) {
    set((s) => {
      const set0 = new Set(s.hiddenParticipantIds);
      if (set0.has(id)) set0.delete(id); else set0.add(id);
      return { hiddenParticipantIds: Array.from(set0) };
    });
  },
  toggleGroupVisible(id) {
    set((s) => {
      const set0 = new Set(s.hiddenGroupIds);
      if (set0.has(id)) set0.delete(id); else set0.add(id);
      return { hiddenGroupIds: Array.from(set0) };
    });
  },
  toggleTagVisible(tag) {
    set((s) => {
      const set0 = new Set(s.hiddenTags);
      if (set0.has(tag)) set0.delete(tag); else set0.add(tag);
      return { hiddenTags: Array.from(set0) };
    });
  },
  resetVisibility() {
    set({ hiddenParticipantIds: [], hiddenGroupIds: [], hiddenTags: [] });
  },

  canvasInteractionMode: 'select',
  setCanvasInteractionMode(mode) {
    set({ canvasInteractionMode: mode });
  },

  loadProject(filePath, project) {
    // 旧スキーマ由来の欠損テーブルを空配列で補完 (白画面クラッシュ防止)．
    const normalized = project
      ? withData(project, backfillProjectData(project.data))
      : project;
    migrateRelationSchema(normalized?.data, normalized?.metadata);
    set({
      filePath,
      project: normalized,
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
    // Sec-003/009 viewer gate (2026-06-03):
    // viewer ロールでは command.viewerAllowed=true のコマンドだけ通す．
    // Phase 2B: コメント / メモログ追記 (makeAddCardMemoEntryCommand /
    // makeAddLabelMemoEntryCommand) は viewer も実行可．他はすべて block．
    if (_editGateRole === 'viewer' && !command.viewerAllowed) {
      console.warn('[viewer-gate] blocked applyCommand:', command.label);
      if (!_viewerNoticeShown) {
        _viewerNoticeShown = true;
        // 1 セッションに 1 回だけ通知．以降は console のみ
        if (typeof window !== 'undefined') {
          setTimeout(() => {
            window.alert(
              '閲覧者モード (viewer) です．\n\n' +
                'このルームでは編集権限が付与されていません．\n' +
                'カード・グループ・関係エッジ・整列などの編集操作は無効化されています．\n' +
                'カードや表札への「メモ追記」(コメント) は viewer でも実行可能です．'
            );
          }, 0);
        }
      }
      return;
    }
    // Codex 指摘#3 (2026-07-03): 一括操作ガードをコマンド層で強制する．
    // UI 経路以外 (alignGroupToLabel / DevTools / 別コンポーネント / 確認漏れ) でも
    // 閾値以上の一括変更は必ず確認する．UI 側で確認済みなら bulkConfirmed=true．
    if (
      command.impactCount != null &&
      command.impactCount >= BULK_CONFIRM_THRESHOLD &&
      command.bulkConfirmed !== true
    ) {
      if (!confirmBulkOperation(command.impactCount, command.bulkActionLabel ?? '一括変更')) {
        return;
      }
    }
    const nextData = command.apply(project.data);
    const nextPast = [...past, command].slice(-MAX_HISTORY);
    set({
      project: withData(project, nextData),
      past: nextPast,
      future: [],
      isDirty: true,
    });
    mirrorToBridge(nextData, project.metadata);
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
    mirrorToBridge(nextData, project.metadata);
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
    mirrorToBridge(nextData, project.metadata);
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
    // Codex-W2: metadata も同期スキーマの一部．mirrorToBridge を呼ばないと
    // 名称変更が Y.Doc に伝播せず他クライアントへ届かない．
    const metadata = { ...project.metadata, name };
    set({ project: { ...project, metadata }, isDirty: true });
    mirrorToBridge(project.data, metadata);
  },

  setDisplaySettings(settings) {
    const { project } = get();
    if (!project) return;
    // Codex-W2: displaySettings の変更も他クライアントへミラーする．
    const metadata = { ...project.metadata, displaySettings: settings };
    set({ project: { ...project, metadata }, isDirty: true });
    mirrorToBridge(project.data, metadata);
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
    // (旧バージョンのスナップショットは後発テーブルを欠くため backfill も通す)
    const restoredData = backfillProjectData(JSON.parse(JSON.stringify(snap.data)));
    migrateRelationSchema(restoredData, project.metadata);
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
    // Codex-W3: スナップショット復元も他クライアントへミラーする．mirrorToBridge は
    // applyDiff (差分反映) なので，復元で実際に変化した分だけ Y.Doc に反映され，
    // 旧来の delete-all + re-add のような全件 tombstone 増殖は起きない．
    mirrorToBridge(restoredData, project.metadata);
  },

  setSnapshots(snapshots) {
    const { project } = get();
    if (!project) return;
    set({
      project: { ...project, snapshots },
      isDirty: true,
    });
  },

  attachSyncBridge(bridge, opts) {
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
    // CRITICAL: skip seeding when the caller says so (opts.seed === false) —
    // see the interface doc.  Seeding over an already-populated Y.Doc would
    // delete its contents and propagate destructive CRDT ops to the server.
    const seed = opts?.seed === true;
    const { project } = get();
    if (seed && project) {
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
      console.debug('[sync] attachSyncBridge: seed skipped', {
        seed,
        hasProject: !!project,
      });
    }

    // Mirror remote-originated changes into the store.  We temporarily set
    // `_applyingRemote = true` so the subsequent set() doesn't bounce back
    // into mirrorToBridge.
    _unsubscribeRemote = bridge.observe((remoteData, remoteMeta) => {
      const { project: cur } = get();
      // 2026-06-02 incident デバッグ用ログ．v0.2.8 で原因を絞り込む用．
      console.info('[sync.observe] remote data received', {
        hasCur: !!cur,
        curCards: cur?.data.cards.length ?? null,
        remoteCards: remoteData.cards.length,
        remoteSegments: remoteData.source_segments.length,
        remoteGroups: remoteData.groups.length,
      });
      _applyingRemote = true;
      try {
        migrateRelationSchema(remoteData, remoteMeta as ProjectMetadata | null);
        if (cur) {
          // final_diagram 防御: リモート (旧クライアントのみの部屋等) が
          // final_diagram を持たない場合，全置換でローカルの図解を消さない．
          if (!remoteData.final_diagram && cur.data.final_diagram) {
            remoteData.final_diagram = cur.data.final_diagram;
          }
          // Codex-W2: remote の metadata 変更 (名称 / displaySettings 等) も反映する．
          set({
            project: {
              ...withData(cur, remoteData),
              metadata: remoteMeta ? { ...cur.metadata, ...remoteMeta } : cur.metadata,
            },
            // 2026-07-14 レビュー rank4/10/18: リモート同期由来の反映では isDirty を
            // 立てない．この observe は接続中のみ発火する．旧実装の isDirty:true は
            // (a) 接続中に isDirty が貼り付き，終了ガード (App.tsx onCloseRequested) が
            // 毎回発火して窓が閉じない・点滅を招き，(b) ローカル .kjproj を開いたまま
            // 接続すると自動保存が縮小/マージ済み状態でローカル正本を静かに上書きした．
            // 共同編集ではサーバーが正本なのでリモート反映は「未保存のローカル変更」で
            // ない．synth-shell 分岐 (下) も isDirty:false で整合する．
            isDirty: false,
          });
          console.info('[sync.observe] store updated (cur branch)', {
            cards: get().project?.data.cards.length,
          });
        } else {
          // 2026-06-02 incident 修正: 旧コードは cur=null 時に remoteData を破棄して
          // いたため，ローカルプロジェクト未ロードで接続した場合にサーバーデータが
          // store に流れず「カード 0 表示」を起こした．代わりに metadata 込みの
          // 空 ProjectFile を合成して反映する．
          const meta = bridge.toMetadata() ?? {};
          const now = new Date().toISOString();
          const shell = makeEmptyProject(
            (meta as { name?: string }).name ?? '(リモートルーム)',
            (meta as { project_id?: string }).project_id ?? `remote-${now}`,
            (meta as { created_at?: string }).created_at ?? now
          );
          set({
            project: {
              ...shell,
              metadata: { ...shell.metadata, ...meta, updated_at: now },
              data: remoteData,
            },
            isDirty: false,
          });
          console.info('[sync.observe] store updated (synth shell)', {
            cards: get().project?.data.cards.length,
          });
        }
      } finally {
        _applyingRemote = false;
      }
    });
  },

  hydrateFromBridge(bridge) {
    const { project: cur } = get();
    _applyingRemote = true;
    try {
      const data = bridge.toProjectData();
      const meta = bridge.toMetadata();
      migrateRelationSchema(data, meta as ProjectMetadata | null);
      if (cur) {
        // final_diagram 防御: リモート側に無ければローカルの図解を保持する．
        if (!data.final_diagram && cur.data.final_diagram) {
          data.final_diagram = cur.data.final_diagram;
        }
        set({
          project: {
            ...withData(cur, data),
            metadata: meta ? { ...cur.metadata, ...meta } : cur.metadata,
          },
          // Cache load is not a user edit; don't mark dirty.
          isDirty: false,
        });
      } else {
        // 2026-06-02 incident 修正: cur=null 時もリモート/キャッシュデータから合成．
        const m = meta ?? {};
        const now = new Date().toISOString();
        const shell = makeEmptyProject(
          (m as { name?: string }).name ?? '(リモートルーム)',
          (m as { project_id?: string }).project_id ?? `remote-${now}`,
          (m as { created_at?: string }).created_at ?? now
        );
        set({
          project: {
            ...shell,
            metadata: { ...shell.metadata, ...m, updated_at: now },
            data,
          },
          isDirty: false,
        });
      }
    } finally {
      _applyingRemote = false;
    }
  },
}));

// デバッグ用: dev tools から store の状態を確認できるよう window に露出．
// 例: window.__kjStore.getState().project?.data.cards.length
if (typeof window !== 'undefined') {
  (window as unknown as { __kjStore: typeof useProjectStore }).__kjStore = useProjectStore;
}

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
