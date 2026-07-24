import { useEffect, useMemo, useRef, useState } from 'react';
import { useProjectStore } from '../stores/projectStore.js';
import {
  applyDisplayOrder,
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
  const setPlacementOrder = useProjectStore((s) => s.setPlacementOrder);
  const [collapsed, setCollapsed] = useState(false);
  const [filter, setFilter] = useState<string>('');
  // 並び替え順は metadata に永続化し，共同編集で共有する（ローカル state ではない）．
  // placement は 'unclassified' | 'pending' のセクションでのみ使う（'canvas' は無い）．
  const savedOrder =
    placement === 'canvas' ? undefined : project?.metadata.placementOrder?.[placement];
  const kbScroll = useKeyboardScroll();
  // 2026-06-02: ジャンプで対象カードまでスクロールするための ref マップ．
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    const handler = (ev: Event) => {
      const cardId = (ev as CustomEvent).detail?.cardId as string | undefined;
      if (!cardId) return;
      const el = cardRefs.current.get(cardId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // 強調アニメーション
        el.classList.add('placement-card-flash');
        setTimeout(() => el.classList.remove('placement-card-flash'), 1200);
      }
    };
    window.addEventListener('kj.scrollToCard', handler as EventListener);
    return () => window.removeEventListener('kj.scrollToCard', handler as EventListener);
  }, []);

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

  // 保存済みの並び替え順を適用する．保存順に載っているカードを先頭に，
  // 保存順に無いカード（新規追加など）は自然順で末尾に置く．削除・キャンバスへの
  // 移動でリストから抜けたカードは自然に落ちるだけで，残りの順序は保持される
  // （＝カードを 1 枚キャンバスへ出しても並びがリセットされない）．
  const orderedCards = useMemo(
    () => applyDisplayOrder(filteredCards, savedOrder),
    [filteredCards, savedOrder]
  );

  const handleShuffle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (placement === 'canvas') return;
    // 並び順を metadata に保存 → 汎用ミラーで接続相手にも同期される．
    setPlacementOrder(placement, shuffleIds(cards.map((c) => c.id)));
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
            title="表示順をランダムに並び替え（並び順は保存され，共同編集の相手にも共有されます）"
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
              ref={(el) => {
                if (el) cardRefs.current.set(c.id, el);
                else cardRefs.current.delete(c.id);
              }}
              className={`placement-card ${c.id === selectedCardId ? 'active' : ''}`}
              draggable
              onDragStart={(e) => handleDragStart(e, c.id)}
              onClick={() => selectCard(c.id)}
              title="ドラッグでキャンバスに配置 / クリックで選択"
            >
              <div className="placement-card-code">{c.code}</div>
              <div className="placement-card-body">
                {c.body
                  ? project?.metadata.displaySettings?.cardTruncate === false
                    ? c.body
                    : c.body.slice(0, 80)
                  : '(本文なし)'}
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
