import type {
  DiagramObjectType,
  DiagramRelation,
  DiagramRelationType,
  ProjectData,
} from '@shared/types/domain';
import { newId } from './ids.js';

export const RELATION_TYPE_LABELS: Record<DiagramRelationType, string> = {
  causes: '因果',
  promotes: '促進',
  inhibits: '抑制',
  precedes: '前提',
  follows: '後続',
  contrasts_with: '対立',
  supports: '支持',
  questions: '疑問',
  part_of: '含意',
  example_of: '具体例',
  abstracts: '抽象化',
  derived_from: '派生',
  co_occurs_with: '同時',
  custom: 'カスタム',
};

/** Compact glyph for each relation type. Useful for inline display in edge
 * labels and the relation picker. Pure Unicode (no emoji). */
export const RELATION_TYPE_GLYPHS: Record<DiagramRelationType, string> = {
  causes: '→',
  promotes: '⇧',
  inhibits: '⇩',
  precedes: '⊢',
  follows: '⊣',
  contrasts_with: '⇄',
  supports: '＋',
  questions: '？',
  part_of: '⊂',
  example_of: '∋',
  abstracts: '⇪',
  derived_from: '⤳',
  co_occurs_with: '≈',
  custom: '◇',
};

export const RELATION_TYPE_ORDER: DiagramRelationType[] = [
  'causes',
  'promotes',
  'inhibits',
  'precedes',
  'follows',
  'contrasts_with',
  'supports',
  'questions',
  'part_of',
  'example_of',
  'abstracts',
  'derived_from',
  'co_occurs_with',
  'custom',
];

export const RELATION_TYPE_COLORS: Record<DiagramRelationType, string> = {
  causes: '#e06c75',
  promotes: '#6fc88a',
  inhibits: '#e0b34c',
  precedes: '#4ea1ff',
  follows: '#4ea1ff',
  contrasts_with: '#c678dd',
  supports: '#56b6c2',
  questions: '#abb2bf',
  part_of: '#98c379',
  example_of: '#a0a0a0',
  abstracts: '#a0a0a0',
  derived_from: '#a0a0a0',
  co_occurs_with: '#a0a0a0',
  custom: '#888',
};

export class RelationError extends Error {}

export interface BuildRelationInput {
  sourceObjectType: DiagramObjectType;
  sourceObjectId: string;
  targetObjectType: DiagramObjectType;
  targetObjectId: string;
  relationType: DiagramRelationType;
  label?: string;
  now: string;
}

export function buildRelation(input: BuildRelationInput): DiagramRelation {
  if (
    input.sourceObjectType === input.targetObjectType &&
    input.sourceObjectId === input.targetObjectId
  ) {
    throw new RelationError('同じオブジェクトへ自己ループは作れません');
  }
  return {
    id: newId(),
    sourceObjectType: input.sourceObjectType,
    sourceObjectId: input.sourceObjectId,
    targetObjectType: input.targetObjectType,
    targetObjectId: input.targetObjectId,
    relationType: input.relationType,
    label: input.label,
    memoIds: [],
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/** Returns true if a relation between the same source/target already exists. */
export function relationExists(
  data: ProjectData,
  sourceType: DiagramObjectType,
  sourceId: string,
  targetType: DiagramObjectType,
  targetId: string
): boolean {
  return data.diagram_relations.some(
    (r) =>
      r.sourceObjectType === sourceType &&
      r.sourceObjectId === sourceId &&
      r.targetObjectType === targetType &&
      r.targetObjectId === targetId
  );
}

export function relationDisplayLabel(r: DiagramRelation): string {
  if (r.label && r.label.trim().length > 0) return r.label;
  return RELATION_TYPE_LABELS[r.relationType];
}

export function getRelationsForObject(
  data: ProjectData,
  objectType: DiagramObjectType,
  objectId: string
): DiagramRelation[] {
  return data.diagram_relations.filter(
    (r) =>
      (r.sourceObjectType === objectType && r.sourceObjectId === objectId) ||
      (r.targetObjectType === objectType && r.targetObjectId === objectId)
  );
}
