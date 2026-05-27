import { useMemo, useState } from 'react';
import { useProjectStore } from '../stores/projectStore.js';
import { makeTagBulkEditCommand, type TagBulkEdit } from '../stores/commands.js';
import type { ProjectData } from '@shared/types/domain';

interface Props {
  open: boolean;
  onClose(): void;
}

interface TagRow {
  tag: string;
  count: number;
  cardIds: string[];
}

function collectTags(data: ProjectData): TagRow[] {
  const map = new Map<string, string[]>();
  for (const c of data.cards) {
    for (const t of c.tags ?? []) {
      if (!map.has(t)) map.set(t, []);
      map.get(t)!.push(c.id);
    }
  }
  return Array.from(map.entries())
    .map(([tag, cardIds]) => ({ tag, count: cardIds.length, cardIds }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

function dedupe(tags: string[]): string[] {
  return Array.from(new Set(tags));
}

function tagsToOptional(tags: string[]): string[] | undefined {
  return tags.length > 0 ? tags : undefined;
}

export function TagEditorDialog({ open, onClose }: Props) {
  const project = useProjectStore((s) => s.project);
  const applyCommand = useProjectStore((s) => s.applyCommand);
  const [query, setQuery] = useState('');
  const [renameOpen, setRenameOpen] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [mergeOpen, setMergeOpen] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState('');

  const tagRows = useMemo(() => {
    if (!project) return [];
    return collectTags(project.data);
  }, [project]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tagRows;
    return tagRows.filter((r) => r.tag.toLowerCase().includes(q));
  }, [tagRows, query]);

  if (!open || !project) return null;

  const handleRename = (oldTag: string, newTag: string) => {
    const cleaned = newTag.trim();
    if (!cleaned || cleaned === oldTag) {
      setRenameOpen(null);
      return;
    }
    const edits: TagBulkEdit[] = [];
    for (const c of project.data.cards) {
      const tags = c.tags;
      if (!tags || !tags.includes(oldTag)) continue;
      const next = dedupe(tags.map((t) => (t === oldTag ? cleaned : t)));
      edits.push({
        cardId: c.id,
        prevTags: tags,
        nextTags: tagsToOptional(next),
      });
    }
    if (edits.length === 0) {
      setRenameOpen(null);
      return;
    }
    applyCommand(
      makeTagBulkEditCommand(edits, new Date().toISOString(), `タグ名変更: ${oldTag} → ${cleaned}`)
    );
    setRenameOpen(null);
  };

  const handleMerge = (sourceTag: string, targetTag: string) => {
    if (!targetTag || sourceTag === targetTag) {
      setMergeOpen(null);
      return;
    }
    const edits: TagBulkEdit[] = [];
    for (const c of project.data.cards) {
      const tags = c.tags;
      if (!tags || !tags.includes(sourceTag)) continue;
      const next = dedupe(tags.map((t) => (t === sourceTag ? targetTag : t)));
      edits.push({
        cardId: c.id,
        prevTags: tags,
        nextTags: tagsToOptional(next),
      });
    }
    if (edits.length === 0) {
      setMergeOpen(null);
      return;
    }
    applyCommand(
      makeTagBulkEditCommand(
        edits,
        new Date().toISOString(),
        `タグ統合: ${sourceTag} → ${targetTag}`
      )
    );
    setMergeOpen(null);
  };

  const handleDelete = (tag: string, count: number) => {
    if (!confirm(`タグ「${tag}」を ${count} 枚のカードから削除しますか？ (Undo で復元可)`)) return;
    const edits: TagBulkEdit[] = [];
    for (const c of project.data.cards) {
      const tags = c.tags;
      if (!tags || !tags.includes(tag)) continue;
      const next = tags.filter((t) => t !== tag);
      edits.push({
        cardId: c.id,
        prevTags: tags,
        nextTags: tagsToOptional(next),
      });
    }
    if (edits.length === 0) return;
    applyCommand(
      makeTagBulkEditCommand(edits, new Date().toISOString(), `タグ削除: ${tag}`)
    );
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 680 }}
      >
        <header className="modal-header">
          <h2>タグエディタ ({tagRows.length} 件)</h2>
        </header>
        <div className="modal-body">
          <div className="form-row">
            <label>絞り込み</label>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="タグ名で絞り込み..."
              autoFocus
            />
          </div>
          {tagRows.length === 0 ? (
            <div className="muted">まだタグがありません．右パネルからカードにタグを追加してください．</div>
          ) : (
            <table className="tag-editor-table">
              <thead>
                <tr>
                  <th>タグ</th>
                  <th>使用数</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.tag}>
                    <td>
                      {renameOpen === r.tag ? (
                        <div style={{ display: 'flex', gap: 4 }}>
                          <input
                            type="text"
                            value={renameDraft}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleRename(r.tag, renameDraft);
                              else if (e.key === 'Escape') setRenameOpen(null);
                            }}
                            autoFocus
                            style={{ width: 180 }}
                          />
                          <button
                            type="button"
                            className="segment-action-btn"
                            onClick={() => handleRename(r.tag, renameDraft)}
                          >
                            確定
                          </button>
                          <button
                            type="button"
                            className="segment-action-btn"
                            onClick={() => setRenameOpen(null)}
                          >
                            取消
                          </button>
                        </div>
                      ) : mergeOpen === r.tag ? (
                        <div style={{ display: 'flex', gap: 4 }}>
                          <select
                            value={mergeTarget}
                            onChange={(e) => setMergeTarget(e.target.value)}
                          >
                            <option value="">統合先タグを選択...</option>
                            {tagRows
                              .filter((tr) => tr.tag !== r.tag)
                              .map((tr) => (
                                <option key={tr.tag} value={tr.tag}>
                                  {tr.tag} ({tr.count})
                                </option>
                              ))}
                          </select>
                          <button
                            type="button"
                            className="segment-action-btn"
                            onClick={() => handleMerge(r.tag, mergeTarget)}
                            disabled={!mergeTarget}
                          >
                            統合
                          </button>
                          <button
                            type="button"
                            className="segment-action-btn"
                            onClick={() => setMergeOpen(null)}
                          >
                            取消
                          </button>
                        </div>
                      ) : (
                        <span className="card-tag" style={{ background: 'rgba(78,161,255,0.15)' }}>
                          {r.tag}
                        </span>
                      )}
                    </td>
                    <td>{r.count} 枚</td>
                    <td>
                      <span style={{ display: 'flex', gap: 4 }}>
                        <button
                          type="button"
                          className="segment-action-btn"
                          onClick={() => {
                            setRenameOpen(r.tag);
                            setRenameDraft(r.tag);
                            setMergeOpen(null);
                          }}
                          disabled={renameOpen === r.tag}
                        >
                          名前変更
                        </button>
                        <button
                          type="button"
                          className="segment-action-btn"
                          onClick={() => {
                            setMergeOpen(r.tag);
                            setMergeTarget('');
                            setRenameOpen(null);
                          }}
                          disabled={mergeOpen === r.tag || tagRows.length < 2}
                          title={
                            tagRows.length < 2
                              ? '統合先候補がありません'
                              : '別のタグと統合'
                          }
                        >
                          統合
                        </button>
                        <button
                          type="button"
                          className="segment-action-btn danger"
                          onClick={() => handleDelete(r.tag, r.count)}
                        >
                          削除
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && tagRows.length > 0 && (
                  <tr>
                    <td colSpan={3} className="muted">
                      該当するタグがありません
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
        <footer className="modal-footer">
          <button type="button" onClick={onClose}>閉じる</button>
        </footer>
      </div>
    </div>
  );
}
