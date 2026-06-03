import { useEffect, useState } from 'react';
import { useSyncManager } from '../sync/useSyncManager.js';

interface Props {
  open: boolean;
  onClose(): void;
}

const LOCAL_STORAGE_KEY = 'kj-trace-studio.sync.lastConnect';

interface PersistedForm {
  serverUrl: string;
  roomId: string;
  email: string;
  nick: string;
  /** Sec-111: 招待 token．email より優先． */
  token: string;
  /** Sec-111: ルーム共通パスワード． */
  password: string;
}

function loadPersisted(): PersistedForm {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch {
    // ignore
  }
  return defaults;
}

const defaults: PersistedForm = {
  serverUrl: 'ws://localhost:1234',
  roomId: 'demo',
  email: '',
  nick: '',
  token: '',
  password: '',
};

/** 招待 URL を貼ると serverUrl / roomId / token / nick / pw を抽出 */
function parseInviteUrl(raw: string): Partial<PersistedForm> | null {
  try {
    const trimmed = raw.trim();
    if (!/^wss?:\/\//i.test(trimmed)) return null;
    const u = new URL(trimmed);
    const pathRoom = u.pathname.replace(/^\/+/, '').replace(/\/.*$/, '');
    const out: Partial<PersistedForm> = {
      serverUrl: `${u.protocol}//${u.host}`,
    };
    if (pathRoom) out.roomId = decodeURIComponent(pathRoom);
    const t = u.searchParams.get('t');
    if (t) out.token = t;
    const pw = u.searchParams.get('pw');
    if (pw) out.password = pw;
    const nick = u.searchParams.get('nick');
    if (nick) out.nick = nick;
    const email = u.searchParams.get('email');
    if (email) out.email = email;
    return out;
  } catch {
    return null;
  }
}

export function SyncConnectDialog({ open, onClose }: Props) {
  const { state, connect, disconnect } = useSyncManager();
  const [form, setForm] = useState<PersistedForm>(loadPersisted);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load persisted values when opening
  useEffect(() => {
    if (open) {
      setForm(loadPersisted());
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  const update = (k: keyof PersistedForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleConnect = async () => {
    setBusy(true);
    setError(null);
    try {
      const nick = form.nick.trim() || `anon-${Math.floor(Math.random() * 1000)}`;
      await connect({
        serverUrl: form.serverUrl.trim().replace(/\/+$/, ''),
        roomId: form.roomId.trim() || 'default',
        email: form.email.trim() || undefined,
        token: form.token.trim() || undefined,
        password: form.password.trim() || undefined,
        nick,
      });
      // Persist for next time (password は localStorage に残さない)
      try {
        const { password: _pw, ...safe } = { ...form, nick };
        void _pw;
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(safe));
      } catch {
        // ignore
      }
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** 招待 URL ペーストで各フィールドを自動充填 */
  const handlePasteUrl = (raw: string) => {
    const parsed = parseInviteUrl(raw);
    if (!parsed) return false;
    setForm((f) => ({ ...f, ...parsed }));
    return true;
  };

  // 接続中でも中断できるように: disconnect で in-flight 接続を切ってから閉じる.
  // (connect() の Promise が hang していても abort できる)
  const handleCancel = () => {
    if (busy) {
      try {
        disconnect();
      } catch {
        // ignore
      }
      setBusy(false);
    }
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={handleCancel}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 480 }}
      >
        <header className="modal-header">
          <h2>サーバーに接続して共同編集</h2>
        </header>
        <div className="modal-body">
          <p className="muted small">
            KJ Studio Server に WebSocket で接続して共同編集を始めます．招待 URL を
            「招待 URL を貼付」欄に貼ると下のフィールドが自動入力されます．
          </p>

          <div className="form-row">
            <label>招待 URL を貼付 (任意)</label>
            <input
              type="text"
              onPaste={(e) => {
                const text = e.clipboardData.getData('text');
                if (handlePasteUrl(text)) {
                  e.preventDefault();
                  // 入力欄自体はクリアしておく (一回限りの取込)
                  (e.target as HTMLInputElement).value = '';
                }
              }}
              onChange={(e) => {
                // 貼付ではなく手入力された場合も解析を試みる
                if (handlePasteUrl(e.target.value)) {
                  e.target.value = '';
                }
              }}
              placeholder="wss://host/room?t=...&nick=... を貼付"
              style={{ width: '100%' }}
              disabled={busy}
            />
            <span className="muted small">
              token や password 付きの招待 URL を貼ると下のフィールドが自動入力されます．
            </span>
          </div>

          <div className="form-row">
            <label>サーバー URL</label>
            <input
              type="text"
              value={form.serverUrl}
              onChange={(e) => update('serverUrl', e.target.value)}
              placeholder="ws://localhost:1234"
              style={{ width: '100%' }}
              disabled={busy}
            />
          </div>

          <div className="form-row">
            <label>ルーム名</label>
            <input
              type="text"
              value={form.roomId}
              onChange={(e) => update('roomId', e.target.value)}
              placeholder="kjlab2026"
              style={{ width: '100%' }}
              disabled={busy}
            />
          </div>

          <div className="form-row">
            <label>招待 token (推奨)</label>
            <input
              type="text"
              value={form.token}
              onChange={(e) => update('token', e.target.value)}
              placeholder="管理者から渡された 43 文字の base64url token"
              style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}
              disabled={busy}
            />
            <span className="muted small">
              管理者が <code>kj-admin invite</code> で発行した token を貼付．
              これを使うと正確なロール (viewer / editor) が付与されます．
            </span>
          </div>

          <div className="form-row">
            <label>ルームパスワード (任意)</label>
            <input
              type="password"
              value={form.password}
              onChange={(e) => update('password', e.target.value)}
              placeholder="ルームに共通パスワードが設定されている場合"
              style={{ width: '100%' }}
              disabled={busy}
              autoComplete="off"
            />
            <span className="muted small">
              管理者が <code>kj-admin password</code> で設定したルーム共通パスワード．
            </span>
          </div>

          <div className="form-row">
            <label>メアド (token / password が無い場合)</label>
            <input
              type="text"
              value={form.email}
              onChange={(e) => update('email', e.target.value)}
              placeholder="alice@ritsumei.ac.jp"
              style={{ width: '100%' }}
              disabled={busy}
            />
            <span className="muted small">
              legacy 互換用．招待リスト登録メアドを入力．token があれば不要．
            </span>
          </div>

          <div className="form-row">
            <label>表示名</label>
            <input
              type="text"
              value={form.nick}
              onChange={(e) => update('nick', e.target.value)}
              placeholder="alice"
              style={{ width: '100%' }}
              disabled={busy}
            />
          </div>

          <div className="muted small" style={{ marginTop: 8 }}>
            現在の接続状態: <strong>{state.status}</strong>
            {state.synced && '（初回同期完了）'}
          </div>

          {error && (
            <div className="error" style={{ marginTop: 8 }}>
              接続に失敗: {error}
            </div>
          )}
        </div>
        <footer className="modal-footer">
          <button type="button" onClick={handleCancel}>
            {busy ? '中断' : 'キャンセル'}
          </button>
          <button
            type="button"
            className="primary"
            onClick={handleConnect}
            disabled={busy || !form.serverUrl || !form.roomId}
          >
            {busy ? '接続中...' : '接続'}
          </button>
        </footer>
      </div>
    </div>
  );
}
