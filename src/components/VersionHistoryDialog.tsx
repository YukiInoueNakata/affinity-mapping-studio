import { useMemo, useState } from 'react';
import { useProjectStore } from '../stores/projectStore.js';
import { buildSnapshot, diffSnapshots, type SnapshotDiffSummary } from '../domain/snapshots.js';

interface Props {
  open: boolean;
  onClose(): void;
}

type View = 'list' | 'create' | 'diff';

export function VersionHistoryDialog({ open, onClose }: Props) {
  const project = useProjectStore((s) => s.project);
  const addSnapshot = useProjectStore((s) => s.addSnapshot);
  const removeSnapshot = useProjectStore((s) => s.removeSnapshot);
  const restoreSnapshot = useProjectStore((s) => s.restoreSnapshot);

  const [view, setView] = useState<View>('list');
  const [labelInput, setLabelInput] = useState('');
  const [commentInput, setCommentInput] = useState('');
  const [diffPair, setDiffPair] = useState<{ left: string; right: string } | null>(null);

  const snapshots = useMemo(() => {
    if (!project?.snapshots) return [];
    return project.snapshots
      .slice()
      .sort((a, b) =>
        a.metadata.timestamp < b.metadata.timestamp ? 1 : -1
      );
  }, [project]);

  const diffResult = useMemo<SnapshotDiffSummary | null>(() => {
    if (!project?.snapshots || !diffPair) return null;
    const a = project.snapshots.find((s) => s.metadata.id === diffPair.left);
    const b = project.snapshots.find((s) => s.metadata.id === diffPair.right);
    if (!a || !b) return null;
    return diffSnapshots(a.data, b.data);
  }, [project, diffPair]);

  if (!open || !project) return null;

  const handleCreate = () => {
    addSnapshot(
      buildSnapshot({
        data: project.data,
        kind: 'manual',
        label: labelInput,
        comment: commentInput,
        now: new Date().toISOString(),
      })
    );
    setLabelInput('');
    setCommentInput('');
    setView('list');
  };

  const handleRestore = (id: string) => {
    if (
      !confirm(
        'このスナップショットの状態でプロジェクトを上書きしますか？\n' +
          '現在の状態は失われます (保存しなければファイルには反映されません)'
      )
    )
      return;
    restoreSnapshot(id);
    onClose();
  };

  const handleDelete = (id: string) => {
    if (!confirm('このスナップショットを削除しますか?')) return;
    removeSnapshot(id);
  };

  const fmt = (iso: string) => iso.slice(0, 16).replace('T', ' ');

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 760, maxHeight: '80vh' }}
      >
        <header className="modal-header">
          <h2>バージョン履歴 ({snapshots.length} 件)</h2>
        </header>
        <div className="modal-body" style={{ overflowY: 'auto' }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <button
              type="button"
              className={view === 'list' ? 'tab active' : 'tab'}
              onClick={() => setView('list')}
            >
              一覧
            </button>
            <button
              type="button"
              className={view === 'create' ? 'tab active' : 'tab'}
              onClick={() => setView('create')}
            >
              新規スナップショット
            </button>
            <button
              type="button"
              className={view === 'diff' ? 'tab active' : 'tab'}
              onClick={() => setView('diff')}
              disabled={snapshots.length < 2}
            >
              Diff
            </button>
          </div>

          {view === 'list' && (
            <ul className="card-list" style={{ maxHeight: '50vh', overflowY: 'auto' }}>
              {snapshots.length === 0 && (
                <li className="muted">スナップショットはまだありません</li>
              )}
              {snapshots.map((s) => (
                <li
                  key={s.metadata.id}
                  style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
                >
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span className="hierarchy-badge">
                      {s.metadata.kind === 'manual' ? 'M' : 'A'}
                    </span>
                    <span className="muted small">{fmt(s.metadata.timestamp)}</span>
                    <strong>{s.metadata.label || '(無題)'}</strong>
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                      <button
                        type="button"
                        className="segment-action-btn"
                        onClick={() => handleRestore(s.metadata.id)}
                      >
                        この状態に戻す
                      </button>
                      <button
                        type="button"
                        className="segment-action-btn danger"
                        onClick={() => handleDelete(s.metadata.id)}
                      >
                        削除
                      </button>
                    </span>
                  </div>
                  {s.metadata.comment && (
                    <div className="muted small">{s.metadata.comment}</div>
                  )}
                  <div className="muted small">
                    カード {s.data.cards.length} / グループ {s.data.groups.length} / 関係 {s.data.diagram_relations.length}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {view === 'create' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label className="block-label">ラベル (任意)</label>
              <input
                type="text"
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
                placeholder="例: イントロ完了, 5/22 のレビュー前"
              />
              <label className="block-label">コメント (任意)</label>
              <textarea
                value={commentInput}
                onChange={(e) => setCommentInput(e.target.value)}
                rows={4}
                placeholder="このスナップショットを残す理由 / 現状メモ"
              />
              <p className="muted small">
                スナップショットは現在のプロジェクト全体をフリーズして保存します．
                ファイル保存 (Ctrl+S) するまで .kjproj ファイルには書き込まれません．
              </p>
              <div className="right-actions">
                <button type="button" onClick={handleCreate}>
                  スナップショット作成
                </button>
              </div>
            </div>
          )}

          {view === 'diff' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <label className="muted small">変更前</label>
                <select
                  value={diffPair?.left ?? ''}
                  onChange={(e) =>
                    setDiffPair({
                      left: e.target.value,
                      right: diffPair?.right ?? '',
                    })
                  }
                >
                  <option value="">選択...</option>
                  {snapshots.map((s) => (
                    <option key={s.metadata.id} value={s.metadata.id}>
                      {fmt(s.metadata.timestamp)} {s.metadata.label ?? ''}
                    </option>
                  ))}
                </select>
                <label className="muted small">→ 変更後</label>
                <select
                  value={diffPair?.right ?? ''}
                  onChange={(e) =>
                    setDiffPair({
                      left: diffPair?.left ?? '',
                      right: e.target.value,
                    })
                  }
                >
                  <option value="">選択...</option>
                  {snapshots.map((s) => (
                    <option key={s.metadata.id} value={s.metadata.id}>
                      {fmt(s.metadata.timestamp)} {s.metadata.label ?? ''}
                    </option>
                  ))}
                </select>
              </div>
              {diffResult && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div className="muted small">
                    カード {diffResult.counts.cardsBefore} → {diffResult.counts.cardsAfter} ／
                    グループ {diffResult.counts.groupsBefore} → {diffResult.counts.groupsAfter} ／
                    関係 {diffResult.counts.relationsBefore} → {diffResult.counts.relationsAfter}
                  </div>
                  <DiffList title="追加されたカード" items={diffResult.cards.added.map((c) => `${c.code}: ${c.body.slice(0, 60)}`)} />
                  <DiffList title="削除されたカード" items={diffResult.cards.removed.map((c) => `${c.code}: ${c.body.slice(0, 60)}`)} />
                  <DiffList title="本文が変わったカード" items={diffResult.cards.changed.map((c) => `${c.after.code}: ${c.before.body.slice(0, 30)} → ${c.after.body.slice(0, 30)}`)} />
                  <DiffList title="追加されたグループ" items={diffResult.groups.added.map((g) => `${g.name} (Lv${g.level})`)} />
                  <DiffList title="削除されたグループ" items={diffResult.groups.removed.map((g) => `${g.name} (Lv${g.level})`)} />
                  <DiffList title="表札が変わったグループ" items={diffResult.labels.changed.map((l) => `${l.before.text} → ${l.after.text}`)} />
                </div>
              )}
            </div>
          )}
        </div>
        <footer className="modal-footer">
          <button type="button" onClick={onClose}>
            閉じる
          </button>
        </footer>
      </div>
    </div>
  );
}

function DiffList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="muted small">{title} ({items.length})</div>
      <ul style={{ fontSize: 11, listStyle: 'disc', paddingLeft: 18 }}>
        {items.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
    </div>
  );
}
