import { useMemo, useState } from 'react';
import { useProjectStore } from '../stores/projectStore.js';
import {
  buildSearchIndex,
  matchCardCodes,
  type SearchHit,
  type SearchHitKind,
} from '../domain/search.js';
import { ContextMenu, type ContextMenuItem } from './ContextMenu.js';

interface Props {
  onJumpTo(hit: SearchHit): void;
}

/** 右クリック時のジャンプ＋カード選択．カード行のみ意味があるが，他種別でも
 *  ジャンプ動作は同等にする（左クリックと挙動を揃える）． */
function dispatchJumpToCard(cardId: string) {
  try {
    window.dispatchEvent(
      new CustomEvent('kj.jumpToCard', { detail: { cardId } })
    );
  } catch {
    // ignore (jsdom 環境などで CustomEvent が無いケース)
  }
}
function dispatchJumpToGroup(groupId: string) {
  try {
    window.dispatchEvent(
      new CustomEvent('kj.jumpToGroup', { detail: { groupId } })
    );
  } catch {
    // ignore
  }
}

const KIND_LABEL: Record<SearchHitKind, string> = {
  card: 'カード',
  segment: '原文',
  group: 'グループ',
  label: '表札',
};

export function SearchPanel({ onJumpTo }: Props) {
  const project = useProjectStore((s) => s.project);
  const selectedParticipantId = useProjectStore((s) => s.selectedParticipantId);
  const selectCard = useProjectStore((s) => s.selectCard);
  const selectGroup = useProjectStore((s) => s.selectGroup);
  const [query, setQuery] = useState<string>('');
  const [scopeFilter, setScopeFilter] = useState<'all' | SearchHitKind>('all');
  // 2026-06-02: 右クリックでコンテキストメニューを表示
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    hit: SearchHit;
  } | null>(null);

  const closeContextMenu = () => setContextMenu(null);

  const buildContextMenuItems = (h: SearchHit): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [];
    if (h.kind === 'card') {
      items.push({
        label: 'ジャンプ (カードへ)',
        title: 'カードを選択してキャンバスへ移動',
        onClick: () => {
          selectCard(h.refId);
          dispatchJumpToCard(h.refId);
        },
      });
      items.push({
        label: '選択のみ',
        title: 'ジャンプせず選択だけ',
        onClick: () => selectCard(h.refId),
      });
    } else if (h.kind === 'group') {
      items.push({
        label: 'ジャンプ (グループへ)',
        title: 'グループを選択してキャンバスへ移動',
        onClick: () => {
          selectGroup(h.refId);
          dispatchJumpToGroup(h.refId);
        },
      });
      items.push({
        label: '選択のみ',
        onClick: () => selectGroup(h.refId),
      });
    } else if (h.kind === 'label' && h.groupId) {
      items.push({
        label: 'ジャンプ (グループへ)',
        title: '表札の所属グループへ移動',
        onClick: () => {
          selectGroup(h.groupId!);
          dispatchJumpToGroup(h.groupId!);
        },
      });
    } else if (h.kind === 'segment') {
      items.push({
        label: 'ジャンプ (原文へ)',
        title: '原文ビューアで表示',
        onClick: () => onJumpTo(h),
      });
    }
    return items;
  };

  const index = useMemo(() => {
    if (!project) return null;
    return buildSearchIndex(project.data);
  }, [project]);

  const hits = useMemo<SearchHit[]>(() => {
    if (!index || !project || !query.trim()) return [];
    const q = query.trim();
    // カードコード (新旧 ID・ゼロ埋め有無・階層コード) の部分一致を最優先で拾い，
    // MiniSearch の本文/表札ヒットを後ろに連結する．id で重複排除．
    const codeHits: SearchHit[] = matchCardCodes(project.data, q).map((h) => ({
      ...h,
      bodySnippet: snippet(h.bodySnippet, q),
    }));
    const seen = new Set(codeHits.map((h) => h.id));
    const list: SearchHit[] = [...codeHits];
    for (const r of index.search(q)) {
      const id = r.id as string;
      if (seen.has(id)) continue;
      seen.add(id);
      list.push({
        id,
        kind: r.kind as SearchHitKind,
        refId: r.refId as string,
        title: r.title as string,
        bodySnippet: snippet(r.body as string, q),
        score: r.score,
        participantId: (r.participantId as string | null) ?? null,
        groupId: (r.groupId as string | null) ?? null,
      });
    }
    return list
      .filter((h) => {
        if (scopeFilter !== 'all' && h.kind !== scopeFilter) return false;
        if (
          selectedParticipantId &&
          h.participantId &&
          h.participantId !== selectedParticipantId
        ) {
          return false;
        }
        return true;
      })
      .slice(0, 60);
  }, [index, project, query, scopeFilter, selectedParticipantId]);

  if (!project) return null;

  return (
    <section className="panel-section search-section">
      <h3>検索</h3>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="カード本文・原文・表札..."
      />
      {query.trim() && (
        <>
          <div className="search-filter-row">
            {(['all', 'card', 'segment', 'group', 'label'] as const).map((k) => (
              <button
                key={k}
                type="button"
                className={`chip ${scopeFilter === k ? 'active' : ''}`}
                onClick={() => setScopeFilter(k)}
              >
                {k === 'all' ? 'すべて' : KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <div className="search-results">
            {hits.length === 0 ? (
              <div className="muted small">該当なし</div>
            ) : (
              <ul className="search-results-list">
                {hits.map((h) => (
                  <li
                    key={h.id}
                    onClick={() => onJumpTo(h)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({ x: e.clientX, y: e.clientY, hit: h });
                    }}
                    title="左クリック: 移動 / 右クリック: メニュー"
                  >
                    <div className="search-result-head">
                      <span className={`kind-tag kind-${h.kind}`}>{KIND_LABEL[h.kind]}</span>
                      <span className="search-result-title">{h.title}</span>
                    </div>
                    {h.bodySnippet && (
                      <div className="search-result-snippet">{h.bodySnippet}</div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={buildContextMenuItems(contextMenu.hit)}
          onClose={closeContextMenu}
        />
      )}
    </section>
  );
}

function snippet(text: string, query: string, maxLen = 80): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= maxLen) return t;
  const idx = t.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return t.slice(0, maxLen - 1) + '…';
  const start = Math.max(0, idx - 20);
  const end = Math.min(t.length, start + maxLen);
  return (start > 0 ? '…' : '') + t.slice(start, end) + (end < t.length ? '…' : '');
}
