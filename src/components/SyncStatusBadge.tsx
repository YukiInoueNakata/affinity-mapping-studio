import { useSyncManager } from '../sync/useSyncManager.js';

interface Props {
  onOpenConnect(): void;
}

const STATUS_COLOR: Record<string, string> = {
  idle: '#aaa',
  connecting: '#e0b34c',
  connected: '#5aaf5a',
  disconnecting: '#aaa',
  disconnected: '#c33',
  error: '#c33',
  'auth-denied': '#c33',
};

const STATUS_LABEL: Record<string, string> = {
  idle: 'オフライン',
  connecting: '接続中…',
  connected: '接続中',
  disconnecting: '切断中…',
  disconnected: '切断',
  error: 'エラー',
  'auth-denied': '認証拒否',
};

export function SyncStatusBadge({ onOpenConnect }: Props) {
  const { state, disconnect } = useSyncManager();
  const isConnected = state.status === 'connected' && state.synced;
  const isActive = state.status !== 'idle';

  return (
    <div className="sync-status-area">
      <button
        type="button"
        className="sync-status-pill"
        onClick={isConnected ? undefined : onOpenConnect}
        title={
          isConnected
            ? `ルーム: ${state.meta?.roomId} / ${state.meta?.serverUrl}`
            : 'サーバーに接続して共同編集'
        }
        style={{
          background: STATUS_COLOR[state.status] ?? '#aaa',
          cursor: isConnected ? 'default' : 'pointer',
        }}
      >
        <span className="sync-status-dot" />
        <span className="sync-status-label">
          {STATUS_LABEL[state.status] ?? state.status}
          {isConnected && state.meta && (
            <span style={{ opacity: 0.85, marginLeft: 4 }}>
              : {state.meta.roomId}
            </span>
          )}
        </span>
      </button>

      {state.peers.length > 0 && (
        <div className="sync-peers">
          {state.peers.map((p) => (
            <span
              key={p.clientId}
              className="sync-peer-chip"
              style={{ background: p.color }}
              title={p.name}
            >
              {p.name.slice(0, 1)}
            </span>
          ))}
        </div>
      )}

      {isActive && (
        <button
          type="button"
          className="sync-disconnect-btn"
          onClick={disconnect}
          title="切断してオフラインに戻る"
        >
          切断
        </button>
      )}
    </div>
  );
}
