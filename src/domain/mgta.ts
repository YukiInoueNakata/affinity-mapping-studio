import type {
  MGtaCategory,
  MGtaConcept,
  MGtaConceptStatus,
  MGtaSettings,
  MGtaVariation,
  MGtaVariationRole,
  ProjectData,
  TheoreticalMemo,
  TheoreticalMemoType,
} from '@shared/types/domain';
import { newId } from './ids.js';

export const VARIATION_ROLE_LABELS: Record<MGtaVariationRole, string> = {
  variation: 'ヴァリエーション',
  similar_example: '類似例',
  opposite_example: '対極例',
  negative_case: '反証例',
  memo_only: 'メモのみ',
};

export const CONCEPT_STATUS_LABELS: Record<MGtaConceptStatus, string> = {
  draft: '草案',
  active: '採用',
  reviewed: 'レビュー済',
  merged: '統合済',
  rejected: '却下',
  archived: 'アーカイブ',
};

export class MGtaError extends Error {}

export function buildSettings(input: {
  analysisTheme: string;
  focalPerson: string;
  researchQuestion?: string;
  notes?: string;
  now: string;
}): MGtaSettings {
  return {
    id: newId(),
    analysisTheme: input.analysisTheme.trim(),
    focalPerson: input.focalPerson.trim(),
    researchQuestion: input.researchQuestion,
    notes: input.notes,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function getActiveSettings(data: ProjectData): MGtaSettings | null {
  if (data.m_gta_settings.length === 0) return null;
  return [...data.m_gta_settings].sort((a, b) =>
    a.updatedAt < b.updatedAt ? 1 : -1
  )[0];
}

export function nextConceptName(data: ProjectData): string {
  const used = new Set(data.m_gta_concepts.map((c) => c.name));
  let n = 1;
  while (used.has(`概念 ${n}`)) n++;
  return `概念 ${n}`;
}

export function buildConcept(input: {
  settingsId: string;
  name?: string;
  definition?: string;
  status?: MGtaConceptStatus;
  categoryId?: string;
  derivedFromGroupId?: string;
  derivedFromLabelId?: string;
  now: string;
}): MGtaConcept {
  return {
    id: newId(),
    settingsId: input.settingsId,
    name: input.name ?? '',
    definition: input.definition ?? '',
    status: input.status ?? 'draft',
    categoryId: input.categoryId,
    derivedFromGroupId: input.derivedFromGroupId,
    derivedFromLabelId: input.derivedFromLabelId,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function buildVariation(input: {
  conceptId: string;
  sourceType: 'card' | 'source_segment' | 'free_text';
  sourceId?: string;
  selectedTextSnapshot?: string;
  interpretation?: string;
  role?: MGtaVariationRole;
  now: string;
}): MGtaVariation {
  if (input.sourceType !== 'free_text' && !input.sourceId) {
    throw new MGtaError('カード/原文ヴァリエーションには sourceId が必要です');
  }
  return {
    id: newId(),
    conceptId: input.conceptId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    selectedTextSnapshot: input.selectedTextSnapshot,
    interpretation: input.interpretation,
    role: input.role ?? 'variation',
    createdAt: input.now,
  };
}

export function buildMGtaCategory(input: {
  name: string;
  definition?: string;
  parentCategoryId?: string;
  now: string;
}): MGtaCategory {
  return {
    id: newId(),
    name: input.name.trim(),
    definition: input.definition,
    parentCategoryId: input.parentCategoryId,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function buildTheoreticalMemo(input: {
  methodKind: 'm_gta' | 'gta' | 'common';
  targetType: TheoreticalMemo['targetType'];
  targetId?: string;
  memoType: TheoreticalMemoType;
  title?: string;
  body: string;
  now: string;
}): TheoreticalMemo {
  return {
    id: newId(),
    methodKind: input.methodKind,
    targetType: input.targetType,
    targetId: input.targetId,
    memoType: input.memoType,
    title: input.title,
    body: input.body,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export interface BuildConceptFromGroupInput {
  groupId: string;
  settingsId: string;
  conceptName?: string;
  definition?: string;
  includeMemberCards: boolean;
  includeLabelAsDefinition: boolean;
  now: string;
}

export interface BuildConceptFromGroupOutput {
  concept: MGtaConcept;
  variations: MGtaVariation[];
}

export function buildConceptFromGroup(
  data: ProjectData,
  input: BuildConceptFromGroupInput
): BuildConceptFromGroupOutput {
  const group = data.groups.find((g) => g.id === input.groupId);
  if (!group) throw new MGtaError('グループが見つかりません');
  const label = data.labels.find((l) => l.groupId === input.groupId);
  const conceptName =
    (input.conceptName && input.conceptName.trim()) ||
    (label?.text && label.text.trim()) ||
    group.name;
  const definition =
    (input.definition && input.definition.trim()) ||
    (input.includeLabelAsDefinition && label?.sharedMemo
      ? label.sharedMemo
      : input.includeLabelAsDefinition && label?.basisMemo
        ? label.basisMemo
        : '');
  const concept = buildConcept({
    settingsId: input.settingsId,
    name: conceptName,
    definition,
    derivedFromGroupId: input.groupId,
    derivedFromLabelId: label?.id,
    now: input.now,
  });
  const variations: MGtaVariation[] = [];
  if (input.includeMemberCards) {
    const memberCardIds = data.group_memberships
      .filter((m) => m.groupId === input.groupId)
      .map((m) => m.cardId);
    for (const cid of memberCardIds) {
      const card = data.cards.find((c) => c.id === cid);
      if (!card) continue;
      variations.push(
        buildVariation({
          conceptId: concept.id,
          sourceType: 'card',
          sourceId: card.id,
          selectedTextSnapshot: card.body,
          role: 'variation',
          now: input.now,
        })
      );
    }
  }
  return { concept, variations };
}

export interface BuildConceptFromCardsInput {
  cardIds: string[];
  settingsId: string;
  conceptName: string;
  definition?: string;
  role?: MGtaVariationRole;
  now: string;
}

export function buildConceptFromCards(
  data: ProjectData,
  input: BuildConceptFromCardsInput
): BuildConceptFromGroupOutput {
  if (input.cardIds.length === 0) throw new MGtaError('カードを 1 枚以上選んでください');
  const concept = buildConcept({
    settingsId: input.settingsId,
    name: input.conceptName,
    definition: input.definition,
    now: input.now,
  });
  const variations: MGtaVariation[] = [];
  for (const cid of input.cardIds) {
    const card = data.cards.find((c) => c.id === cid);
    if (!card) continue;
    variations.push(
      buildVariation({
        conceptId: concept.id,
        sourceType: 'card',
        sourceId: card.id,
        selectedTextSnapshot: card.body,
        role: input.role ?? 'variation',
        now: input.now,
      })
    );
  }
  return { concept, variations };
}

export function getVariationsForConcept(
  data: ProjectData,
  conceptId: string
): MGtaVariation[] {
  return data.m_gta_variations.filter((v) => v.conceptId === conceptId);
}

export function getConceptsForCategory(
  data: ProjectData,
  categoryId: string | null
): MGtaConcept[] {
  if (categoryId === null) {
    return data.m_gta_concepts.filter((c) => !c.categoryId);
  }
  return data.m_gta_concepts.filter((c) => c.categoryId === categoryId);
}
