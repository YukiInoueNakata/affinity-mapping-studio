import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type { Label, TextRevisionFieldName } from '@shared/types/domain';
import { useProjectStore } from '../stores/projectStore.js';
import {
  makeAddCardMemoEntryCommand,
  makeAddLabelMemoEntryCommand,
  makeApplyGtaCodeCommand,
  makeCreateConceptCommand,
  makeCreateGtaCodeCommand,
  makeCreateMGtaSettingsCommand,
  makeDeleteCardCommand,
  makeDeleteCardMemoEntryCommand,
  makeDeleteGroupCommand,
  makeDeleteLabelMemoEntryCommand,
  makeDeleteRelationCommand,
  makeEditCardBodyCommand,
  makeEditCardMetaCommand,
  makeEditLabelCommand,
  makeEditRelationCommand,
  makeRelinkCardLinkCommand,
  makeRemoveCardFromGroupCommand,
  makeRemoveGtaCodeApplicationCommand,
  makeRenameGroupCommand,
  makeSplitCardCommand,
  makeSetCardBodyDisplayCommand,
} from '../stores/commands.js';
import { newId } from '../domain/ids.js';
import type { MemoEntry } from '@shared/types/domain';
import { buildCodeApplication, buildGtaCode, getApplicationsForCard } from '../domain/gta.js';
import {
  buildConceptFromGroup,
  buildSettings,
  getActiveSettings,
} from '../domain/mgta.js';
import { buildSplitCards, SplitError } from '../domain/cards.js';
import { tryRelinkToLatest } from '../domain/segments.js';
import {
  RELATION_TYPE_GLYPHS,
  RELATION_TYPE_LABELS,
  RELATION_TYPE_ORDER,
} from '../domain/relations.js';
import { CardSplitDialog } from './CardSplitDialog.js';
import type { DiagramRelationType } from '@shared/types/domain';
import {
  computeCascadedGroupBoundsUpdates,
  getChildGroups,
  getGroupLabel,
  getGroupMembers,
  getGroupPosition,
  levelPrefix,
} from '../domain/groups.js';

export function RightPanel() {
  const project = useProjectStore((s) => s.project);
  const selectedCardId = useProjectStore((s) => s.selectedCardId);
  const selectedCardIds = useProjectStore((s) => s.selectedCardIds);
  const selectedGroupId = useProjectStore((s) => s.selectedGroupId);
  const selectedGroupIds = useProjectStore((s) => s.selectedGroupIds);
  const selectedRelationId = useProjectStore((s) => s.selectedRelationId);

  if (selectedRelationId) return <RelationRightPanel />;
  // Multi-selection takes priority over single panels so the user can see
  // exactly which items are in the current selection.
  if (selectedCardIds.length >= 2 || selectedGroupIds.length >= 2) {
    return (
      <MultiSelectionPanel
        cardIds={selectedCardIds}
        groupIds={selectedGroupIds}
      />
    );
  }
  if (selectedGroupId) return <GroupRightPanel />;
  if (selectedCardId) return <CardRightPanel />;
  if (!project) {
    return (
      <aside className="right-panel">
        <div className="empty-state">プロジェクトを開いてください</div>
      </aside>
    );
  }
  return (
    <aside className="right-panel">
      <div className="empty-state">カードまたはグループを選択してください</div>
    </aside>
  );
}

function MultiSelectionPanel({
  cardIds,
  groupIds,
}: {
  cardIds: string[];
  groupIds: string[];
}) {
  const project = useProjectStore((s) => s.project);
  const selectCard = useProjectStore((s) => s.selectCard);
  const selectGroup = useProjectStore((s) => s.selectGroup);
  const cards = useMemo(() => {
    if (!project) return [];
    const set = new Set(cardIds);
    return project.data.cards.filter((c) => set.has(c.id));
  }, [project, cardIds]);
  const groups = useMemo(() => {
    if (!project) return [];
    const set = new Set(groupIds);
    return project.data.groups.filter((g) => set.has(g.id));
  }, [project, groupIds]);
  if (!project) {
    return (
      <aside className="right-panel">
        <div className="empty-state">プロジェクトを開いてください</div>
      </aside>
    );
  }
  return (
    <aside className="right-panel">
      <section className="panel-section">
        <h3>
          複数選択中 (カード {cards.length} 枚 / グループ {groups.length} 個)
        </h3>
        <p className="muted small">
          行をクリックすると単一選択に絞り込みます．Shift+クリックで追加/解除できます．
        </p>
      </section>
      {groups.length > 0 && (
        <section className="panel-section">
          <h3>選択中のグループ ({groups.length})</h3>
          <ul className="card-list">
            {groups.map((g) => (
              <li key={g.id} onClick={() => selectGroup(g.id)}>
                <span className="card-list-code">{`L${g.level}`}</span>
                <span className="card-list-body">{g.name}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {cards.length > 0 && (
        <section className="panel-section">
          <h3>選択中のカード ({cards.length})</h3>
          <ul className="card-list">
            {cards.map((c) => (
              <li key={c.id} onClick={() => selectCard(c.id)}>
                <span className="card-list-code">{c.code}</span>
                <span className="card-list-body">
                  {c.body.slice(0, 80) || '(本文なし)'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}

function CardRightPanel() {
  const project = useProjectStore((s) => s.project);
  const selectedCardId = useProjectStore((s) => s.selectedCardId);
  const applyCommand = useProjectStore((s) => s.applyCommand);
  const selectCard = useProjectStore((s) => s.selectCard);
  const selectSegment = useProjectStore((s) => s.selectSegment);

  const card = useMemo(() => {
    if (!project || !selectedCardId) return null;
    return project.data.cards.find((c) => c.id === selectedCardId) ?? null;
  }, [project, selectedCardId]);

  const participant = useMemo(() => {
    if (!project || !card) return null;
    return project.data.participants.find((p) => p.id === card.participantId) ?? null;
  }, [project, card]);

  const links = useMemo(() => {
    if (!project || !card) return [];
    return project.data.card_source_links.filter((l) => l.cardId === card.id);
  }, [project, card]);

  const linkedSegments = useMemo(() => {
    if (!project) return [];
    return links
      .map((l) => {
        const seg = project.data.source_segments.find((s) => s.id === l.segmentId);
        return seg ? { link: l, segment: seg } : null;
      })
      .filter((x): x is { link: typeof links[number]; segment: typeof project.data.source_segments[number] } => x !== null)
      .sort((a, b) => a.segment.order - b.segment.order);
  }, [project, links]);

  const groupName = useMemo(() => {
    if (!project || !card) return null;
    const m = project.data.group_memberships.find((mm) => mm.cardId === card.id);
    if (!m) return null;
    return project.data.groups.find((g) => g.id === m.groupId)?.name ?? null;
  }, [project, card]);

  const [draftBody, setDraftBody] = useState<string>('');
  const [draftMemo, setDraftMemo] = useState<string>('');
  const [tagInput, setTagInput] = useState<string>('');
  const [tagSuggestIdx, setTagSuggestIdx] = useState<number>(-1);
  const [tagInputFocused, setTagInputFocused] = useState<boolean>(false);
  const [splitOpen, setSplitOpen] = useState(false);

  const allTagSuggestions = useMemo(() => {
    if (!project) return [] as Array<{ tag: string; count: number }>;
    const counts = new Map<string, number>();
    for (const c of project.data.cards) {
      for (const t of c.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }, [project]);

  const tagSuggestions = useMemo(() => {
    if (!card) return [];
    const has = new Set(card.tags ?? []);
    const q = tagInput.trim().toLowerCase();
    if (q === '') return allTagSuggestions.filter((s) => !has.has(s.tag)).slice(0, 8);
    return allTagSuggestions
      .filter((s) => !has.has(s.tag) && s.tag.toLowerCase().includes(q))
      .slice(0, 8);
  }, [tagInput, allTagSuggestions, card]);
  useEffect(() => {
    setDraftBody(card?.body ?? '');
    setDraftMemo(card?.memo ?? '');
    setSplitOpen(false);
    setTagInput('');
    setTagInputFocused(false);
  }, [card?.id, card?.body, card?.memo]);

  if (!card) {
    return (
      <aside className="right-panel">
        <div className="empty-state">カードを選択してください</div>
      </aside>
    );
  }

  function commitBody() {
    if (!card) return;
    if (draftBody === card.body) return;
    applyCommand(
      makeEditCardBodyCommand(card.id, card.body, draftBody, new Date().toISOString(), card.updatedAt)
    );
  }

  function commitMemo() {
    if (!card) return;
    const nextMemo = draftMemo;
    if ((card.memo ?? '') === nextMemo) return;
    applyCommand(
      makeEditCardMetaCommand(
        card.id,
        { memo: card.memo, tags: card.tags, updatedAt: card.updatedAt },
        { memo: nextMemo || undefined, tags: card.tags, now: new Date().toISOString() }
      )
    );
  }

  function addTag(raw: string) {
    if (!card) return;
    const t = raw.trim();
    if (!t) return;
    const current = card.tags ?? [];
    if (current.includes(t)) {
      setTagInput('');
      return;
    }
    applyCommand(
      makeEditCardMetaCommand(
        card.id,
        { memo: card.memo, tags: card.tags, updatedAt: card.updatedAt },
        { memo: card.memo, tags: [...current, t], now: new Date().toISOString() }
      )
    );
    setTagInput('');
  }

  function removeTag(tag: string) {
    if (!card) return;
    const current = card.tags ?? [];
    if (!current.includes(tag)) return;
    applyCommand(
      makeEditCardMetaCommand(
        card.id,
        { memo: card.memo, tags: card.tags, updatedAt: card.updatedAt },
        {
          memo: card.memo,
          tags: current.filter((t) => t !== tag),
          now: new Date().toISOString(),
        }
      )
    );
  }

  function handleDelete() {
    if (!project || !card) return;
    if (!confirm(`カード ${card.code} を削除しますか？ (Undo で復元できます)`)) return;
    const allLinks = project.data.card_source_links.filter((l) => l.cardId === card.id);
    const pos = project.data.card_positions.find((p) => p.cardId === card.id) ?? null;
    applyCommand(makeDeleteCardCommand(card, allLinks, pos));
    selectCard(null);
  }

  function handleRemoveFromGroup() {
    if (!project || !card) return;
    const membership = project.data.group_memberships.find(
      (m) => m.cardId === card.id
    );
    if (!membership) return;
    // Simulate the post-removal data so cascaded auto-fit ignores this card.
    const synthesized = {
      ...project.data,
      group_memberships: project.data.group_memberships.filter(
        (m) => m.id !== membership.id
      ),
    };
    const cardWrapWidth = project.metadata.displaySettings?.cardWrapWidth;
    const cardOverrides = new Map<string, { x: number; y: number }>();
    const pos = project.data.card_positions.find((p) => p.cardId === card.id);
    if (pos) cardOverrides.set(card.id, { x: pos.x, y: pos.y });
    // Force walkUp via groupOverride so the source group is included.
    const groupOverride = new Map<
      string,
      { x: number; y: number; width: number; height: number }
    >();
    const sourcePos = project.data.group_positions.find(
      (p) => p.groupId === membership.groupId
    );
    if (sourcePos) {
      groupOverride.set(membership.groupId, {
        x: sourcePos.x,
        y: sourcePos.y,
        width: sourcePos.width,
        height: sourcePos.height,
      });
    }
    const groupBoundsUpdates = computeCascadedGroupBoundsUpdates(
      synthesized,
      cardOverrides,
      groupOverride,
      { defaultCardWidth: cardWrapWidth }
    );
    applyCommand(makeRemoveCardFromGroupCommand(membership, groupBoundsUpdates));
  }

  function handleApplyCode() {
    if (!project || !card) return;
    const codeName = prompt(
      'コードを付与（既存コード名を入力 or 新規コード名で作成）'
    );
    if (!codeName) return;
    let code = project.data.gta_codes.find((c) => c.name === codeName);
    const now = new Date().toISOString();
    if (!code) {
      code = buildGtaCode({ name: codeName, now });
      applyCommand(makeCreateGtaCodeCommand(code));
    }
    const app = buildCodeApplication({
      codeId: code.id,
      targetType: 'card',
      targetId: card.id,
      selectedTextSnapshot: card.body,
      now,
    });
    applyCommand(makeApplyGtaCodeCommand(app));
  }

  function handleConfirmSplit(parts: string[]) {
    if (!project || !card) return;
    try {
      const out = buildSplitCards(project.data, {
        cardId: card.id,
        bodyParts: parts,
        now: new Date().toISOString(),
      });
      applyCommand(makeSplitCardCommand(out));
      setSplitOpen(false);
      if (out.newCards.length > 0) selectCard(out.newCards[0].id);
    } catch (e) {
      if (e instanceof SplitError) {
        alert(e.message);
      } else {
        throw e;
      }
    }
  }

  function jumpToSegment(segmentId: string) {
    selectSegment(segmentId);
    // Ask the App shell to switch the center tab to "source" and (if needed)
    // focus an independent source-viewer window. Decoupled via a custom event
    // so RightPanel does not need to know about centerTab state directly.
    window.dispatchEvent(
      new CustomEvent('kj.requestSourceView', { detail: { segmentId } })
    );
  }

  return (
    <aside className="right-panel">
      <section className="panel-section">
        <h3>カード詳細</h3>
        <dl className="meta-list">
          <dt>カードID</dt>
          <dd>{card.code}</dd>
          <dt>参加者</dt>
          <dd>{participant ? `${participant.code} — ${participant.displayName}` : '(不明)'}</dd>
          <dt>グループ</dt>
          <dd>{groupName ?? <span className="muted">未グループ化</span>}</dd>
          <dt>作成</dt>
          <dd>{card.createdAt.slice(0, 19).replace('T', ' ')}</dd>
          <dt>更新</dt>
          <dd>{card.updatedAt.slice(0, 19).replace('T', ' ')}</dd>
        </dl>
        <label className="block-label">本文</label>
        <textarea
          className="card-body-editor"
          value={draftBody}
          onChange={(e) => setDraftBody(e.target.value)}
          onBlur={commitBody}
          rows={6}
        />
        <label className="block-label">本文の表示（このカード）</label>
        <select
          value={card.bodyDisplay ?? 'default'}
          onChange={(e) => {
            if (!card) return;
            const v = e.target.value;
            const next = v === 'full' ? 'full' : v === 'truncated' ? 'truncated' : undefined;
            applyCommand(
              makeSetCardBodyDisplayCommand(
                card.id,
                next,
                card.bodyDisplay,
                new Date().toISOString(),
                card.updatedAt
              )
            );
          }}
          style={{ width: '100%' }}
        >
          <option value="default">既定（表示設定に従う）</option>
          <option value="full">全文表示（省略しない）</option>
          <option value="truncated">省略表示（…で切り詰め）</option>
        </select>
        <label className="block-label">メモ (ログ)</label>
        <MemoLogEditor
          entries={card.memoLog ?? []}
          legacyText={card.memo}
          onAdd={(text) => {
            if (!card) return;
            const entry: MemoEntry = {
              id: newId(),
              text,
              timestamp: new Date().toISOString(),
            };
            applyCommand(
              makeAddCardMemoEntryCommand(
                card.id,
                entry,
                new Date().toISOString(),
                card.updatedAt
              )
            );
          }}
          onDelete={(entry) => {
            if (!card) return;
            if (!confirm(`このメモ (${entry.timestamp.slice(0, 16).replace('T', ' ')}) を削除しますか？`)) return;
            applyCommand(
              makeDeleteCardMemoEntryCommand(
                card.id,
                entry,
                new Date().toISOString(),
                card.updatedAt
              )
            );
          }}
        />
        <label className="block-label">タグ</label>
        <div className="card-tags">
          {(card.tags ?? []).map((t) => (
            <span key={t} className="card-tag">
              {t}
              <button
                type="button"
                className="card-tag-remove"
                onClick={() => removeTag(t)}
                title="削除"
              >
                ×
              </button>
            </span>
          ))}
          <div className="card-tag-input-wrap">
            <input
              type="text"
              value={tagInput}
              onChange={(e) => {
                setTagInput(e.target.value);
                setTagSuggestIdx(-1);
              }}
              onFocus={() => {
                setTagInputFocused(true);
                setTagSuggestIdx(-1);
              }}
              onBlur={() => {
                // Delay so click on a suggestion item registers before unmounting
                setTimeout(() => setTagInputFocused(false), 120);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  if (tagSuggestIdx >= 0 && tagSuggestions[tagSuggestIdx]) {
                    addTag(tagSuggestions[tagSuggestIdx].tag);
                  } else {
                    addTag(tagInput);
                  }
                  setTagSuggestIdx(-1);
                } else if (e.key === 'Tab' && tagSuggestions.length > 0) {
                  e.preventDefault();
                  addTag(
                    (tagSuggestIdx >= 0 ? tagSuggestions[tagSuggestIdx] : tagSuggestions[0]).tag
                  );
                  setTagSuggestIdx(-1);
                } else if (e.key === 'ArrowDown' && tagSuggestions.length > 0) {
                  e.preventDefault();
                  setTagSuggestIdx((i) => (i + 1) % tagSuggestions.length);
                } else if (e.key === 'ArrowUp' && tagSuggestions.length > 0) {
                  e.preventDefault();
                  setTagSuggestIdx((i) =>
                    i <= 0 ? tagSuggestions.length - 1 : i - 1
                  );
                } else if (e.key === 'Escape') {
                  setTagSuggestIdx(-1);
                  setTagInput('');
                } else if (
                  e.key === 'Backspace' &&
                  tagInput === '' &&
                  (card.tags ?? []).length > 0
                ) {
                  e.preventDefault();
                  const last = (card.tags ?? [])[(card.tags ?? []).length - 1];
                  if (last) removeTag(last);
                }
              }}
              placeholder="タグを入力 → Enter / Tab で追加"
              className="card-tag-input"
            />
            {tagInputFocused && tagSuggestions.length > 0 && (
              <div className="card-tag-suggestions">
                {tagSuggestions.map((s, i) => (
                  <button
                    key={s.tag}
                    type="button"
                    className={`card-tag-suggest ${i === tagSuggestIdx ? 'active' : ''}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      addTag(s.tag);
                      setTagSuggestIdx(-1);
                    }}
                  >
                    <span>{s.tag}</span>
                    <span className="muted small">{s.count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="right-actions" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => setSplitOpen(true)}>
            分割...
          </button>
          {/* GTA コード付与は当面 UI 非表示．handleApplyCode は温存．
          <button type="button" onClick={handleApplyCode}>
            + GTA コード付与
          </button>
          */}
          {groupName && (
            <button
              type="button"
              onClick={handleRemoveFromGroup}
              title={`「${groupName}」から外す`}
            >
              グループから外す
            </button>
          )}
          <button type="button" onClick={handleDelete} className="danger">
            カードを削除
          </button>
        </div>
      </section>

      {/* GTA コード付与済み一覧は当面 UI 非表示．
      <CardCodesSection card={card} />
      */}


      <CardSplitDialog
        open={splitOpen}
        card={card}
        onClose={() => setSplitOpen(false)}
        onConfirm={handleConfirmSplit}
      />

      <section className="panel-section">
        <h3>原文参照 ({linkedSegments.length})</h3>
        {linkedSegments.length === 0 ? (
          <div className="muted">参照原文が見つかりません</div>
        ) : (
          linkedSegments.map(({ link: l, segment: s }) => {
            const isSuperseded =
              project?.data.source_segments.some((x) => x.previousVersionId === s.id) ?? false;
            const isDeleted = s.deletedAt !== null;
            const stale = isSuperseded || isDeleted;
            const handleRelink = () => {
              if (!project) return;
              const result = tryRelinkToLatest(project.data, {
                segmentId: l.segmentId,
                selectedTextSnapshot: l.selectedTextSnapshot,
                startOffset: l.startOffset,
                endOffset: l.endOffset,
              });
              if (!result) {
                alert('最新版にスニペットが見つかりませんでした．手動で再リンクしてください．');
                return;
              }
              applyCommand(
                makeRelinkCardLinkCommand(
                  l.id,
                  { segmentId: l.segmentId, startOffset: l.startOffset, endOffset: l.endOffset },
                  {
                    segmentId: result.newSegmentId,
                    startOffset: result.newStartOffset,
                    endOffset: result.newEndOffset,
                  }
                )
              );
            };
            return (
              <div key={l.id} className="source-ref">
                <div className="source-ref-meta">
                  <span>{s.sourceFile}</span>
                  <span>#{s.order + 1}</span>
                </div>
                {stale && (
                  <div className="link-stale-banner">
                    <span>
                      {isDeleted ? '原文は削除済' : '更新版あり'}（参照は旧版を指しています）
                    </span>
                    {isSuperseded && !isDeleted && (
                      <button type="button" className="segment-action-btn" onClick={handleRelink}>
                        最新版に更新
                      </button>
                    )}
                  </div>
                )}
                <p className="source-ref-text">
                  {renderHighlighted(s.text, l.startOffset, l.endOffset)}
                </p>
                <button type="button" onClick={() => jumpToSegment(s.id)}>
                  原文ビューアで表示
                </button>
              </div>
            );
          })
        )}
      </section>
    </aside>
  );
}

function CardCodesSection({ card }: { card: { id: string; code: string } }) {
  const project = useProjectStore((s) => s.project);
  const applyCommand = useProjectStore((s) => s.applyCommand);
  const setMode = useProjectStore((s) => s.setMode);
  const selectCode = useProjectStore((s) => s.selectCode);
  const apps = useMemo(() => {
    if (!project) return [];
    return getApplicationsForCard(project.data, card.id);
  }, [project, card.id]);
  if (!project || apps.length === 0) return null;
  return (
    <section className="panel-section">
      <h3>付与済み GTA コード ({apps.length})</h3>
      <ul className="mgta-variation-list">
        {apps.map((a) => {
          const code = project.data.gta_codes.find((c) => c.id === a.codeId);
          return (
            <li key={a.id} className="mgta-variation-item">
              <div className="mgta-variation-head">
                <span className="mgta-concept-name">{code?.name ?? '(削除済み)'}</span>
                <button
                  type="button"
                  className="segment-action-btn"
                  onClick={() => {
                    setMode('gta');
                    if (code) selectCode(code.id);
                  }}
                >
                  GTA モードで表示
                </button>
                <button
                  type="button"
                  className="segment-action-btn"
                  onClick={() => applyCommand(makeRemoveGtaCodeApplicationCommand(a))}
                >
                  解除
                </button>
              </div>
              {a.memo && <div className="muted small">{a.memo}</div>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function GroupRightPanel() {
  const project = useProjectStore((s) => s.project);
  const selectedGroupId = useProjectStore((s) => s.selectedGroupId);
  const applyCommand = useProjectStore((s) => s.applyCommand);
  const selectGroup = useProjectStore((s) => s.selectGroup);
  const setMode = useProjectStore((s) => s.setMode);
  const selectConcept = useProjectStore((s) => s.selectConcept);

  const group = useMemo(() => {
    if (!project || !selectedGroupId) return null;
    return project.data.groups.find((g) => g.id === selectedGroupId) ?? null;
  }, [project, selectedGroupId]);

  const label = useMemo(() => {
    if (!project || !group) return null;
    return getGroupLabel(project.data, group.id);
  }, [project, group]);

  const members = useMemo(() => {
    if (!project || !group) return [];
    return getGroupMembers(project.data, group.id);
  }, [project, group]);

  const children = useMemo(() => {
    if (!project || !group) return [];
    return getChildGroups(project.data, group.id);
  }, [project, group]);

  const [draftName, setDraftName] = useState<string>('');
  const [drafts, setDrafts] = useState<Record<TextRevisionFieldName, string>>({
    text: '',
    sharedMemo: '',
    basisMemo: '',
    holdMemo: '',
  });

  useEffect(() => {
    setDraftName(group?.name ?? '');
  }, [group?.id, group?.name]);

  useEffect(() => {
    setDrafts({
      text: label?.text ?? '',
      sharedMemo: label?.sharedMemo ?? '',
      basisMemo: label?.basisMemo ?? '',
      holdMemo: label?.holdMemo ?? '',
    });
  }, [label?.id, label?.text, label?.sharedMemo, label?.basisMemo, label?.holdMemo]);

  if (!group) {
    return (
      <aside className="right-panel">
        <div className="empty-state">グループを選択してください</div>
      </aside>
    );
  }

  function commitGroupName() {
    if (!group) return;
    const next = draftName.trim();
    if (!next || next === group.name) return;
    applyCommand(
      makeRenameGroupCommand(group.id, group.name, next, new Date().toISOString(), group.updatedAt)
    );
  }

  function commitLabelField(field: TextRevisionFieldName) {
    if (!label) return;
    const prev = label[field];
    const next = drafts[field];
    if (prev === next) return;
    applyCommand(
      makeEditLabelCommand(label.id, field, prev, next, new Date().toISOString(), label.updatedAt)
    );
  }

  function handleDelete() {
    if (!project || !group) return;
    if (
      !confirm(
        `グループ「${group.name}」を削除しますか？ メンバーカードは未グループ化に戻ります．(Undo で復元できます)`
      )
    )
      return;
    const labelToRemove: Label | null = label;
    const position = getGroupPosition(project.data, group.id);
    const memberships = project.data.group_memberships.filter((m) => m.groupId === group.id);
    applyCommand(makeDeleteGroupCommand(group, labelToRemove, position, memberships));
    selectGroup(null);
  }

  function handleConvertToMGtaConcept() {
    if (!project || !group) return;
    const now = new Date().toISOString();
    let settings = getActiveSettings(project.data);
    if (!settings) {
      const theme = prompt(
        '分析テーマを入力してください（M-GTA 設定が未作成のため）'
      );
      if (!theme) return;
      const focal = prompt('分析焦点者を入力してください');
      if (!focal) return;
      settings = buildSettings({ analysisTheme: theme, focalPerson: focal, now });
      applyCommand(makeCreateMGtaSettingsCommand(settings));
    }
    const out = buildConceptFromGroup(project.data, {
      groupId: group.id,
      settingsId: settings.id,
      includeMemberCards: true,
      includeLabelAsDefinition: true,
      now,
    });
    applyCommand(makeCreateConceptCommand(out.concept, out.variations));
    setMode('m_gta');
    selectConcept(out.concept.id);
  }

  return (
    <aside className="right-panel">
      <section className="panel-section">
        <h3>{group.level >= 2 ? `${levelPrefix(group.level)}詳細` : 'グループ詳細'}</h3>
        <dl className="meta-list">
          <dt>名称</dt>
          <dd>
            <input
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={commitGroupName}
            />
          </dd>
          <dt>階層</dt>
          <dd>level {group.level}</dd>
          {group.level >= 2 ? (
            <>
              <dt>子グループ</dt>
              <dd>{children.length} 個</dd>
            </>
          ) : (
            <>
              <dt>メンバー</dt>
              <dd>{members.length} 枚</dd>
            </>
          )}
          <dt>作成</dt>
          <dd>{group.createdAt.slice(0, 19).replace('T', ' ')}</dd>
          <dt>更新</dt>
          <dd>{group.updatedAt.slice(0, 19).replace('T', ' ')}</dd>
        </dl>
      </section>

      <LabelTabs
        drafts={drafts}
        setDrafts={setDrafts}
        commitField={commitLabelField}
        labelId={label?.id ?? null}
      />


      <section className="panel-section">
        <h3>{group.level >= 2 ? '子グループ' : 'メンバーカード'}</h3>
        {group.level >= 2 ? (
          children.length === 0 ? (
            <div className="muted">子グループなし</div>
          ) : (
            <ul className="card-list">
              {children.map((c) => (
                <li key={c.id}>
                  <span className="card-list-code">{c.name}</span>
                </li>
              ))}
            </ul>
          )
        ) : members.length === 0 ? (
          <div className="muted">メンバーなし</div>
        ) : (
          <ul className="card-list">
            {members.map((c) => (
              <li key={c.id} className="muted-row">
                <span className="card-list-code">{c.code}</span>
                <span className="card-list-body">{c.body.slice(0, 50)}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="right-actions" style={{ gap: 6, flexWrap: 'wrap' }}>
          {/* M-GTA 概念候補ボタンは当面 UI 非表示．handleConvertToMGtaConcept は温存．
          <button type="button" onClick={handleConvertToMGtaConcept}>
            M-GTA 概念候補にする
          </button>
          */}
          <button type="button" onClick={handleDelete} className="danger">
            グループを削除
          </button>
        </div>
      </section>
    </aside>
  );
}

function RelationRightPanel() {
  const project = useProjectStore((s) => s.project);
  const selectedRelationId = useProjectStore((s) => s.selectedRelationId);
  const applyCommand = useProjectStore((s) => s.applyCommand);
  const selectRelation = useProjectStore((s) => s.selectRelation);

  const relation = useMemo(() => {
    if (!project || !selectedRelationId) return null;
    return project.data.diagram_relations.find((r) => r.id === selectedRelationId) ?? null;
  }, [project, selectedRelationId]);

  const sourceName = useMemo(() => {
    if (!project || !relation) return '';
    if (relation.sourceObjectType === 'group') {
      const g = project.data.groups.find((x) => x.id === relation.sourceObjectId);
      return g?.name ?? '?';
    }
    const c = project.data.cards.find((x) => x.id === relation.sourceObjectId);
    return c?.code ?? '?';
  }, [project, relation]);

  const targetName = useMemo(() => {
    if (!project || !relation) return '';
    if (relation.targetObjectType === 'group') {
      const g = project.data.groups.find((x) => x.id === relation.targetObjectId);
      return g?.name ?? '?';
    }
    const c = project.data.cards.find((x) => x.id === relation.targetObjectId);
    return c?.code ?? '?';
  }, [project, relation]);

  const [draftLabel, setDraftLabel] = useState('');
  useEffect(() => {
    setDraftLabel(relation?.label ?? '');
  }, [relation?.id, relation?.label]);

  if (!relation) {
    return (
      <aside className="right-panel">
        <div className="empty-state">関係線を選択してください</div>
      </aside>
    );
  }

  const handleTypeChange = (rt: DiagramRelationType) => {
    if (!relation) return;
    if (rt === relation.relationType) return;
    applyCommand(
      makeEditRelationCommand(
        relation.id,
        { relationType: relation.relationType, label: relation.label },
        { relationType: rt, label: relation.label, now: new Date().toISOString() }
      )
    );
  };

  const handleLabelBlur = () => {
    if (!relation) return;
    const next = draftLabel.trim() === '' ? undefined : draftLabel;
    if (next === relation.label) return;
    applyCommand(
      makeEditRelationCommand(
        relation.id,
        { relationType: relation.relationType, label: relation.label },
        { relationType: relation.relationType, label: next, now: new Date().toISOString() }
      )
    );
  };

  const handleDelete = () => {
    if (!relation) return;
    if (!confirm(`この関係線を削除しますか？\n${sourceName} → ${targetName}`)) return;
    applyCommand(makeDeleteRelationCommand(relation));
    selectRelation(null);
  };

  return (
    <aside className="right-panel">
      <section className="panel-section">
        <h3>関係線詳細</h3>
        <dl className="meta-list">
          <dt>From</dt>
          <dd>{sourceName}</dd>
          <dt>To</dt>
          <dd>{targetName}</dd>
          <dt>作成</dt>
          <dd>{relation.createdAt.slice(0, 19).replace('T', ' ')}</dd>
          <dt>更新</dt>
          <dd>{relation.updatedAt.slice(0, 19).replace('T', ' ')}</dd>
        </dl>
        <label className="block-label">関係種別</label>
        <select
          value={relation.relationType}
          onChange={(e) => handleTypeChange(e.target.value as DiagramRelationType)}
        >
          {RELATION_TYPE_ORDER.map((rt) => (
            <option key={rt} value={rt}>
              {RELATION_TYPE_GLYPHS[rt]} {RELATION_TYPE_LABELS[rt]}
            </option>
          ))}
        </select>
        <label className="block-label">ラベル（任意．空ならタイプ名を表示）</label>
        <input
          type="text"
          value={draftLabel}
          onChange={(e) => setDraftLabel(e.target.value)}
          onBlur={handleLabelBlur}
          placeholder={RELATION_TYPE_LABELS[relation.relationType]}
        />
        <div className="right-actions">
          <button type="button" onClick={handleDelete} className="danger">
            関係線を削除
          </button>
        </div>
      </section>
    </aside>
  );
}

interface LabelTabsProps {
  drafts: Record<TextRevisionFieldName, string>;
  setDrafts: Dispatch<SetStateAction<Record<TextRevisionFieldName, string>>>;
  commitField: (field: TextRevisionFieldName) => void;
  labelId: string | null;
}

/** メモ用タブ（表札は独立扱い．2026-06-02 のリクエストで分離） */
const LABEL_MEMO_TABS: Array<{
  field: TextRevisionFieldName;
  label: string;
  placeholder: string;
  rows: number;
}> = [
  { field: 'sharedMemo', label: '共有メモ', placeholder: 'チームで共有する解釈', rows: 8 },
  { field: 'basisMemo', label: '根拠メモ', placeholder: 'なぜこうまとめたか', rows: 8 },
  { field: 'holdMemo', label: '保留メモ', placeholder: '迷い・後で検討する点', rows: 8 },
];

function LabelTabs({ drafts, setDrafts, commitField, labelId }: LabelTabsProps) {
  const [active, setActive] = useState<TextRevisionFieldName>('sharedMemo');
  const [historyOpen, setHistoryOpen] = useState(false);
  const current = LABEL_MEMO_TABS.find((t) => t.field === active) ?? LABEL_MEMO_TABS[0];
  const project = useProjectStore((s) => s.project);
  const applyCommand = useProjectStore((s) => s.applyCommand);
  const label = useMemo(() => {
    if (!project || !labelId) return null;
    return project.data.labels.find((l) => l.id === labelId) ?? null;
  }, [project, labelId]);
  const isMemoField =
    current.field === 'sharedMemo' ||
    current.field === 'basisMemo' ||
    current.field === 'holdMemo';
  const memoEntries =
    label && isMemoField ? label.memoLogs?.[current.field as 'sharedMemo'] ?? [] : [];

  // 表札専用 textarea: Enter で確定 (commit + blur)，Ctrl+Enter / Shift+Enter で改行．
  const onLabelTextKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      commitField('text');
      (e.target as HTMLTextAreaElement).blur();
    }
  };

  return (
    <>
      {/* 表札 (text) は独立セクション．ユーザー要望で常時表示 (タブ化しない)． */}
      <section className="panel-section">
        <h3 style={{ marginTop: 0, marginBottom: 4 }}>表札</h3>
        <textarea
          value={drafts.text ?? ''}
          onChange={(e) => setDrafts((d) => ({ ...d, text: e.target.value }))}
          onBlur={() => commitField('text')}
          onKeyDown={onLabelTextKeyDown}
          rows={3}
          placeholder="（表札を入力．Enter で確定，Ctrl+Enter で改行）"
          style={{ width: '100%', boxSizing: 'border-box' }}
        />
      </section>
      {/* メモ 3 種だけタブ化 */}
      <section className="panel-section">
      <div className="label-tabs-row">
        {LABEL_MEMO_TABS.map((t) => {
          const hasContent = (drafts[t.field] ?? '').trim().length > 0;
          return (
            <button
              key={t.field}
              type="button"
              className={`label-tab ${active === t.field ? 'active' : ''} ${
                hasContent ? 'has-content' : ''
              }`}
              onClick={() => setActive(t.field)}
            >
              {t.label}
              {hasContent && <span className="label-tab-dot" />}
            </button>
          );
        })}
      </div>
      {isMemoField && label ? (
        <MemoLogEditor
          entries={memoEntries}
          legacyText={drafts[current.field] ?? ''}
          onAdd={(text) => {
            const entry: MemoEntry = {
              id: newId(),
              text,
              timestamp: new Date().toISOString(),
            };
            applyCommand(
              makeAddLabelMemoEntryCommand(
                label.id,
                current.field as 'sharedMemo' | 'basisMemo' | 'holdMemo',
                entry,
                new Date().toISOString(),
                label.updatedAt
              )
            );
          }}
          onDelete={(entry) => {
            if (!confirm(`このメモを削除しますか？`)) return;
            applyCommand(
              makeDeleteLabelMemoEntryCommand(
                label.id,
                current.field as 'sharedMemo' | 'basisMemo' | 'holdMemo',
                entry,
                new Date().toISOString(),
                label.updatedAt
              )
            );
          }}
        />
      ) : (
        <textarea
          value={drafts[current.field] ?? ''}
          onChange={(e) =>
            setDrafts((d) => ({ ...d, [current.field]: e.target.value }))
          }
          onBlur={() => commitField(current.field)}
          rows={current.rows}
          placeholder={current.placeholder}
        />
      )}
      {labelId && (
        <div className="right-actions">
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            title="この表札の編集履歴を表示"
          >
            履歴を表示
          </button>
        </div>
      )}
      {historyOpen && labelId && (
        <RevisionHistoryDialog labelId={labelId} onClose={() => setHistoryOpen(false)} />
      )}
    </section>
    </>
  );
}

function RevisionHistoryDialog({
  labelId,
  onClose,
}: {
  labelId: string;
  onClose: () => void;
}) {
  const project = useProjectStore((s) => s.project);
  const revisions = useMemo(() => {
    if (!project) return [];
    return project.data.text_revisions
      .filter((r) => r.targetId === labelId)
      .slice()
      .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  }, [project, labelId]);
  const fieldName = (f: TextRevisionFieldName): string => {
    switch (f) {
      case 'text':
        return '表札';
      case 'sharedMemo':
        return '共有メモ';
      case 'basisMemo':
        return '根拠メモ';
      case 'holdMemo':
        return '保留メモ';
      default:
        return f;
    }
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 680 }}>
        <header className="modal-header">
          <h2>表札の編集履歴 ({revisions.length} 件)</h2>
        </header>
        <div className="modal-body">
          {revisions.length === 0 ? (
            <div className="muted">編集履歴はまだありません</div>
          ) : (
            <ol className="revision-list">
              {revisions.map((r) => (
                <li key={r.id}>
                  <div className="revision-meta">
                    <span className="revision-field">{fieldName(r.fieldName)}</span>
                    <span className="revision-time">
                      {r.timestamp.slice(0, 19).replace('T', ' ')}
                    </span>
                  </div>
                  <div className="revision-diff">
                    <div className="revision-before">
                      <div className="revision-label muted">変更前</div>
                      <pre>{r.beforeText || '(空)'}</pre>
                    </div>
                    <div className="revision-after">
                      <div className="revision-label muted">変更後</div>
                      <pre>{r.afterText || '(空)'}</pre>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
        <footer className="modal-footer">
          <button type="button" onClick={onClose}>閉じる</button>
        </footer>
      </div>
    </div>
  );
}

function MemoLogEditor({
  entries,
  legacyText,
  onAdd,
  onDelete,
}: {
  entries: MemoEntry[];
  legacyText?: string;
  onAdd: (text: string) => void;
  onDelete: (entry: MemoEntry) => void;
}) {
  const [draft, setDraft] = useState('');
  const sorted = useMemo(
    () => entries.slice().sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1)),
    [entries]
  );
  const handleAdd = () => {
    const text = draft.trim();
    if (!text) return;
    onAdd(text);
    setDraft('');
  };
  return (
    <div className="memo-log">
      {sorted.length === 0 && !legacyText && (
        <div className="muted small" style={{ padding: '4px 0' }}>
          まだメモがありません．下に追記すると日時付きでログに残ります．
        </div>
      )}
      {sorted.length > 0 && (
        <ul className="memo-log-list">
          {sorted.map((e) => (
            <li key={e.id} className="memo-log-entry">
              <div className="memo-log-entry-head">
                <span className="memo-log-time">
                  {e.timestamp.slice(0, 16).replace('T', ' ')}
                </span>
                <button
                  type="button"
                  className="segment-action-btn danger"
                  onClick={() => onDelete(e)}
                  title="このエントリを削除"
                >
                  ×
                </button>
              </div>
              <div className="memo-log-text">{e.text}</div>
            </li>
          ))}
        </ul>
      )}
      <div className="memo-log-input">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          placeholder="メモを追記 (Ctrl+Enter で確定)"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              handleAdd();
            }
          }}
        />
        <button type="button" onClick={handleAdd} disabled={!draft.trim()}>
          追記
        </button>
      </div>
    </div>
  );
}

function renderHighlighted(text: string, start: number, end: number) {
  if (start < 0 || end > text.length || end <= start) return text;
  return (
    <>
      {text.slice(0, start)}
      <mark>{text.slice(start, end)}</mark>
      {text.slice(end)}
    </>
  );
}
