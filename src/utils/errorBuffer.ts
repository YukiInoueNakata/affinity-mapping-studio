// v0.2.15: PC 初心者向けの自己診断補助．
//
// console.error / window.onerror / unhandledrejection を hook して直近 100 件の
// エラーを保持．SyncConnectDialog の「エラーをコピー」ボタンや，将来の右下バナーで
// 利用する．
//
// 初期化は main.tsx 起動直後に installErrorBuffer() を呼ぶ．

const MAX = 100;
const buffer: Array<{ at: string; kind: string; message: string; stack?: string }> = [];
let installed = false;

function record(kind: string, message: string, stack?: string) {
  const at = new Date().toISOString();
  buffer.push({ at, kind, message, stack });
  if (buffer.length > MAX) buffer.shift();
  persist(`${at} [${kind}] ${message}`);
}

// 2026-08-16: メモリ内 100 件だけでは，閉じられないまま放置されたプロセスから
// 事後に何も取り出せなかった (窓が破棄された引き金すら復元できなかった)．
// ディスクにも 1 行落とす．失敗しても握り潰す (ここで console.error を呼ぶと
// 自分の hook を再帰的に叩くため，通知は行わない)．
function persist(line: string) {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
  void import('@tauri-apps/api/core')
    .then(({ invoke }) => invoke('append_log', { line }))
    .catch(() => {
      /* ignore */
    });
}

/** 終了経路など，エラー以外の重要イベントもログに残す． */
export function logEvent(message: string) {
  const at = new Date().toISOString();
  persist(`${at} [event] ${message}`);
}

export function installErrorBuffer() {
  if (installed) return;
  installed = true;

  const origErr = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    try {
      const message = args
        .map((a) => (a instanceof Error ? `${a.message}\n${a.stack ?? ''}` : String(a)))
        .join(' ');
      record('console.error', message);
    } catch {
      /* never throw from the hook */
    }
    origErr(...args);
  };

  window.addEventListener('error', (ev) => {
    try {
      record('window.error', ev.message ?? String(ev.error ?? ''), ev.error?.stack);
    } catch {
      /* ignore */
    }
  });

  window.addEventListener('unhandledrejection', (ev) => {
    try {
      const reason = ev.reason;
      const message = reason instanceof Error ? reason.message : String(reason);
      const stack = reason instanceof Error ? reason.stack : undefined;
      record('unhandledrejection', message, stack);
    } catch {
      /* ignore */
    }
  });
}

export function getRecentErrors() {
  return buffer.slice();
}

export function formatRecentErrors(): string {
  if (buffer.length === 0) return '(エラー記録なし)';
  const platform = navigator.userAgent;
  const lines: string[] = [
    `# Affinity Mapping Studio 診断ログ`,
    `生成日時: ${new Date().toISOString()}`,
    `Platform: ${platform}`,
    `エラー件数: ${buffer.length}`,
    '',
  ];
  for (const e of buffer) {
    lines.push(`[${e.at}] ${e.kind}`);
    lines.push(`  ${e.message}`);
    if (e.stack) {
      lines.push(e.stack.split('\n').slice(0, 5).map((s) => '  ' + s).join('\n'));
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function clearErrorBuffer() {
  buffer.length = 0;
}
