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
    // 0.2.28+: 分割由来の階層コードは serial から再現できないため，code を
    // そのまま保存した mergedFromCodes を優先する (旧データは serial から復元)．
    let mergedCodes = '';
    if (c.mergedFromCodes && c.mergedFromCodes.length > 0) {
      mergedCodes = c.mergedFromCodes.join(' ');
    } else if (c.mergedFrom && c.mergedFrom.length > 0) {
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

/** カードコードを「ゼロ埋めの有無を無視した」比較用の文字列にする．
 * 参加者接頭 (P02 など) は英数字混在なので保持し，ハイフン区切りの純数字
 * セグメント (020 / 01) だけ先頭ゼロを外す．
 *   P02-020-01 → p02-20-1 ／ 024 → 24 ／ 02-024 → 2-24 */
export function looseCardCode(code: string): string {
  return code
    .toLowerCase()
    .split('-')
    .map((seg) => (/^\d+$/.test(seg) ? seg.replace(/^0+(\d)/, '$1') : seg))
    .join('-');
}

/** クエリの 1 セグメントがコードの 1 セグメントに一致するか．
 * 純数字クエリは数字セグメントとのゼロ埋め無視一致．allowTrailingDigits の
 * ときだけ参加者接頭 (p02) の末尾数字 (02) にも一致させる — 「02-024」の
 * 先頭のような複数セグメントクエリの参加者部にのみ使う (単独の「20」が
 * P20 の全カードにヒットする誤爆を防ぐ)． */
function codeSegMatches(codeSeg: string, qSeg: string, allowTrailingDigits: boolean): boolean {
  if (codeSeg === qSeg) return true;
  if (allowTrailingDigits && /^\d+$/.test(qSeg)) {
    const m = codeSeg.match(/(\d+)$/);
    if (m && m[1].replace(/^0+(\d)/, '$1') === qSeg) return true;
  }
  return false;
}

/** クエリが数字を含む (= カード番号/コードらしい) ときだけ，コードのセグメント
 * 単位一致でカードを拾う．新旧 (ゼロ埋め有無) と階層コード (P02-020-01) の
 * 双方に一致する．
 *   "20" → P02-020 / P02-020-01 …／ "P02-20" → P02-020(-01) ／ "P02-020-01" → 完全一致
 * セグメント単位で照合するため "20" が P20-001 (別参加者) に誤ヒットしない．
 * 参加者・グループ・種別フィルタは呼び出し側に委ねる (score は最上位固定)． */
export function matchCardCodes(data: ProjectData, query: string): SearchHit[] {
  const q = query.trim();
  if (!q || !/\d/.test(q)) return [];
  const qSegs = looseCardCode(q.replace(/\s+/g, '')).split('-').filter(Boolean);
  if (qSegs.length === 0) return [];
  const cardGroupId = new Map<string, string>();
  for (const m of data.group_memberships) cardGroupId.set(m.cardId, m.groupId);

  // qSegs が cSegs の「連続部分列」として現れるか．先頭セグメントのみ，複数
  // セグメントクエリのとき参加者接頭の末尾数字一致 (02 → p02) を許す．
  const segsMatch = (cSegs: string[]): boolean => {
    for (let s = 0; s + qSegs.length <= cSegs.length; s++) {
      let ok = true;
      for (let j = 0; j < qSegs.length; j++) {
        const allowTrail = j === 0 && s === 0 && qSegs.length >= 2;
        if (!codeSegMatches(cSegs[s + j], qSegs[j], allowTrail)) {
          ok = false;
          break;
        }
      }
      if (ok) return true;
    }
    return false;
  };

  const hits: SearchHit[] = [];
  for (const c of data.cards) {
    if (!segsMatch(looseCardCode(c.code).split('-'))) continue;
    hits.push({
      id: `card:${c.id}`,
      kind: 'card',
      refId: c.id,
      title: c.code,
      bodySnippet: snippet(c.body),
      score: Number.MAX_SAFE_INTEGER,
      participantId: c.participantId,
      groupId: cardGroupId.get(c.id) ?? null,
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

  // カード番号らしいクエリ (例: 02-024 / P02-024 / 024 / P02-020-01) はコードの
  // 部分一致で拾い，MiniSearch の緩い一致より優先する (score 最上位)．新旧・
  // ゼロ埋め有無・階層コードのいずれでもヒットする．
  const codeHits = matchCardCodes(data, q).filter((h) => {
    if (filters.kinds && filters.kinds.length > 0 && !filters.kinds.includes('card')) {
      return false;
    }
    if (filters.participantId !== undefined && filters.participantId !== null) {
      if (h.participantId !== filters.participantId) return false;
    }
    if (filters.groupId !== undefined) {
      if (filters.groupId === null && h.groupId !== null) return false;
      if (filters.groupId !== null && h.groupId !== filters.groupId) return false;
    }
    return true;
  });

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
