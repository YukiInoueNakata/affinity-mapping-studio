import { useEffect, useState, useCallback } from 'react';
import { syncManager, type SyncState, type ConnectOptions } from './syncManager.js';

/** React hook over the singleton SyncManager.  Re-renders on state change. */
export function useSyncManager() {
  const [state, setState] = useState<SyncState>(syncManager.getState());
  useEffect(() => syncManager.on(setState), []);

  const connect = useCallback((opts: ConnectOptions) => syncManager.connect(opts), []);
  const disconnect = useCallback(() => syncManager.disconnect(), []);

  return { state, connect, disconnect };
}
