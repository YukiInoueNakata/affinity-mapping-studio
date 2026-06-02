import { useEffect, useState, useCallback } from 'react';
import { syncManager, type SyncState, type ConnectOptions } from './syncManager.js';
import type { KjRole } from './yWebsocketProvider.js';

/** React hook over the singleton SyncManager.  Re-renders on state change. */
export function useSyncManager() {
  const [state, setState] = useState<SyncState>(syncManager.getState());
  useEffect(() => syncManager.on(setState), []);

  const connect = useCallback((opts: ConnectOptions) => syncManager.connect(opts), []);
  const disconnect = useCallback(() => syncManager.disconnect(), []);

  return { state, connect, disconnect };
}

/** Sec-003/009 (2026-06-03): 現在のロール．
 *  - 未接続 / 旧サーバー (MESSAGE_KJ_META 未対応) のときは null
 *  - null は呼び出し側で「editor 既定」として扱う safe fallback
 *  - viewer のときは編集系 UI を disable する必要がある */
export function useKjRole(): KjRole | null {
  const [state, setState] = useState<SyncState>(syncManager.getState());
  useEffect(() => syncManager.on(setState), []);
  return state.role?.role ?? null;
}

/** Sec-003/009: 「閲覧者モード」判定．未接続またはロール未通知 (旧サーバー)
 *  のときは false (= editor 既定 safe fallback)． */
export function useIsViewer(): boolean {
  return useKjRole() === 'viewer';
}

/** Sec-003/009: 編集 (カード/グループ/関係/整列/スタイル等) が許可されているか．
 *  viewer 以外 (= editor / admin / null) は許可．
 *  コメント・メモログは viewer でも編集可なので別判定 (useCanComment)． */
export function useCanEdit(): boolean {
  return !useIsViewer();
}

/** Sec-003/009: コメント書き込みが許可されているか．現状は全ロール許可
 *  (viewer もコメント可．Sec-009 案 1 協調モデル)． */
export function useCanComment(): boolean {
  // 将来 strict + コメント別チャネル化したら role を見る
  return true;
}
