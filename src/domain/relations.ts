import type {
  DiagramObjectType,
  DiagramRelation,
  DiagramRelationType,
  ProjectData,
} from '@shared/types/domain';
import { newId } from './ids.js';

export const RELATION_TYPE_LABELS: Record<DiagramRelationType, string> = {
  subsumes: '包摂',
  exemplifies: '例示',
  refutes: '反証',
  complements: '補完',
  opposes: '対立',
  parallels: '並列',
  causes: '因果',
  results_in: '帰結',
  presupposes: '前提',
  conditions: '条件',
  synonymous: '同義',
  similar: '類似',
  influences: '影響',
  defines: '規定',
  custom: 'カスタム',
};

/** Compact glyph for each relation type. Useful for inline display in edge
 * labels and the relation picker. Pure Unicode (no emoji). */
export const RELATION_TYPE_GLYPHS: Record<DiagramRelationType, string> = {
  subsumes: '⊃',
  exemplifies: '∋',
  refutes: '⊗',
  complements: '＋',
  opposes: '⇄',
  parallels: '∥',
  causes: '→',
  results_in: '⇒',
  presupposes: '⊢',
  conditions: '⊳',
  synonymous: '≡',
  similar: '≈',
  influences: '⇢',
  defines: '≝',
  custom: '◇',
};

export const RELATION_TYPE_ORDER: DiagramRelationType[] = [
  'subsumes',
  'exemplifies',
  'refutes',
  'complements',
  'opposes',
  'parallels',
  'causes',
  'results_in',
  'presupposes',
  'conditions',
  'synonymous',
  'similar',
  'influences',
  'defines',
  'custom',
];

/** 両端に矢じりを持つ（対称・双方向の）関係種別．
 *  KJFinalView では markerStart + markerEnd の両方に同じ marker を適用する． */
export const BIDIRECTIONAL_RELATIONS: ReadonlySet<DiagramRelationType> = new Set<DiagramRelationType>([
  'opposes',
  'parallels',
  'synonymous',
  'similar',
]);

export const RELATION_TYPE_COLORS: Record<DiagramRelationType, string> = {
  subsumes: '#98c379',
  exemplifies: '#a0a0a0',
  refutes: '#e06c75',
  complements: '#56b6c2',
  opposes: '#c678dd',
  parallels: '#a0a0a0',
  causes: '#e06c75',
  results_in: '#4ea1ff',
  presupposes: '#4ea1ff',
  conditions: '#61afef',
  synonymous: '#98c379',
  similar: '#a0a0a0',
  influences: '#6fc88a',
  defines: '#e0b34c',
  custom: '#888',
};

/** 旧スキーマ（14 種）→ 新スキーマ（論文§2 分類）への関係種別マッピング．
 *  保存済みプロジェクト / sync / snapshot のロード時に migrateRelationType で適用する． */
export const RELATION_TYPE_MIGRATION: Record<string, DiagramRelationType> = {
  causes: 'causes',
  promotes: 'influences',
  inhibits: 'influences',
  precedes: 'presupposes',
  follows: 'results_in',
  contrasts_with: 'opposes',
  supports: 'complements',
  questions: 'refutes',
  part_of: 'subsumes',
  example_of: 'exemplifies',
  abstracts: 'subsumes',
  derived_from: 'defines',
  co_occurs_with: 'parallels',
  custom: 'custom',
};

const NEW_RELATION_TYPES: ReadonlySet<string> = new Set<string>(RELATION_TYPE_ORDER);

/** 装飾シェイプ種別（FinalDiagram の kind が関係種別ではない場合）．
 *  migrate 時にそのまま通過させる（関係種別への coerce をしない）． */
const DECORATIVE_SHAPE_KINDS: ReadonlySet<string> = new Set<string>([
  'circle',
  'rect',
  'cloud',
  'bracket',
  'arrow_standalone',
  'text',
]);

/** 関係種別文字列を新スキーマへ正規化する．
 *  - 既に新キー → そのまま
 *  - 旧キー → マッピング適用
 *  - 装飾シェイプ種別 → そのまま（FinalDiagram shape.kind 用）
 *  - 未知 → 'custom' に coerce */
export function migrateRelationType(value: string): string {
  if (NEW_RELATION_TYPES.has(value)) return value;
  if (value in RELATION_TYPE_MIGRATION) return RELATION_TYPE_MIGRATION[value];
  if (DECORATIVE_SHAPE_KINDS.has(value)) return value;
  return 'custom';
}

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
  return RELATION_TYPE_LABELS[r.relationType] ?? RELATION_TYPE_LABELS.custom;
}

/** diagram_relations の relationType を新スキーマへ正規化（破壊的・in-place）．
 *  保存済みプロジェクト / sync / snapshot のロード境界で呼ぶ． */
export function normalizeProjectRelations(data: ProjectData): void {
  if (!Array.isArray(data?.diagram_relations)) return;
  for (const r of data.diagram_relations) {
    if (typeof r.relationType === 'string') {
      r.relationType = migrateRelationType(r.relationType) as DiagramRelationType;
    }
  }
}

/** FinalDiagram の shape.kind（関係種別 or 装飾種別）を新スキーマへ正規化（破壊的・in-place）． */
export function normalizeFinalDiagramShapes(finalDiagram: unknown): void {
  const fd = finalDiagram as { shapes?: Array<{ kind?: string }> } | null | undefined;
  if (!fd || !Array.isArray(fd.shapes)) return;
  for (const s of fd.shapes) {
    if (typeof s.kind === 'string') {
      s.kind = migrateRelationType(s.kind);
    }
  }
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
