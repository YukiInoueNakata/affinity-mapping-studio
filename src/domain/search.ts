import MiniSearch from 'minisearch';
import type { ProjectData } from '@shared/types/domain';
import { getVisibleSegments } from './segments.js';

export type SearchHitKind = 'card' | 'segment' | 'group' | 'label';

export interface SearchDoc {
  id: string;
  kind: SearchHitKind;
  refId: string;
  title: string;
  body: string;
  participantId: string | null;
  groupId: string | null;
}

export interface SearchHit {
  id: string;
  kind: SearchHitKind;
  refId: string;
  title: string;
  bodySnippet: string;
  score: number;
  participantId: string | null;
  groupId: string | null;
}

export interface SearchFilters {
  participantId?: string | null;
  groupId?: string | null;
  kinds?: SearchHitKind[];
}

function snippet(text: string, maxLen = 100): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  return trimmed.length <= maxLen ? trimmed : trimmed.slice(0, maxLen - 1) + '…';
}

export function buildSearchDocs(data: ProjectData): SearchDoc[] {
  const docs: SearchDoc[] = [];
  const cardGroupId = new Map<string, string>();
  for (const m of data.group_memberships) cardGroupId.set(m.cardId, m.groupId);

  // 参加者コードを引いて participantPrefix を補完できるようにする (merged 元コード生成用)
  const participantCodeById = new Map(data.participants.map((p) => [p.id, p.code]));
  for (const c of data.cards) {
    // 2026-06-02: カードのメモ (memoLog) + タグも検索対象に含める．
    const memoBlob = (c.memoLog ?? []).map((m) => m.text).filter(Boolean).join(' / ');
    const tagBlob = (c.tags ?? []).join(' ');
    // 2026-06-02: 統合元カード (mergedFrom) の旧 code も body に含めて検索可能に．
    // title は表示用なので c.code のまま．body に旧コードを混ぜることで
    // 「統合前の P02-003」検索で統合後のカードもヒットする．
    let mergedCodes = '';
    if (c.mergedFrom && c.mergedFrom.length > 0) {
      const partCode = participantCodeById.get(c.participantId);
      if (partCode) {
        mergedCodes = c.mergedFrom
          .map((n) => `${partCode}-${String(n).padStart(3, '0')}`)
          .join(' ');
      }
    }
    const body = [c.body, memoBlob, tagBlob, mergedCodes]
      .filter((s) => s && s.length > 0)
      .join(' / ');
    docs.push({
      id: `card:${c.id}`,
      kind: 'card',
      refId: c.id,
      title: c.code,
      body,
      participantId: c.participantId,
      groupId: cardGroupId.get(c.id) ?? null,
    });
  }
  for (const s of getVisibleSegments(data)) {
    docs.push({
      id: `segment:${s.id}`,
      kind: 'segment',
      refId: s.id,
      title: `${s.sourceFile} #${s.order + 1}`,
      body: s.text,
      participantId: s.participantId,
      groupId: null,
    });
  }
  for (const g of data.groups) {
    // 2026-06-02: グループの叙述メモ (narrative) も検索対象に．
    docs.push({
      id: `group:${g.id}`,
      kind: 'group',
      refId: g.id,
      title: g.name,
      body: [g.name, g.narrative].filter((s) => s && s.length > 0).join(' / '),
      participantId: null,
      groupId: g.id,
    });
  }
  for (const l of data.labels) {
    // 2026-06-02: 表札 + 3 種メモ + メモログ全エントリも検索対象に．
    const logEntries: string[] = [];
    if (l.memoLogs) {
      for (const key of ['sharedMemo', 'basisMemo', 'holdMemo'] as const) {
        const arr = l.memoLogs[key];
        if (arr) for (const m of arr) if (m.text) logEntries.push(m.text);
      }
    }
    docs.push({
      id: `label:${l.id}`,
      kind: 'label',
      refId: l.groupId,
      title: l.text || '(無題の表札)',
      body: [l.text, l.sharedMemo, l.basisMemo, l.holdMemo, ...logEntries]
        .filter((s) => s && s.length > 0)
        .join(' / '),
      participantId: null,
      groupId: l.groupId,
    });
  }
  return docs;
}

export function buildSearchIndex(data: ProjectData) {
  const ms = new MiniSearch<SearchDoc>({
    fields: ['title', 'body'],
    storeFields: ['kind', 'refId', 'title', 'body', 'participantId', 'groupId'],
    searchOptions: { prefix: true, fuzzy: 0.2, boost: { title: 2 } },
    tokenize: (text) => {
      const ascii = text
        .toLowerCase()
        .split(/[\s　\.,;:!?"'()\[\]{}<>\/\\|`~@#$%^&*+=\-]+/u)
        .filter(Boolean);
      const cjk: string[] = [];
      const isCjk = (ch: string) => /[぀-ゟ゠-ヿ㐀-鿿]/.test(ch);
      for (let i = 0; i < text.length - 1; i++) {
        const a = text[i];
        const b = text[i + 1];
        if (isCjk(a) && isCjk(b)) cjk.push(a + b);
      }
      return [...ascii, ...cjk];
    },
  });
  ms.addAll(buildSearchDocs(data));
  return ms;
}

export function searchProject(
  data: ProjectData,
  query: string,
  filters: SearchFilters = {}
): SearchHit[] {
  const q = query.trim();
  if (!q) return [];
  const ms = buildSearchIndex(data);
  const raw = ms.search(q);
  const hits: SearchHit[] = [];
  for (const r of raw) {
    const kind = r.kind as SearchHitKind;
    if (filters.kinds && filters.kinds.length > 0 && !filters.kinds.includes(kind)) continue;
    if (filters.participantId !== undefined && filters.participantId !== null) {
      if (r.participantId !== filters.participantId) continue;
    }
    if (filters.groupId !== undefined) {
      if (filters.groupId === null && r.groupId !== null) continue;
      if (filters.groupId !== null && r.groupId !== filters.groupId) continue;
    }
    hits.push({
      id: r.id as string,
      kind,
      refId: r.refId as string,
      title: r.title as string,
      bodySnippet: snippet(r.body as string),
      score: r.score,
      participantId: (r.participantId as string | null) ?? null,
      groupId: (r.groupId as string | null) ?? null,
    });
  }
  return hits;
}
