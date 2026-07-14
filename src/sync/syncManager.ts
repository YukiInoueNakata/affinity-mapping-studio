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
export function docHasData(doc: Y.Doc): boolean {
  // Conservative emptiness test guarding destructive uploadProject/seed paths.
  // Treat the doc as "has data" if ANY table holds rows OR the metadata map is
  // non-empty.  A room that only carries metadata (or a partially-written /
  // broken-schema doc) must NOT be judged empty: seeding over it would delete
  // and re-add records, tombstoning shared content and risking a wipe.
  const tables = doc.getMap('tables');
  let has = false;
  tables.forEach((v) => {
    if (v instanceof Y.Array && v.length > 0) has = true;
  });
  if (has) return true;
  return doc.getMap('metadata').size > 0;
}

export interface ConnectOptions {
  serverUrl: string;
  roomId: string;
  email?: string;
  nick: string;
  /** Sec-111 (2026-06-03): 招待 token．email より優先される． */
  token?: string;
  /** Sec-111: ルーム共通パスワード． */
  password?: string;
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
  /** v0.2.16: epoch 不一致からの clean 再接続に使う直近の接続オプション． */
  private lastOpts: ConnectOptions | null = null;
  /** epoch 一致 / 初回時に「同期完了後 localStorage に保存する epoch」を一時保持． */
  private pendingEpoch: string | null = null;
  /** epoch 不一致リカバリ中フラグ (再帰的な reconnect ループを防ぐ)． */
  private epochRecovering = false;
  /** 接続世代カウンタ (2026-07 レビュー)．connect()/disconnect() のたびに進める．
   *  await を挟む非同期処理は開始時の世代を控え，await 後に世代が変わっていたら
   *  中断する — 「キャンセルした接続が await 復帰後に復活する」「切断後に epoch
   *  復旧が勝手に再接続する」再入レースの恒久対策． */
  private gen = 0;
  /** Codex-C2 (2026-06-16): uploadProject 先着レース検出．
   *  自分が seed したときの doc.clientID．`__sync.seedOwner` が LWW でこの値以外に
   *  収束したら「別クライアントの seed が勝った」= 自分のアップロードは破棄された，
   *  と判定して store を勝者状態へ再ハイドレートする． */
  private uploadOwnerId: number | null = null;
  /** `__sync` マップ observer の解除関数． */
  private seedOwnerUnobserve: (() => void) | null = null;

  getState(): SyncState {
    return this.state;
  }

  /** 段階2: アプリ内スナップショット API 用の接続情報．
   *  直近の接続 opts (serverUrl/roomId/token) から HTTP ベース URL を導出して返す．
   *  未接続 (lastOpts が無い) 場合は null． */
  getSnapshotApiTarget(): {
    baseUrl: string;
    roomId: string;
    token: string;
    email: string;
  } | null {
    const o = this.lastOpts;
    if (!o) return null;
    // wss:// → https://, ws:// → http://．末尾スラッシュは除去．
    const baseUrl = o.serverUrl.replace(/^ws/i, 'http').replace(/\/+$/, '');
    return {
      baseUrl,
      roomId: o.roomId,
      token: o.token ?? '',
      email: o.email ?? '',
    };
  }

  on(listener: (s: SyncState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 対策5: 直近の接続先へ再接続する（スナップショット復元後などに使う）．
   *  サーバーが epoch を更新していれば connect 内の epoch 不一致リカバリが働き，
   *  ローカルキャッシュを破棄してサーバーの復元状態を download-only で取得する． */
  async reconnect(): Promise<void> {
    const o = this.lastOpts;
    if (!o) throw new Error('未接続のため再接続できません');
    await this.connect(o);
  }

  /** Connect to a room.  Resolves once the first sync completes (or rejects
   *  on auth-denied / error within 10 seconds). */
  async connect(opts: ConnectOptions): Promise<void> {
    this.disconnect();
    const myGen = ++this.gen;
    this.lastOpts = opts;
    // v0.2.16: このルームについて最後に同期した docEpoch を読み込む．
    // サーバーの epoch と不一致なら古い lineage のキャッシュとみなして抑止する．
    const storedEpoch = readEpoch(opts.roomId);
    this.pendingEpoch = null;

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
    // 世代チェック: この await 中に disconnect()/別の connect() が走っていたら，
    // ここで静かに手仕舞いする (旧コードはここから無条件に接続を続行し，
    // キャンセルされた接続が復活していた)．
    if (myGen !== this.gen) {
      if (this.idb === idb) this.idb = null;
      void idb.destroy();
      throw new Error('接続がキャンセルされました');
    }
    const hadCache = docHasData(doc);

    const bridge = new YjsSyncBridge(doc);
    const provider = new YjsWebsocketProvider({
      serverUrl: opts.serverUrl,
      roomId: opts.roomId,
      email: opts.email ?? '',
      nick: opts.nick,
      token: opts.token,
      password: opts.password,
      doc,
      expectedEpoch: storedEpoch,
    });
    // Hand the awareness instance a small "user" payload so other peers see us
    provider.awareness.setLocalStateField('user', {
      name: opts.nick || 'anonymous',
      color: pickColor(opts.nick || opts.email || 'x'),
    });

    this.bridge = bridge;
    this.provider = provider;

    // Codex-C2: seed 先着判定用に `__sync` マップを監視する．別クライアントの
    // uploadProject が LWW で勝つと seedOwner が自分の clientID 以外に収束するので，
    // その瞬間に自分のアップロードが破棄されたと判定して再ハイドレートする．
    {
      const syncMeta = doc.getMap('__sync');
      const onSyncMetaChange = () => this.checkSeedOwnerConflict();
      syncMeta.observe(onSyncMetaChange);
      this.seedOwnerUnobserve = () => syncMeta.unobserve(onSyncMetaChange);
    }

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
        // v0.2.16: 同期完了時にサーバー epoch を保存．次回接続で一致判定に使う．
        if (e.synced && this.pendingEpoch) {
          writeEpoch(opts.roomId, this.pendingEpoch);
          this.pendingEpoch = null;
        }
      } else if (e.type === 'epoch') {
        if (e.serverEpoch === null) {
          // epoch 非対応サーバー: 何もしない (旧挙動)．
        } else if (e.matched === false) {
          // 不一致: ローカルキャッシュが古い lineage．破棄して clean 再接続する．
          console.warn(
            `[sync] docEpoch mismatch (stored=${e.expected} server=${e.serverEpoch}) — ` +
              'ローカルキャッシュを破棄して再同期します',
          );
          void this.recoverFromEpochMismatch(opts.roomId, e.serverEpoch);
        } else {
          // 一致 / 初回: 同期完了後に保存する epoch として控える．
          this.pendingEpoch = e.serverEpoch;
        }
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
        } else if (s.status === 'idle') {
          // 待機中に disconnect() された (キャンセル)．10 秒待たず即 reject する．
          clearTimeout(timer);
          unsub();
          reject(new Error('接続がキャンセルされました'));
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
  async uploadProject(project: ProjectFile): Promise<void> {
    if (!this.bridge) throw new Error('not connected to a room');
    // 同期完了前は server の現状 (既存行) が doc に未反映なので docHasData が
    // 偽陰性になり得る．synced を必須にして「空に見えるが実は既存データあり」
    // の room を上書きする事故を防ぐ．synced 後は server pre-seed 済の空 array
    // のみが見え (= docHasData=false)，seedFromProjectData は push に集約され union．
    if (!this.state.synced) {
      throw new Error('まだサーバーと同期していません。同期完了後に再試行してください');
    }
    if (docHasData(this.bridge.doc)) {
      throw new Error('room already has data — refusing to overwrite');
    }
    const bridge = this.bridge;
    const ownerId = bridge.doc.clientID;
    // #2 (2026-06-23): サーバー room claim を取得してから seed する．最初の 1 クライアント
    // だけが grant され，同時 upload による「2 プロジェクト混在」を根本的に防ぐ．旧サーバーは
    // no-server-support で granted=true を返し，従来の seedOwner LWW にフォールバックする．
    if (this.provider) {
      const claim = await this.provider.requestSeedClaim(ownerId);
      if (!claim.granted) {
        // 別クライアントが先に claim 済 / viewer / 既存データあり．seed せず内容を読み込む．
        if (docHasData(bridge.doc)) {
          useProjectStore.getState().hydrateFromBridge(bridge);
        }
        const msg =
          claim.reason === 'already-claimed'
            ? '別のユーザーが先にこのルームへプロジェクトを投入中です。アップロードを中止しました。'
            : claim.reason === 'room-has-data'
              ? 'ルームには既にデータがあります。アップロードを中止しました。'
              : claim.reason === 'viewer-cannot-seed'
                ? '閲覧者はプロジェクトをアップロードできません。'
                : `アップロードできませんでした (${claim.reason})`;
        this.setState({ errorDetail: msg });
        throw new Error(msg);
      }
    }
    const store = useProjectStore.getState();
    store.loadProject(null, project);
    // Codex-C2: seed と同一トランザクションで `__sync.seedOwner` に自分の clientID を
    // 書く．claim 非対応の旧サーバーでも，この LWW で「先着勝者」を決定論的に判定できる
    // (checkSeedOwnerConflict で敗者が検出)．claim とで二重に防御．
    bridge.applyLocal(() => {
      bridge.seedFromProjectData(project.data, project.metadata);
      bridge.doc.getMap('__sync').set('seedOwner', ownerId);
    });
    this.uploadOwnerId = ownerId;
  }

  /** Codex-C2: `__sync.seedOwner` が自分の seed と異なる値に収束したら，別クライアント
   *  のアップロードが LWW で勝ったということ．自分が seed したローカル project は
   *  CRDT 上ですでに勝者の内容に上書きされているので，store を勝者状態へ再ハイドレート
   *  し，敗者ユーザーへ明示的に通知する． */
  private checkSeedOwnerConflict(): void {
    if (this.uploadOwnerId === null || !this.bridge) return;
    const owner = this.bridge.doc.getMap('__sync').get('seedOwner');
    if (typeof owner !== 'number' || owner === this.uploadOwnerId) return;
    const mine = this.uploadOwnerId;
    this.uploadOwnerId = null;
    console.warn(
      `[sync] seed conflict: 別クライアント (${owner}) が先着アップロードに勝ちました ` +
        `(mine=${mine})．ローカル seed を破棄しルーム内容を再読み込みします`,
    );
    useProjectStore.getState().hydrateFromBridge(this.bridge);
    this.setState({
      errorDetail:
        '別のユーザーが先にこのルームへプロジェクトを投入しました。あなたのアップロードは破棄され、ルームの内容を読み込みました。',
    });
  }

  disconnect(): void {
    // 進行中の connect()/epoch 復旧を無効化する (世代カウンタ)．
    this.gen++;
    // 明示的に切断したら「直近の接続先」も破棄する (epoch 復旧などの自動再接続が
    // 切断後のルームへ戻ってしまうのを防ぐ)．connect() は disconnect() 後に
    // lastOpts を設定し直すため影響しない．
    this.lastOpts = null;
    if (this.seedOwnerUnobserve) {
      this.seedOwnerUnobserve();
      this.seedOwnerUnobserve = null;
    }
    this.uploadOwnerId = null;
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

  /** v0.2.16: docEpoch 不一致からの復旧．
   *  古い lineage のローカルキャッシュ (IndexedDB) を破棄し，サーバーの新しい
   *  epoch を保存してから clean 再接続する．clean な doc は空なので
   *  「サーバーが欠いている操作」が無く，アップロードは発生しない (download-only)．
   *  これで古い 2.6 MB の再注入を防ぎつつ，サーバーの正しい状態に追従する． */
  private async recoverFromEpochMismatch(roomId: string, serverEpoch: string): Promise<void> {
    if (this.epochRecovering) return; // 再帰ガード
    this.epochRecovering = true;
    try {
      // 1. 自分の IndexedDB 接続を確実に閉じる．disconnect() は idb.destroy() を
      //    await しないので，ここで明示的に待つ（待たないと自分が deleteDatabase の
      //    blocker になり onblocked へ落ちる）．
      //    lastOpts は disconnect() でクリアされるため先に控える．
      const opts = this.lastOpts;
      const idb = this.idb;
      // レビュー rank5: IndexedDB を破棄する前に，未同期のオフライン編集を含み得る
      // ローカル doc をベストエフォートで退避し，破棄件数を fail-loud で提示する．
      // 旧実装は無確認・無退避で削除し，痕跡は console.warn のみだった (研究データが
      // メモリ/ディスク両方から無言消失)．この退避は既存の削除ロジックには手を入れず，
      // 破棄前に「復元可能なコピー」を残すだけの純粋な追加．
      try {
        const bridge = this.bridge;
        if (bridge) {
          const data = bridge.toProjectData();
          const counts = {
            participants: data.participants.length,
            source_segments: data.source_segments.length,
            cards: data.cards.length,
            groups: data.groups.length,
          };
          const update = Y.encodeStateAsUpdate(bridge.doc);
          const backupKey = `kj-epoch-backup-${roomId}-${Date.now()}`;
          let backedUp = false;
          try {
            let bin = '';
            for (let i = 0; i < update.length; i++) bin += String.fromCharCode(update[i]);
            const b64 = btoa(bin);
            // localStorage の容量上限 (概ね 5MB) を超えないぶんだけ退避する．
            if (b64.length <= 4_000_000) {
              localStorage.setItem(backupKey, b64);
              backedUp = true;
            }
          } catch {
            /* quota 超過等は下の fail-loud で通知 */
          }
          // fail-loud: console.error で診断バッファ (SyncConnectDialog の
          // 「診断ログをコピー」) にも残す．無言削除にしない．
          console.error(
            `[sync] epoch 不一致でローカルキャッシュを破棄します (未同期のオフライン編集を含む可能性)．` +
              `件数=${JSON.stringify(counts)}．` +
              (backedUp
                ? `破棄前に localStorage["${backupKey}"] へ退避しました (復元可能)．`
                : `退避に失敗しました (容量超過等)．重要な未同期編集があればアプリを閉じる前にエクスポートしてください．`),
          );
        }
      } catch (e) {
        console.error('[sync] epoch recovery backup failed:', e);
      }
      this.disconnect();
      // この復旧サイクルの世代．以降ユーザーが明示的に disconnect()/connect()
      // したら gen が進み，末尾の自動再接続を中止する (2026-07 レビュー:
      // 「切断したのに epoch 復旧が勝手に再接続する」対策)．
      const myGen = this.gen;
      if (idb) {
        try {
          await idb.destroy();
        } catch {
          /* 二重 destroy は無害．close を待つのが目的 */
        }
      }
      // 2. 古い lineage のキャッシュを削除．onblocked では resolve せず真の成功のみ
      //    true を返す（Codex 指摘の race 対策）．
      const deleted = await deleteRoomCache(roomId);
      // 3. キャッシュ削除を確認できたときだけ新 epoch を保存する．削除に失敗したら
      //    旧 epoch のままにして次回接続でもう一度復旧経路に入れる（旧 lineage を
      //    一致扱いして再アップロード＝再肥大するのを防ぐ）．
      if (deleted) {
        writeEpoch(roomId, serverEpoch);
      } else {
        console.warn(
          `[sync] epoch recovery: kj-room-${roomId} を削除できませんでした．` +
            `epoch は据え置き，次回接続で再試行します．`,
        );
      }
      // 4. 復旧中にユーザーが操作していなければ (世代不変)，元の接続先へ
      //    download-only で再接続する．
      if (opts && opts.roomId === roomId && this.gen === myGen) {
        await this.connect(opts);
      }
    } catch (err) {
      console.error('[sync] epoch mismatch recovery failed:', err);
    } finally {
      this.epochRecovering = false;
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

// ---- v0.2.16 docEpoch helpers ----

function epochKey(roomId: string): string {
  return `kj-epoch-${roomId}`;
}

/** このルームについて最後に同期したサーバー docEpoch を読む (無ければ null)． */
function readEpoch(roomId: string): string | null {
  try {
    const v = localStorage.getItem(epochKey(roomId));
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

/** サーバー docEpoch を保存．次回接続時の一致判定に使う． */
function writeEpoch(roomId: string, epoch: string): void {
  try {
    localStorage.setItem(epochKey(roomId), epoch);
  } catch {
    /* localStorage 不可 (private mode 等) は無視 */
  }
}

/** このルームの y-indexeddb キャッシュ (`kj-room-<roomId>`) を削除する．
 *  epoch 不一致時に古い lineage のキャッシュを捨てるために使う．
 *  削除が確定したときだけ true を返す．`onblocked` では resolve せず，他の接続が
 *  閉じて onsuccess が発火するのを待つ（早期に成功扱いすると古いキャッシュが残った
 *  まま再接続してしまう — Codex 指摘の race）．閉じない場合は timeout で false． */
export function deleteRoomCache(roomId: string, timeoutMs = 3000): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    try {
      const req = indexedDB.deleteDatabase(`kj-room-${roomId}`);
      req.onsuccess = () => done(true);
      req.onerror = () => done(false);
      req.onblocked = () => {
        // 別の接続がまだ開いている．request は pending のまま残り，接続が閉じれば
        // onsuccess が発火する．ここでは resolve しない．
        console.warn(
          `[sync] deleteRoomCache blocked for kj-room-${roomId}; 接続クローズ待ち`,
        );
      };
      // 安全網: success も error も来ない（恒久ブロック等）場合は false で諦め，
      // 呼び出し側が次回の epoch 不一致で再試行できるようにする．
      setTimeout(() => done(false), timeoutMs);
    } catch {
      done(false);
    }
  });
}

function pickColor(seed: string): string {
  // Simple hash → HSL.  Good enough for distinguishing 2-5 ゼミ members.
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) & 0xffffff;
  }
  const hue = Math.abs(h) % 360;
  return `hsl(${hue}, 60%, 50%)`;
}
