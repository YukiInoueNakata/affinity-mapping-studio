import { useState } from 'react';
import { useProjectStore } from '../stores/projectStore.js';
import {
  computeStatistics,
  operationsToMarkdown,
  statisticsToCsv,
  statisticsToMarkdown,
  type CommandHistoryEntry,
} from '../domain/audit.js';

interface Props {
  open: boolean;
  onClose(): void;
}

type TabKey = 'statistics' | 'history';

export function AuditExportDialog({ open, onClose }: Props) {
  const project = useProjectStore((s) => s.project);
  const past = useProjectStore((s) => s.past);
  const future = useProjectStore((s) => s.future);
  const [tab, setTab] = useState<TabKey>('statistics');
  const [format, setFormat] = useState<'markdown' | 'csv'>('markdown');

  if (!open || !project) return null;

  const stats = computeStatistics(project.data);
  const history: CommandHistoryEntry[] = [
    ...past.map((c, i) => ({ index: i, label: c.label })),
    ...future
      .slice()
      .reverse()
      .map((c, i) => ({ index: past.length + i, label: `(undone) ${c.label}` })),
  ];

  const text =
    tab === 'statistics'
      ? format === 'markdown'
        ? statisticsToMarkdown(stats, project.metadata)
        : statisticsToCsv(stats)
      : operationsToMarkdown(history);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    alert('クリップボードにコピーしました');
  };

  const handleDownload = () => {
    const ext = tab === 'statistics' && format === 'csv' ? 'csv' : 'md';
    const mime = ext === 'csv' ? 'text/csv' : 'text/markdown';
    const blob = new Blob([text], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const stem = tab === 'statistics' ? 'project-statistics' : 'operation-history';
    a.download = `${stem}.${ext}`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 760 }}
      >
        <header className="modal-header">
          <h2>監査証跡 / プロジェクト統計</h2>
        </header>
        <div className="modal-body">
          <div className="mode-switcher" style={{ marginBottom: 8 }}>
            <button
              type="button"
              className={`mode-btn ${tab === 'statistics' ? 'active' : ''}`}
              onClick={() => setTab('statistics')}
            >
              分析過程統計
            </button>
            <button
              type="button"
              className={`mode-btn ${tab === 'history' ? 'active' : ''}`}
              onClick={() => setTab('history')}
            >
              操作履歴 ({history.length})
            </button>
          </div>
          {tab === 'statistics' && (
            <div className="form-row">
              <label>形式</label>
              <div className="radio-row">
                <label>
                  <input
                    type="radio"
                    name="fmt"
                    checked={format === 'markdown'}
                    onChange={() => setFormat('markdown')}
                  />{' '}
                  Markdown
                </label>
                <label>
                  <input
                    type="radio"
                    name="fmt"
                    checked={format === 'csv'}
                    onChange={() => setFormat('csv')}
                  />{' '}
                  CSV
                </label>
              </div>
            </div>
          )}
          <label className="block-label">プレビュー</label>
          <pre
            style={{
              background: '#1a1a1a',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: 8,
              maxHeight: 420,
              overflowY: 'auto',
              whiteSpace: 'pre-wrap',
              fontFamily: 'inherit',
              fontSize: 12,
              margin: 0,
            }}
          >
            {text || '(出力する内容がありません)'}
          </pre>
        </div>
        <footer className="modal-footer">
          <button type="button" onClick={onClose}>閉じる</button>
          <button type="button" onClick={handleCopy}>クリップボードにコピー</button>
          <button type="button" className="primary" onClick={handleDownload}>
            ダウンロード
          </button>
        </footer>
      </div>
    </div>
  );
}
