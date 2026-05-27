// Phase 4b-3d: lifecycle manager for the sync layer.
//
// One `SyncManager` exists per renderer process (module singleton).  It owns
// the YjsSyncBridge + YjsWebsocketProvider, wires the bridge into the Zustand
// store, exposes connection / presence state, and is the single point that
// the React UI talks to (via the useSyncManager hook).

import * as Y from 'yjs';
import { YjsSyncBridge } from './yjsBridge.js';
import {
  YjsWebsocketProvider,
  type ProviderStatus,
} from './yWebsocketProvider.js';
import { useProjectStore } from '../stores/projectStore.js';

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
}

const INITIAL_STATE: SyncState = {
  status: 'idle',
  synced: false,
  errorDetail: null,
  peers: [],
  meta: null,
};

class SyncManager {
  private state: SyncState = INITIAL_STATE;
  private listeners = new Set<(s: SyncState) => void>();
  private bridge: YjsSyncBridge | null = null;
  private provider: YjsWebsocketProvider | null = null;
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

    // Connect the bridge to the store so applyCommand / observe flow.
    useProjectStore.getState().attachSyncBridge(bridge);

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
      }
    });

    // Push presence updates into our state whenever awareness changes
    provider.awareness.on('change', this.handleAwarenessChange);

    provider.connect();

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
    if (this.state.status !== 'idle') {
      this.setState(INITIAL_STATE);
    }
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
