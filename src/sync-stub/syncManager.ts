// No-op stub for sync-free "studio" builds.
//
// `electron.vite.config.ts` redirects `./sync/syncManager.js` to this file
// when KJ_INCLUDE_SYNC=false, so Yjs / y-protocols / WebSocket code never
// enters the renderer bundle.

class StubSyncManager {
  getState() {
    return {
      status: 'idle' as const,
      synced: false,
      errorDetail: null,
      peers: [],
      meta: null,
    };
  }
  on(): () => void {
    return () => {};
  }
  async connect(): Promise<void> {
    throw new Error('sync is disabled in this build');
  }
  disconnect(): void {}
  _debugSnapshot(): null {
    return null;
  }
}

export const syncManager = new StubSyncManager();
