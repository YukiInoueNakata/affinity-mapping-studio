import type {
  Card,
  CardPosition,
  CardSourceLink,
  Participant,
  ProjectData,
  SourceSegment,
} from '@shared/types/domain';
import type { WordComment } from '@shared/types/ipc';
import { formatCardCode, isValidParticipantCode, newId } from './ids.js';
import { nextCardSerial, nextCardPositionForParticipant } from './cards.js';

/** Whether this file is one big interview transcript (1 participant, optional
 * speaker column) or a survey-style table (each row = a different participant). */
export type ImportPattern = 'interview' | 'survey';

/** Role a column plays during import. Unmapped columns are ignored. */
export type ColumnRole =
  | 'ignore'
  | 'body'
  | 'speaker'
  | 'participant_code'
  | 'participant_name'
  | 'custom'
  | 'auto_card';

export interface ColumnSpec {
  /** 0-based index into the row arrays. */
  index: number;
  role: ColumnRole;
  /** Header label as shown in the wizard.  For role='custom' this becomes the
   *  customFields key.  For role='auto_card' this becomes the card body source. */
  label: string;
}

export interface InterviewImportPlan {
  pattern: 'interview';
  /** Resolved participant id this file belongs to.  Created up-front if new. */
  participantId: string;
  fileName: string;
  /** 0-based index of the row whose cells provide column labels.  null means
   *  there is no header row (column labels default to "列 1", "列 2", …). */
  headerRowIndex: number | null;
  /** 0-based index of the first data row.  Anything before this (including
   *  header / metadata rows) is ignored during import.  For Qualtrics-style
   *  CSVs with 1 header + 2 metadata rows, set to 3. */
  dataStartRowIndex: number;
  columns: ColumnSpec[];
}

export interface SurveyImportPlan {
  pattern: 'survey';
  fileName: string;
  headerRowIndex: number | null;
  dataStartRowIndex: number;
  columns: ColumnSpec[];
  /** Fallback display-name template, e.g. "回答者 {code}" (when no name column). */
  defaultDisplayNameTemplate?: string;
}

export type ImportPlan = InterviewImportPlan | SurveyImportPlan;

export interface ImportRow {
  participant: Participant | null;
  participantIsNew: boolean;
  segment: SourceSegment;
  /** Bodies for auto-card columns: { columnLabel: cellText }. Used downstream. */
  autoCardSources: Record<string, string>;
}

export interface ImportBuildResult {
  newParticipants: Participant[];
  segments: SourceSegment[];
  cards: Card[];
  cardLinks: CardSourceLink[];
  cardPositions: CardPosition[];
  /** Row-level errors (skipped). For surfacing in the wizard's "did not import" tab. */
  skipped: Array<{ rowIndex: number; reason: string }>;
}

export class ImportPlanError extends Error {}

/** Validates a plan independently of any data rows. */
export function validatePlan(plan: ImportPlan): string[] {
  const errs: string[] = [];
  const bodyCols = plan.columns.filter((c) => c.role === 'body');
  if (bodyCols.length === 0) errs.push('本文列を 1 つ以上指定してください');
  if (plan.pattern === 'survey') {
    const codeCols = plan.columns.filter((c) => c.role === 'participant_code');
    if (codeCols.length > 1) {
      errs.push('参加者コード列は 1 つだけ指定してください（未指定なら自動連番 P001…）');
    }
  }
  // Duplicate role checks where appropriate
  const customLabels = plan.columns
    .filter((c) => c.role === 'custom' || c.role === 'auto_card')
    .map((c) => c.label);
  const dups = customLabels.filter((l, i) => customLabels.indexOf(l) !== i);
  if (dups.length > 0) {
    errs.push(`列名が重複しています: ${Array.from(new Set(dups)).join(', ')}`);
  }
  return errs;
}

/** Parse a single line of fixed-width text into columns according to break points.
 *  `breaks` is the set of 0-based character indices where a new column starts. */
export function parseFixedWidthLine(line: string, breaks: number[]): string[] {
  const ordered = Array.from(new Set(breaks)).sort((a, b) => a - b);
  if (ordered.length === 0 || ordered[0] !== 0) ordered.unshift(0);
  const cells: string[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const start = ordered[i];
    const end = i + 1 < ordered.length ? ordered[i + 1] : line.length;
    cells.push(line.slice(start, end));
  }
  return cells.map((c) => c.trim());
}

export function parseFixedWidthText(text: string, breaks: number[]): string[][] {
  const lines = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((l) => l.length > 0);
  return lines.map((l) => parseFixedWidthLine(l, breaks));
}

/** Split `text` into sentences using any character in `delimiters` as a
 *  terminator.  The delimiter character is kept at the end of each segment.
 *  Newlines do not terminate sentences — they are preserved inside the segment.
 *  Empty segments (after trimming) are dropped. */
export function splitBySentenceDelimiters(text: string, delimiters: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (delimiters.length === 0) {
    const t = normalized.trim();
    return t.length === 0 ? [] : [t];
  }
  const stops = new Set(Array.from(delimiters));
  const out: string[] = [];
  let buf = '';
  for (const ch of normalized) {
    buf += ch;
    if (stops.has(ch)) {
      const piece = buf.trim();
      if (piece.length > 0) out.push(piece);
      buf = '';
    }
  }
  const tail = buf.trim();
  if (tail.length > 0) out.push(tail);
  return out;
}

/** Heuristically guess whether a tabular file looks like a survey (rows are
 *  distinct participants, identified by an ID-like column) or an interview
 *  (1 file = 1 participant, optional speaker column).
 *
 *  Looks for an "ID-like" column: values match /^[A-Za-z][A-Za-z0-9_-]{0,9}$/
 *  and the distinct/total ratio is high.  Body text usually doesn't satisfy
 *  the regex so it doesn't trigger false positives.
 */
export function guessPattern(rows: string[][]): ImportPattern {
  if (rows.length < 3) return 'interview';
  const idLikeRe = /^[A-Za-z][A-Za-z0-9_-]{0,9}$/;
  let bestIdRatio = 0;
  for (let c = 0; c < (rows[0]?.length ?? 0); c++) {
    const values = rows.slice(1).map((r) => r[c] ?? '').filter((v) => v.length > 0);
    if (values.length === 0) continue;
    const idLikeCount = values.filter((v) => idLikeRe.test(v)).length;
    const idLikeFrac = idLikeCount / values.length;
    if (idLikeFrac < 0.8) continue;
    const distinct = new Set(values).size;
    const ratio = distinct / values.length;
    if (ratio > bestIdRatio) bestIdRatio = ratio;
  }
  // Survey when at least one ID-like column has mostly distinct values per row
  return bestIdRatio > 0.6 ? 'survey' : 'interview';
}

/** Run the plan against the rows, producing new participants/segments/cards.
 *  Pure function: nothing mutates `data`. */
export function buildImport(
  data: ProjectData,
  plan: ImportPlan,
  rows: string[][],
  now: string
): ImportBuildResult {
  const skipped: ImportBuildResult['skipped'] = [];
  const newParticipants: Participant[] = [];
  const segments: SourceSegment[] = [];
  const autoCardEntries: Array<{
    participantId: string;
    body: string;
    segmentId: string;
  }> = [];

  const startRow = Math.max(0, plan.dataStartRowIndex);
  const bodyCols = plan.columns.filter((c) => c.role === 'body');
  const speakerCol = plan.columns.find((c) => c.role === 'speaker') ?? null;
  const codeCol = plan.columns.find((c) => c.role === 'participant_code') ?? null;
  const nameCol = plan.columns.find((c) => c.role === 'participant_name') ?? null;
  const customCols = plan.columns.filter((c) => c.role === 'custom');
  const autoCardCols = plan.columns.filter((c) => c.role === 'auto_card');

  // For survey: build participant lookup as we go
  const participantByCode = new Map<string, Participant>();
  for (const p of data.participants) participantByCode.set(p.code, p);
  // Auto-numbering state for survey rows that have no participant code column /
  // empty code cells.  Seeded so it never collides with an existing P\d+ code.
  let autoSerial = nextAutoSerial(data.participants);

  let order = nextSegmentOrder(data, plan.fileName);

  for (let r = startRow; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const bodyParts = bodyCols
      .map((c) => (row[c.index] ?? '').trim())
      .filter((s) => s.length > 0);
    if (bodyParts.length === 0) {
      // empty body row — skip silently (handles trailing empty rows)
      continue;
    }
    const body = bodyParts.join('\n');

    let participantId: string;
    if (plan.pattern === 'interview') {
      participantId = plan.participantId;
    } else {
      const rawCode = codeCol ? (row[codeCol.index] ?? '').trim() : '';
      let p: Participant | null = null;
      if (rawCode) {
        if (!isValidParticipantCode(rawCode)) {
          skipped.push({
            rowIndex: r,
            reason: `参加者コード "${rawCode}" は無効です（英字始まり 1〜10 文字 英数字）`,
          });
          continue;
        }
        p = participantByCode.get(rawCode) ?? null;
        if (!p) {
          const displayNameRaw = nameCol ? (row[nameCol.index] ?? '').trim() : '';
          const displayName =
            displayNameRaw ||
            (plan.defaultDisplayNameTemplate
              ? plan.defaultDisplayNameTemplate.replace('{code}', rawCode)
              : rawCode);
          p = {
            id: newId(),
            code: rawCode,
            displayName,
            createdAt: now,
          };
          participantByCode.set(rawCode, p);
          newParticipants.push(p);
        }
      } else {
        // No code column or empty cell → auto-number P001, P002, ... per row
        let code: string;
        do {
          code = `P${String(autoSerial++).padStart(3, '0')}`;
        } while (participantByCode.has(code));
        p = {
          id: newId(),
          code,
          displayName: code,
          createdAt: now,
        };
        participantByCode.set(code, p);
        newParticipants.push(p);
      }
      participantId = p.id;
    }

    const speaker = speakerCol ? (row[speakerCol.index] ?? '').trim() : '';
    const customFields: Record<string, string> = {};
    for (const c of customCols) {
      const v = (row[c.index] ?? '').trim();
      if (v.length > 0) customFields[c.label] = v;
    }

    const seg: SourceSegment = {
      id: newId(),
      participantId,
      sourceFile: plan.fileName,
      importedAt: now,
      order: order++,
      text: body,
      previousVersionId: null,
      deletedAt: null,
    };
    if (speaker) seg.speaker = speaker;
    if (Object.keys(customFields).length > 0) seg.customFields = customFields;
    segments.push(seg);

    for (const c of autoCardCols) {
      const v = (row[c.index] ?? '').trim();
      if (v.length > 0) {
        autoCardEntries.push({ participantId, body: v, segmentId: seg.id });
      }
    }
  }

  const { cards, cardLinks, cardPositions } = buildAutoCards(
    data,
    newParticipants,
    segments,
    autoCardEntries,
    now
  );

  return {
    newParticipants,
    segments,
    cards,
    cardLinks,
    cardPositions,
    skipped,
  };
}

function buildAutoCards(
  data: ProjectData,
  newParticipants: Participant[],
  newSegments: SourceSegment[],
  entries: Array<{ participantId: string; body: string; segmentId: string }>,
  now: string
): { cards: Card[]; cardLinks: CardSourceLink[]; cardPositions: CardPosition[] } {
  const cards: Card[] = [];
  const cardLinks: CardSourceLink[] = [];
  const cardPositions: CardPosition[] = [];
  // Per-participant serial counter starting from data + new cards already added
  const serialBase = new Map<string, number>();
  // Per-participant position counter
  const posCount = new Map<string, number>();

  const participants = new Map<string, Participant>();
  for (const p of data.participants) participants.set(p.id, p);
  for (const p of newParticipants) participants.set(p.id, p);

  for (const entry of entries) {
    const participant = participants.get(entry.participantId);
    if (!participant) continue;
    let serial = serialBase.get(entry.participantId);
    if (serial === undefined) {
      serial = nextCardSerial(data, entry.participantId);
      serialBase.set(entry.participantId, serial);
    } else {
      serial = serial + 1;
      serialBase.set(entry.participantId, serial);
    }
    const cardId = newId();
    const segment = newSegments.find((s) => s.id === entry.segmentId);
    const snapshot = entry.body;
    cards.push({
      id: cardId,
      participantId: entry.participantId,
      code: formatCardCode(participant.code, serial),
      serialNumber: serial,
      body: entry.body,
      status: 'active',
      placement: 'unclassified',
      createdAt: now,
      updatedAt: now,
    });
    if (segment) {
      cardLinks.push({
        id: newId(),
        cardId,
        segmentId: segment.id,
        startOffset: 0,
        endOffset: Math.min(segment.text.length, snapshot.length),
        selectedTextSnapshot: snapshot,
        createdAt: now,
      });
    }
    const pcount = posCount.get(entry.participantId) ?? 0;
    posCount.set(entry.participantId, pcount + 1);
    const base = nextCardPositionForParticipant(data, entry.participantId);
    cardPositions.push({
      cardId,
      x: base.x + (pcount % 12) * 28,
      y: base.y + Math.floor(pcount / 12) * 28,
    });
  }

  return { cards, cardLinks, cardPositions };
}

function nextSegmentOrder(data: ProjectData, sourceFile: string): number {
  let max = -1;
  for (const s of data.source_segments) {
    if (s.sourceFile === sourceFile && s.order > max) max = s.order;
  }
  return max + 1;
}

/** Next P-style serial number that doesn't collide with any existing
 *  participant code matching `^P\d+$`. */
function nextAutoSerial(participants: Participant[]): number {
  const re = /^P(\d+)$/;
  let max = 0;
  for (const p of participants) {
    const m = re.exec(p.code);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  return max + 1;
}

/** What to do with the Word comments attached to a .docx import. */
export type CommentMode = 'ignore' | 'segments' | 'cards';

/** How to handle the comment author name when materialising a comment.
 *  - 'include': prefix the body with "[author] " (legacy behaviour)
 *  - 'remove': drop the author entirely
 *  - 'tag': attach the author as a tag (cards) or customFields entry (segments)
 */
export type CommentAuthorHandling = 'include' | 'remove' | 'tag';

export interface CommentImportInput {
  comments: WordComment[];
  /** All segments visible after the main import (existing + newly added). */
  candidateSegments: SourceSegment[];
  participantId: string;
  /** Participant code (e.g. "P01"). Used to format new card.code. */
  participantCode: string;
  sourceFile: string;
  /** Serial seed: nextCardSerial(data, participantId) before the call. */
  serialStart: number;
  authorHandling: CommentAuthorHandling;
  /** Optional per-author remap: raw author name -> tag/customField value.
   *  Only consulted when authorHandling === 'tag'.  Empty or missing entries
   *  fall back to the raw author. */
  authorRemap?: Record<string, string>;
  now: string;
}

function applyAuthorToBody(
  text: string,
  author: string | undefined,
  handling: CommentAuthorHandling
): string {
  if (!author || handling !== 'include') return text;
  return `[${author}] ${text}`;
}

function resolveAuthorTag(
  author: string,
  remap: Record<string, string> | undefined
): string {
  const v = remap?.[author]?.trim();
  return v && v.length > 0 ? v : author;
}

export interface CommentImportResult {
  segments: SourceSegment[];
  cards: Card[];
  cardLinks: CardSourceLink[];
  cardPositions: CardPosition[];
}

/** Build segments from Word comments: each comment becomes a new SourceSegment
 *  in a parallel "(コメント)" sub-file. */
export function buildCommentsAsSegments(input: CommentImportInput): CommentImportResult {
  const filtered = input.comments.filter((c) => c.text.trim().length > 0);
  const fileForComments = `${input.sourceFile} (コメント)`;
  const segments: SourceSegment[] = filtered.map((c, i) => {
    const body = applyAuthorToBody(c.text, c.author, input.authorHandling);
    const seg: SourceSegment = {
      id: newId(),
      participantId: input.participantId,
      sourceFile: fileForComments,
      importedAt: input.now,
      order: i,
      text: body,
      previousVersionId: null,
      deletedAt: null,
    };
    if (input.authorHandling === 'tag' && c.author) {
      seg.customFields = { コメント者: resolveAuthorTag(c.author, input.authorRemap) };
    }
    return seg;
  });
  return { segments, cards: [], cardLinks: [], cardPositions: [] };
}

/** Build cards from Word comments: each comment becomes an unclassified card
 *  whose body is the comment text.  If the comment's commentedText can be
 *  located inside any candidate segment, a CardSourceLink is created. */
export function buildCommentsAsCards(input: CommentImportInput): CommentImportResult {
  const filtered = input.comments.filter((c) => c.text.trim().length > 0);
  const cards: Card[] = [];
  const cardLinks: CardSourceLink[] = [];
  const cardPositions: CardPosition[] = [];
  let serial = input.serialStart;
  // Lazy lookup tables for fast match
  const segByText = input.candidateSegments
    .filter((s) => s.participantId === input.participantId && s.deletedAt === null);
  // We need a participant code to format card.code. Caller passes via serialStart
  // but not code itself — derive from a placeholder pCode in caller.
  for (let i = 0; i < filtered.length; i++) {
    const c = filtered[i];
    const body = applyAuthorToBody(c.text, c.author, input.authorHandling);
    const cardId = newId();
    const card: Card = {
      id: cardId,
      participantId: input.participantId,
      code: formatCardCode(input.participantCode, serial),
      serialNumber: serial,
      body,
      status: 'active',
      placement: 'unclassified',
      createdAt: input.now,
      updatedAt: input.now,
    };
    if (input.authorHandling === 'tag' && c.author) {
      card.tags = [resolveAuthorTag(c.author, input.authorRemap)];
    }
    cards.push(card);
    serial++;
    cardPositions.push({
      cardId,
      x: 80 + (i % 12) * 28,
      y: 80 + Math.floor(i / 12) * 28,
    });
    const match = findSegmentForComment(segByText, c);
    if (match) {
      cardLinks.push({
        id: newId(),
        cardId,
        segmentId: match.segment.id,
        startOffset: match.start,
        endOffset: match.end,
        selectedTextSnapshot: match.snapshot,
        createdAt: input.now,
      });
    }
  }
  return { segments: [], cards, cardLinks, cardPositions };
}

/** Try a Word comment against the candidate segments, in three escalating
 *  strategies — exact range → paragraph context → fuzzy prefix.  This is the
 *  authoritative comment→segment matcher used by both buildCommentsAsCards
 *  and the wizard's dry-run preview. */
export function findSegmentForComment(
  candidateSegments: SourceSegment[],
  comment: { commentedText?: string; paragraphText?: string }
): { segment: SourceSegment; start: number; end: number; snapshot: string } | null {
  const commented = comment.commentedText?.trim() ?? '';
  if (commented.length > 0) {
    const m = findSegmentContaining(candidateSegments, commented);
    if (m) return m;
  }
  const paragraph = comment.paragraphText?.trim() ?? '';
  if (paragraph.length > 0) {
    const m = findSegmentContaining(candidateSegments, paragraph);
    if (m) return m;
    // Last-ditch: match each line of the paragraph in turn
    for (const line of paragraph.split(/\n+/)) {
      const t = line.trim();
      if (t.length < 4) continue;
      const lm = findSegmentContaining(candidateSegments, t);
      if (lm) return lm;
    }
  }
  return null;
}

/** Find the first segment whose text contains `target` as a substring.
 *  Falls back to a fuzzy contains-by-prefix if no exact match. */
/** Locate the segment whose body contains the comment-target text.  Tries
 *  three strategies in order, because Word comment ranges and mammoth's plain
 *  text extraction normalise whitespace and paragraph breaks differently:
 *    1. exact substring match
 *    2. whitespace-stripped substring match (handles \n vs no-\n mismatches)
 *    3. prefix-substring fallback (first 20 chars) for partial mismatches
 */
export function findSegmentContaining(
  segments: SourceSegment[],
  target: string
): { segment: SourceSegment; start: number; end: number; snapshot: string } | null {
  if (target.length === 0) return null;
  // 1. Exact substring
  for (const s of segments) {
    const idx = s.text.indexOf(target);
    if (idx !== -1) {
      return { segment: s, start: idx, end: idx + target.length, snapshot: target };
    }
  }
  // 2. Whitespace-stripped substring (Word coalesces runs; mammoth may insert \n)
  const normTarget = target.replace(/\s+/g, '');
  if (normTarget.length === 0) return null;
  for (const s of segments) {
    const hit = findInTextIgnoringWhitespace(s.text, normTarget);
    if (hit) {
      return {
        segment: s,
        start: hit.start,
        end: hit.end,
        snapshot: s.text.slice(hit.start, hit.end),
      };
    }
  }
  // 3. Prefix fallback for partial mismatches
  if (target.length > 20) {
    const prefix = target.slice(0, 20);
    for (const s of segments) {
      const idx = s.text.indexOf(prefix);
      if (idx !== -1) {
        const end = Math.min(idx + target.length, s.text.length);
        return { segment: s, start: idx, end, snapshot: s.text.slice(idx, end) };
      }
    }
    const normPrefix = prefix.replace(/\s+/g, '');
    if (normPrefix.length > 0) {
      for (const s of segments) {
        const hit = findInTextIgnoringWhitespace(s.text, normPrefix);
        if (hit) {
          const end = Math.min(hit.start + target.length, s.text.length);
          return {
            segment: s,
            start: hit.start,
            end,
            snapshot: s.text.slice(hit.start, end),
          };
        }
      }
    }
  }
  return null;
}

/** Locate the substring `normTarget` (already whitespace-stripped) inside
 *  `text`, returning indices in the original text.  Returns null if not found. */
function findInTextIgnoringWhitespace(
  text: string,
  normTarget: string
): { start: number; end: number } | null {
  // Build a map from normalised-string indices back to original indices
  const indexMap: number[] = [];
  let normText = '';
  for (let i = 0; i < text.length; i++) {
    if (!/\s/.test(text[i])) {
      indexMap.push(i);
      normText += text[i];
    }
  }
  const ni = normText.indexOf(normTarget);
  if (ni === -1 || normTarget.length === 0) return null;
  const start = indexMap[ni];
  const endChar = indexMap[ni + normTarget.length - 1];
  return { start, end: endChar + 1 };
}
