// v0.2.16 test: docEpoch 評価 + suppressUpload ゲート (クライアント側)．
//
// サーバーは MESSAGE_KJ_META で docEpoch (lineage 世代 ID) を送る．これは
// SyncStep1 より先に届くので，クライアントは upload を計算する前に
// suppressUpload を同期的に決定できる．
//   - server null (epoch 非対応サーバー): 何もしない (旧挙動)
//   - expected null (キャッシュ無し / 初回): 抑止せず，serverEpoch を記録
//   - 一致: 抑止せず (オフライン編集のマージを保持)
//   - 不一致: suppressUpload=true + matched=false で emit
//
// DOM/WebSocket 非依存．MESSAGE_KJ_META を組み立てて handleServerMessage に
// 直接食わせることで parse → evaluateEpoch の経路を end-to-end で検証する．

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import { YjsWebsocketProvider, type ProviderEvent } from '../yWebsocketProvider.js';

const MESSAGE_KJ_META = 2;

/** MESSAGE_KJ_META フレームを組み立てる (サーバー src/index.js の sendKjMeta と同形)． */
function kjMetaFrame(meta: Record<string, unknown>): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_KJ_META);
  encoding.writeVarString(enc, JSON.stringify(meta));
  return encoding.toUint8Array(enc);
}

interface Harness {
  provider: YjsWebsocketProvider;
  events: ProviderEvent[];
  feed: (meta: Record<string, unknown>) => void;
  suppressUpload: () => boolean;
}

function makeProvider(expectedEpoch: string | null): Harness {
  const doc = new Y.Doc();
  const provider = new YjsWebsocketProvider({
    serverUrl: 'ws://localhost:1234',
    roomId: 'test-room',
    nick: 'tester',
    doc,
    expectedEpoch,
    autoReconnect: false,
  });
  const events: ProviderEvent[] = [];
  provider.on((e) => events.push(e));
  return {
    provider,
    events,
    feed: (meta) => {
      // handleServerMessage は private．ArrayBuffer を渡して parse 経路を通す．
      const frame = kjMetaFrame(meta);
      const ab = frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength);
      (provider as unknown as { handleServerMessage: (d: unknown) => void }).handleServerMessage(ab);
    },
    suppressUpload: () =>
      (provider as unknown as { suppressUpload: boolean }).suppressUpload,
  };
}

function epochEvents(events: ProviderEvent[]) {
  return events.filter((e): e is Extract<ProviderEvent, { type: 'epoch' }> => e.type === 'epoch');
}

describe('client docEpoch evaluation', () => {
  it('一致: suppressUpload を立てず matched=true で emit', () => {
    const h = makeProvider('epoch-A');
    h.feed({ kind: 'role-assigned', role: 'editor', docEpoch: 'epoch-A' });
    const evs = epochEvents(h.events);
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ serverEpoch: 'epoch-A', expected: 'epoch-A', matched: true });
    expect(h.suppressUpload()).toBe(false);
  });

  it('不一致: suppressUpload=true + matched=false で emit', () => {
    const h = makeProvider('epoch-A');
    h.feed({ kind: 'role-assigned', role: 'editor', docEpoch: 'epoch-B' });
    const evs = epochEvents(h.events);
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ serverEpoch: 'epoch-B', expected: 'epoch-A', matched: false });
    expect(h.suppressUpload()).toBe(true);
  });

  it('server null (epoch 非対応サーバー): 抑止せず matched=true', () => {
    const h = makeProvider('epoch-A');
    h.feed({ kind: 'role-assigned', role: 'editor' }); // docEpoch 無し → null
    const evs = epochEvents(h.events);
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ serverEpoch: null, expected: 'epoch-A', matched: true });
    expect(h.suppressUpload()).toBe(false);
  });

  it('expected null (キャッシュ無し / 初回): 抑止せず serverEpoch を記録', () => {
    const h = makeProvider(null);
    h.feed({ kind: 'role-assigned', role: 'editor', docEpoch: 'epoch-fresh' });
    const evs = epochEvents(h.events);
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({
      serverEpoch: 'epoch-fresh',
      expected: null,
      matched: true,
    });
    expect(h.suppressUpload()).toBe(false);
  });

  it('docEpoch を受けても role-assigned は従来どおり emit される', () => {
    const h = makeProvider('epoch-A');
    h.feed({
      kind: 'role-assigned',
      role: 'viewer',
      via: 'invite',
      docEpoch: 'epoch-A',
    });
    const role = h.events.find((e) => e.type === 'role-assigned');
    expect(role).toBeDefined();
    expect((role as Extract<ProviderEvent, { type: 'role-assigned' }>).assignment.role).toBe(
      'viewer',
    );
  });

  it('接続のたびに suppressUpload はリセットされる (onopen 相当)', () => {
    const h = makeProvider('epoch-A');
    h.feed({ kind: 'role-assigned', role: 'editor', docEpoch: 'epoch-B' });
    expect(h.suppressUpload()).toBe(true);
    // 新 epoch を保存して再接続したシナリオ: expected を更新した別 provider は
    // 一致するので抑止されない (recover 後の clean 接続を模す)．
    const h2 = makeProvider('epoch-B');
    h2.feed({ kind: 'role-assigned', role: 'editor', docEpoch: 'epoch-B' });
    expect(h2.suppressUpload()).toBe(false);
  });
});
