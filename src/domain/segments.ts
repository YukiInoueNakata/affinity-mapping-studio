import type { ProjectData, SourceSegment } from '@shared/types/domain';
import type { SegmentSplitMode } from '@shared/types/ipc';
import { newId } from './ids.js';

export function splitTextIntoSegments(text: string, mode: SegmentSplitMode): string[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (mode === 'blank-line') {
    return normalized
      .split(/\n\s*\n+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return normalized
    .split(/\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function buildSegments(
  participantId: string,
  sourceFile: string,
  text: string,
  mode: SegmentSplitMode,
  now: string,
  startOrder = 0
): SourceSegment[] {
  const parts = splitTextIntoSegments(text, mode);
  return parts.map((t, i) => ({
    id: newId(),
    participantId,
    sourceFile,
    importedAt: now,
    order: startOrder + i,
    text: t,
    previousVersionId: null,
    deletedAt: null,
  }));
}

export function buildCommentSegments(
  participantId: string,
  sourceFile: string,
  comments: Array<{ id: string; author?: string; text: string }>,
  now: string,
  startOrder: number
): SourceSegment[] {
  return comments
    .filter((c) => c.text.trim().length > 0)
    .map((c, i) => ({
      id: newId(),
      participantId,
      sourceFile,
      importedAt: now,
      order: startOrder + i,
      text: c.author ? `[${c.author}] ${c.text}` : c.text,
      previousVersionId: null,
      deletedAt: null,
    }));
}

/** A segment is "current" iff it is not soft-deleted AND no other segment supersedes it. */
export function isCurrentSegment(data: ProjectData, segmentId: string): boolean {
  const s = data.source_segments.find((x) => x.id === segmentId);
  if (!s || s.deletedAt) return false;
  return !data.source_segments.some((x) => x.previousVersionId === segmentId);
}

/** Returns the segments to show in the source viewer: alive + latest version, ordered. */
export function getVisibleSegments(data: ProjectData): SourceSegment[] {
  const supersededIds = new Set(
    data.source_segments
      .map((s) => s.previousVersionId)
      .filter((id): id is string => id !== null)
  );
  return data.source_segments
    .filter((s) => !s.deletedAt && !supersededIds.has(s.id))
    .slice()
    .sort((a, b) => a.order - b.order);
}

/** Find a segment's most recent surviving descendant via the previousVersionId chain. */
export function findLatestVersion(
  data: ProjectData,
  segmentId: string
): SourceSegment | null {
  const start = data.source_segments.find((s) => s.id === segmentId);
  if (!start) return null;
  let current = start;
  while (true) {
    const next = data.source_segments.find((s) => s.previousVersionId === current.id);
    if (!next) break;
    current = next;
  }
  if (current.deletedAt) return null;
  return current;
}

export interface EditSegmentInput {
  segmentId: string;
  newText: string;
  now: string;
}

export interface EditSegmentOutput {
  oldSegment: SourceSegment;
  newSegment: SourceSegment;
}

export class SegmentEditError extends Error {}

export function buildEditedSegment(
  data: ProjectData,
  input: EditSegmentInput
): EditSegmentOutput {
  const old = data.source_segments.find((s) => s.id === input.segmentId);
  if (!old) throw new SegmentEditError('セグメントが見つかりません');
  if (old.deletedAt) throw new SegmentEditError('削除済みセグメントは編集できません');
  if (data.source_segments.some((s) => s.previousVersionId === old.id)) {
    throw new SegmentEditError('既に新しい版が存在します（旧版は編集不可）');
  }
  const trimmed = input.newText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (trimmed.trim().length === 0) {
    throw new SegmentEditError('空のテキストには編集できません（削除を使ってください）');
  }
  if (trimmed === old.text) {
    throw new SegmentEditError('テキストに変更がありません');
  }
  return {
    oldSegment: old,
    newSegment: {
      id: newId(),
      participantId: old.participantId,
      sourceFile: old.sourceFile,
      importedAt: input.now,
      order: old.order,
      text: trimmed,
      previousVersionId: old.id,
      deletedAt: null,
    },
  };
}

export interface InsertSegmentInput {
  participantId: string;
  sourceFile: string;
  afterSegmentId: string | null;
  text: string;
  now: string;
}

export function buildInsertedSegment(
  data: ProjectData,
  input: InsertSegmentInput
): SourceSegment {
  const trimmed = input.text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (trimmed.length === 0) {
    throw new SegmentEditError('追加するテキストが空です');
  }
  const visible = getVisibleSegments(data).filter(
    (s) => s.participantId === input.participantId && s.sourceFile === input.sourceFile
  );
  let order: number;
  if (input.afterSegmentId === null) {
    order = visible.length > 0 ? visible[0].order - 1 : 0;
  } else {
    const afterIdx = visible.findIndex((s) => s.id === input.afterSegmentId);
    if (afterIdx === -1) throw new SegmentEditError('挿入位置の基準セグメントが見つかりません');
    const after = visible[afterIdx];
    const next = visible[afterIdx + 1];
    order = next ? (after.order + next.order) / 2 : after.order + 1;
  }
  return {
    id: newId(),
    participantId: input.participantId,
    sourceFile: input.sourceFile,
    importedAt: input.now,
    order,
    text: trimmed,
    previousVersionId: null,
    deletedAt: null,
  };
}

/**
 * Try to relink a card source link to the latest version of its segment chain.
 * Returns the updated link if a fuzzy match by selectedTextSnapshot succeeded; null otherwise.
 */
export function tryRelinkToLatest(
  data: ProjectData,
  link: { segmentId: string; selectedTextSnapshot: string; startOffset: number; endOffset: number }
): { newSegmentId: string; newStartOffset: number; newEndOffset: number } | null {
  const latest = findLatestVersion(data, link.segmentId);
  if (!latest) return null;
  if (latest.id === link.segmentId) return null;
  const snapshot = link.selectedTextSnapshot;
  if (!snapshot) return null;
  const idx = latest.text.indexOf(snapshot);
  if (idx === -1) return null;
  return {
    newSegmentId: latest.id,
    newStartOffset: idx,
    newEndOffset: idx + snapshot.length,
  };
}
