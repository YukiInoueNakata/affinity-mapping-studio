import { useMemo, useState } from 'react';
import { useProjectStore } from '../stores/projectStore.js';
import {
  effectivePlacement,
  getCardsByPlacement,
  nextCardPositionForParticipant,
} from '../domain/cards.js';
import { makeSetCardPlacementCommand } from '../stores/commands.js';
import { useKeyboardScroll } from '../hooks/useKeyboardScroll.js';
import type { Card, CardPlacement } from '@shared/types/domain';

/** Fisher-Yates shuffle: returns a new ordering of card ids. */
function shuffleIds(ids: string[]): string[] {
  const out = ids.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

interface Props {
  /** layout: 'right' = vertical pane on right; 'top'/'bottom' = horizontal dock */
  layout?: 'right' | 'top' | 'bottom';
}

export function CardPlacementPane({ layout = 'right' }: Props) {
  const project = useProjectStore((s) => s.project);
  if (!project) return null;
  const unclassified = getCardsByPlacement(project.data, 'unclassified');
  const pending = getCardsByPlacement(project.data, 'pending');
  return (
    <aside className={`placement-pane placement-pane-${layout}`}>
      <PlacementSection
        title="未分類"
        placement="unclassified"
        cards={unclassified}
      />
      <PlacementSection
        title="分類留保"
        placement="pending"
        cards={pending}
      />
    </aside>
  );
}

function PlacementSection({
  title,
  placement,
  cards,
}: {
  title: string;
  placement: CardPlacement;
  cards: Card[];
}) {
  const project = useProjectStore((s) => s.project);
  const applyCommand = useProjectStore((s) => s.applyCommand);
  const selectCard = useProjectStore((s) => s.selectCard);
  const selectedCardId = useProjectStore((s) => s.selectedCardId);
  const [collapsed, setCollapsed] = useState(false);
  const [shuffleOrder, setShuffleOrder] = useState<string[] | null>(null);
  const [filter, setFilter] = useState<string>('');
  const kbScroll = useKeyboardScroll();

  // フィルタ後カード．カードコード（ID）と本文の双方を部分一致．
  const filteredCards = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (q.length === 0) return cards;
    return cards.filter(
      (c) =>
        c.code.toLowerCase().includes(q) ||
        (c.body ?? '').toLowerCase().includes(q)
    );
  }, [cards, filter]);

  // Apply the local shuffle order if it covers exactly the current card ids.
  // When the underlying card set changes (new add / remove) we drop the order
  // back to natural ordering so the new card appears.
  const orderedCards = useMemo(() => {
    if (!shuffleOrder) return filteredCards;
    const set = new Set(filteredCards.map((c) => c.id));
    const idsMatch =
      shuffleOrder.length === filteredCards.length &&
      shuffleOrder.every((id) => set.has(id));
    if (!idsMatch) return filteredCards;
    const map = new Map(filteredCards.map((c) => [c.id, c]));
    return shuffleOrder
      .map((id) => map.get(id))
      .filter((c): c is Card => !!c);
  }, [filteredCards, shuffleOrder]);

  const handleShuffle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShuffleOrder(shuffleIds(cards.map((c) => c.id)));
  };

  if (!project) return null;

  const handlePlaceOnCanvas = (cardId: string) => {
    const card = project.data.cards.find((c) => c.id === cardId);
    if (!card) return;
    const pos = project.data.card_positions.find((p) => p.cardId === cardId);
    // (#5) 現在のキャンバス表示中心に置く. CanvasView が公開する getter を使い，
    // 未マウント時は従来の participant 別 scatter 位置に fallback.
    const getCenter = (
      window as unknown as { __kjGetCanvasCenter?: () => { x: number; y: number } | null }
    ).__kjGetCanvasCenter;
    const center = typeof getCenter === 'function' ? getCenter() : null;
    const base =
      center ?? nextCardPositionForParticipant(project.data, card.participantId);
    // 既存カードに重ならない空き位置を探す
    const taken = project.data.card_positions.map((p) => ({ x: p.x, y: p.y }));
    let x = base.x;
    let y = base.y;
    let guard = 0;
    while (
      taken.some((p) => Math.abs(p.x - x) < 30 && Math.abs(p.y - y) < 30) &&
      guard < 60
    ) {
      x += 28;
      y += 24;
      guard++;
    }
    applyCommand(
      makeSetCardPlacementCommand(
        cardId,
        {
          placement: effectivePlacement(card),
          position: pos ? { x: pos.x, y: pos.y } : null,
          updatedAt: card.updatedAt,
        },
        {
          placement: 'canvas',
          position: { x, y },
          now: new Date().toISOString(),
        }
      )
    );
    selectCard(cardId);
  };

  const handleSetPlacement = (cardId: string, target: CardPlacement) => {
    const card = project.data.cards.find((c) => c.id === cardId);
    if (!card) return;
    const pos = project.data.card_positions.find((p) => p.cardId === cardId);
    applyCommand(
      makeSetCardPlacementCommand(
        cardId,
        {
          placement: effectivePlacement(card),
          position: pos ? { x: pos.x, y: pos.y } : null,
          updatedAt: card.updatedAt,
        },
        { placement: target, now: new Date().toISOString() }
      )
    );
  };

  const handleDragStart = (e: React.DragEvent, cardId: string) => {
    e.dataTransfer.setData('application/kjproj-card-id', cardId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const otherPlacement: CardPlacement =
    placement === 'unclassified' ? 'pending' : 'unclassified';
  const otherLabel = placement === 'unclassified' ? '保留へ' : '未分類へ';

  return (
    <section className={`placement-section placement-section-${placement} ${collapsed ? 'collapsed' : ''}`}>
      <header
        className="placement-section-header"
        onClick={() => setCollapsed((c) => !c)}
        title={collapsed ? '展開' : '折りたたむ'}
      >
        <span className="placement-section-toggle">{collapsed ? '▶' : '▼'}</span>
        <span className="placement-section-title">{title}</span>
        <span className="placement-section-count">{cards.length}</span>
        {!collapsed && cards.length >= 2 && (
          <button
            type="button"
            className="segment-action-btn"
            onClick={handleShuffle}
            title="表示順をランダムに並び替え (データは変わりません)"
            style={{ marginLeft: 'auto' }}
          >
            並び替え
          </button>
        )}
      </header>
      {!collapsed && (
        <div className="placement-list" {...kbScroll}>
          {cards.length >= 2 && (
            <div
              style={{
                padding: '4px 8px',
                borderBottom: '1px solid var(--border)',
                background: 'var(--bg-elev-2)',
              }}
            >
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="ID または本文で絞り込み（例: 48 / P02-048）"
                style={{ width: '100%', fontSize: 11 }}
                onClick={(e) => e.stopPropagation()}
              />
              {filter.trim() && (
                <div className="muted small" style={{ marginTop: 2 }}>
                  {orderedCards.length} / {cards.length} 件表示
                </div>
              )}
            </div>
          )}
          {cards.length === 0 && (
            <div className="muted small" style={{ padding: 8 }}>
              {placement === 'unclassified'
                ? '未分類のカードはありません'
                : '保留中のカードはありません'}
            </div>
          )}
          {cards.length > 0 && orderedCards.length === 0 && (
            <div className="muted small" style={{ padding: 8 }}>
              絞り込みにマッチするカードがありません
            </div>
          )}
          {orderedCards.map((c) => (
            <div
              key={c.id}
              className={`placement-card ${c.id === selectedCardId ? 'active' : ''}`}
              draggable
              onDragStart={(e) => handleDragStart(e, c.id)}
              onClick={() => selectCard(c.id)}
              title="ドラッグでキャンバスに配置 / クリックで選択"
            >
              <div className="placement-card-code">{c.code}</div>
              <div className="placement-card-body">
                {c.body ? c.body.slice(0, 80) : '(本文なし)'}
              </div>
              <div className="placement-card-actions">
                <button
                  type="button"
                  className="segment-action-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    handlePlaceOnCanvas(c.id);
                  }}
                >
                  キャンバスへ
                </button>
                <button
                  type="button"
                  className="segment-action-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSetPlacement(c.id, otherPlacement);
                  }}
                >
                  {otherLabel}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
