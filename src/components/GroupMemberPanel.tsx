// 最終図解ビュー右ペイン: 選択中グループのメンバーカード一覧 + 叙述メモ．
// クリックで KJ canvas タブに切替 + 該当カードをセンタリング (kj.jumpToCard)．
// 田中 2011 / 川喜田 1986・1997: B 型叙述化の Group 単位メモ．

import { useEffect, useMemo, useRef, useState } from 'react';
import { useProjectStore } from '../stores/projectStore.js';
import { makeSetGroupNarrativeCommand } from '../stores/commands.js';
import { getGroupLabel } from '../domain/groups.js';
import { getGroupNarrative } from '../domain/finalDiagram.js';

export function GroupMemberPanel() {
  const project = useProjectStore((s) => s.project);
  const applyCommand = useProjectStore((s) => s.applyCommand);
  const selectedGroupId = useProjectStore((s) => s.selectedGroupId);
  const selectCard = useProjectStore((s) => s.selectCard);

  const group = useMemo(() => {
    if (!project || !selectedGroupId) return null;
    return project.data.groups.find((g) => g.id === selectedGroupId) ?? null;
  }, [project, selectedGroupId]);

  const label = group && project ? getGroupLabel(project.data, group.id) : null;

  const members = useMemo(() => {
    if (!project || !group) return [];
    const memberIds = project.data.group_memberships
      .filter((m) => m.groupId === group.id)
      .map((m) => m.cardId);
    return memberIds
      .map((cid) => project.data.cards.find((c) => c.id === cid))
      .filter((c): c is NonNullable<typeof c> => !!c);
  }, [project, group]);

  // ---- 叙述メモ (debounced save) ----
  const [draft, setDraft] = useState('');
  const lastSavedRef = useRef('');
  const debounceRef = useRef<number | null>(null);

  // group が切り替わったら draft を再ロード．保存中タイマもクリア．
  useEffect(() => {
    const initial = getGroupNarrative(group);
    setDraft(initial);
    lastSavedRef.current = initial;
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, [group?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // draft 変更 → 500ms 後に commit (undo 単位を細かくしすぎないため)．
  useEffect(() => {
    if (!group) return;
    if (draft === lastSavedRef.current) return;
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      const now = new Date().toISOString();
      applyCommand(
        makeSetGroupNarrativeCommand(
          group.id,
          lastSavedRef.current,
          draft,
          now,
          group.updatedAt
        )
      );
      lastSavedRef.current = draft;
      debounceRef.current = null;
    }, 500);
    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [draft, group, applyCommand]);

  const handleJumpToCard = (cardId: string) => {
    selectCard(cardId);
    window.dispatchEvent(
      new CustomEvent('kj.jumpToCard', { detail: { cardId } })
    );
  };

  if (!project) return null;
  if (!group) {
    return (
      <aside className="kj-final-side">
        <div className="empty-state" style={{ padding: 16 }}>
          島 (グループ) をクリックすると，
          <br />
          中のカード一覧と叙述メモを表示します．
        </div>
      </aside>
    );
  }

  return (
    <aside className="kj-final-side">
      <header className="kj-final-side-header">
        <div className="kj-final-side-title">{label?.text || group.name}</div>
        <div className="muted small">メンバーカード {members.length} 枚</div>
      </header>
      <div className="kj-final-side-section">
        <div className="kj-final-side-sub">メンバーカード</div>
        {members.length === 0 ? (
          <div className="muted small" style={{ padding: 8 }}>
            この島にはまだカードがありません．
          </div>
        ) : (
          <ul className="kj-final-member-list">
            {members.map((c) => {
              const participant = project.data.participants.find(
                (p) => p.id === c.participantId
              );
              return (
                <li key={c.id} className="kj-final-member-item">
                  <div className="kj-final-member-header">
                    <span className="kj-final-member-code">{c.code}</span>
                    {participant && (
                      <span className="muted small">{participant.code}</span>
                    )}
                    <button
                      type="button"
                      className="kj-final-member-jump"
                      onClick={() => handleJumpToCard(c.id)}
                      title="キャンバスタブに切り替え，このカードをセンタリング"
                    >
                      キャンバスで表示
                    </button>
                  </div>
                  <div className="kj-final-member-body">
                    {c.body ? c.body.slice(0, 80) : '(本文なし)'}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="kj-final-side-section">
        <div className="kj-final-side-sub">叙述メモ (B 型)</div>
        <textarea
          className="kj-final-narrative"
          placeholder="この島について書く．他の島との関係，導かれる仮説，など．(500ms 自動保存)"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={8}
        />
      </div>
    </aside>
  );
}
