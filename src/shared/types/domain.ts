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
  /** For merged cards: a full snapshot of the source cards (and their links,
   * positions, memberships) captured at merge time, so the merge can be undone
   * at any time via "統合を解除" (not just in-session Undo).  Absent for normal
   * cards and for pre-0.2.25 merged cards (those remain Undo-only). */
  mergedSnapshot?: MergedCardSnapshot;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

/** Reversal payload for a card merge: everything needed to restore the
 * pre-merge state. */
export interface MergedCardSnapshot {
  cards: Card[];
  links: CardSourceLink[];
  positions: CardPosition[];
  memberships: GroupMembership[];
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
  /** Stacking order among overlapping cards. Higher = front. Absent = 0
   * (back-compat: pre-0.2.25 data renders identically). */
  z?: number;
}

export interface Group {
  id: string;
  name: string;
  level: number;
  parentGroupId: string | null;
  collapsed: boolean;
  /** Inline display overrides (font, color, etc.). */
  displayStyle?: DisplayStyle;
  /** Per-group narrative for the B 型叙述化 step of KJ method (田中 2011 / 川喜田 1986). */
  narrative?: string;
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
  | 'subsumes'
  | 'exemplifies'
  | 'refutes'
  | 'complements'
  | 'opposes'
  | 'parallels'
  | 'causes'
  | 'results_in'
  | 'presupposes'
  | 'conditions'
  | 'synonymous'
  | 'similar'
  | 'influences'
  | 'defines'
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
  /** KJ 法 1986/1997 版「A 型図解化」専用のデータ (schema v9 で追加)．
   *  存在しない場合は空 (`createEmptyFinalDiagram()`) として扱う．
   *  data 配下に置くことで，DomainCommand での undo/redo に乗る． */
  final_diagram?: FinalDiagram;
}

export interface DisplaySettings {
  cardMaxChars?: number;
  cardWrapWidth?: number;
  cardFontSize?: number;
  groupFontSize?: number;
  /** KJ キャンバスの地の色．未指定なら白 (#ffffff)． */
  canvasBackground?: string;
  /** グループ化時にメンバーカードを自動でグリッド整列する．未指定は ON 扱い． */
  autoPackOnGroup?: boolean;
  /** 自動整列の方向．'cols' = 列数を基準, 'rows' = 行数を基準．既定 'cols'． */
  autoPackOrientation?: 'cols' | 'rows';
  /** 列数 (cols) または行数 (rows) の固定値．未指定なら √n の自動決定． */
  autoPackCount?: number;
}

export interface ProjectMetadata {
  project_id: string;
  name: string;
  created_at: ISODateString;
  updated_at: ISODateString;
  description: string;
  displaySettings?: DisplaySettings;
}

// ---- Final KJ diagram (schema v9) ----
// 川喜田 1986/1997 版の A 型図解化 (元ラベル添付→島どり→島間関連付け→シンボル→
// 表題・註記) を，KJ canvas と独立した最終図解ビューで扱うためのデータ。
// 配置は KJ canvas の group_positions と独立 (この最終図解だけ自由に動かせる)。

/** 図形パレットから配置する標準シンボルの種類。
 *  - DiagramRelationType 14 種 (因果/対立/包含/同質 等．川喜田 1997 図 1 を参照)
 *  - 装飾形状 (円 / 矩形 / 雲 / 角括弧 / 単独矢印 / テキスト) */
export type FinalDiagramShapeKind =
  | DiagramRelationType
  | 'circle'
  | 'rect'
  | 'cloud'
  | 'bracket'
  | 'arrow_standalone'
  | 'text';

export interface FinalDiagramShape {
  id: string;
  kind: FinalDiagramShapeKind;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 回転角度 (度). 0 = 通常向き. */
  rotation: number;
  /** 図形の上に重ねるラベル. */
  label?: string;
  /** 既定は kind 由来 (関係種別なら RELATION_TYPE_COLORS[kind]). */
  color?: string;
  /** 任意で「特定グループに紐づく注釈」として扱える. null = 独立. */
  anchorGroupId?: string | null;
  /** 描画順 (z-index 相当). 大きいほど手前. */
  z?: number;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface FinalDiagramAnnotation {
  /** 作成日 (YYYY-MM-DD 等の文字列でよい). */
  date?: string;
  /** 作成場所. */
  place?: string;
  /** データ出所. */
  source?: string;
  /** 作成者 (複数なら "山田, 鈴木" 等). */
  authors?: string;
}

export interface FinalDiagram {
  /** 図解全体の表題. */
  title?: string;
  /** 図解の右下に添える註記 (作成日/場所/出所/作成者). */
  annotation?: FinalDiagramAnnotation;
  /** 最終図解専用の Group 配置 (KJ canvas とは独立).
   *  キー: Group.id. 空オブジェクトの時は KJ canvas の group_positions から初期化される. */
  groupLayout: Record<string, { x: number; y: number; width?: number; height?: number }>;
  /** 図形パレットから配置したシンボル. */
  shapes: FinalDiagramShape[];
  /** 全体の叙述メモ (Group 個別の narrative とは別に，図解全体の総括). */
  overallNarrative?: string;
}
