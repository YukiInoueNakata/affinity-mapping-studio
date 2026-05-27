import type { ProjectData } from '@shared/types/domain';

export type BulkReplaceFieldKind =
  | 'card_body'
  | 'card_memo'
  | 'label_text'
  | 'label_sharedMemo'
  | 'label_basisMemo'
  | 'label_holdMemo';

export interface BulkReplaceOptions {
  query: string;
  replacement: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  scope: Set<BulkReplaceFieldKind>;
}

export interface BulkReplaceHit {
  kind: BulkReplaceFieldKind;
  /** card id or label id (depending on kind). */
  recordId: string;
  prevValue: string;
  nextValue: string;
  matchCount: number;
  /** short snippet for preview. */
  snippet: string;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildRegex(opts: BulkReplaceOptions): RegExp {
  const pattern = opts.wholeWord
    ? `\\b${escapeRegExp(opts.query)}\\b`
    : escapeRegExp(opts.query);
  return new RegExp(pattern, opts.caseSensitive ? 'g' : 'gi');
}

function snippetAround(text: string, match: RegExp): string {
  match.lastIndex = 0;
  const m = match.exec(text);
  if (!m) return text.slice(0, 80);
  const start = Math.max(0, m.index - 20);
  const end = Math.min(text.length, m.index + m[0].length + 30);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return prefix + text.slice(start, end) + suffix;
}

export function findBulkReplaceHits(
  data: ProjectData,
  opts: BulkReplaceOptions
): BulkReplaceHit[] {
  if (!opts.query) return [];
  const hits: BulkReplaceHit[] = [];

  const tryField = (
    kind: BulkReplaceFieldKind,
    recordId: string,
    value: string | undefined
  ) => {
    if (!opts.scope.has(kind) || !value) return;
    const re = buildRegex(opts);
    if (!re.test(value)) return;
    const re2 = buildRegex(opts);
    const matchCount = (value.match(re2) ?? []).length;
    const next = value.replace(buildRegex(opts), opts.replacement);
    hits.push({
      kind,
      recordId,
      prevValue: value,
      nextValue: next,
      matchCount,
      snippet: snippetAround(value, buildRegex(opts)),
    });
  };

  for (const c of data.cards) {
    tryField('card_body', c.id, c.body);
    tryField('card_memo', c.id, c.memo);
  }
  for (const l of data.labels) {
    tryField('label_text', l.id, l.text);
    tryField('label_sharedMemo', l.id, l.sharedMemo);
    tryField('label_basisMemo', l.id, l.basisMemo);
    tryField('label_holdMemo', l.id, l.holdMemo);
  }
  return hits;
}

export const FIELD_LABELS: Record<BulkReplaceFieldKind, string> = {
  card_body: 'カード本文',
  card_memo: 'カードメモ',
  label_text: '表札',
  label_sharedMemo: '共有メモ',
  label_basisMemo: '根拠メモ',
  label_holdMemo: '保留メモ',
};

export const DEFAULT_SCOPE: BulkReplaceFieldKind[] = [
  'card_body',
  'card_memo',
  'label_text',
  'label_sharedMemo',
  'label_basisMemo',
  'label_holdMemo',
];
