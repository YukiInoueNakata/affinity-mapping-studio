import { useMemo, useState } from 'react';
import { useProjectStore } from '../stores/projectStore.js';
import { flattenGroupTree, getGroupLabel, getUngroupedCards, levelPrefix } from '../domain/groups.js';
import {
  makeRenameParticipantCommand,
  makeDeleteParticipantCommand,
  makeMergeParticipantsCommand,
} from '../stores/commands.js';
import { SearchPanel } from './SearchPanel.js';
import type { SearchHit } from '../domain/search.js';

interface Props {
  onOpenImport(): void;
  onJumpTo(hit: SearchHit): void;
}

export function LeftPanel({ onOpenImport, onJumpTo }: Props) {
  const project = useProjectStore((s) => s.project);
  const selectedCardId = useProjectStore((s) => s.selectedCardId);
  const selectedGroupId = useProjectStore((s) => s.selectedGroupId);
  const selectedParticipantId = useProjectStore((s) => s.selectedParticipantId);
  const selectCard = useProjectStore((s) => s.selectCard);
  const selectGroup = useProjectStore((s) => s.selectGroup);
  const selectParticipant = useProjectStore((s) => s.selectParticipant);
  const selectSegment = useProjectStore((s) => s.selectSegment);
  const applyCommand = useProjectStore((s) => s.applyCommand);
  // 2026-06-02: 表示・非表示フィルタ
  const hiddenParticipantIds = useProjectStore((s) => s.hiddenParticipantIds);
  const hiddenGroupIds = useProjectStore((s) => s.hiddenGroupIds);
  const hiddenTags = useProjectStore((s) => s.hiddenTags);
  const toggleParticipantVisible = useProjectStore((s) => s.toggleParticipantVisible);
  const toggleGroupVisible = useProjectStore((s) => s.toggleGroupVisible);
  const toggleTagVisible = useProjectStore((s) => s.toggleTagVisible);
  const hiddenPartSet = useMemo(() => new Set(hiddenParticipantIds), [hiddenParticipantIds]);
  const hiddenGroupSet = useMemo(() => new Set(hiddenGroupIds), [hiddenGroupIds]);
  const hiddenTagSet = useMemo(() => new Set(hiddenTags), [hiddenTags]);

  // (#2) 参加者名のインライン編集 (右クリックで開始)
  const [renamingPid, setRenamingPid] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  // v0.2.15 (#131/#137): 参加者の右クリック context menu (rename/delete/merge)
  // 右クリック時に menuParticipantId をセットして floating メニューを開く．
  const [menuParticipantId, setMenuParticipantId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [mergeFromId, setMergeFromId] = useState<string | null>(null);

  const handleDeleteParticipant = (pid: string) => {
    if (!project) return;
    const p = project.data.participants.find((x) => x.id === pid);
    if (!p) return;
    const segCount = project.data.source_segments.filter(
      (s) => s.participantId === pid && !s.deletedAt
    ).length;
    const cardCount = project.data.cards.filter((c) => c.participantId === pid).length;
    if (segCount > 0 || cardCount > 0) {
      alert(
        `参加者 "${p.code}" は seg ${segCount} / card ${cardCount} を持っています．\n` +
          `先にセグメント/カードを削除するか，他の参加者にマージしてください．`
      );
      return;
    }
    if (!confirm(`参加者 "${p.code}" (${p.displayName}) を削除しますか?`)) return;
    applyCommand(makeDeleteParticipantCommand(p));
    setMenuParticipantId(null);
  };

  const startMerge = (fromId: string) => {
    setMergeFromId(fromId);
    setMenuParticipantId(null);
  };

  const handleConfirmMerge = (toId: string) => {
    if (!project || !mergeFromId) return;
    const fromP = project.data.participants.find((p) => p.id === mergeFromId);
    const toP = project.data.participants.find((p) => p.id === toId);
    if (!fromP || !toP) {
      setMergeFromId(null);
      return;
    }
    const fromCardCount = project.data.cards.filter((c) => c.participantId === mergeFromId).length;
    const ok = confirm(
      `参加者をマージします:\n\n` +
        `  ${fromP.code} (${fromP.displayName}) → ${toP.code} (${toP.displayName})\n\n` +
        `・${fromP.code} の ${fromCardCount} 枚のカードが ${toP.code} に統合されます\n` +
        `・カード番号は ${toP.code} 起点で再発番されます (例: ${fromP.code}-001 → ${toP.code}-XXX)\n` +
        `・${fromP.code} 参加者は削除されます\n` +
        `・Undo で元に戻せます\n\n` +
        `続行しますか?`
    );
    if (!ok) return;
    applyCommand(
      makeMergeParticipantsCommand(mergeFromId, toId, {
        participants: project.data.participants,
        cards: project.data.cards,
        source_segments: project.data.source_segments,
      })
    );
    setMergeFromId(null);
  };

  const commitRename = (pid: string) => {
    if (!project) {
      setRenamingPid(null);
      return;
    }
    const target = project.data.participants.find((p) => p.id === pid);
    if (!target) {
      setRenamingPid(null);
      return;
    }
    const next = renameDraft.trim();
    if (next.length === 0 || next === target.displayName) {
      setRenamingPid(null);
      return;
    }
    // 重複チェック: 別の参加者と displayName が被ったらエラー
    const collision = project.data.participants.some(
      (p) => p.id !== pid && p.displayName.trim() === next
    );
    if (collision) {
      alert(`「${next}」は別の協力者と重複しています．別の名前にしてください．`);
      return;
    }
    applyCommand(makeRenameParticipantCommand(pid, target.displayName, next));
    setRenamingPid(null);
  };

  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());

  const tagCounts = useMemo(() => {
    const map = new Map<string, number>();
    if (!project) return map;
    for (const c of project.data.cards) {
      for (const t of c.tags ?? []) {
        map.set(t, (map.get(t) ?? 0) + 1);
      }
    }
    return map;
  }, [project]);

  const sortedTags = useMemo(
    () => Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    [tagCounts]
  );

  const toggleTag = (t: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  };

  const cards = useMemo(() => {
    if (!project) return [];
    const items = project.data.cards.slice();
    items.sort((a, b) => a.code.localeCompare(b.code));
    let filtered = items;
    if (selectedParticipantId) {
      filtered = filtered.filter((c) => c.participantId === selectedParticipantId);
    }
    if (selectedTags.size > 0) {
      filtered = filtered.filter((c) => {
        const cardTags = new Set(c.tags ?? []);
        for (const t of selectedTags) if (!cardTags.has(t)) return false;
        return true;
      });
    }
    return filtered;
  }, [project, selectedParticipantId, selectedTags]);

  const segmentCountByParticipant = useMemo(() => {
    const map = new Map<string, number>();
    if (!project) return map;
    for (const s of project.data.source_segments) {
      map.set(s.participantId, (map.get(s.participantId) ?? 0) + 1);
    }
    return map;
  }, [project]);

  const cardCountByParticipant = useMemo(() => {
    const map = new Map<string, number>();
    if (!project) return map;
    for (const c of project.data.cards) {
      map.set(c.participantId, (map.get(c.participantId) ?? 0) + 1);
    }
    return map;
  }, [project]);

  const groupsWithCounts = useMemo(() => {
    if (!project) return [];
    const memberCount = new Map<string, number>();
    for (const m of project.data.group_memberships) {
      memberCount.set(m.groupId, (memberCount.get(m.groupId) ?? 0) + 1);
    }
    return flattenGroupTree(project.data).map(({ group, depth }) => ({
      group,
      label: getGroupLabel(project.data, group.id),
      count: memberCount.get(group.id) ?? 0,
      depth,
    }));
  }, [project]);

  const ungroupedCount = useMemo(() => {
    if (!project) return 0;
    return getUngroupedCards(project.data).length;
  }, [project]);

  function handleSelectCard(cardId: string) {
    selectCard(cardId);
    const link = project?.data.card_source_links.find((l) => l.cardId === cardId);
    if (link) selectSegment(link.segmentId);
  }

  return (
    <aside className="left-panel">
      <SearchPanel onJumpTo={onJumpTo} />
      <section className="panel-section">
        <h3>参加者</h3>
        <ul className="participant-list">
          <li
            className={selectedParticipantId === null ? 'active' : ''}
            onClick={() => selectParticipant(null)}
          >
            すべて表示
          </li>
          {project?.data.participants.map((p) => {
            const isHidden = hiddenPartSet.has(p.id);
            return (
            <li
              key={p.id}
              className={`${selectedParticipantId === p.id ? 'active' : ''} ${isHidden ? 'kj-vis-hidden' : ''}`}
              onClick={() => {
                if (renamingPid !== p.id) selectParticipant(p.id);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenuParticipantId(p.id);
                setMenuPos({ x: e.clientX, y: e.clientY });
              }}
              title="右クリックで操作メニュー (名前変更 / マージ / 削除)"
            >
              <button
                type="button"
                className={`kj-vis-toggle ${isHidden ? 'hidden' : 'shown'}`}
                onClick={(e) => { e.stopPropagation(); toggleParticipantVisible(p.id); }}
                title={isHidden ? 'キャンバスで表示する' : 'キャンバスで非表示にする'}
                aria-label={isHidden ? '非表示' : '表示中'}
              >
                {isHidden ? '×' : '○'}
              </button>
              <strong>{p.code}</strong>{' '}
              {renamingPid === p.id ? (
                <input
                  type="text"
                  value={renameDraft}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onBlur={() => commitRename(p.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(p.id);
                    else if (e.key === 'Escape') setRenamingPid(null);
                  }}
                  style={{ width: '60%', fontSize: 11 }}
                />
              ) : (
                p.displayName
              )}
              <span className="counts">
                seg {segmentCountByParticipant.get(p.id) ?? 0} / card{' '}
                {cardCountByParticipant.get(p.id) ?? 0}
              </span>
            </li>
            );
          })}
          {(!project || project.data.participants.length === 0) && (
            <li className="muted">(まだ参加者がありません)</li>
          )}
        </ul>

        {/* v0.2.15 (#131/#137): 参加者 右クリックメニュー */}
        {menuParticipantId && menuPos && (() => {
          const p = project?.data.participants.find((x) => x.id === menuParticipantId);
          if (!p) return null;
          const segCount = project!.data.source_segments.filter(
            (s) => s.participantId === p.id && !s.deletedAt
          ).length;
          const cardCount = project!.data.cards.filter((c) => c.participantId === p.id).length;
          const canDelete = segCount === 0 && cardCount === 0;
          return (
            <>
              <div
                style={{
                  position: 'fixed',
                  inset: 0,
                  zIndex: 1000,
                }}
                onClick={() => setMenuParticipantId(null)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenuParticipantId(null);
                }}
              />
              <div
                style={{
                  position: 'fixed',
                  left: menuPos.x,
                  top: menuPos.y,
                  background: 'white',
                  border: '1px solid #ccc',
                  borderRadius: 4,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                  padding: 4,
                  zIndex: 1001,
                  minWidth: 180,
                  fontSize: 12,
                }}
              >
                <div style={{ padding: '4px 8px', color: '#888', fontSize: 11, borderBottom: '1px solid #eee' }}>
                  {p.code} ({p.displayName})
                </div>
                <button
                  type="button"
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 8px', border: 'none', background: 'transparent', cursor: 'pointer' }}
                  onClick={() => {
                    setRenameDraft(p.displayName);
                    setRenamingPid(p.id);
                    setMenuParticipantId(null);
                  }}
                >
                  ✏️ 名前を変更
                </button>
                <button
                  type="button"
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 8px', border: 'none', background: 'transparent', cursor: 'pointer' }}
                  onClick={() => startMerge(p.id)}
                  disabled={(project?.data.participants.length ?? 0) < 2}
                  title={(project?.data.participants.length ?? 0) < 2 ? 'マージ先が他にいません' : ''}
                >
                  🔀 他の参加者にマージ...
                </button>
                <button
                  type="button"
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 8px', border: 'none', background: 'transparent', cursor: canDelete ? 'pointer' : 'not-allowed', color: canDelete ? '#c33' : '#aaa' }}
                  onClick={() => handleDeleteParticipant(p.id)}
                  disabled={!canDelete}
                  title={canDelete ? '' : `seg ${segCount} / card ${cardCount} があります．先にマージか削除を．`}
                >
                  🗑 削除 {canDelete ? '' : `(seg ${segCount}/card ${cardCount} 残)`}
                </button>
              </div>
            </>
          );
        })()}

        {/* v0.2.15 (#131): マージ先選択ダイアログ */}
        {mergeFromId && (() => {
          const fromP = project?.data.participants.find((x) => x.id === mergeFromId);
          if (!fromP) return null;
          const candidates = project?.data.participants.filter((x) => x.id !== mergeFromId) ?? [];
          return (
            <div
              className="modal-backdrop"
              style={{ zIndex: 1100 }}
              onClick={() => setMergeFromId(null)}
            >
              <div
                className="modal"
                onClick={(e) => e.stopPropagation()}
                style={{ width: 360 }}
              >
                <header className="modal-header">
                  <h2 style={{ margin: 0, fontSize: 14 }}>参加者をマージ</h2>
                </header>
                <div className="modal-body">
                  <p style={{ margin: '4px 0', fontSize: 12 }}>
                    <strong>{fromP.code}</strong> ({fromP.displayName}) を
                    どの参加者にマージしますか?
                  </p>
                  <p className="muted small" style={{ margin: '4px 0' }}>
                    マージ先のカード番号体系で再発番されます (例: P13-001 → P12-XXX)
                  </p>
                  {candidates.length === 0 ? (
                    <p className="muted small">マージ先となる参加者がいません．</p>
                  ) : (
                    <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0', maxHeight: 240, overflowY: 'auto' }}>
                      {candidates.map((c) => {
                        const ccnt = project!.data.cards.filter((x) => x.participantId === c.id).length;
                        return (
                          <li key={c.id} style={{ padding: '2px 0' }}>
                            <button
                              type="button"
                              style={{ width: '100%', textAlign: 'left', padding: '6px 8px', cursor: 'pointer' }}
                              onClick={() => handleConfirmMerge(c.id)}
                            >
                              <strong>{c.code}</strong> {c.displayName} (card {ccnt})
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
                <footer className="modal-footer">
                  <button type="button" onClick={() => setMergeFromId(null)}>
                    キャンセル
                  </button>
                </footer>
              </div>
            </div>
          );
        })()}
      </section>

      <section className="panel-section">
        <h3>グループ ({groupsWithCounts.length})</h3>
        <ul className="participant-list">
          {groupsWithCounts.map(({ group, label, count, depth }) => {
            const isHidden = hiddenGroupSet.has(group.id);
            return (
            <li
              key={group.id}
              className={`${group.id === selectedGroupId ? 'active' : ''} ${
                depth > 0 ? 'group-indent' : ''
              } ${group.level >= 2 ? 'group-parent' : ''} ${isHidden ? 'kj-vis-hidden' : ''}`}
              style={depth > 0 ? { paddingLeft: 12 + depth * 14 } : undefined}
              onClick={() => selectGroup(group.id)}
            >
              <button
                type="button"
                className={`kj-vis-toggle ${isHidden ? 'hidden' : 'shown'}`}
                onClick={(e) => { e.stopPropagation(); toggleGroupVisible(group.id); }}
                title={isHidden ? 'キャンバスで表示する' : 'キャンバスで非表示にする'}
                aria-label={isHidden ? '非表示' : '表示中'}
              >
                {isHidden ? '×' : '○'}
              </button>
              <strong>{(label?.text || group.name).slice(0, 24)}</strong>
              {group.level >= 2 ? (
                <span className="counts">{levelPrefix(group.level)}</span>
              ) : (
                <span className="counts">{count} 枚</span>
              )}
            </li>
            );
          })}
          {groupsWithCounts.length === 0 && (
            <li className="muted">(まだグループがありません)</li>
          )}
          {ungroupedCount > 0 && (
            <li className="muted">
              <em>未グループ化: {ungroupedCount} 枚</em>
            </li>
          )}
        </ul>
      </section>

      {sortedTags.length > 0 && (
        <section className="panel-section">
          <h3>
            タグ ({sortedTags.length})
            {selectedTags.size > 0 && (
              <button
                type="button"
                className="segment-action-btn"
                style={{ marginLeft: 8 }}
                onClick={() => setSelectedTags(new Set())}
              >
                クリア
              </button>
            )}
          </h3>
          <div className="search-filter-row">
            {sortedTags.map(([tag, n]) => {
              const isHidden = hiddenTagSet.has(tag);
              return (
              <span key={tag} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                <button
                  type="button"
                  className={`chip ${selectedTags.has(tag) ? 'active' : ''} ${isHidden ? 'kj-vis-hidden' : ''}`}
                  onClick={() => toggleTag(tag)}
                  title={`${tag} (${n} 件)`}
                >
                  {tag} <span style={{ opacity: 0.6 }}>{n}</span>
                </button>
                <button
                  type="button"
                  className={`kj-vis-toggle ${isHidden ? 'hidden' : 'shown'}`}
                  onClick={(e) => { e.stopPropagation(); toggleTagVisible(tag); }}
                  title={isHidden ? 'キャンバスで表示する' : 'キャンバスで非表示にする'}
                  aria-label={isHidden ? '非表示' : '表示中'}
                  style={{ fontSize: 10 }}
                >
                  {isHidden ? '×' : '○'}
                </button>
              </span>
              );
            })}
          </div>
          {selectedTags.size > 0 && (
            <div className="muted small" style={{ marginTop: 4 }}>
              選択中 {selectedTags.size} タグの全てを持つカードに絞り込み
            </div>
          )}
        </section>
      )}

      <section className="panel-section panel-section-grow">
        <h3>カード ({cards.length})</h3>
        <ul className="card-list">
          {cards.map((c) => (
            <li
              key={c.id}
              className={c.id === selectedCardId ? 'active' : ''}
              onClick={() => handleSelectCard(c.id)}
            >
              <div className="card-list-code">{c.code}</div>
              <div className="card-list-body">{firstLine(c.body)}</div>
            </li>
          ))}
          {cards.length === 0 && (
            <li className="muted">(まだカードがありません)</li>
          )}
        </ul>
      </section>

      <footer className="left-panel-footer">
        <button
          type="button"
          onClick={onOpenImport}
          disabled={!project}
          title={project ? '' : 'プロジェクトを作成または開いてください'}
        >
          テキストを取り込む
        </button>
      </footer>
    </aside>
  );
}

function firstLine(s: string): string {
  const i = s.indexOf('\n');
  return i >= 0 ? s.slice(0, i) : s;
}
