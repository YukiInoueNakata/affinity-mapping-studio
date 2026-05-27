import type { ProjectData, ProjectMetadata } from '@shared/types/domain';

export interface ProjectStatistics {
  participants: number;
  source_segments_total: number;
  source_segments_active: number;
  source_segments_superseded: number;
  source_segments_deleted: number;
  cards_total: number;
  cards_canvas: number;
  cards_unclassified: number;
  cards_pending: number;
  groups_total: number;
  groups_by_level: Record<number, number>;
  labels_with_text: number;
  diagram_relations: number;
  m_gta_settings: number;
  m_gta_concepts: number;
  m_gta_variations: number;
  m_gta_categories: number;
  gta_codes: number;
  gta_code_applications: number;
  gta_categories: number;
  theoretical_memos_total: number;
  text_revisions_total: number;
}

export function computeStatistics(data: ProjectData): ProjectStatistics {
  const supersededIds = new Set(
    data.source_segments
      .map((s) => s.previousVersionId)
      .filter((id): id is string => id !== null)
  );
  const segActive = data.source_segments.filter(
    (s) => !s.deletedAt && !supersededIds.has(s.id)
  ).length;
  const segDeleted = data.source_segments.filter((s) => s.deletedAt).length;
  const segSuperseded = supersededIds.size;

  const groupsByLevel: Record<number, number> = {};
  for (const g of data.groups) {
    groupsByLevel[g.level] = (groupsByLevel[g.level] ?? 0) + 1;
  }

  return {
    participants: data.participants.length,
    source_segments_total: data.source_segments.length,
    source_segments_active: segActive,
    source_segments_superseded: segSuperseded,
    source_segments_deleted: segDeleted,
    cards_total: data.cards.length,
    cards_canvas: data.cards.filter((c) => (c.placement ?? 'canvas') === 'canvas').length,
    cards_unclassified: data.cards.filter((c) => c.placement === 'unclassified').length,
    cards_pending: data.cards.filter((c) => c.placement === 'pending').length,
    groups_total: data.groups.length,
    groups_by_level: groupsByLevel,
    labels_with_text: data.labels.filter((l) => l.text.trim().length > 0).length,
    diagram_relations: data.diagram_relations.length,
    m_gta_settings: data.m_gta_settings.length,
    m_gta_concepts: data.m_gta_concepts.length,
    m_gta_variations: data.m_gta_variations.length,
    m_gta_categories: data.m_gta_categories.length,
    gta_codes: data.gta_codes.length,
    gta_code_applications: data.gta_code_applications.length,
    gta_categories: data.gta_categories.length,
    theoretical_memos_total: data.theoretical_memos.length,
    text_revisions_total: data.text_revisions.length,
  };
}

export function statisticsToMarkdown(
  stats: ProjectStatistics,
  metadata: ProjectMetadata
): string {
  const lines: string[] = [];
  lines.push(`# プロジェクト統計: ${metadata.name}`);
  lines.push('');
  lines.push(`- 作成日: ${metadata.created_at.slice(0, 10)}`);
  lines.push(`- 最終更新: ${metadata.updated_at.slice(0, 10)}`);
  if (metadata.description) lines.push(`- 説明: ${metadata.description}`);
  lines.push('');
  lines.push('## データ規模');
  lines.push('');
  lines.push(`- 協力者: ${stats.participants} 名`);
  lines.push(
    `- 原文セグメント: ${stats.source_segments_active} (現行) / ${stats.source_segments_superseded} (置換済) / ${stats.source_segments_deleted} (削除) / 累計 ${stats.source_segments_total}`
  );
  lines.push(
    `- カード: ${stats.cards_total} (キャンバス ${stats.cards_canvas} / 未分類 ${stats.cards_unclassified} / 保留 ${stats.cards_pending})`
  );
  lines.push('');
  lines.push('## KJ 法');
  lines.push('');
  lines.push(`- グループ: ${stats.groups_total}`);
  for (const [lvl, n] of Object.entries(stats.groups_by_level).sort()) {
    lines.push(`  - level ${lvl}: ${n}`);
  }
  lines.push(`- 表札（テキストあり）: ${stats.labels_with_text}`);
  lines.push(`- 関係線: ${stats.diagram_relations}`);
  lines.push('');
  lines.push('## M-GTA');
  lines.push('');
  lines.push(`- 設定数: ${stats.m_gta_settings}`);
  lines.push(`- 概念: ${stats.m_gta_concepts}`);
  lines.push(`- ヴァリエーション: ${stats.m_gta_variations}`);
  lines.push(`- カテゴリー: ${stats.m_gta_categories}`);
  lines.push('');
  lines.push('## GTA');
  lines.push('');
  lines.push(`- コード: ${stats.gta_codes}`);
  lines.push(`- コード付与: ${stats.gta_code_applications}`);
  lines.push(`- カテゴリー: ${stats.gta_categories}`);
  lines.push('');
  lines.push('## 履歴');
  lines.push('');
  lines.push(`- 理論的メモ累計: ${stats.theoretical_memos_total}`);
  lines.push(`- 表札変更履歴: ${stats.text_revisions_total}`);
  return lines.join('\n');
}

export function statisticsToCsv(stats: ProjectStatistics): string {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const rows: Array<[string, string | number]> = [
    ['participants', stats.participants],
    ['source_segments_total', stats.source_segments_total],
    ['source_segments_active', stats.source_segments_active],
    ['source_segments_superseded', stats.source_segments_superseded],
    ['source_segments_deleted', stats.source_segments_deleted],
    ['cards_total', stats.cards_total],
    ['cards_canvas', stats.cards_canvas],
    ['cards_unclassified', stats.cards_unclassified],
    ['cards_pending', stats.cards_pending],
    ['groups_total', stats.groups_total],
    ['labels_with_text', stats.labels_with_text],
    ['diagram_relations', stats.diagram_relations],
    ['m_gta_settings', stats.m_gta_settings],
    ['m_gta_concepts', stats.m_gta_concepts],
    ['m_gta_variations', stats.m_gta_variations],
    ['m_gta_categories', stats.m_gta_categories],
    ['gta_codes', stats.gta_codes],
    ['gta_code_applications', stats.gta_code_applications],
    ['gta_categories', stats.gta_categories],
    ['theoretical_memos_total', stats.theoretical_memos_total],
    ['text_revisions_total', stats.text_revisions_total],
  ];
  for (const [lvl, n] of Object.entries(stats.groups_by_level)) {
    rows.push([`groups_level_${lvl}`, n]);
  }
  return ['metric,value', ...rows.map(([k, v]) => `${esc(k)},${v}`)].join('\n');
}

export interface CommandHistoryEntry {
  index: number;
  label: string;
}

export function operationsToMarkdown(history: CommandHistoryEntry[]): string {
  const lines: string[] = [];
  lines.push('# 操作履歴');
  lines.push('');
  lines.push(`合計操作数: ${history.length}`);
  lines.push('');
  for (const e of history) {
    lines.push(`${e.index + 1}. ${e.label}`);
  }
  return lines.join('\n');
}
