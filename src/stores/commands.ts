import type { MemoEntry, ProjectData } from '@shared/types/domain';
import type {
  Card,
  CardPlacement,
  CardPosition,
  CardSourceLink,
  DiagramRelation,
  DiagramRelationType,
  DisplayStyle,
  GtaCategory,
  GtaCode,
  GtaCodeApplication,
  GtaCodeStatus,
  GtaCodeType,
  Group,
  GroupMembership,
  GroupPosition,
  Label,
  MGtaCategory,
  MGtaConcept,
  MGtaConceptStatus,
  MGtaSettings,
  MGtaVariation,
  Participant,
  SourceSegment,
  TextRevision,
  TextRevisionFieldName,
  TheoreticalMemo,
} from '@shared/types/domain';
import { makeTextRevision } from '../domain/labels.js';

export interface DomainCommand {
  readonly label: string;
  apply(data: ProjectData): ProjectData;
  revert(data: ProjectData): ProjectData;
}

export function makeAddParticipantCommand(participant: Participant): DomainCommand {
  return {
    label: `参加者を追加: ${participant.code}`,
    apply: (d) => ({ ...d, participants: [...d.participants, participant] }),
    revert: (d) => ({
      ...d,
      participants: d.participants.filter((p) => p.id !== participant.id),
    }),
  };
}

// ---- M-GTA commands (Phase 1.5b) ----

export function makeCreateMGtaSettingsCommand(settings: MGtaSettings): DomainCommand {
  return {
    label: `M-GTA 設定作成: ${settings.analysisTheme}`,
    apply: (d) => ({ ...d, m_gta_settings: [...d.m_gta_settings, settings] }),
    revert: (d) => ({
      ...d,
      m_gta_settings: d.m_gta_settings.filter((s) => s.id !== settings.id),
    }),
  };
}

export function makeUpdateMGtaSettingsCommand(
  settingsId: string,
  prev: Partial<MGtaSettings>,
  next: Partial<MGtaSettings> & { now: string }
): DomainCommand {
  return {
    label: `M-GTA 設定更新`,
    apply: (d) => ({
      ...d,
      m_gta_settings: d.m_gta_settings.map((s) =>
        s.id === settingsId
          ? {
              ...s,
              ...stripNow(next),
              updatedAt: next.now,
            }
          : s
      ),
    }),
    revert: (d) => ({
      ...d,
      m_gta_settings: d.m_gta_settings.map((s) =>
        s.id === settingsId ? { ...s, ...prev } : s
      ),
    }),
  };
}

function stripNow<T extends { now?: string }>(o: T): Omit<T, 'now'> {
  const { now: _unused, ...rest } = o;
  void _unused;
  return rest as Omit<T, 'now'>;
}

export function makeCreateConceptCommand(
  concept: MGtaConcept,
  variations: MGtaVariation[] = []
): DomainCommand {
  const variationIds = new Set(variations.map((v) => v.id));
  return {
    label: `概念作成: ${concept.name}`,
    apply: (d) => ({
      ...d,
      m_gta_concepts: [...d.m_gta_concepts, concept],
      m_gta_variations: [...d.m_gta_variations, ...variations],
    }),
    revert: (d) => ({
      ...d,
      m_gta_concepts: d.m_gta_concepts.filter((c) => c.id !== concept.id),
      m_gta_variations: d.m_gta_variations.filter((v) => !variationIds.has(v.id)),
    }),
  };
}

export function makeEditConceptCommand(
  conceptId: string,
  prev: { name: string; definition: string; status: MGtaConceptStatus; categoryId?: string; updatedAt: string },
  next: { name: string; definition: string; status: MGtaConceptStatus; categoryId?: string; now: string }
): DomainCommand {
  return {
    label: `概念編集: ${conceptId}`,
    apply: (d) => ({
      ...d,
      m_gta_concepts: d.m_gta_concepts.map((c) =>
        c.id === conceptId
          ? { ...c, name: next.name, definition: next.definition, status: next.status, categoryId: next.categoryId, updatedAt: next.now }
          : c
      ),
    }),
    revert: (d) => ({
      ...d,
      m_gta_concepts: d.m_gta_concepts.map((c) =>
        c.id === conceptId
          ? { ...c, name: prev.name, definition: prev.definition, status: prev.status, categoryId: prev.categoryId, updatedAt: prev.updatedAt }
          : c
      ),
    }),
  };
}

export function makeDeleteConceptCommand(
  concept: MGtaConcept,
  variations: MGtaVariation[]
): DomainCommand {
  const varIds = new Set(variations.map((v) => v.id));
  return {
    label: `概念削除: ${concept.name}`,
    apply: (d) => ({
      ...d,
      m_gta_concepts: d.m_gta_concepts.filter((c) => c.id !== concept.id),
      m_gta_variations: d.m_gta_variations.filter((v) => !varIds.has(v.id)),
    }),
    revert: (d) => ({
      ...d,
      m_gta_concepts: [...d.m_gta_concepts, concept],
      m_gta_variations: [...d.m_gta_variations, ...variations],
    }),
  };
}

export function makeAddVariationCommand(variation: MGtaVariation): DomainCommand {
  return {
    label: `ヴァリエーション追加: ${variation.conceptId}`,
    apply: (d) => ({ ...d, m_gta_variations: [...d.m_gta_variations, variation] }),
    revert: (d) => ({
      ...d,
      m_gta_variations: d.m_gta_variations.filter((v) => v.id !== variation.id),
    }),
  };
}

export function makeRemoveVariationCommand(variation: MGtaVariation): DomainCommand {
  return {
    label: `ヴァリエーション削除: ${variation.id}`,
    apply: (d) => ({
      ...d,
      m_gta_variations: d.m_gta_variations.filter((v) => v.id !== variation.id),
    }),
    revert: (d) => ({ ...d, m_gta_variations: [...d.m_gta_variations, variation] }),
  };
}

export function makeCreateMGtaCategoryCommand(category: MGtaCategory): DomainCommand {
  return {
    label: `カテゴリー作成: ${category.name}`,
    apply: (d) => ({ ...d, m_gta_categories: [...d.m_gta_categories, category] }),
    revert: (d) => ({
      ...d,
      m_gta_categories: d.m_gta_categories.filter((c) => c.id !== category.id),
    }),
  };
}

export function makeDeleteMGtaCategoryCommand(category: MGtaCategory): DomainCommand {
  return {
    label: `カテゴリー削除: ${category.name}`,
    apply: (d) => ({
      ...d,
      m_gta_categories: d.m_gta_categories.filter((c) => c.id !== category.id),
      m_gta_concepts: d.m_gta_concepts.map((c) =>
        c.categoryId === category.id ? { ...c, categoryId: undefined } : c
      ),
    }),
    revert: (d) => ({
      ...d,
      m_gta_categories: [...d.m_gta_categories, category],
      // Note: concepts whose categoryId was cleared cannot be revived here cleanly;
      // we accept that they remain uncategorised on revert.
    }),
  };
}

export function makeAssignConceptToCategoryCommand(
  conceptId: string,
  prevCategoryId: string | undefined,
  nextCategoryId: string | undefined,
  now: string,
  prevUpdatedAt: string
): DomainCommand {
  return {
    label: `概念をカテゴリーへ: ${conceptId}`,
    apply: (d) => ({
      ...d,
      m_gta_concepts: d.m_gta_concepts.map((c) =>
        c.id === conceptId ? { ...c, categoryId: nextCategoryId, updatedAt: now } : c
      ),
    }),
    revert: (d) => ({
      ...d,
      m_gta_concepts: d.m_gta_concepts.map((c) =>
        c.id === conceptId ? { ...c, categoryId: prevCategoryId, updatedAt: prevUpdatedAt } : c
      ),
    }),
  };
}

export function makeCreateTheoreticalMemoCommand(memo: TheoreticalMemo): DomainCommand {
  return {
    label: `理論的メモ作成: ${memo.id}`,
    apply: (d) => ({ ...d, theoretical_memos: [...d.theoretical_memos, memo] }),
    revert: (d) => ({
      ...d,
      theoretical_memos: d.theoretical_memos.filter((m) => m.id !== memo.id),
    }),
  };
}

export function makeEditTheoreticalMemoCommand(
  memoId: string,
  prev: { title?: string; body: string; updatedAt: string },
  next: { title?: string; body: string; now: string }
): DomainCommand {
  return {
    label: `理論的メモ編集: ${memoId}`,
    apply: (d) => ({
      ...d,
      theoretical_memos: d.theoretical_memos.map((m) =>
        m.id === memoId ? { ...m, title: next.title, body: next.body, updatedAt: next.now } : m
      ),
    }),
    revert: (d) => ({
      ...d,
      theoretical_memos: d.theoretical_memos.map((m) =>
        m.id === memoId ? { ...m, title: prev.title, body: prev.body, updatedAt: prev.updatedAt } : m
      ),
    }),
  };
}

export function makeDeleteTheoreticalMemoCommand(memo: TheoreticalMemo): DomainCommand {
  return {
    label: `理論的メモ削除: ${memo.id}`,
    apply: (d) => ({
      ...d,
      theoretical_memos: d.theoretical_memos.filter((m) => m.id !== memo.id),
    }),
    revert: (d) => ({ ...d, theoretical_memos: [...d.theoretical_memos, memo] }),
  };
}

// ---- GTA commands (Phase 1.5c) ----

export function makeCreateGtaCodeCommand(code: GtaCode): DomainCommand {
  return {
    label: `コード作成: ${code.name}`,
    apply: (d) => ({ ...d, gta_codes: [...d.gta_codes, code] }),
    revert: (d) => ({ ...d, gta_codes: d.gta_codes.filter((c) => c.id !== code.id) }),
  };
}

export function makeEditGtaCodeCommand(
  codeId: string,
  prev: {
    name: string;
    definition?: string;
    codeType: GtaCodeType;
    categoryId?: string;
    status: GtaCodeStatus;
    updatedAt: string;
  },
  next: {
    name: string;
    definition?: string;
    codeType: GtaCodeType;
    categoryId?: string;
    status: GtaCodeStatus;
    now: string;
  }
): DomainCommand {
  return {
    label: `コード編集: ${codeId}`,
    apply: (d) => ({
      ...d,
      gta_codes: d.gta_codes.map((c) =>
        c.id === codeId
          ? {
              ...c,
              name: next.name,
              definition: next.definition,
              codeType: next.codeType,
              categoryId: next.categoryId,
              status: next.status,
              updatedAt: next.now,
            }
          : c
      ),
    }),
    revert: (d) => ({
      ...d,
      gta_codes: d.gta_codes.map((c) =>
        c.id === codeId
          ? {
              ...c,
              name: prev.name,
              definition: prev.definition,
              codeType: prev.codeType,
              categoryId: prev.categoryId,
              status: prev.status,
              updatedAt: prev.updatedAt,
            }
          : c
      ),
    }),
  };
}

export function makeDeleteGtaCodeCommand(
  code: GtaCode,
  applications: GtaCodeApplication[]
): DomainCommand {
  const appIds = new Set(applications.map((a) => a.id));
  return {
    label: `コード削除: ${code.name}`,
    apply: (d) => ({
      ...d,
      gta_codes: d.gta_codes.filter((c) => c.id !== code.id),
      gta_code_applications: d.gta_code_applications.filter((a) => !appIds.has(a.id)),
    }),
    revert: (d) => ({
      ...d,
      gta_codes: [...d.gta_codes, code],
      gta_code_applications: [...d.gta_code_applications, ...applications],
    }),
  };
}

export function makeApplyGtaCodeCommand(application: GtaCodeApplication): DomainCommand {
  return {
    label: `コード付与: ${application.codeId} → ${application.targetId}`,
    apply: (d) => ({
      ...d,
      gta_code_applications: [...d.gta_code_applications, application],
    }),
    revert: (d) => ({
      ...d,
      gta_code_applications: d.gta_code_applications.filter((a) => a.id !== application.id),
    }),
  };
}

export function makeRemoveGtaCodeApplicationCommand(
  application: GtaCodeApplication
): DomainCommand {
  return {
    label: `コード付与削除: ${application.id}`,
    apply: (d) => ({
      ...d,
      gta_code_applications: d.gta_code_applications.filter((a) => a.id !== application.id),
    }),
    revert: (d) => ({
      ...d,
      gta_code_applications: [...d.gta_code_applications, application],
    }),
  };
}

export function makeCreateGtaCategoryCommand(category: GtaCategory): DomainCommand {
  return {
    label: `GTA カテゴリー作成: ${category.name}`,
    apply: (d) => ({ ...d, gta_categories: [...d.gta_categories, category] }),
    revert: (d) => ({
      ...d,
      gta_categories: d.gta_categories.filter((c) => c.id !== category.id),
    }),
  };
}

export function makeDeleteGtaCategoryCommand(category: GtaCategory): DomainCommand {
  return {
    label: `GTA カテゴリー削除: ${category.name}`,
    apply: (d) => ({
      ...d,
      gta_categories: d.gta_categories.filter((c) => c.id !== category.id),
      gta_codes: d.gta_codes.map((c) =>
        c.categoryId === category.id ? { ...c, categoryId: undefined } : c
      ),
    }),
    revert: (d) => ({
      ...d,
      gta_categories: [...d.gta_categories, category],
    }),
  };
}

export function makeCreateRelationCommand(relation: DiagramRelation): DomainCommand {
  return {
    label: `関係作成: ${relation.sourceObjectId} → ${relation.targetObjectId}`,
    apply: (d) => ({
      ...d,
      diagram_relations: [...d.diagram_relations, relation],
    }),
    revert: (d) => ({
      ...d,
      diagram_relations: d.diagram_relations.filter((r) => r.id !== relation.id),
    }),
  };
}

export function makeEditRelationCommand(
  relationId: string,
  prev: { relationType: DiagramRelationType; label?: string },
  next: { relationType: DiagramRelationType; label?: string; now: string }
): DomainCommand {
  return {
    label: `関係編集: ${relationId}`,
    apply: (d) => ({
      ...d,
      diagram_relations: d.diagram_relations.map((r) =>
        r.id === relationId
          ? { ...r, relationType: next.relationType, label: next.label, updatedAt: next.now }
          : r
      ),
    }),
    revert: (d) => ({
      ...d,
      diagram_relations: d.diagram_relations.map((r) =>
        r.id === relationId
          ? { ...r, relationType: prev.relationType, label: prev.label }
          : r
      ),
    }),
  };
}

export function makeDeleteRelationCommand(relation: DiagramRelation): DomainCommand {
  return {
    label: `関係削除: ${relation.id}`,
    apply: (d) => ({
      ...d,
      diagram_relations: d.diagram_relations.filter((r) => r.id !== relation.id),
    }),
    revert: (d) => ({
      ...d,
      diagram_relations: [...d.diagram_relations, relation],
    }),
  };
}

export function makeEditSegmentCommand(
  oldSegment: SourceSegment,
  newSegment: SourceSegment
): DomainCommand {
  return {
    label: `原文編集: ${oldSegment.sourceFile} #${oldSegment.order + 1}`,
    apply: (d) => ({
      ...d,
      source_segments: [...d.source_segments, newSegment],
    }),
    revert: (d) => ({
      ...d,
      source_segments: d.source_segments.filter((s) => s.id !== newSegment.id),
    }),
  };
}

export function makeDeleteSegmentCommand(segmentId: string, now: string): DomainCommand {
  return {
    label: `セグメント削除: ${segmentId}`,
    apply: (d) => ({
      ...d,
      source_segments: d.source_segments.map((s) =>
        s.id === segmentId ? { ...s, deletedAt: now } : s
      ),
    }),
    revert: (d) => ({
      ...d,
      source_segments: d.source_segments.map((s) =>
        s.id === segmentId ? { ...s, deletedAt: null } : s
      ),
    }),
  };
}

/**
 * Bulk soft-delete segments by id (e.g., all rows of one file or a multi-
 * select in the viewer). Each segment's prior deletedAt is preserved so undo
 * restores precisely.
 */
export function makeDeleteSegmentsBulkCommand(
  segmentIds: string[],
  now: string,
  prevDeletedAtById: Record<string, string | null>
): DomainCommand {
  const targets = new Set(segmentIds);
  return {
    label: `セグメント一括削除: ${segmentIds.length} 件`,
    apply: (d) => ({
      ...d,
      source_segments: d.source_segments.map((s) =>
        targets.has(s.id) ? { ...s, deletedAt: now } : s
      ),
    }),
    revert: (d) => ({
      ...d,
      source_segments: d.source_segments.map((s) =>
        targets.has(s.id)
          ? { ...s, deletedAt: prevDeletedAtById[s.id] ?? null }
          : s
      ),
    }),
  };
}

/**
 * (#2) Rename a participant's displayName.  Uniqueness must be checked by the
 * caller before applying (this command does not validate).
 */
export function makeRenameParticipantCommand(
  participantId: string,
  prevName: string,
  nextName: string
): DomainCommand {
  return {
    label: `参加者名変更: ${prevName || '(空)'} → ${nextName}`,
    apply: (d) => ({
      ...d,
      participants: d.participants.map((p) =>
        p.id === participantId ? { ...p, displayName: nextName } : p
      ),
    }),
    revert: (d) => ({
      ...d,
      participants: d.participants.map((p) =>
        p.id === participantId ? { ...p, displayName: prevName } : p
      ),
    }),
  };
}

/**
 * (#1) Delete a whole imported file: soft-delete its segments AND remove any
 * participants that become orphaned (no remaining active segments and no
 * cards).  Caller computes `orphanedParticipants`.  Undo restores both.
 */
export function makeDeleteFileCommand(
  segmentIds: string[],
  now: string,
  prevDeletedAtById: Record<string, string | null>,
  orphanedParticipants: Participant[]
): DomainCommand {
  const targets = new Set(segmentIds);
  const orphanIds = new Set(orphanedParticipants.map((p) => p.id));
  const partLabel =
    orphanedParticipants.length > 0 ? ` + ${orphanedParticipants.length} 参加者` : '';
  return {
    label: `ファイル削除: ${segmentIds.length} セグメント${partLabel}`,
    apply: (d) => ({
      ...d,
      source_segments: d.source_segments.map((s) =>
        targets.has(s.id) ? { ...s, deletedAt: now } : s
      ),
      participants:
        orphanIds.size > 0
          ? d.participants.filter((p) => !orphanIds.has(p.id))
          : d.participants,
    }),
    revert: (d) => ({
      ...d,
      source_segments: d.source_segments.map((s) =>
        targets.has(s.id) ? { ...s, deletedAt: prevDeletedAtById[s.id] ?? null } : s
      ),
      participants:
        orphanedParticipants.length > 0
          ? [...d.participants, ...orphanedParticipants]
          : d.participants,
    }),
  };
}

/**
 * Set/clear the speaker label on a segment. Pure in-place mutation,
 * no versioning (cheap edit).
 */
export function makeSetSegmentSpeakerCommand(
  segmentId: string,
  prev: string | undefined,
  next: string | undefined
): DomainCommand {
  return {
    label: `話者編集: ${segmentId}`,
    apply: (d) => ({
      ...d,
      source_segments: d.source_segments.map((s) =>
        s.id === segmentId ? { ...s, speaker: next || undefined } : s
      ),
    }),
    revert: (d) => ({
      ...d,
      source_segments: d.source_segments.map((s) =>
        s.id === segmentId ? { ...s, speaker: prev || undefined } : s
      ),
    }),
  };
}

export function makeInsertSegmentCommand(segment: SourceSegment): DomainCommand {
  return {
    label: `セグメント追加: ${segment.sourceFile} (order ${segment.order})`,
    apply: (d) => ({
      ...d,
      source_segments: [...d.source_segments, segment],
    }),
    revert: (d) => ({
      ...d,
      source_segments: d.source_segments.filter((s) => s.id !== segment.id),
    }),
  };
}

export function makeRelinkCardLinkCommand(
  linkId: string,
  prev: { segmentId: string; startOffset: number; endOffset: number },
  next: { segmentId: string; startOffset: number; endOffset: number }
): DomainCommand {
  return {
    label: `リンク更新: ${linkId}`,
    apply: (d) => ({
      ...d,
      card_source_links: d.card_source_links.map((l) =>
        l.id === linkId
          ? { ...l, segmentId: next.segmentId, startOffset: next.startOffset, endOffset: next.endOffset }
          : l
      ),
    }),
    revert: (d) => ({
      ...d,
      card_source_links: d.card_source_links.map((l) =>
        l.id === linkId
          ? { ...l, segmentId: prev.segmentId, startOffset: prev.startOffset, endOffset: prev.endOffset }
          : l
      ),
    }),
  };
}

export function makeImportSegmentsCommand(segments: SourceSegment[]): DomainCommand {
  const ids = new Set(segments.map((s) => s.id));
  return {
    label: `セグメントを取り込み (${segments.length} 件)`,
    apply: (d) => ({ ...d, source_segments: [...d.source_segments, ...segments] }),
    revert: (d) => ({
      ...d,
      source_segments: d.source_segments.filter((s) => !ids.has(s.id)),
    }),
  };
}

export interface BulkImportInput {
  participants: Participant[];
  segments: SourceSegment[];
  cards: Card[];
  cardLinks: CardSourceLink[];
  cardPositions: CardPosition[];
}

/** Single-undo bulk import: participants + segments + auto-cards in one step. */
export function makeBulkImportCommand(input: BulkImportInput): DomainCommand {
  const participantIds = new Set(input.participants.map((p) => p.id));
  const segIds = new Set(input.segments.map((s) => s.id));
  const cardIds = new Set(input.cards.map((c) => c.id));
  const linkIds = new Set(input.cardLinks.map((l) => l.id));
  const label = [
    `セグメント ${input.segments.length} 件`,
    input.participants.length > 0 ? `参加者 ${input.participants.length} 名` : null,
    input.cards.length > 0 ? `カード ${input.cards.length} 枚` : null,
  ]
    .filter(Boolean)
    .join(' / ');
  return {
    label: `一括取り込み: ${label}`,
    apply: (d) => ({
      ...d,
      participants: [...d.participants, ...input.participants],
      source_segments: [...d.source_segments, ...input.segments],
      cards: [...d.cards, ...input.cards],
      card_source_links: [...d.card_source_links, ...input.cardLinks],
      card_positions: [...d.card_positions, ...input.cardPositions],
    }),
    revert: (d) => ({
      ...d,
      participants: d.participants.filter((p) => !participantIds.has(p.id)),
      source_segments: d.source_segments.filter((s) => !segIds.has(s.id)),
      cards: d.cards.filter((c) => !cardIds.has(c.id)),
      card_source_links: d.card_source_links.filter((l) => !linkIds.has(l.id)),
      card_positions: d.card_positions.filter((p) => !cardIds.has(p.cardId)),
    }),
  };
}

export function makeCreateCardCommand(
  card: Card,
  links: CardSourceLink[],
  position: CardPosition
): DomainCommand {
  const linkIds = new Set(links.map((l) => l.id));
  return {
    label: `カード化: ${card.code}`,
    apply: (d) => ({
      ...d,
      cards: [...d.cards, card],
      card_source_links: [...d.card_source_links, ...links],
      card_positions: [...d.card_positions, position],
    }),
    revert: (d) => ({
      ...d,
      cards: d.cards.filter((c) => c.id !== card.id),
      card_source_links: d.card_source_links.filter((l) => !linkIds.has(l.id)),
      card_positions: d.card_positions.filter((p) => p.cardId !== card.id),
    }),
  };
}

export interface BatchedCardCreate {
  card: Card;
  links: CardSourceLink[];
  position: CardPosition;
}

export function makeCreateCardsCommand(items: BatchedCardCreate[]): DomainCommand {
  const cardIdSet = new Set(items.map((it) => it.card.id));
  const allLinks = items.flatMap((it) => it.links);
  const allLinkIds = new Set(allLinks.map((l) => l.id));
  const allPositions = items.map((it) => it.position);
  const allCards = items.map((it) => it.card);
  return {
    label: `カード化 (一括 ${items.length} 枚)`,
    apply: (d) => ({
      ...d,
      cards: [...d.cards, ...allCards],
      card_source_links: [...d.card_source_links, ...allLinks],
      card_positions: [...d.card_positions, ...allPositions],
    }),
    revert: (d) => ({
      ...d,
      cards: d.cards.filter((c) => !cardIdSet.has(c.id)),
      card_source_links: d.card_source_links.filter((l) => !allLinkIds.has(l.id)),
      card_positions: d.card_positions.filter((p) => !cardIdSet.has(p.cardId)),
    }),
  };
}

/** Free card = no source_link, used for fieldwork-style notes.
 *  If `newParticipant` is provided, it's also inserted (first-ever free card
 *  in this project triggers creation of the "(自由メモ)" pseudo-participant). */
export function makeCreateFreeCardCommand(
  card: Card,
  position: CardPosition,
  newParticipant: Participant | null
): DomainCommand {
  return {
    label: `カード作成: ${card.code}`,
    apply: (d) => ({
      ...d,
      participants: newParticipant
        ? [...d.participants, newParticipant]
        : d.participants,
      cards: [...d.cards, card],
      card_positions: [...d.card_positions, position],
    }),
    revert: (d) => ({
      ...d,
      participants: newParticipant
        ? d.participants.filter((p) => p.id !== newParticipant.id)
        : d.participants,
      cards: d.cards.filter((c) => c.id !== card.id),
      card_positions: d.card_positions.filter((p) => p.cardId !== card.id),
    }),
  };
}

export interface MergeCommandInput {
  newCard: Card;
  newLinks: CardSourceLink[];
  newPosition: CardPosition;
  newMembership: GroupMembership | null;
  oldCards: Card[];
  oldLinks: CardSourceLink[];
  oldPositions: CardPosition[];
  oldMemberships: GroupMembership[];
}

export interface SplitCommandInput {
  oldCard: Card;
  oldLinks: CardSourceLink[];
  oldPosition: CardPosition | null;
  oldMembership: GroupMembership | null;
  newCards: Card[];
  newLinks: CardSourceLink[];
  newPositions: CardPosition[];
  newMemberships: GroupMembership[];
}

export function makeSplitCardCommand(input: SplitCommandInput): DomainCommand {
  const newCardIds = new Set(input.newCards.map((c) => c.id));
  const newLinkIds = new Set(input.newLinks.map((l) => l.id));
  const newPosCardIds = new Set(input.newPositions.map((p) => p.cardId));
  const newMembershipIds = new Set(input.newMemberships.map((m) => m.id));
  const oldLinkIds = new Set(input.oldLinks.map((l) => l.id));
  return {
    label: `カード分割: ${input.oldCard.code} → ${input.newCards.length} 枚`,
    apply: (d) => ({
      ...d,
      cards: [...d.cards.filter((c) => c.id !== input.oldCard.id), ...input.newCards],
      card_source_links: [
        ...d.card_source_links.filter((l) => !oldLinkIds.has(l.id)),
        ...input.newLinks,
      ],
      card_positions: [
        ...d.card_positions.filter((p) => p.cardId !== input.oldCard.id),
        ...input.newPositions,
      ],
      group_memberships: [
        ...d.group_memberships.filter((m) =>
          input.oldMembership ? m.id !== input.oldMembership.id : true
        ),
        ...input.newMemberships,
      ],
    }),
    revert: (d) => ({
      ...d,
      cards: [...d.cards.filter((c) => !newCardIds.has(c.id)), input.oldCard],
      card_source_links: [
        ...d.card_source_links.filter((l) => !newLinkIds.has(l.id)),
        ...input.oldLinks,
      ],
      card_positions: [
        ...d.card_positions.filter((p) => !newPosCardIds.has(p.cardId)),
        ...(input.oldPosition ? [input.oldPosition] : []),
      ],
      group_memberships: [
        ...d.group_memberships.filter((m) => !newMembershipIds.has(m.id)),
        ...(input.oldMembership ? [input.oldMembership] : []),
      ],
    }),
  };
}

export function makeMergeCardsCommand(input: MergeCommandInput): DomainCommand {
  const oldCardIds = new Set(input.oldCards.map((c) => c.id));
  const oldLinkIds = new Set(input.oldLinks.map((l) => l.id));
  const oldPositionIds = new Set(input.oldPositions.map((p) => p.cardId));
  const oldMembershipIds = new Set(input.oldMemberships.map((m) => m.id));
  const newLinkIds = new Set(input.newLinks.map((l) => l.id));
  return {
    label: `カード結合: ${input.oldCards.length} → ${input.newCard.code}`,
    apply: (d) => ({
      ...d,
      cards: [...d.cards.filter((c) => !oldCardIds.has(c.id)), input.newCard],
      card_source_links: [
        ...d.card_source_links.filter((l) => !oldLinkIds.has(l.id)),
        ...input.newLinks,
      ],
      card_positions: [
        ...d.card_positions.filter((p) => !oldPositionIds.has(p.cardId)),
        input.newPosition,
      ],
      group_memberships: [
        ...d.group_memberships.filter((m) => !oldMembershipIds.has(m.id)),
        ...(input.newMembership ? [input.newMembership] : []),
      ],
    }),
    revert: (d) => ({
      ...d,
      cards: [...d.cards.filter((c) => c.id !== input.newCard.id), ...input.oldCards],
      card_source_links: [
        ...d.card_source_links.filter((l) => !newLinkIds.has(l.id)),
        ...input.oldLinks,
      ],
      card_positions: [
        ...d.card_positions.filter((p) => p.cardId !== input.newCard.id),
        ...input.oldPositions,
      ],
      group_memberships: [
        ...d.group_memberships.filter((m) =>
          input.newMembership ? m.id !== input.newMembership.id : true
        ),
        ...input.oldMemberships,
      ],
    }),
  };
}

export function makeEditCardBodyCommand(
  cardId: string,
  prevBody: string,
  nextBody: string,
  now: string,
  prevUpdatedAt: string
): DomainCommand {
  return {
    label: `カード本文編集: ${cardId}`,
    apply: (d) => ({
      ...d,
      cards: d.cards.map((c) =>
        c.id === cardId ? { ...c, body: nextBody, updatedAt: now } : c
      ),
    }),
    revert: (d) => ({
      ...d,
      cards: d.cards.map((c) =>
        c.id === cardId ? { ...c, body: prevBody, updatedAt: prevUpdatedAt } : c
      ),
    }),
  };
}

export interface BulkReplaceEdit {
  kind:
    | 'card_body'
    | 'card_memo'
    | 'label_text'
    | 'label_sharedMemo'
    | 'label_basisMemo'
    | 'label_holdMemo';
  recordId: string;
  prevValue: string;
  nextValue: string;
}

export function makeBulkReplaceCommand(
  edits: BulkReplaceEdit[],
  now: string
): DomainCommand {
  const byCard = new Map<string, BulkReplaceEdit[]>();
  const byLabel = new Map<string, BulkReplaceEdit[]>();
  for (const e of edits) {
    const target = e.kind.startsWith('card_') ? byCard : byLabel;
    if (!target.has(e.recordId)) target.set(e.recordId, []);
    target.get(e.recordId)!.push(e);
  }
  return {
    label: `一括置換: ${edits.length} フィールド`,
    apply: (d) => ({
      ...d,
      cards: d.cards.map((c) => {
        const es = byCard.get(c.id);
        if (!es) return c;
        const next: typeof c = { ...c, updatedAt: now };
        for (const e of es) {
          if (e.kind === 'card_body') next.body = e.nextValue;
          else if (e.kind === 'card_memo') next.memo = e.nextValue;
        }
        return next;
      }),
      labels: d.labels.map((l) => {
        const es = byLabel.get(l.id);
        if (!es) return l;
        const next: typeof l = { ...l, updatedAt: now };
        for (const e of es) {
          if (e.kind === 'label_text') next.text = e.nextValue;
          else if (e.kind === 'label_sharedMemo') next.sharedMemo = e.nextValue;
          else if (e.kind === 'label_basisMemo') next.basisMemo = e.nextValue;
          else if (e.kind === 'label_holdMemo') next.holdMemo = e.nextValue;
        }
        return next;
      }),
    }),
    revert: (d) => ({
      ...d,
      cards: d.cards.map((c) => {
        const es = byCard.get(c.id);
        if (!es) return c;
        const next: typeof c = { ...c };
        for (const e of es) {
          if (e.kind === 'card_body') next.body = e.prevValue;
          else if (e.kind === 'card_memo') next.memo = e.prevValue;
        }
        return next;
      }),
      labels: d.labels.map((l) => {
        const es = byLabel.get(l.id);
        if (!es) return l;
        const next: typeof l = { ...l };
        for (const e of es) {
          if (e.kind === 'label_text') next.text = e.prevValue;
          else if (e.kind === 'label_sharedMemo') next.sharedMemo = e.prevValue;
          else if (e.kind === 'label_basisMemo') next.basisMemo = e.prevValue;
          else if (e.kind === 'label_holdMemo') next.holdMemo = e.prevValue;
        }
        return next;
      }),
    }),
  };
}

export function makeBulkApplyCardStyleCommand(
  cardIds: string[],
  prevStyles: Map<string, DisplayStyle | undefined>,
  nextStyle: DisplayStyle | undefined,
  now: string
): DomainCommand {
  const targets = new Set(cardIds);
  return {
    label: `カードスタイル一括: ${cardIds.length} 件`,
    apply: (d) => ({
      ...d,
      cards: d.cards.map((c) =>
        targets.has(c.id) ? { ...c, displayStyle: nextStyle, updatedAt: now } : c
      ),
    }),
    revert: (d) => ({
      ...d,
      cards: d.cards.map((c) =>
        targets.has(c.id)
          ? { ...c, displayStyle: prevStyles.get(c.id) }
          : c
      ),
    }),
  };
}

export function makeBulkApplyGroupStyleCommand(
  groupIds: string[],
  prevStyles: Map<string, DisplayStyle | undefined>,
  nextStyle: DisplayStyle | undefined,
  now: string
): DomainCommand {
  const targets = new Set(groupIds);
  return {
    label: `グループスタイル一括: ${groupIds.length} 件`,
    apply: (d) => ({
      ...d,
      groups: d.groups.map((g) =>
        targets.has(g.id) ? { ...g, displayStyle: nextStyle, updatedAt: now } : g
      ),
    }),
    revert: (d) => ({
      ...d,
      groups: d.groups.map((g) =>
        targets.has(g.id)
          ? { ...g, displayStyle: prevStyles.get(g.id) }
          : g
      ),
    }),
  };
}

export interface TagBulkEdit {
  cardId: string;
  prevTags: string[] | undefined;
  nextTags: string[] | undefined;
}

export function makeTagBulkEditCommand(
  edits: TagBulkEdit[],
  now: string,
  label: string
): DomainCommand {
  const map = new Map(edits.map((e) => [e.cardId, e]));
  return {
    label,
    apply: (d) => ({
      ...d,
      cards: d.cards.map((c) => {
        const ch = map.get(c.id);
        if (!ch) return c;
        return { ...c, tags: ch.nextTags, updatedAt: now };
      }),
    }),
    revert: (d) => ({
      ...d,
      cards: d.cards.map((c) => {
        const ch = map.get(c.id);
        if (!ch) return c;
        return { ...c, tags: ch.prevTags };
      }),
    }),
  };
}

export function makeEditCardMetaCommand(
  cardId: string,
  prev: { memo?: string; tags?: string[]; updatedAt: string },
  next: { memo?: string; tags?: string[]; now: string }
): DomainCommand {
  return {
    label: `カードメタ編集: ${cardId}`,
    apply: (d) => ({
      ...d,
      cards: d.cards.map((c) =>
        c.id === cardId
          ? { ...c, memo: next.memo, tags: next.tags, updatedAt: next.now }
          : c
      ),
    }),
    revert: (d) => ({
      ...d,
      cards: d.cards.map((c) =>
        c.id === cardId
          ? { ...c, memo: prev.memo, tags: prev.tags, updatedAt: prev.updatedAt }
          : c
      ),
    }),
  };
}

export function makeDeleteCardCommand(
  card: Card,
  links: CardSourceLink[],
  position: CardPosition | null
): DomainCommand {
  const linkIds = new Set(links.map((l) => l.id));
  return {
    label: `カード削除: ${card.code}`,
    apply: (d) => ({
      ...d,
      cards: d.cards.filter((c) => c.id !== card.id),
      card_source_links: d.card_source_links.filter((l) => !linkIds.has(l.id)),
      card_positions: d.card_positions.filter((p) => p.cardId !== card.id),
    }),
    revert: (d) => ({
      ...d,
      cards: [...d.cards, card],
      card_source_links: [...d.card_source_links, ...links],
      card_positions: position ? [...d.card_positions, position] : d.card_positions,
    }),
  };
}

export function makeSetCardPlacementCommand(
  cardId: string,
  prev: { placement?: CardPlacement; position: { x: number; y: number } | null; updatedAt: string },
  next: { placement: CardPlacement; position?: { x: number; y: number }; now: string }
): DomainCommand {
  return {
    label: `カード配置変更: ${cardId} → ${next.placement}`,
    apply: (d) => ({
      ...d,
      cards: d.cards.map((c) =>
        c.id === cardId ? { ...c, placement: next.placement, updatedAt: next.now } : c
      ),
      card_positions:
        next.position && next.placement === 'canvas'
          ? d.card_positions.some((p) => p.cardId === cardId)
            ? d.card_positions.map((p) =>
                p.cardId === cardId ? { ...p, x: next.position!.x, y: next.position!.y } : p
              )
            : [...d.card_positions, { cardId, x: next.position.x, y: next.position.y }]
          : d.card_positions,
    }),
    revert: (d) => ({
      ...d,
      cards: d.cards.map((c) =>
        c.id === cardId ? { ...c, placement: prev.placement, updatedAt: prev.updatedAt } : c
      ),
      card_positions:
        prev.position
          ? d.card_positions.some((p) => p.cardId === cardId)
            ? d.card_positions.map((p) =>
                p.cardId === cardId ? { ...p, x: prev.position!.x, y: prev.position!.y } : p
              )
            : [...d.card_positions, { cardId, x: prev.position.x, y: prev.position.y }]
          : d.card_positions.filter((p) => p.cardId !== cardId || prev.position !== null),
    }),
  };
}

/**
 * Move many cards AND many groups at once (e.g. from an alignment operation
 * that targets a mix of nodes). For each moved group, callers should also
 * include its descendants' moves in `cardMoves` / `groupMoves` so the visual
 * layout follows.
 */
export function makeMoveNodesBulkCommand(
  cardMoves: Array<{
    cardId: string;
    from: { x: number; y: number };
    to: { x: number; y: number };
  }>,
  groupMoves: Array<{
    groupId: string;
    from: { x: number; y: number };
    to: { x: number; y: number };
  }>,
  groupBoundsUpdates: Array<{ prev: GroupPosition; next: GroupPosition }> = []
): DomainCommand {
  const cardFromById = new Map(cardMoves.map((m) => [m.cardId, m.from]));
  const cardToById = new Map(cardMoves.map((m) => [m.cardId, m.to]));
  const groupFromById = new Map(groupMoves.map((m) => [m.groupId, m.from]));
  const groupToById = new Map(groupMoves.map((m) => [m.groupId, m.to]));
  const nextGroupBoundsById = new Map(
    groupBoundsUpdates.map((u) => [u.next.groupId, u.next])
  );
  const prevGroupBoundsById = new Map(
    groupBoundsUpdates.map((u) => [u.prev.groupId, u.prev])
  );
  return {
    label: `カード/グループ一括移動: ${cardMoves.length} + ${groupMoves.length}`,
    apply: (d) => ({
      ...d,
      card_positions: d.card_positions.map((p) => {
        const next = cardToById.get(p.cardId);
        return next ? { ...p, x: next.x, y: next.y } : p;
      }),
      group_positions: d.group_positions.map((p) => {
        const next = groupToById.get(p.groupId);
        if (next) return { ...p, x: next.x, y: next.y };
        // bounds updates only apply to groups NOT directly moved (otherwise
        // the bounds reflect a previous render)
        if (nextGroupBoundsById.has(p.groupId))
          return nextGroupBoundsById.get(p.groupId)!;
        return p;
      }),
    }),
    revert: (d) => ({
      ...d,
      card_positions: d.card_positions.map((p) => {
        const prev = cardFromById.get(p.cardId);
        return prev ? { ...p, x: prev.x, y: prev.y } : p;
      }),
      group_positions: d.group_positions.map((p) => {
        const prev = groupFromById.get(p.groupId);
        if (prev) return { ...p, x: prev.x, y: prev.y };
        if (prevGroupBoundsById.has(p.groupId))
          return prevGroupBoundsById.get(p.groupId)!;
        return p;
      }),
    }),
  };
}

/**
 * Move many cards at once (e.g. from an alignment operation). Each entry
 * carries its prev and next position so Undo restores precisely.
 */
export function makeMoveCardsBulkCommand(
  moves: Array<{ cardId: string; from: { x: number; y: number }; to: { x: number; y: number } }>,
  groupBoundsUpdates: Array<{ prev: GroupPosition; next: GroupPosition }> = []
): DomainCommand {
  const fromById = new Map(moves.map((m) => [m.cardId, m.from]));
  const toById = new Map(moves.map((m) => [m.cardId, m.to]));
  const nextGroupById = new Map(groupBoundsUpdates.map((u) => [u.next.groupId, u.next]));
  const prevGroupById = new Map(groupBoundsUpdates.map((u) => [u.prev.groupId, u.prev]));
  return {
    label: `カード一括移動: ${moves.length} 枚`,
    apply: (d) => ({
      ...d,
      card_positions: d.card_positions.map((p) => {
        const next = toById.get(p.cardId);
        return next ? { ...p, x: next.x, y: next.y } : p;
      }),
      group_positions: d.group_positions.map((p) =>
        nextGroupById.has(p.groupId) ? nextGroupById.get(p.groupId)! : p
      ),
    }),
    revert: (d) => ({
      ...d,
      card_positions: d.card_positions.map((p) => {
        const prev = fromById.get(p.cardId);
        return prev ? { ...p, x: prev.x, y: prev.y } : p;
      }),
      group_positions: d.group_positions.map((p) =>
        prevGroupById.has(p.groupId) ? prevGroupById.get(p.groupId)! : p
      ),
    }),
  };
}

export function makeMoveCardCommand(
  cardId: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
  groupBoundsUpdates: Array<{ prev: GroupPosition; next: GroupPosition }> = []
): DomainCommand {
  const nextById = new Map(groupBoundsUpdates.map((u) => [u.next.groupId, u.next]));
  const prevById = new Map(groupBoundsUpdates.map((u) => [u.prev.groupId, u.prev]));
  return {
    label: `カード移動: ${cardId}`,
    apply: (d) => ({
      ...d,
      card_positions: d.card_positions.map((p) =>
        p.cardId === cardId ? { ...p, x: to.x, y: to.y } : p
      ),
      group_positions: d.group_positions.map((p) =>
        nextById.has(p.groupId) ? nextById.get(p.groupId)! : p
      ),
    }),
    revert: (d) => ({
      ...d,
      card_positions: d.card_positions.map((p) =>
        p.cardId === cardId ? { ...p, x: from.x, y: from.y } : p
      ),
      group_positions: d.group_positions.map((p) =>
        prevById.has(p.groupId) ? prevById.get(p.groupId)! : p
      ),
    }),
  };
}

export function makeCreateGroupCommand(
  group: Group,
  label: Label,
  position: GroupPosition,
  memberships: GroupMembership[],
  replacedMemberships: GroupMembership[] = []
): DomainCommand {
  const newMembershipIds = new Set(memberships.map((m) => m.id));
  const replacedIds = new Set(replacedMemberships.map((m) => m.id));
  return {
    label: `グループ作成: ${group.name}`,
    apply: (d) => ({
      ...d,
      groups: [...d.groups, group],
      labels: [...d.labels, label],
      group_positions: [...d.group_positions, position],
      group_memberships: [
        ...d.group_memberships.filter((m) => !replacedIds.has(m.id)),
        ...memberships,
      ],
    }),
    revert: (d) => ({
      ...d,
      groups: d.groups.filter((g) => g.id !== group.id),
      labels: d.labels.filter((l) => l.id !== label.id),
      group_positions: d.group_positions.filter((p) => p.groupId !== group.id),
      group_memberships: [
        ...d.group_memberships.filter((m) => !newMembershipIds.has(m.id)),
        ...replacedMemberships,
      ],
    }),
  };
}

export function makeDeleteGroupCommand(
  group: Group,
  label: Label | null,
  position: GroupPosition | null,
  memberships: GroupMembership[],
  ancestorBoundsUpdates: Array<{ prev: GroupPosition; next: GroupPosition }> = []
): DomainCommand {
  const membershipIds = new Set(memberships.map((m) => m.id));
  const nextById = new Map(
    ancestorBoundsUpdates.map((u) => [u.next.groupId, u.next])
  );
  const prevById = new Map(
    ancestorBoundsUpdates.map((u) => [u.prev.groupId, u.prev])
  );
  return {
    label: `グループ削除: ${group.name}`,
    apply: (d) => ({
      ...d,
      groups: d.groups.filter((g) => g.id !== group.id),
      labels: d.labels.filter((l) => l.groupId !== group.id),
      group_positions: d.group_positions
        .filter((p) => p.groupId !== group.id)
        .map((p) => (nextById.has(p.groupId) ? nextById.get(p.groupId)! : p)),
      group_memberships: d.group_memberships.filter((m) => !membershipIds.has(m.id)),
    }),
    revert: (d) => ({
      ...d,
      groups: [...d.groups, group],
      labels: label ? [...d.labels, label] : d.labels,
      group_positions: [
        ...(position ? [position] : []),
        ...d.group_positions.map((p) =>
          prevById.has(p.groupId) ? prevById.get(p.groupId)! : p
        ),
      ],
      group_memberships: [...d.group_memberships, ...memberships],
    }),
  };
}

export function makeAssignCardToGroupCommand(
  newMembership: GroupMembership,
  replacedMembership: GroupMembership | null
): DomainCommand {
  return {
    label: `カードをグループへ: ${newMembership.cardId}`,
    apply: (d) => ({
      ...d,
      group_memberships: [
        ...d.group_memberships.filter((m) =>
          replacedMembership ? m.id !== replacedMembership.id : true
        ),
        newMembership,
      ],
    }),
    revert: (d) => ({
      ...d,
      group_memberships: [
        ...d.group_memberships.filter((m) => m.id !== newMembership.id),
        ...(replacedMembership ? [replacedMembership] : []),
      ],
    }),
  };
}

/**
 * Batch-add multiple cards into an existing group, optionally also recomputing
 * the target group's auto-fit bounds. Old memberships of those cards (if any)
 * are passed in `replacedMemberships` so Undo restores them exactly.
 */
export function makeAddCardsToGroupCommand(
  groupId: string,
  newMemberships: GroupMembership[],
  replacedMemberships: GroupMembership[],
  groupBoundsUpdates: Array<{ prev: GroupPosition; next: GroupPosition }> = []
): DomainCommand {
  const newIds = new Set(newMemberships.map((m) => m.id));
  const replacedIds = new Set(replacedMemberships.map((m) => m.id));
  const nextById = new Map(groupBoundsUpdates.map((u) => [u.next.groupId, u.next]));
  const prevById = new Map(groupBoundsUpdates.map((u) => [u.prev.groupId, u.prev]));
  return {
    label: `カードを既存グループへ追加: ${groupId} (+${newMemberships.length})`,
    apply: (d) => ({
      ...d,
      group_memberships: [
        ...d.group_memberships.filter((m) => !replacedIds.has(m.id)),
        ...newMemberships,
      ],
      group_positions: d.group_positions.map((p) =>
        nextById.has(p.groupId) ? nextById.get(p.groupId)! : p
      ),
    }),
    revert: (d) => ({
      ...d,
      group_memberships: [
        ...d.group_memberships.filter((m) => !newIds.has(m.id)),
        ...replacedMemberships,
      ],
      group_positions: d.group_positions.map((p) =>
        prevById.has(p.groupId) ? prevById.get(p.groupId)! : p
      ),
    }),
  };
}

export function makeRemoveCardFromGroupCommand(
  membership: GroupMembership,
  groupBoundsUpdates: Array<{ prev: GroupPosition; next: GroupPosition }> = []
): DomainCommand {
  const nextById = new Map(groupBoundsUpdates.map((u) => [u.next.groupId, u.next]));
  const prevById = new Map(groupBoundsUpdates.map((u) => [u.prev.groupId, u.prev]));
  return {
    label: `カードをグループから外す: ${membership.cardId}`,
    apply: (d) => ({
      ...d,
      group_memberships: d.group_memberships.filter((m) => m.id !== membership.id),
      group_positions: d.group_positions.map((p) =>
        nextById.has(p.groupId) ? nextById.get(p.groupId)! : p
      ),
    }),
    revert: (d) => ({
      ...d,
      group_memberships: [...d.group_memberships, membership],
      group_positions: d.group_positions.map((p) =>
        prevById.has(p.groupId) ? prevById.get(p.groupId)! : p
      ),
    }),
  };
}

/**
 * Set parentGroupId of a single group to null (detach from its parent).
 * Used by the right-click "上位グループから外す" command.
 */
export function makeUnnestGroupCommand(
  groupId: string,
  prevParentId: string | null,
  now: string,
  prevUpdatedAt: string,
  groupBoundsUpdates: Array<{ prev: GroupPosition; next: GroupPosition }> = []
): DomainCommand {
  const nextById = new Map(groupBoundsUpdates.map((u) => [u.next.groupId, u.next]));
  const prevById = new Map(groupBoundsUpdates.map((u) => [u.prev.groupId, u.prev]));
  return {
    label: `上位グループから外す: ${groupId}`,
    apply: (d) => ({
      ...d,
      groups: d.groups.map((g) =>
        g.id === groupId ? { ...g, parentGroupId: null, updatedAt: now } : g
      ),
      group_positions: d.group_positions.map((p) =>
        nextById.has(p.groupId) ? nextById.get(p.groupId)! : p
      ),
    }),
    revert: (d) => ({
      ...d,
      groups: d.groups.map((g) =>
        g.id === groupId
          ? { ...g, parentGroupId: prevParentId, updatedAt: prevUpdatedAt }
          : g
      ),
      group_positions: d.group_positions.map((p) =>
        prevById.has(p.groupId) ? prevById.get(p.groupId)! : p
      ),
    }),
  };
}

/**
 * Set the parentGroupId of existing groups to point to a new parent group.
 * Used when nesting selected groups into a higher-level existing group.
 */
export function makeNestIntoExistingGroupCommand(
  parentGroupId: string,
  childGroupIds: string[],
  prevParentByChild: Record<string, string | null>,
  now: string,
  groupBoundsUpdates: Array<{ prev: GroupPosition; next: GroupPosition }> = []
): DomainCommand {
  const targetIds = new Set(childGroupIds);
  const nextById = new Map(groupBoundsUpdates.map((u) => [u.next.groupId, u.next]));
  const prevById = new Map(groupBoundsUpdates.map((u) => [u.prev.groupId, u.prev]));
  return {
    label: `既存上位グループへネスト: ${parentGroupId} (+${childGroupIds.length})`,
    apply: (d) => ({
      ...d,
      groups: d.groups.map((g) =>
        targetIds.has(g.id) ? { ...g, parentGroupId, updatedAt: now } : g
      ),
      group_positions: d.group_positions.map((p) =>
        nextById.has(p.groupId) ? nextById.get(p.groupId)! : p
      ),
    }),
    revert: (d) => ({
      ...d,
      groups: d.groups.map((g) =>
        targetIds.has(g.id)
          ? { ...g, parentGroupId: prevParentByChild[g.id] ?? null, updatedAt: now }
          : g
      ),
      group_positions: d.group_positions.map((p) =>
        prevById.has(p.groupId) ? prevById.get(p.groupId)! : p
      ),
    }),
  };
}

export function makeMoveGroupCommand(
  groupId: string,
  from: { x: number; y: number },
  to: { x: number; y: number }
): DomainCommand {
  return {
    label: `グループ移動: ${groupId}`,
    apply: (d) => ({
      ...d,
      group_positions: d.group_positions.map((p) =>
        p.groupId === groupId ? { ...p, x: to.x, y: to.y } : p
      ),
    }),
    revert: (d) => ({
      ...d,
      group_positions: d.group_positions.map((p) =>
        p.groupId === groupId ? { ...p, x: from.x, y: from.y } : p
      ),
    }),
  };
}

export interface PositionDelta {
  id: string;
  type: 'card' | 'group';
  from: { x: number; y: number };
  to: { x: number; y: number };
}

export function makeMoveGroupWithChildrenCommand(
  groupId: string,
  groupFrom: { x: number; y: number },
  groupTo: { x: number; y: number },
  childMoves: PositionDelta[],
  ancestorBoundsUpdates: Array<{ prev: GroupPosition; next: GroupPosition }> = []
): DomainCommand {
  const cardMoves = new Map<string, PositionDelta>();
  const groupMoves = new Map<string, PositionDelta>();
  for (const m of childMoves) {
    if (m.type === 'card') cardMoves.set(m.id, m);
    else groupMoves.set(m.id, m);
  }
  const nextById = new Map(ancestorBoundsUpdates.map((u) => [u.next.groupId, u.next]));
  const prevById = new Map(ancestorBoundsUpdates.map((u) => [u.prev.groupId, u.prev]));
  return {
    label: `グループ移動 (連動): ${groupId} (+ ${childMoves.length} 件)`,
    apply: (d) => ({
      ...d,
      group_positions: d.group_positions.map((p) => {
        if (p.groupId === groupId) return { ...p, x: groupTo.x, y: groupTo.y };
        const cg = groupMoves.get(p.groupId);
        if (cg) return { ...p, x: cg.to.x, y: cg.to.y };
        if (nextById.has(p.groupId)) return nextById.get(p.groupId)!;
        return p;
      }),
      card_positions: d.card_positions.map((p) => {
        const c = cardMoves.get(p.cardId);
        if (c) return { ...p, x: c.to.x, y: c.to.y };
        return p;
      }),
    }),
    revert: (d) => ({
      ...d,
      group_positions: d.group_positions.map((p) => {
        if (p.groupId === groupId) return { ...p, x: groupFrom.x, y: groupFrom.y };
        const cg = groupMoves.get(p.groupId);
        if (cg) return { ...p, x: cg.from.x, y: cg.from.y };
        if (prevById.has(p.groupId)) return prevById.get(p.groupId)!;
        return p;
      }),
      card_positions: d.card_positions.map((p) => {
        const c = cardMoves.get(p.cardId);
        if (c) return { ...p, x: c.from.x, y: c.from.y };
        return p;
      }),
    }),
  };
}

export function makeResizeGroupCommand(
  groupId: string,
  from: { x: number; y: number; width: number; height: number },
  to: { x: number; y: number; width: number; height: number },
  ancestorBoundsUpdates: Array<{ prev: GroupPosition; next: GroupPosition }> = []
): DomainCommand {
  const nextById = new Map(
    ancestorBoundsUpdates.map((u) => [u.next.groupId, u.next])
  );
  const prevById = new Map(
    ancestorBoundsUpdates.map((u) => [u.prev.groupId, u.prev])
  );
  return {
    label: `グループサイズ変更: ${groupId}`,
    apply: (d) => ({
      ...d,
      group_positions: d.group_positions.map((p) =>
        p.groupId === groupId
          ? { ...p, x: to.x, y: to.y, width: to.width, height: to.height }
          : nextById.has(p.groupId)
            ? nextById.get(p.groupId)!
            : p
      ),
    }),
    revert: (d) => ({
      ...d,
      group_positions: d.group_positions.map((p) =>
        p.groupId === groupId
          ? { ...p, x: from.x, y: from.y, width: from.width, height: from.height }
          : prevById.has(p.groupId)
            ? prevById.get(p.groupId)!
            : p
      ),
    }),
  };
}

export function makeEditLabelCommand(
  labelId: string,
  field: TextRevisionFieldName,
  prevValue: string,
  nextValue: string,
  now: string,
  prevUpdatedAt: string
): DomainCommand {
  const revision: TextRevision = makeTextRevision(labelId, field, prevValue, nextValue, now);
  return {
    label: `表札編集: ${labelId}/${field}`,
    apply: (d) => ({
      ...d,
      labels: d.labels.map((l) =>
        l.id === labelId ? { ...l, [field]: nextValue, updatedAt: now } : l
      ),
      text_revisions: [...d.text_revisions, revision],
    }),
    revert: (d) => ({
      ...d,
      labels: d.labels.map((l) =>
        l.id === labelId ? { ...l, [field]: prevValue, updatedAt: prevUpdatedAt } : l
      ),
      text_revisions: d.text_revisions.filter((r) => r.id !== revision.id),
    }),
  };
}

export function makeNestGroupsCommand(
  parent: Group,
  parentLabel: Label,
  parentPosition: GroupPosition,
  childGroups: Group[],
  now: string
): DomainCommand {
  const childIds = new Set(childGroups.map((g) => g.id));
  const prevParents = new Map(childGroups.map((g) => [g.id, g.parentGroupId] as const));
  const prevUpdatedAt = new Map(childGroups.map((g) => [g.id, g.updatedAt] as const));
  return {
    label: `親グループ作成: ${parent.name} (${childGroups.length} 子)`,
    apply: (d) => ({
      ...d,
      groups: [
        ...d.groups.map((g) =>
          childIds.has(g.id) ? { ...g, parentGroupId: parent.id, updatedAt: now } : g
        ),
        parent,
      ],
      labels: [...d.labels, parentLabel],
      group_positions: [...d.group_positions, parentPosition],
    }),
    revert: (d) => ({
      ...d,
      groups: d.groups
        .filter((g) => g.id !== parent.id)
        .map((g) =>
          childIds.has(g.id)
            ? {
                ...g,
                parentGroupId: prevParents.get(g.id) ?? null,
                updatedAt: prevUpdatedAt.get(g.id) ?? g.updatedAt,
              }
            : g
        ),
      labels: d.labels.filter((l) => l.id !== parentLabel.id),
      group_positions: d.group_positions.filter((p) => p.groupId !== parent.id),
    }),
  };
}

export function makeToggleGroupCollapsedCommand(
  groupId: string,
  nextCollapsed: boolean,
  now: string,
  prevUpdatedAt: string,
  ancestorBoundsUpdates: Array<{ prev: GroupPosition; next: GroupPosition }> = []
): DomainCommand {
  const nextPosById = new Map(
    ancestorBoundsUpdates.map((u) => [u.next.groupId, u.next])
  );
  const prevPosById = new Map(
    ancestorBoundsUpdates.map((u) => [u.prev.groupId, u.prev])
  );
  return {
    label: `グループ折りたたみ: ${groupId} → ${nextCollapsed}`,
    apply: (d) => ({
      ...d,
      groups: d.groups.map((g) =>
        g.id === groupId ? { ...g, collapsed: nextCollapsed, updatedAt: now } : g
      ),
      group_positions: d.group_positions.map((p) =>
        nextPosById.has(p.groupId) ? nextPosById.get(p.groupId)! : p
      ),
    }),
    revert: (d) => ({
      ...d,
      groups: d.groups.map((g) =>
        g.id === groupId ? { ...g, collapsed: !nextCollapsed, updatedAt: prevUpdatedAt } : g
      ),
      group_positions: d.group_positions.map((p) =>
        prevPosById.has(p.groupId) ? prevPosById.get(p.groupId)! : p
      ),
    }),
  };
}

export function makeAddCardMemoEntryCommand(
  cardId: string,
  entry: MemoEntry,
  now: string,
  prevUpdatedAt: string
): DomainCommand {
  return {
    label: `カードメモ追記: ${cardId}`,
    apply: (d) => ({
      ...d,
      cards: d.cards.map((c) =>
        c.id === cardId
          ? {
              ...c,
              memoLog: [...(c.memoLog ?? []), entry],
              updatedAt: now,
            }
          : c
      ),
    }),
    revert: (d) => ({
      ...d,
      cards: d.cards.map((c) =>
        c.id === cardId
          ? {
              ...c,
              memoLog: (c.memoLog ?? []).filter((m) => m.id !== entry.id),
              updatedAt: prevUpdatedAt,
            }
          : c
      ),
    }),
  };
}

export function makeDeleteCardMemoEntryCommand(
  cardId: string,
  entry: MemoEntry,
  now: string,
  prevUpdatedAt: string
): DomainCommand {
  return {
    label: `カードメモ削除: ${cardId}/${entry.id}`,
    apply: (d) => ({
      ...d,
      cards: d.cards.map((c) =>
        c.id === cardId
          ? {
              ...c,
              memoLog: (c.memoLog ?? []).filter((m) => m.id !== entry.id),
              updatedAt: now,
            }
          : c
      ),
    }),
    revert: (d) => ({
      ...d,
      cards: d.cards.map((c) =>
        c.id === cardId
          ? {
              ...c,
              memoLog: [...(c.memoLog ?? []), entry].sort((a, b) =>
                a.timestamp < b.timestamp ? -1 : 1
              ),
              updatedAt: prevUpdatedAt,
            }
          : c
      ),
    }),
  };
}

type LabelMemoField = 'sharedMemo' | 'basisMemo' | 'holdMemo';

export function makeAddLabelMemoEntryCommand(
  labelId: string,
  field: LabelMemoField,
  entry: MemoEntry,
  now: string,
  prevUpdatedAt: string
): DomainCommand {
  return {
    label: `表札メモ追記: ${labelId}/${field}`,
    apply: (d) => ({
      ...d,
      labels: d.labels.map((l) =>
        l.id === labelId
          ? {
              ...l,
              memoLogs: {
                ...(l.memoLogs ?? {}),
                [field]: [...(l.memoLogs?.[field] ?? []), entry],
              },
              updatedAt: now,
            }
          : l
      ),
    }),
    revert: (d) => ({
      ...d,
      labels: d.labels.map((l) =>
        l.id === labelId
          ? {
              ...l,
              memoLogs: {
                ...(l.memoLogs ?? {}),
                [field]: (l.memoLogs?.[field] ?? []).filter(
                  (m) => m.id !== entry.id
                ),
              },
              updatedAt: prevUpdatedAt,
            }
          : l
      ),
    }),
  };
}

export function makeDeleteLabelMemoEntryCommand(
  labelId: string,
  field: LabelMemoField,
  entry: MemoEntry,
  now: string,
  prevUpdatedAt: string
): DomainCommand {
  return {
    label: `表札メモ削除: ${labelId}/${field}/${entry.id}`,
    apply: (d) => ({
      ...d,
      labels: d.labels.map((l) =>
        l.id === labelId
          ? {
              ...l,
              memoLogs: {
                ...(l.memoLogs ?? {}),
                [field]: (l.memoLogs?.[field] ?? []).filter(
                  (m) => m.id !== entry.id
                ),
              },
              updatedAt: now,
            }
          : l
      ),
    }),
    revert: (d) => ({
      ...d,
      labels: d.labels.map((l) =>
        l.id === labelId
          ? {
              ...l,
              memoLogs: {
                ...(l.memoLogs ?? {}),
                [field]: [...(l.memoLogs?.[field] ?? []), entry].sort((a, b) =>
                  a.timestamp < b.timestamp ? -1 : 1
                ),
              },
              updatedAt: prevUpdatedAt,
            }
          : l
      ),
    }),
  };
}

/**
 * Bulk set the collapsed flag on a list of cards. Stores the previous value
 * per-card so Undo restores the exact prior state.
 */
export function makeSetCardsCollapsedBulkCommand(
  entries: Array<{ cardId: string; prev: boolean; next: boolean }>,
  now: string
): DomainCommand {
  const nextMap = new Map(entries.map((e) => [e.cardId, e.next]));
  const prevMap = new Map(entries.map((e) => [e.cardId, e.prev]));
  return {
    label: `カード一括折りたたみ: ${entries.length} 枚`,
    apply: (d) => ({
      ...d,
      cards: d.cards.map((c) =>
        nextMap.has(c.id) ? { ...c, collapsed: nextMap.get(c.id), updatedAt: now } : c
      ),
    }),
    revert: (d) => ({
      ...d,
      cards: d.cards.map((c) =>
        prevMap.has(c.id)
          ? { ...c, collapsed: prevMap.get(c.id), updatedAt: now }
          : c
      ),
    }),
  };
}

/**
 * Bulk set the collapsed flag on a list of groups. Each group's prior value
 * is preserved for Undo.
 */
export function makeSetGroupsCollapsedBulkCommand(
  entries: Array<{ groupId: string; prev: boolean; next: boolean }>,
  now: string,
  ancestorBoundsUpdates: Array<{ prev: GroupPosition; next: GroupPosition }> = []
): DomainCommand {
  const nextMap = new Map(entries.map((e) => [e.groupId, e.next]));
  const prevMap = new Map(entries.map((e) => [e.groupId, e.prev]));
  const nextPosById = new Map(
    ancestorBoundsUpdates.map((u) => [u.next.groupId, u.next])
  );
  const prevPosById = new Map(
    ancestorBoundsUpdates.map((u) => [u.prev.groupId, u.prev])
  );
  return {
    label: `グループ一括折りたたみ: ${entries.length} 個`,
    apply: (d) => ({
      ...d,
      groups: d.groups.map((g) =>
        nextMap.has(g.id) ? { ...g, collapsed: nextMap.get(g.id)!, updatedAt: now } : g
      ),
      group_positions: d.group_positions.map((p) =>
        nextPosById.has(p.groupId) ? nextPosById.get(p.groupId)! : p
      ),
    }),
    revert: (d) => ({
      ...d,
      groups: d.groups.map((g) =>
        prevMap.has(g.id) ? { ...g, collapsed: prevMap.get(g.id)!, updatedAt: now } : g
      ),
      group_positions: d.group_positions.map((p) =>
        prevPosById.has(p.groupId) ? prevPosById.get(p.groupId)! : p
      ),
    }),
  };
}

export function makeToggleCardCollapsedCommand(
  cardId: string,
  nextCollapsed: boolean,
  now: string,
  prevUpdatedAt: string
): DomainCommand {
  const prevCollapsed = !nextCollapsed;
  return {
    label: `カード折りたたみ: ${cardId} → ${nextCollapsed}`,
    apply: (d) => ({
      ...d,
      cards: d.cards.map((c) =>
        c.id === cardId ? { ...c, collapsed: nextCollapsed, updatedAt: now } : c
      ),
    }),
    revert: (d) => ({
      ...d,
      cards: d.cards.map((c) =>
        c.id === cardId ? { ...c, collapsed: prevCollapsed, updatedAt: prevUpdatedAt } : c
      ),
    }),
  };
}

export function makeRenameGroupCommand(
  groupId: string,
  prevName: string,
  nextName: string,
  now: string,
  prevUpdatedAt: string
): DomainCommand {
  return {
    label: `グループ名変更: ${prevName} -> ${nextName}`,
    apply: (d) => ({
      ...d,
      groups: d.groups.map((g) =>
        g.id === groupId ? { ...g, name: nextName, updatedAt: now } : g
      ),
    }),
    revert: (d) => ({
      ...d,
      groups: d.groups.map((g) =>
        g.id === groupId ? { ...g, name: prevName, updatedAt: prevUpdatedAt } : g
      ),
    }),
  };
}
