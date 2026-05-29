export type ISODateString = string;

export type CardStatus = 'active';

/** Optional inline style applied to a node (card / group).  All fields optional. */
export interface DisplayStyle {
  fontSize?: number;
  fontWeight?: 'normal' | 'bold';
  color?: string;
  background?: string;
  borderColor?: string;
  /** CSS border width in px. */
  borderWidth?: number;
  borderStyle?: 'solid' | 'dashed' | 'dotted';
}

/** Where a card currently lives.  'canvas' = visible on the React Flow board.
 * 'unclassified' = newly created, waiting to be placed.
 * 'pending' = explicitly held off by the analyst for later decision. */
export type CardPlacement = 'canvas' | 'unclassified' | 'pending';

export interface Participant {
  id: string;
  code: string;
  displayName: string;
  createdAt: ISODateString;
}

export interface SourceSegment {
  id: string;
  participantId: string;
  sourceFile: string;
  importedAt: ISODateString;
  order: number;
  text: string;
  /** Speaker label for the row (e.g. "インタビュアー", "A さん"). Optional —
   * absent for survey-style sources where each row is a different participant. */
  speaker?: string;
  /** Custom user-defined columns (gender, age, duration, etc.) keyed by name. */
  customFields?: Record<string, string>;
  /** When this segment supersedes another, the previous segment's id. null for original imports. */
  previousVersionId: string | null;
  /** Soft-delete marker. null means alive. */
  deletedAt: ISODateString | null;
}

export interface Card {
  id: string;
  participantId: string;
  code: string;
  serialNumber: number;
  body: string;
  status: CardStatus;
  /** Optional.  Default 'canvas' when absent (back-compat for pre-Phase 1.5+ data). */
  placement?: CardPlacement;
  /** Analyst's running memo on this card.  Distinct from body. (Legacy single-field.) */
  memo?: string;
  /** Log-style memo entries with timestamps. New writes go here; the legacy
   * `memo` field is preserved for back-compat / search. */
  memoLog?: MemoEntry[];
  /** Free-form tags (multiple allowed). */
  tags?: string[];
  /** Inline display overrides (font, color, etc.). */
  displayStyle?: DisplayStyle;
  /** When true, the card is rendered as ID-only (body hidden) on the canvas. */
  collapsed?: boolean;
  /** (#7) For merged cards: the serial numbers of the source cards this card
   * was created from.  Shown as a provenance sub-label (e.g. "← 003,005").
   * Absent for normal (non-merged) cards. */
  mergedFrom?: number[];
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface CardSourceLink {
  id: string;
  cardId: string;
  segmentId: string;
  startOffset: number;
  endOffset: number;
  selectedTextSnapshot: string;
  createdAt: ISODateString;
}

export interface CardPosition {
  cardId: string;
  x: number;
  y: number;
}

export interface Group {
  id: string;
  name: string;
  level: number;
  parentGroupId: string | null;
  collapsed: boolean;
  /** Inline display overrides (font, color, etc.). */
  displayStyle?: DisplayStyle;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface GroupMembership {
  id: string;
  cardId: string;
  groupId: string;
  createdAt: ISODateString;
}

export interface Label {
  id: string;
  groupId: string;
  text: string;
  sharedMemo: string;
  basisMemo: string;
  holdMemo: string;
  /** Per-field log of appended entries (shared / basis / hold). Optional. */
  memoLogs?: Partial<Record<'sharedMemo' | 'basisMemo' | 'holdMemo', MemoEntry[]>>;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface MemoEntry {
  id: string;
  text: string;
  timestamp: ISODateString;
}

export interface GroupPosition {
  groupId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type TextRevisionTargetType = 'label';

export type TextRevisionFieldName = 'text' | 'sharedMemo' | 'basisMemo' | 'holdMemo';

export interface TextRevision {
  id: string;
  targetType: TextRevisionTargetType;
  targetId: string;
  fieldName: TextRevisionFieldName;
  beforeText: string;
  afterText: string;
  timestamp: ISODateString;
}

// ---- Phase 1.5: M-GTA / GTA / multi-method analysis extension ----
// データ基盤だけ Phase 1.5a で先行投入．UI（M-GTA モード等）は KJ モード完成後に実装する．

export type AnalysisMethodKind = 'kj' | 'm_gta' | 'gta' | 'thematic' | 'scat' | 'custom';

export interface AnalysisMethod {
  id: string;
  kind: AnalysisMethodKind;
  name: string;
  description?: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface AnalysisSession {
  id: string;
  name: string;
  methodId?: string;
  boardId?: string;
  startedAt: ISODateString;
  endedAt?: ISODateString;
  participants: string[];
  summary?: string;
  memo?: string;
  snapshotId?: string;
}

export type AnalyticLinkFromType =
  | 'card'
  | 'group'
  | 'label'
  | 'source_segment'
  | 'concept'
  | 'code'
  | 'category';
export type AnalyticLinkToType =
  | 'concept'
  | 'code'
  | 'category'
  | 'memo'
  | 'diagram_node';
export type AnalyticRelationType =
  | 'evidence_for'
  | 'variation_of'
  | 'example_of'
  | 'counterexample_of'
  | 'derived_from'
  | 'converted_from'
  | 'refers_to'
  | 'supports'
  | 'questions'
  | 'rejects';

export interface AnalyticObjectLink {
  id: string;
  fromType: AnalyticLinkFromType;
  fromId: string;
  toType: AnalyticLinkToType;
  toId: string;
  relationType: AnalyticRelationType;
  note?: string;
  createdBy?: string;
  createdAt: ISODateString;
}

export interface MGtaSettings {
  id: string;
  boardId?: string;
  analysisTheme: string;
  focalPerson: string;
  researchQuestion?: string;
  notes?: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export type MGtaConceptStatus =
  | 'draft'
  | 'active'
  | 'reviewed'
  | 'merged'
  | 'rejected'
  | 'archived';

export interface MGtaConcept {
  id: string;
  boardId?: string;
  settingsId: string;
  name: string;
  definition: string;
  status: MGtaConceptStatus;
  categoryId?: string;
  derivedFromGroupId?: string;
  derivedFromLabelId?: string;
  createdBy?: string;
  updatedBy?: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export type MGtaVariationRole =
  | 'variation'
  | 'similar_example'
  | 'opposite_example'
  | 'negative_case'
  | 'memo_only';

export type MGtaVariationSourceType = 'card' | 'source_segment' | 'free_text';

export interface MGtaVariation {
  id: string;
  conceptId: string;
  sourceType: MGtaVariationSourceType;
  sourceId?: string;
  selectedTextSnapshot?: string;
  interpretation?: string;
  role: MGtaVariationRole;
  createdBy?: string;
  createdAt: ISODateString;
}

export interface MGtaCategory {
  id: string;
  boardId?: string;
  name: string;
  definition?: string;
  parentCategoryId?: string;
  createdBy?: string;
  updatedBy?: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export type TheoreticalMemoTargetType =
  | 'project'
  | 'board'
  | 'card'
  | 'group'
  | 'label'
  | 'concept'
  | 'category'
  | 'code'
  | 'relation';
export type TheoreticalMemoMethodKind = 'm_gta' | 'gta' | 'common';
export type TheoreticalMemoType =
  | 'idea'
  | 'definition'
  | 'question'
  | 'comparison'
  | 'negative_case'
  | 'sampling'
  | 'saturation'
  | 'decision'
  | 'rejected_interpretation'
  | 'paper_note';

export interface TheoreticalMemo {
  id: string;
  methodKind: TheoreticalMemoMethodKind;
  targetType: TheoreticalMemoTargetType;
  targetId?: string;
  memoType: TheoreticalMemoType;
  title?: string;
  body: string;
  createdBy?: string;
  updatedBy?: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export type DiagramObjectType =
  | 'card'
  | 'group'
  | 'concept'
  | 'category'
  | 'code'
  | 'memo';

export type DiagramRelationType =
  | 'causes'
  | 'promotes'
  | 'inhibits'
  | 'precedes'
  | 'follows'
  | 'contrasts_with'
  | 'supports'
  | 'questions'
  | 'part_of'
  | 'example_of'
  | 'abstracts'
  | 'derived_from'
  | 'co_occurs_with'
  | 'custom';

// ---- GTA tables (Phase 1.5c) ----

export type GtaCodeType =
  | 'open'
  | 'in_vivo'
  | 'focused'
  | 'axial'
  | 'selective'
  | 'custom';

export type GtaCodeStatus =
  | 'draft'
  | 'active'
  | 'reviewed'
  | 'merged'
  | 'archived'
  | 'rejected';

export interface GtaCode {
  id: string;
  boardId?: string;
  name: string;
  definition?: string;
  codeType: GtaCodeType;
  parentCodeId?: string;
  categoryId?: string;
  status: GtaCodeStatus;
  createdBy?: string;
  updatedBy?: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export type GtaCodeApplicationTargetType = 'source_segment' | 'card' | 'selected_range';

export interface GtaCodeApplication {
  id: string;
  codeId: string;
  targetType: GtaCodeApplicationTargetType;
  targetId: string;
  startOffset?: number;
  endOffset?: number;
  selectedTextSnapshot?: string;
  memo?: string;
  createdBy?: string;
  createdAt: ISODateString;
}

export interface GtaCategory {
  id: string;
  boardId?: string;
  name: string;
  definition?: string;
  parentCategoryId?: string;
  isCoreCategory?: boolean;
  createdBy?: string;
  updatedBy?: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface DiagramRelation {
  id: string;
  boardId?: string;
  diagramId?: string;
  sourceObjectType: DiagramObjectType;
  sourceObjectId: string;
  targetObjectType: DiagramObjectType;
  targetObjectId: string;
  relationType: DiagramRelationType;
  label?: string;
  memoIds: string[];
  createdBy?: string;
  updatedBy?: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface ProjectData {
  participants: Participant[];
  source_segments: SourceSegment[];
  cards: Card[];
  card_source_links: CardSourceLink[];
  card_positions: CardPosition[];
  groups: Group[];
  group_memberships: GroupMembership[];
  labels: Label[];
  group_positions: GroupPosition[];
  text_revisions: TextRevision[];
  analysis_methods: AnalysisMethod[];
  analysis_sessions: AnalysisSession[];
  analytic_object_links: AnalyticObjectLink[];
  m_gta_settings: MGtaSettings[];
  m_gta_concepts: MGtaConcept[];
  m_gta_variations: MGtaVariation[];
  m_gta_categories: MGtaCategory[];
  theoretical_memos: TheoreticalMemo[];
  diagram_relations: DiagramRelation[];
  gta_codes: GtaCode[];
  gta_code_applications: GtaCodeApplication[];
  gta_categories: GtaCategory[];
}

export interface DisplaySettings {
  cardMaxChars?: number;
  cardWrapWidth?: number;
  cardFontSize?: number;
  groupFontSize?: number;
}

export interface ProjectMetadata {
  project_id: string;
  name: string;
  created_at: ISODateString;
  updated_at: ISODateString;
  description: string;
  displaySettings?: DisplaySettings;
}
