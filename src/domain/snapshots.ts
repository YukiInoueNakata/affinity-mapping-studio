import type {
  ProjectData,
  Card,
  Group,
  Label,
} from '@shared/types/domain';
import type { Snapshot, SnapshotMetadata } from '@shared/types/project';
import { newId } from './ids.js';

export interface CreateSnapshotInput {
  data: ProjectData;
  kind: 'manual' | 'auto';
  label?: string;
  comment?: string;
  now: string;
}

/**
 * Build a frozen full Snapshot of the current project state.
 * Caller is responsible for inserting it into ProjectFile.snapshots.
 */
export function buildSnapshot(input: CreateSnapshotInput): Snapshot {
  const metadata: SnapshotMetadata = {
    id: newId(),
    timestamp: input.now,
    kind: input.kind,
    label: input.label?.trim() || undefined,
    comment: input.comment?.trim() || undefined,
  };
  // Deep-clone via JSON to detach from the live store reference.
  const data = JSON.parse(JSON.stringify(input.data)) as ProjectData;
  return { metadata, data };
}

/**
 * Snapshot-vs-snapshot summary diff.  Returns counts of additions / removals
 * across the major tables, plus a sample list (limited) of changed items so
 * the UI can render a digest without overwhelming output.
 */
export interface SnapshotDiffSummary {
  cards: { added: Card[]; removed: Card[]; changed: Array<{ before: Card; after: Card }> };
  groups: { added: Group[]; removed: Group[]; changed: Array<{ before: Group; after: Group }> };
  labels: { changed: Array<{ before: Label; after: Label }> };
  counts: {
    cardsBefore: number;
    cardsAfter: number;
    groupsBefore: number;
    groupsAfter: number;
    relationsBefore: number;
    relationsAfter: number;
  };
}

const SAMPLE_LIMIT = 50;

function indexById<T extends { id: string }>(arr: T[]): Map<string, T> {
  return new Map(arr.map((x) => [x.id, x]));
}

export function diffSnapshots(before: ProjectData, after: ProjectData): SnapshotDiffSummary {
  const beforeCards = indexById(before.cards);
  const afterCards = indexById(after.cards);
  const beforeGroups = indexById(before.groups);
  const afterGroups = indexById(after.groups);
  const beforeLabels = indexById(before.labels);
  const afterLabels = indexById(after.labels);

  const addedCards: Card[] = [];
  const removedCards: Card[] = [];
  const changedCards: Array<{ before: Card; after: Card }> = [];
  for (const [id, c] of afterCards) {
    const b = beforeCards.get(id);
    if (!b) addedCards.push(c);
    else if (c.body !== b.body || c.code !== b.code) changedCards.push({ before: b, after: c });
  }
  for (const [id, c] of beforeCards) {
    if (!afterCards.has(id)) removedCards.push(c);
  }

  const addedGroups: Group[] = [];
  const removedGroups: Group[] = [];
  const changedGroups: Array<{ before: Group; after: Group }> = [];
  for (const [id, g] of afterGroups) {
    const b = beforeGroups.get(id);
    if (!b) addedGroups.push(g);
    else if (g.name !== b.name || g.parentGroupId !== b.parentGroupId || g.collapsed !== b.collapsed) {
      changedGroups.push({ before: b, after: g });
    }
  }
  for (const [id, g] of beforeGroups) {
    if (!afterGroups.has(id)) removedGroups.push(g);
  }

  const changedLabels: Array<{ before: Label; after: Label }> = [];
  for (const [id, l] of afterLabels) {
    const b = beforeLabels.get(id);
    if (!b) continue;
    if (
      l.text !== b.text ||
      l.sharedMemo !== b.sharedMemo ||
      l.basisMemo !== b.basisMemo ||
      l.holdMemo !== b.holdMemo
    ) {
      changedLabels.push({ before: b, after: l });
    }
  }

  return {
    cards: {
      added: addedCards.slice(0, SAMPLE_LIMIT),
      removed: removedCards.slice(0, SAMPLE_LIMIT),
      changed: changedCards.slice(0, SAMPLE_LIMIT),
    },
    groups: {
      added: addedGroups.slice(0, SAMPLE_LIMIT),
      removed: removedGroups.slice(0, SAMPLE_LIMIT),
      changed: changedGroups.slice(0, SAMPLE_LIMIT),
    },
    labels: { changed: changedLabels.slice(0, SAMPLE_LIMIT) },
    counts: {
      cardsBefore: before.cards.length,
      cardsAfter: after.cards.length,
      groupsBefore: before.groups.length,
      groupsAfter: after.groups.length,
      relationsBefore: before.diagram_relations.length,
      relationsAfter: after.diagram_relations.length,
    },
  };
}

/**
 * Rotate auto-snapshots: keep only the N most recent ones.  Manual snapshots
 * are preserved.  Returns the trimmed array.
 */
export function rotateAutoSnapshots(snapshots: Snapshot[], keep: number): Snapshot[] {
  const manual = snapshots.filter((s) => s.metadata.kind === 'manual');
  const auto = snapshots
    .filter((s) => s.metadata.kind === 'auto')
    .slice()
    .sort((a, b) => (a.metadata.timestamp < b.metadata.timestamp ? 1 : -1));
  const trimmedAuto = auto.slice(0, Math.max(0, keep));
  return [...manual, ...trimmedAuto].sort((a, b) =>
    a.metadata.timestamp < b.metadata.timestamp ? -1 : 1
  );
}
