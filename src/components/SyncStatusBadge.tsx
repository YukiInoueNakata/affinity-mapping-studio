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

const ROLE_BADGE_COLOR: Record<string, string> = {
  viewer: '#8a6d3b',
  editor: '#3a7',
  admin: '#a73a8a',
};

const ROLE_BADGE_LABEL: Record<string, string> = {
  viewer: '閲覧者モード',
  editor: '編集者',
  admin: '管理者',
};

export function SyncStatusBadge({ onOpenConnect }: Props) {
  const { state, disconnect } = useSyncManager();
  const isConnected = state.status === 'connected' && state.synced;
  const isActive = state.status !== 'idle';
  const role = state.role?.role;
  const showRoleBadge = isConnected && role && role !== 'editor'; // editor は既定なので非表示
  // CA2 (2026-06-09): legacy client 警告 banner
  const upgradeRecommended = state.role?.upgradeRecommended;
  // CA3 (2026-06-09): matchedRule で tooltip 拡張
  const matchedRule = state.role?.matchedRule;

  return (
    <div className="sync-status-area">
      <button
        type="button"
        className="sync-status-pill"
        onClick={isConnected ? undefined : onOpenConnect}
        title={
          isConnected
            ? `ルーム: ${state.meta?.roomId} / ${state.meta?.serverUrl}` +
              (role ? `\nロール: ${role}${state.role?.via ? ` (${state.role.via})` : ''}` : '') +
              (matchedRule ? `\n${matchedRule}` : '')
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

      {showRoleBadge && (
        <span
          className="sync-role-badge"
          style={{ background: ROLE_BADGE_COLOR[role] ?? '#888' }}
          title={
            role === 'viewer'
              ? '閲覧専用．カード・グループは編集不可．コメントとメモログのみ書き込み可'
              : `ロール: ${role}`
          }
        >
          {ROLE_BADGE_LABEL[role] ?? role}
        </span>
      )}

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

      {/* CA2 (2026-06-09): legacy client 警告 banner */}
      {upgradeRecommended && (
        <span
          className="sync-upgrade-banner"
          title={
            upgradeRecommended.message +
            (upgradeRecommended.downloadHint ? '\n' + upgradeRecommended.downloadHint : '')
          }
          style={{
            background: '#8a6d3b',
            color: '#fff',
            padding: '2px 8px',
            borderRadius: 10,
            fontSize: 10,
            fontWeight: 600,
            cursor: 'help',
            whiteSpace: 'nowrap',
          }}
        >
          更新推奨
        </span>
      )}
    </div>
  );
}
