import { useMemo, useState } from 'react';
import { useProjectStore } from '../stores/projectStore.js';
import {
  DEFAULT_SCOPE,
  FIELD_LABELS,
  findBulkReplaceHits,
  type BulkReplaceFieldKind,
} from '../domain/bulkReplace.js';
import { makeBulkReplaceCommand } from '../stores/commands.js';

interface Props {
  open: boolean;
  onClose(): void;
}

export function BulkReplaceDialog({ open, onClose }: Props) {
  const project = useProjectStore((s) => s.project);
  const applyCommand = useProjectStore((s) => s.applyCommand);
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [scope, setScope] = useState<Set<BulkReplaceFieldKind>>(
    new Set(DEFAULT_SCOPE)
  );

  const hits = useMemo(() => {
    if (!project || !open || !query) return [];
    try {
      return findBulkReplaceHits(project.data, {
        query,
        replacement,
        caseSensitive,
        wholeWord,
        scope,
      });
    } catch {
      return [];
    }
  }, [project, open, query, replacement, caseSensitive, wholeWord, scope]);

  if (!open) return null;

  const totalMatches = hits.reduce((n, h) => n + h.matchCount, 0);

  const toggleScope = (k: BulkReplaceFieldKind) => {
    setScope((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const handleApply = () => {
    if (!project || hits.length === 0) return;
    if (
      !confirm(
        `${hits.length} 件のフィールドで ${totalMatches} 箇所を置換します．Undo で戻せます．実行しますか？`
      )
    )
      return;
    applyCommand(
      makeBulkReplaceCommand(
        hits.map((h) => ({
          kind: h.kind,
          recordId: h.recordId,
          prevValue: h.prevValue,
          nextValue: h.nextValue,
        })),
        new Date().toISOString()
      )
    );
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 760 }}
      >
        <header className="modal-header">
          <h2>一括検索置換</h2>
        </header>
        <div className="modal-body">
          <div className="form-row">
            <label>検索</label>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="検索する文字列"
              autoFocus
            />
          </div>
          <div className="form-row">
            <label>置換</label>
            <input
              type="text"
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              placeholder="置換後の文字列（空欄で削除）"
            />
          </div>
          <div className="form-row">
            <label>オプション</label>
            <div className="radio-row">
              <label>
                <input
                  type="checkbox"
                  checked={caseSensitive}
                  onChange={(e) => setCaseSensitive(e.target.checked)}
                />{' '}
                大文字小文字を区別
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={wholeWord}
                  onChange={(e) => setWholeWord(e.target.checked)}
                />{' '}
                単語単位
              </label>
            </div>
          </div>
          <div className="form-row">
            <label>対象</label>
            <div className="search-filter-row">
              {DEFAULT_SCOPE.map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`chip ${scope.has(k) ? 'active' : ''}`}
                  onClick={() => toggleScope(k)}
                >
                  {FIELD_LABELS[k]}
                </button>
              ))}
            </div>
          </div>
          <label className="block-label">
            プレビュー: {hits.length} フィールドで {totalMatches} 件マッチ
          </label>
          <div className="preview" style={{ maxHeight: 280 }}>
            {hits.length === 0 ? (
              <div className="muted small">
                {query
                  ? '一致するフィールドはありません'
                  : '検索文字列を入力してください'}
              </div>
            ) : (
              <ol className="preview-list">
                {hits.slice(0, 50).map((h, i) => (
                  <li key={i}>
                    <strong className="muted small">{FIELD_LABELS[h.kind]}</strong>
                    {' '}
                    <span className="muted small">({h.matchCount} 箇所)</span>
                    <div style={{ fontSize: 12 }}>{h.snippet}</div>
                  </li>
                ))}
                {hits.length > 50 && (
                  <li className="muted small">
                    …他 {hits.length - 50} フィールド
                  </li>
                )}
              </ol>
            )}
          </div>
        </div>
        <footer className="modal-footer">
          <button type="button" onClick={onClose}>
            キャンセル
          </button>
          <button
            type="button"
            className="primary"
            onClick={handleApply}
            disabled={hits.length === 0}
          >
            置換実行 ({hits.length} フィールド / {totalMatches} 件)
          </button>
        </footer>
      </div>
    </div>
  );
}
