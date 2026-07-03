// 段階2: アプリ内スナップショット API クライアント．
//
// サーバー (affinity-mapping-studio-server) の /api/snapshots エンドポイントを叩く．
// Yjs 同期プロトコルとは別経路の REST で，手動作成 (create) と一覧 (list) のみ．
// 復元 (restore) はサーバー側 admin CLI 限定なので，ここには実装しない．
//
// 認証は WS と同じルームトークン (?t=) を流用する．接続情報は syncManager から取得．
import { syncManager } from '../sync/syncManager.js';

export interface SnapshotEntry {
  id: string;
  ts: string;
  trigger: string;
  author: string | null;
  label: string | null;
  bytes: number;
  counts: { cards: number; groups: number; memberships: number };
}

export class SnapshotApiError extends Error {}

function target() {
  const t = syncManager.getSnapshotApiTarget();
  if (!t) {
    throw new SnapshotApiError('ルームに接続していません（スナップショットは接続中のみ）');
  }
  return t;
}

function endpoint(t: { baseUrl: string; roomId: string; token: string }): string {
  const qs = new URLSearchParams({ room: t.roomId });
  if (t.token) qs.set('t', t.token);
  return `${t.baseUrl}/api/snapshots?${qs.toString()}`;
}

function restoreEndpoint(
  t: { baseUrl: string; roomId: string; token: string },
  id: string
): string {
  const qs = new URLSearchParams({ room: t.roomId, id });
  if (t.token) qs.set('t', t.token);
  return `${t.baseUrl}/api/snapshots/restore?${qs.toString()}`;
}

async function parseError(res: Response): Promise<string> {
  let detail = `HTTP ${res.status}`;
  try {
    const j = await res.json();
    if (j?.error) detail = `${j.error}${j.reason ? ` (${j.reason})` : ''}`;
  } catch {
    /* ignore */
  }
  if (res.status === 403) return `権限がありません: ${detail}`;
  if (res.status === 409) return `スナップショットは無効化されています: ${detail}`;
  return detail;
}

/** 手動スナップショットを作成する（editor 権限必須）． */
export async function createSnapshot(label?: string): Promise<SnapshotEntry> {
  const t = target();
  let res: Response;
  try {
    res = await fetch(endpoint(t), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: label ?? null }),
    });
  } catch (e) {
    throw new SnapshotApiError(
      `サーバーに接続できませんでした: ${e instanceof Error ? e.message : String(e)}`
    );
  }
  if (!res.ok) throw new SnapshotApiError(await parseError(res));
  const j = (await res.json()) as { snapshot: SnapshotEntry | null };
  if (!j.snapshot) throw new SnapshotApiError('スナップショットの作成に失敗しました');
  return j.snapshot;
}

/** スナップショット一覧を取得する（新しい順）． */
export async function fetchSnapshots(): Promise<SnapshotEntry[]> {
  const t = target();
  let res: Response;
  try {
    res = await fetch(endpoint(t), { method: 'GET' });
  } catch (e) {
    throw new SnapshotApiError(
      `サーバーに接続できませんでした: ${e instanceof Error ? e.message : String(e)}`
    );
  }
  if (!res.ok) throw new SnapshotApiError(await parseError(res));
  const j = (await res.json()) as { snapshots: SnapshotEntry[] };
  return j.snapshots ?? [];
}

/**
 * 対策5: 指定スナップショットへ復元する（editor / admin 権限必須）．
 * サーバーは復元前に現状を自動退避し，全接続を切断して epoch を更新する．
 * 成功後はクライアントを再接続して復元状態を取得する必要がある．
 */
export async function restoreSnapshot(id: string): Promise<void> {
  const t = target();
  let res: Response;
  try {
    res = await fetch(restoreEndpoint(t, id), { method: 'POST' });
  } catch (e) {
    throw new SnapshotApiError(
      `サーバーに接続できませんでした: ${e instanceof Error ? e.message : String(e)}`
    );
  }
  if (!res.ok) throw new SnapshotApiError(await parseError(res));
}
