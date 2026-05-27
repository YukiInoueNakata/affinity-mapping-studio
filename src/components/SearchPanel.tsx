import { useMemo, useState } from 'react';
import { useProjectStore } from '../stores/projectStore.js';
import { buildSearchIndex, type SearchHit, type SearchHitKind } from '../domain/search.js';

interface Props {
  onJumpTo(hit: SearchHit): void;
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
  const [query, setQuery] = useState<string>('');
  const [scopeFilter, setScopeFilter] = useState<'all' | SearchHitKind>('all');

  const index = useMemo(() => {
    if (!project) return null;
    return buildSearchIndex(project.data);
  }, [project]);

  const hits = useMemo<SearchHit[]>(() => {
    if (!index || !query.trim()) return [];
    const raw = index.search(query.trim());
    const list: SearchHit[] = raw.slice(0, 60).map((r) => ({
      id: r.id as string,
      kind: r.kind as SearchHitKind,
      refId: r.refId as string,
      title: r.title as string,
      bodySnippet: snippet(r.body as string, query.trim()),
      score: r.score,
      participantId: (r.participantId as string | null) ?? null,
      groupId: (r.groupId as string | null) ?? null,
    }));
    return list.filter((h) => {
      if (scopeFilter !== 'all' && h.kind !== scopeFilter) return false;
      if (selectedParticipantId && h.participantId && h.participantId !== selectedParticipantId) {
        return false;
      }
      return true;
    });
  }, [index, query, scopeFilter, selectedParticipantId]);

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
                  <li key={h.id} onClick={() => onJumpTo(h)}>
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
