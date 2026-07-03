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
    // 数字だけのトークン (カード通し番号 024 等) は prefix / fuzzy を無効化する．
    // 02-024 が 026 / 029 に一致してしまう誤ヒットを防ぐ (2026-07 修正)．
    // 英字を含むトークンは従来どおり prefix + fuzzy で本文検索の緩さを維持．
    searchOptions: {
      prefix: (term: string) => !/^\d+$/.test(term) && term.length >= 2,
      fuzzy: (term: string) => (/^\d+$/.test(term) ? false : 0.2),
      boost: { title: 2 },
    },
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
  // v0.2.14 robustness (2026-06-10 incident):
  // 壊れた sync (cards.id 重複等) で MiniSearch.addAll が throw すると React の
  // Error Boundary 不在のため画面真っ暗に．id で uniq してから add する．
  const docs = buildSearchDocs(data);
  const seen = new Set<string>();
  const uniq: SearchDoc[] = [];
  let dupCount = 0;
  for (const d of docs) {
    if (seen.has(d.id)) {
      dupCount++;
      continue;
    }
    seen.add(d.id);
    uniq.push(d);
  }
  if (dupCount > 0) {
    console.warn(`[search] dropped ${dupCount} duplicate doc id(s) before MiniSearch add`);
  }
  ms.addAll(uniq);
  return ms;
}

/** カード番号らしい文字列を code 比較用に正規化する．前置の英字接頭 (P など) と
 * 記号・空白を除き，数字ブロックのゼロ埋めを外す (024 → 24)．一致比較専用． */
function normalizeCodeQuery(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^0-9a-z]/g, '')
    .replace(/^[a-z]+/, '')
    .replace(/\b0+(\d)/g, '$1');
}

/** クエリがカード番号らしい (数字を含み英字が participant 接頭のみ) ときだけ，
 * code の完全一致/包含でカードを拾う．そうでなければ空配列． */
function searchCardCodesExact(
  data: ProjectData,
  query: string,
  filters: SearchFilters
): SearchHit[] {
  // 数字を 2 ブロック以上含む (024-... や 02-024) か，純数字のときだけ発動．
  if (!/\d/.test(query)) return [];
  const isCodeLike = /^[A-Za-z]?\s*\d+(?:\s*[-\s]\s*\d+)?$/.test(query.trim());
  if (!isCodeLike) return [];
  if (filters.kinds && filters.kinds.length > 0 && !filters.kinds.includes('card')) return [];

  const nq = normalizeCodeQuery(query);
  if (!nq) return [];
  const cardGroupId = new Map<string, string>();
  for (const m of data.group_memberships) cardGroupId.set(m.cardId, m.groupId);

  const hits: SearchHit[] = [];
  for (const c of data.cards) {
    const nc = normalizeCodeQuery(c.code);
    if (nc !== nq) continue;
    if (filters.participantId !== undefined && filters.participantId !== null) {
      if (c.participantId !== filters.participantId) continue;
    }
    const groupId = cardGroupId.get(c.id) ?? null;
    if (filters.groupId !== undefined) {
      if (filters.groupId === null && groupId !== null) continue;
      if (filters.groupId !== null && groupId !== filters.groupId) continue;
    }
    hits.push({
      id: `card:${c.id}`,
      kind: 'card',
      refId: c.id,
      title: c.code,
      bodySnippet: snippet(c.body),
      score: Number.MAX_SAFE_INTEGER,
      participantId: c.participantId,
      groupId,
    });
  }
  return hits;
}

export function searchProject(
  data: ProjectData,
  query: string,
  filters: SearchFilters = {}
): SearchHit[] {
  const q = query.trim();
  if (!q) return [];

  // カード番号らしいクエリ (例: 02-024 / P02-024 / 024) は code の完全一致寄りに
  // 拾い，MiniSearch の緩い一致より優先する．正規化して大小・ゼロ埋め・前置 P を無視．
  const codeHits = searchCardCodesExact(data, q, filters);

  const ms = buildSearchIndex(data);
  const raw = ms.search(q);
  const hits: SearchHit[] = [...codeHits];
  const seenIds = new Set(codeHits.map((h) => h.id));
  for (const r of raw) {
    const kind = r.kind as SearchHitKind;
    if (seenIds.has(r.id as string)) continue;
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
