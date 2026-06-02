// Phase 4b-3d: lifecycle manager for the sync layer.
//
// One `SyncManager` exists per renderer process (module singleton).  It owns
// the YjsSyncBridge + YjsWebsocketProvider, wires the bridge into the Zustand
// store, exposes connection / presence state, and is the single point that
// the React UI talks to (via the useSyncManager hook).

import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { YjsSyncBridge } from './yjsBridge.js';
import {
  YjsWebsocketProvider,
  type ProviderStatus,
  type KjRole,
  type KjRoleAssignment,
} from './yWebsocketProvider.js';
import { useProjectStore, setEditGateRole } from '../stores/projectStore.js';
import type { ProjectFile } from '@shared/types/project';

/** True if the Y.Doc's `tables` map already holds any records — i.e. data was
 *  restored from the local IndexedDB cache (or otherwise present). */
function docHasData(doc: Y.Doc): boolean {
  const tables = doc.getMap('tables');
  let has = false;
  tables.forEach((v) => {
    if (v instanceof Y.Array && v.length > 0) has = true;
  });
  return has;
}

export interface ConnectOptions {
  serverUrl: string;
  roomId: string;
  email?: string;
  nick: string;
}

export interface PresenceUser {
  clientId: number;
  name: string;
  color: string;
}

export interface SyncState {
  status: ProviderStatus | 'idle';
  /** True once the server's first state snapshot has arrived. */
  synced: boolean;
  /** Last error text shown to the user. */
  errorDetail: string | null;
  /** Other peers currently in the room (excluding self). */
  peers: PresenceUser[];
  /** Connection metadata for the UI to display. */
  meta: { serverUrl: string; roomId: string; nick: string; email: string } | null;
  /** Sec-003/009: サーバーから通知されたロール．未接続 / 旧サーバー時は null．
   *  null = role 未通知 (= editor 既定で safe fallback)． */
  role: KjRoleAssignment | null;
}

const INITIAL_STATE: SyncState = {
  status: 'idle',
  synced: false,
  errorDetail: null,
  peers: [],
  meta: null,
  role: null,
};

class SyncManager {
  private state: SyncState = INITIAL_STATE;
  private listeners = new Set<(s: SyncState) => void>();
  private bridge: YjsSyncBridge | null = null;
  private provider: YjsWebsocketProvider | null = null;
  private idb: IndexeddbPersistence | null = null;
  private unsubProvider: (() => void) | null = null;

  getState(): SyncState {
    return this.state;
  }

  on(listener: (s: SyncState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Connect to a room.  Resolves once the first sync completes (or rejects
   *  on auth-denied / error within 10 seconds). */
  async connect(opts: ConnectOptions): Promise<void> {
    this.disconnect();

    const doc = new Y.Doc();

    // CRDT-first: load the room's local IndexedDB cache into the doc BEFORE
    // attaching the bridge or connecting the socket.  This gives instant load,
    // offline editing, and automatic merge on reconnect.  We await the initial
    // cache load so `docHasData` reflects the cached state.
    const idb = new IndexeddbPersistence(`kj-room-${opts.roomId}`, doc);
    this.idb = idb;
    try {
      await idb.whenSynced;
    } catch {
      // If IndexedDB is unavailable (e.g. private mode) just continue online.
    }
    const hadCache = docHasData(doc);

    const bridge = new YjsSyncBridge(doc);
    const provider = new YjsWebsocketProvider({
      serverUrl: opts.serverUrl,
      roomId: opts.roomId,
      email: opts.email ?? '',
      nick: opts.nick,
      doc,
    });
    // Hand the awareness instance a small "user" payload so other peers see us
    provider.awareness.setLocalStateField('user', {
      name: opts.nick || 'anonymous',
      color: pickColor(opts.nick || opts.email || 'x'),
    });

    this.bridge = bridge;
    this.provider = provider;

    // バグ修正 (2026-06-02 incident): 旧コードは hadCache=false ＋ ローカルプロジェクト
    // 非 null 時に attachSyncBridge({ seed: true }) を呼んでサーバーの Y.Doc を
    // ローカルの (時に空の) 状態で seed し直していた．これが CRDT 経由で他クライアント
    // のカードを全削除する事故を起こした．
    //
    // 安全な方針: connect では絶対に seed しない (= サーバー側のデータを破壊しない)．
    // ローカルプロジェクトをルームに転送したい場合は明示的に uploadProject() を
    // 呼ぶ運用とする．attachSyncBridge は seed=false で，hydrateFromBridge で
    // サーバー / IndexedDB からのデータをローカル store へ反映する．
    // 2026-06-02 debug ログ
    console.info('[sync.connect] pre-attach', {
      roomId: opts.roomId,
      hadCache,
      currentProjectCards: useProjectStore.getState().project?.data.cards.length ?? null,
    });
    useProjectStore.getState().attachSyncBridge(bridge, { seed: false });
    if (hadCache) {
      console.info('[sync.connect] hadCache=true, hydrating from bridge');
      useProjectStore.getState().hydrateFromBridge(bridge);
    } else {
      console.info('[sync.connect] hadCache=false, waiting for server sync');
    }

    this.setState({
      status: 'connecting',
      synced: false,
      errorDetail: null,
      peers: [],
      meta: {
        serverUrl: opts.serverUrl,
        roomId: opts.roomId,
        nick: opts.nick,
        email: opts.email ?? '',
      },
    });

    this.unsubProvider = provider.on((e) => {
      if (e.type === 'status') {
        this.setState({ status: e.status, errorDetail: e.detail ?? null });
      } else if (e.type === 'sync') {
        this.setState({ synced: e.synced });
      } else if (e.type === 'error') {
        this.setState({ errorDetail: e.error.message });
      } else if (e.type === 'role-assigned') {
        console.info('[sync] role assigned by server:', e.assignment);
        this.setState({ role: e.assignment });
        // Sec-003/009: store 側の edit gate にも反映．viewer のとき applyCommand が block される．
        setEditGateRole(e.assignment.role);
      }
    });

    // Push presence updates into our state whenever awareness changes
    provider.awareness.on('change', this.handleAwarenessChange);

    provider.connect();

    // When the local cache already has data we can let the user work offline
    // immediately — resolve without waiting for the server.  The provider keeps
    // retrying in the background and merges server state when it arrives.
    if (hadCache) {
      return Promise.resolve();
    }

    // No cache (first join / brand-new room): we need the server's first sync
    // to know the room's state, so wait for it (or fail).
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        unsub();
        reject(new Error('connection timeout'));
      }, 10_000);
      const unsub = this.on((s) => {
        if (s.synced) {
          clearTimeout(timer);
          unsub();
          resolve();
        } else if (s.status === 'auth-denied' || s.status === 'error') {
          clearTimeout(timer);
          unsub();
          reject(new Error(s.errorDetail ?? s.status));
        }
      });
    });
  }

  /** True while attached to a room (online OR offline-with-cache). */
  isInRoom(): boolean {
    return this.bridge !== null;
  }

  /** True if the connected room's Y.Doc already holds data. */
  roomHasData(): boolean {
    return this.bridge !== null && docHasData(this.bridge.doc);
  }

  /** Upload a locally-opened project INTO the connected (empty) room.  Seeds
   *  the room's Y.Doc from the project so it propagates to the server and other
   *  peers.  Refuses if the room already has data, since seeding deletes then
   *  re-adds table contents and would otherwise wipe the shared room. */
  uploadProject(project: ProjectFile): void {
    if (!this.bridge) throw new Error('not connected to a room');
    if (docHasData(this.bridge.doc)) {
      throw new Error('room already has data — refusing to overwrite');
    }
    const store = useProjectStore.getState();
    store.loadProject(null, project);
    const bridge = this.bridge;
    bridge.applyLocal(() => {
      bridge.seedFromProjectData(project.data, project.metadata);
    });
  }

  disconnect(): void {
    if (this.unsubProvider) {
      this.unsubProvider();
      this.unsubProvider = null;
    }
    if (this.provider) {
      this.provider.awareness.off('change', this.handleAwarenessChange);
      this.provider.destroy();
      this.provider = null;
    }
    if (this.bridge) {
      // Detach store first so its observer is removed
      useProjectStore.getState().attachSyncBridge(null);
      this.bridge = null;
    }
    if (this.idb) {
      // destroy() stops syncing but keeps the cached data on disk for next time.
      void this.idb.destroy();
      this.idb = null;
    }
    if (this.state.status !== 'idle') {
      this.setState(INITIAL_STATE);
    } else if (this.state.role !== null) {
      // 接続失敗で idle に戻った場合でも role 情報は持ち越さない
      this.setState({ role: null });
    }
    // Sec-003/009: 切断したら gate も解除．ローカル単独編集は常に editor 想定．
    setEditGateRole(null);
  }

  // ---- internals ----

  private setState(patch: Partial<SyncState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) {
      try {
        l(this.state);
      } catch (e) {
        console.error('SyncManager listener error:', e);
      }
    }
  }

  private handleAwarenessChange = () => {
    if (!this.provider) return;
    const localId = this.bridge?.doc.clientID;
    const peers: PresenceUser[] = [];
    this.provider.awareness.getStates().forEach((s, id) => {
      if (id === localId) return;
      const user = (s as { user?: { name?: string; color?: string } }).user;
      if (!user) return;
      peers.push({
        clientId: id,
        name: user.name ?? 'anonymous',
        color: user.color ?? '#888',
      });
    });
    this.setState({ peers });
  };

  /** Debug helper: returns the current Y.Doc table sizes so DevTools can
   *  compare against the Zustand store.  Returns null when disconnected. */
  _debugSnapshot(): {
    tableSizes: Record<string, number>;
    state: SyncState;
  } | null {
    if (!this.bridge) return null;
    const doc = this.bridge.doc;
    const tables = doc.getMap('tables');
    const sizes: Record<string, number> = {};
    tables.forEach((value, key) => {
      if (value instanceof Y.Array) sizes[key] = value.length;
      else if (value instanceof Y.Map) sizes[key] = value.size;
    });
    return { tableSizes: sizes, state: this.state };
  }
}

export const syncManager = new SyncManager();

function pickColor(seed: string): string {
  // Simple hash → HSL.  Good enough for distinguishing 2-5 ゼミ members.
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) & 0xffffff;
  }
  const hue = Math.abs(h) % 360;
  return `hsl(${hue}, 60%, 50%)`;
}
