// v0.2.20 回帰テスト: deleteRoomCache の onblocked 早期 resolve バグ (Codex 指摘).
//
// epoch 不一致リカバリでは「古い lineage の IndexedDB キャッシュが本当に消えた」
// ことを確認してから新 epoch を保存する必要がある．旧実装は onblocked でも
// resolve(true) 相当の成功扱いをしていたため，削除がブロックされたまま再接続し，
// 古いキャッシュが残って再アップロード＝再肥大する race があった．
//
// ここでは最小の fake indexedDB を注入し，
//   - onsuccess → true
//   - onerror   → false
//   - onblocked → resolve せず onsuccess を待つ
//   - timeout   → false
// を固定する．DOM/実 IndexedDB 非依存．

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { deleteRoomCache } from '../syncManager.js';

interface FakeReq {
  onsuccess?: () => void;
  onerror?: () => void;
  onblocked?: () => void;
}

let lastReq: FakeReq | null;
const originalIndexedDB = (globalThis as { indexedDB?: unknown }).indexedDB;

beforeEach(() => {
  lastReq = null;
  (globalThis as { indexedDB?: unknown }).indexedDB = {
    deleteDatabase: () => {
      const req: FakeReq = {};
      lastReq = req;
      return req as unknown;
    },
  };
});

afterEach(() => {
  (globalThis as { indexedDB?: unknown }).indexedDB = originalIndexedDB;
});

/** p がまだ resolve していなければ true． */
async function isPending(p: Promise<unknown>): Promise<boolean> {
  const sentinel = Symbol('pending');
  const raced = await Promise.race([p, Promise.resolve(sentinel)]);
  return raced === sentinel;
}

describe('deleteRoomCache', () => {
  it('onsuccess → true', async () => {
    const p = deleteRoomCache('r', 1000);
    lastReq!.onsuccess!();
    expect(await p).toBe(true);
  });

  it('onerror → false', async () => {
    const p = deleteRoomCache('r', 1000);
    lastReq!.onerror!();
    expect(await p).toBe(false);
  });

  it('onblocked では resolve せず，後続の onsuccess を待つ', async () => {
    const p = deleteRoomCache('r', 1000);
    lastReq!.onblocked!();
    // ブロック通知だけでは未解決のまま (早期 resolve しない).
    expect(await isPending(p)).toBe(true);
    // 接続が閉じて onsuccess が発火したら true.
    lastReq!.onsuccess!();
    expect(await p).toBe(true);
  });

  it('恒久ブロック (success も error も来ない) は timeout で false', async () => {
    const p = deleteRoomCache('r', 10);
    lastReq!.onblocked!();
    expect(await p).toBe(false);
  });

  it('deleteDatabase が throw したら false', async () => {
    (globalThis as { indexedDB?: unknown }).indexedDB = {
      deleteDatabase: () => {
        throw new Error('SecurityError');
      },
    };
    expect(await deleteRoomCache('r', 1000)).toBe(false);
  });
});
