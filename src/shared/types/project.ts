import type { ISODateString, ProjectData, ProjectMetadata } from './domain.js';
import { CURRENT_SCHEMA_VERSION, type SchemaVersion } from '../schema/version.js';

export interface ProjectFile {
  schema_version: SchemaVersion;
  app_version: string;
  metadata: ProjectMetadata;
  data: ProjectData;
  /** Frozen full snapshots of past project states. Stored in ZIP under
   * `snapshots/<id>.json` and read into memory on project load. */
  snapshots?: Snapshot[];
}

export interface SnapshotMetadata {
  id: string;
  timestamp: ISODateString;
  /** `manual` is created by the user explicitly; `auto` is rotation-managed. */
  kind: 'manual' | 'auto';
  /** Short user-supplied tag for manual snapshots ("章 1 完了" 等). */
  label?: string;
  /** Free-form note. */
  comment?: string;
}

export interface Snapshot {
  metadata: SnapshotMetadata;
  /** A full ProjectData payload that can replace the current state on restore. */
  data: ProjectData;
}

/** Single source of truth = package.json `version`, injected via Vite `define`. */
export const APP_VERSION = __APP_VERSION__;

export const INITIAL_ANALYSIS_METHODS = [
  { kind: 'kj' as const, name: 'KJ法' },
  { kind: 'm_gta' as const, name: 'M-GTA' },
  { kind: 'gta' as const, name: 'GTA' },
];

/** ProjectData の全配列テーブル名．旧スキーマの .kjproj には後発テーブルの
 * JSON が存在しないため，読込時に backfillProjectData で [] を補う． */
const ALL_TABLE_NAMES = [
  'participants',
  'source_segments',
  'cards',
  'card_source_links',
  'card_positions',
  'groups',
  'group_memberships',
  'labels',
  'group_positions',
  'text_revisions',
  'analysis_methods',
  'analysis_sessions',
  'analytic_object_links',
  'm_gta_settings',
  'm_gta_concepts',
  'm_gta_variations',
  'm_gta_categories',
  'theoretical_memos',
  'diagram_relations',
  'gta_codes',
  'gta_code_applications',
  'gta_categories',
] as const;

/** 旧バージョンで保存されたプロジェクト (後発テーブルのファイルが無い) を
 * 現行スキーマに正規化する．欠損テーブルは空配列で補い，既存データと
 * final_diagram 等の非テーブルフィールドはそのまま保持する．
 * (2026-07 レビュー: 欠損配列への無防備アクセスで白画面クラッシュする
 * バグの恒久対策．読込・スナップショット復元・sync hydrate で通すこと) */
export function backfillProjectData(data: Partial<ProjectData> | undefined | null): ProjectData {
  const src = (data ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = { ...src };
  for (const t of ALL_TABLE_NAMES) {
    if (!Array.isArray(out[t])) out[t] = [];
  }
  return out as unknown as ProjectData;
}

export function makeEmptyProject(name: string, projectId: string, now: string): ProjectFile {
  return {
    schema_version: CURRENT_SCHEMA_VERSION,
    app_version: APP_VERSION,
    metadata: {
      project_id: projectId,
      name,
      created_at: now,
      updated_at: now,
      description: '',
    },
    data: {
      participants: [],
      source_segments: [],
      cards: [],
      card_source_links: [],
      card_positions: [],
      groups: [],
      group_memberships: [],
      labels: [],
      group_positions: [],
      text_revisions: [],
      analysis_methods: INITIAL_ANALYSIS_METHODS.map((m, i) => ({
        id: `method-${m.kind}-${i}`,
        kind: m.kind,
        name: m.name,
        createdAt: now,
        updatedAt: now,
      })),
      analysis_sessions: [],
      analytic_object_links: [],
      m_gta_settings: [],
      m_gta_concepts: [],
      m_gta_variations: [],
      m_gta_categories: [],
      theoretical_memos: [],
      diagram_relations: [],
      gta_codes: [],
      gta_code_applications: [],
      gta_categories: [],
    },
  };
}
