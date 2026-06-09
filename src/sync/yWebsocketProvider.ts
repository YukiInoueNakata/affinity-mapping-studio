// Phase 4b-3b: client-side WebSocket provider for our PoC kj-trace-server.
//
// We don't use the standard `y-websocket` npm package because the server
// implements the y-protocols/sync + awareness wire format directly (see
// kj-trace-server/src/index.js).  Re-implementing the small client surface
// in-house gives us:
//   - control over reconnection / status events
//   - room URL + email/nick query string conventions used by the server
//   - no dependency on y-websocket's WebsocketProvider implementation
//
// URL form:  ws://host:1234/<roomId>?email=alice@xxx&nick=Alice
//
// Wire format (matches src/index.js on the server side):
//   message[0]   = MESSAGE_SYNC (0)  or  MESSAGE_AWARENESS (1)
//   message[1..] = encoded payload per y-protocols

import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
// Sec-003/009 (2026-06-03): KJ Studio Server 独自メッセージ．接続確立直後に
// サーバーから { kind: 'role-assigned', role, via, identity, strict, serverVersion }
// が JSON で送られてくる．未対応サーバー (旧 kj-trace-server) からは届かないため
// role は null のままで safe fallback (= editor 既定) で動作．
const MESSAGE_KJ_META = 2;

// Sec-008 (2026-06-03): WS subprotocol．サーバーは receive-only で問題なし．
// 厳格モード (KJ_REQUIRE_KJ_STUDIO_PROTOCOL=true) のサーバーでもこの subprotocol で通過する．
const KJ_STUDIO_SUBPROTOCOL = 'kj-studio.v1';

export type KjRole = 'editor' | 'viewer' | 'admin';

export interface KjRoleAssignment {
  role: KjRole;
  via?: string;
  identity?: string;
  strict?: boolean;
  serverVersion?: string;
}

export type ProviderStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnecting'
  | 'disconnected'
  | 'error'
  | 'auth-denied';

export interface YjsWebsocketProviderOptions {
  /** Server base URL, e.g. "ws://localhost:1234". */
  serverUrl: string;
  /** Room id (becomes the URL pathname). */
  roomId: string;
  /** Optional email (required for invite_list rooms when token not provided). */
  email?: string;
  /** Optional nickname (used in awareness presence). */
  nick?: string;
  /** Sec-111 (2026-06-03): 招待 token．`?t=<token>` で送る．これが優先される． */
  token?: string;
  /** Sec-111: ルーム共通パスワード．`?pw=<password>` で送る． */
  password?: string;
  /** Y.Doc to synchronise. */
  doc: Y.Doc;
  /** Awareness instance.  If not supplied, one is created from `doc`. */
  awareness?: awarenessProtocol.Awareness;
  /** Reconnect backoff base in ms (default 1000). */
  reconnectBackoffMs?: number;
  /** Auto-reconnect after unclean disconnect (default true). */
  autoReconnect?: boolean;
}

export type ProviderEvent =
  | { type: 'status'; status: ProviderStatus; detail?: string }
  | { type: 'sync'; synced: boolean }
  | { type: 'error'; error: Error }
  | { type: 'role-assigned'; assignment: KjRoleAssignment };

export class YjsWebsocketProvider {
  readonly opts: Required<Pick<YjsWebsocketProviderOptions, 'serverUrl' | 'roomId' | 'doc'>> &
    YjsWebsocketProviderOptions;
  readonly awareness: awarenessProtocol.Awareness;
  private ws: WebSocket | null = null;
  private status: ProviderStatus = 'idle';
  private listeners = new Set<(e: ProviderEvent) => void>();
  private destroyed = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private synced = false;
  /** True once we have ever successfully opened a WebSocket to this server.
   *  Used to distinguish HTTP-401-style auth denial (never opened) from a
   *  server crash / restart (opened previously, now refused). */
  private hasEverOpened = false;

  constructor(opts: YjsWebsocketProviderOptions) {
    this.opts = {
      reconnectBackoffMs: 1000,
      autoReconnect: true,
      email: '',
      nick: '',
      ...opts,
    } as YjsWebsocketProviderOptions & {
      serverUrl: string;
      roomId: string;
      doc: Y.Doc;
    };
    this.awareness = opts.awareness ?? new awarenessProtocol.Awareness(opts.doc);
    // Echo local doc updates to the server (unless they originated from us
    // receiving a server update — handled by tagging origin = this).
    opts.doc.on('update', this.handleLocalDocUpdate);
    this.awareness.on('update', this.handleAwarenessChange);
  }

  /** Subscribe to status / sync / error events.  Returns an unsubscribe fn. */
  on(handler: (e: ProviderEvent) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  /** Open the WebSocket and start the sync handshake. */
  connect(): void {
    if (this.destroyed) throw new Error('provider destroyed');
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.setStatus('connecting');
    const url = this.buildUrl();
    let socket: WebSocket;
    try {
      // Sec-008: kj-studio.v1 subprotocol を offer．サーバー側が要求モードのとき
      // 通過するために必要．non-strict サーバーでも害は無い．
      socket = new WebSocket(url, [KJ_STUDIO_SUBPROTOCOL]);
    } catch (e) {
      this.emit({ type: 'error', error: e as Error });
      this.setStatus('error', (e as Error).message);
      this.scheduleReconnect();
      return;
    }
    socket.binaryType = 'arraybuffer';
    socket.onopen = () => {
      this.reconnectAttempt = 0;
      this.hasEverOpened = true;
      this.setStatus('connected');
      this.sendSyncStep1();
      this.broadcastAwareness();
    };
    socket.onmessage = (ev) => this.handleServerMessage(ev.data);
    socket.onerror = (ev) => {
      // 'error' MessageEvent does not contain a message; surface a generic Error
      this.emit({ type: 'error', error: new Error('WebSocket error') });
    };
    socket.onclose = (ev) => {
      // CA1 (2026-06-09): 4xxx range は サーバーが reason 細分化して送ってくる
      // (KJ Studio Server v0.2.x+)
      if (ev.code >= 4000 && ev.code < 4100) {
        const msg = humanReadableReason(ev.code, ev.reason);
        this.setStatus('auth-denied', msg);
        this.ws = null;
        // 自動再接続しない (auth denial)
        return;
      }
      // 1006 = abnormal closure (legacy server / network エラー)
      // hasEverOpened が false なら HTTP-401-style auth denial (古いサーバー)
      if (ev.code === 1006 && !this.hasEverOpened) {
        this.setStatus(
          'auth-denied',
          '接続拒否 (古いサーバーかも．reason: ' + (ev.reason || 'unknown') + ')'
        );
        return;
      }
      this.setStatus('disconnected', `code=${ev.code} reason=${ev.reason}`);
      this.ws = null;
      this.synced = false;
      this.emit({ type: 'sync', synced: false });
      if (this.opts.autoReconnect !== false && !this.destroyed) {
        this.scheduleReconnect();
      }
    };
    this.ws = socket;
  }

  /** Close the WebSocket and stop reconnect attempts. */
  disconnect(): void {
    this.setStatus('disconnecting');
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close(1000, 'client disconnect');
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.setStatus('disconnected');
  }

  /** Permanently tear down the provider. */
  destroy(): void {
    this.destroyed = true;
    this.disconnect();
    this.opts.doc.off('update', this.handleLocalDocUpdate);
    this.awareness.off('update', this.handleAwarenessChange);
    this.listeners.clear();
  }

  getStatus(): ProviderStatus {
    return this.status;
  }

  isSynced(): boolean {
    return this.synced;
  }

  // ---- private helpers ----

  private buildUrl(): string {
    const base = this.opts.serverUrl.replace(/\/+$/, '');
    const qs = new URLSearchParams();
    if (this.opts.email) qs.set('email', this.opts.email);
    if (this.opts.nick) qs.set('nick', this.opts.nick);
    // Sec-111: token / password を URL query に乗せる (サーバーが ?t= / ?pw= で受ける)
    if (this.opts.token) qs.set('t', this.opts.token);
    if (this.opts.password) qs.set('pw', this.opts.password);
    const path = encodeURIComponent(this.opts.roomId).replace(/%2F/g, '/');
    const query = qs.toString();
    return query.length > 0 ? `${base}/${path}?${query}` : `${base}/${path}`;
  }

  private setStatus(status: ProviderStatus, detail?: string): void {
    this.status = status;
    this.emit({ type: 'status', status, detail });
  }

  private emit(event: ProviderEvent): void {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch (e) {
        console.error('provider listener error:', e);
      }
    }
  }

  private send(bytes: Uint8Array): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(bytes);
    }
  }

  private sendSyncStep1(): void {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(enc, this.opts.doc);
    this.send(encoding.toUint8Array(enc));
  }

  private broadcastAwareness(): void {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      enc,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.opts.doc.clientID])
    );
    this.send(encoding.toUint8Array(enc));
  }

  private handleServerMessage(data: unknown): void {
    let bytes: Uint8Array;
    if (data instanceof ArrayBuffer) {
      bytes = new Uint8Array(data);
    } else if (data instanceof Uint8Array) {
      bytes = data;
    } else {
      console.warn('unexpected ws message type:', data);
      return;
    }
    const dec = decoding.createDecoder(bytes);
    const type = decoding.readVarUint(dec);
    if (type === MESSAGE_SYNC) {
      const reply = encoding.createEncoder();
      encoding.writeVarUint(reply, MESSAGE_SYNC);
      const beforeCards = (this.opts.doc.getMap('tables').get('cards') as { length?: number } | undefined)?.length ?? 0;
      const msgType = syncProtocol.readSyncMessage(dec, reply, this.opts.doc, this);
      const afterCards = (this.opts.doc.getMap('tables').get('cards') as { length?: number } | undefined)?.length ?? 0;
      // 2026-06-02 debug ログ
      console.info('[provider.msg] sync', {
        subType: msgType,
        bytes,
        cardsBefore: beforeCards,
        cardsAfter: afterCards,
      });
      if (encoding.length(reply) > 1) {
        this.send(encoding.toUint8Array(reply));
      }
      // SyncStep2 (=1) means the server has just sent us its full state — we're synced
      if (msgType === syncProtocol.messageYjsSyncStep2 && !this.synced) {
        this.synced = true;
        this.emit({ type: 'sync', synced: true });
      }
    } else if (type === MESSAGE_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(
        this.awareness,
        decoding.readVarUint8Array(dec),
        this
      );
    } else if (type === MESSAGE_KJ_META) {
      // Sec-003/009 (2026-06-03): サーバーからのメタ情報．現状は role-assigned のみ．
      try {
        const json = decoding.readVarString(dec);
        const meta = JSON.parse(json) as {
          kind?: string;
          role?: KjRole;
          via?: string;
          identity?: string;
          strict?: boolean;
          serverVersion?: string;
        };
        if (meta.kind === 'role-assigned' && meta.role) {
          this.emit({
            type: 'role-assigned',
            assignment: {
              role: meta.role,
              via: meta.via,
              identity: meta.identity,
              strict: meta.strict,
              serverVersion: meta.serverVersion,
            },
          });
        } else {
          console.info('[provider] kj-meta:', meta);
        }
      } catch (e) {
        console.warn('[provider] failed to parse kj-meta payload:', e);
      }
    } else {
      console.warn('unknown ws message type:', type);
    }
  }

  private handleLocalDocUpdate = (update: Uint8Array, origin: unknown) => {
    // Don't echo server-sourced updates back to the server.
    if (origin === this) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeUpdate(enc, update);
    this.send(encoding.toUint8Array(enc));
  };

  private handleAwarenessChange = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown
  ) => {
    if (origin === this) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const changed = added.concat(updated, removed);
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      enc,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed)
    );
    this.send(encoding.toUint8Array(enc));
  };

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.destroyed) return;
    this.reconnectAttempt += 1;
    const base = this.opts.reconnectBackoffMs ?? 1000;
    // Exponential backoff with cap at 30s
    const delay = Math.min(base * 2 ** Math.min(this.reconnectAttempt - 1, 5), 30_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}

/** CA1 (2026-06-09): KJ Studio Server の WS close 4xxx を日本語メッセージに．
 *  サーバー (src/index.js) の rejectUpgrade() が送る code/reason に対応．
 *  reason は "code-name:detail" 形式 (detail は requirement-group-failed のみ付与)． */
export function humanReadableReason(code: number, reason: string): string {
  const parts = (reason || '').split(':');
  const baseReason = parts[0];
  const detail = parts.slice(1).join(':');
  switch (code) {
    case 4001:
      return '招待 token が無効です．管理者に新しい招待 URL を依頼してください';
    case 4002:
      return '招待 token の有効期限が切れています';
    case 4003:
      return '招待 token の最大使用回数を超えました';
    case 4004:
      return 'ルームパスワードが違います';
    case 4005:
      return 'ルームが見つかりません．room ID を確認してください';
    case 4006:
      return 'ルーム ID の形式が不正です';
    case 4007: {
      // detail は "inviteToken|roomPassword" 等の OR グループ
      const methodLabels: Record<string, string> = {
        inviteToken: '招待 token',
        roomPassword: 'パスワード',
        emailLegacy: 'メアド (legacy)',
        tailscale: 'Tailscale 接続',
        ipCidr: '許可 IP',
        trustedProxy: 'reverse-proxy 認証',
        localhostAuto: 'localhost 接続',
        noneOpen: '認証なし',
      };
      const labels = (detail || '')
        .split('|')
        .map((m) => methodLabels[m] ?? m)
        .filter(Boolean);
      const need = labels.length > 0 ? labels.join(' または ') : '何らかの認証';
      return `認証要件を満たしていません (必要: ${need})`;
    }
    case 4008:
      return 'ルームが満員です．時間を置いて再試行してください';
    case 4009:
      return '接続が多すぎます．数秒待って再試行してください';
    case 4010:
      return '接続元 Origin が許可されていません (サーバーの allowlist を確認)';
    case 4011:
      return 'WebSocket プロトコルが対応していません (クライアントが古い可能性)';
    case 4999:
      return `認証に失敗しました (${baseReason || 'unauthorized'})`;
    default:
      return `接続拒否: ${reason || 'unknown'} (code=${code})`;
  }
}
