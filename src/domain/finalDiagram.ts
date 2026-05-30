// KJ 法 1986/1997 版「A 型図解化」用の最終図解 (FinalDiagram) を扱う純粋関数群．
// 田中博晃 (2011)「KJ 法入門：質的データ分析法として KJ 法を行う前に」を参照．
//
// 設計方針:
// - 状態は Project.metadata.finalDiagram に集約．存在しなければ空として扱う．
// - 配置は KJ canvas の group_positions と独立 (専用 layout)．初回は KJ から初期化．
// - 図形 (shapes) は 14 種の DiagramRelationType + 装飾形状を統一の FinalDiagramShape で扱う．

import type {
  FinalDiagram,
  FinalDiagramShape,
  FinalDiagramShapeKind,
  Group,
  GroupPosition,
  ISODateString,
  ProjectMetadata,
} from '@shared/types/domain';
import { newId } from './ids.js';

const DEFAULT_SHAPE_W = 120;
const DEFAULT_SHAPE_H = 80;

/** 空の FinalDiagram．まだ表題も註記も配置も無い初期状態． */
export function createEmptyFinalDiagram(): FinalDiagram {
  return {
    groupLayout: {},
    shapes: [],
  };
}

/** ProjectMetadata から FinalDiagram を取り出す．存在しなければ空を返す (旧版互換)． */
export function getFinalDiagram(metadata: ProjectMetadata | undefined | null): FinalDiagram {
  if (!metadata || !metadata.finalDiagram) return createEmptyFinalDiagram();
  // 部分的に欠けている場合に備えて防御的に補完．
  const fd = metadata.finalDiagram;
  return {
    title: fd.title,
    annotation: fd.annotation ? { ...fd.annotation } : undefined,
    groupLayout: fd.groupLayout ?? {},
    shapes: fd.shapes ?? [],
    overallNarrative: fd.overallNarrative,
  };
}

/** 最終図解での Group 配置を解決する．finalDiagram.groupLayout が空のキーは
 *  KJ canvas の groupPositions から流用する (初回表示用フォールバック)． */
export function resolveFinalGroupPosition(
  finalDiagram: FinalDiagram,
  fallbackPositions: readonly GroupPosition[],
  groupId: string
): { x: number; y: number; width?: number; height?: number } | null {
  const own = finalDiagram.groupLayout[groupId];
  if (own) return { ...own };
  const fb = fallbackPositions.find((p) => p.groupId === groupId);
  if (fb) return { x: fb.x, y: fb.y, width: fb.width, height: fb.height };
  return null;
}

/** finalDiagram.groupLayout が空 (初回) のとき，KJ canvas の groupPositions を
 *  すべてコピーした初期 layout を作る．以降はこれを起点に専用編集する． */
export function seedFinalLayoutFromCanvas(
  groupPositions: readonly GroupPosition[]
): Record<string, { x: number; y: number; width?: number; height?: number }> {
  const out: Record<string, { x: number; y: number; width?: number; height?: number }> = {};
  for (const p of groupPositions) {
    out[p.groupId] = { x: p.x, y: p.y, width: p.width, height: p.height };
  }
  return out;
}

/** 図形パレットから新しい shape を作る．座標と種別を指定し，幅・高さは既定値を使う． */
export function createFinalShape(
  kind: FinalDiagramShapeKind,
  x: number,
  y: number,
  now: ISODateString,
  opts: Partial<Omit<FinalDiagramShape, 'id' | 'kind' | 'x' | 'y' | 'createdAt' | 'updatedAt'>> = {}
): FinalDiagramShape {
  return {
    id: newId(),
    kind,
    x,
    y,
    width: opts.width ?? defaultShapeWidth(kind),
    height: opts.height ?? defaultShapeHeight(kind),
    rotation: opts.rotation ?? 0,
    label: opts.label,
    color: opts.color,
    anchorGroupId: opts.anchorGroupId ?? null,
    z: opts.z,
    createdAt: now,
    updatedAt: now,
  };
}

function defaultShapeWidth(kind: FinalDiagramShapeKind): number {
  switch (kind) {
    case 'text':
      return 160;
    case 'arrow_standalone':
      return 140;
    case 'bracket':
      return 40;
    default:
      return DEFAULT_SHAPE_W;
  }
}

function defaultShapeHeight(kind: FinalDiagramShapeKind): number {
  switch (kind) {
    case 'text':
      return 40;
    case 'arrow_standalone':
      return 30;
    case 'bracket':
      return 120;
    default:
      return DEFAULT_SHAPE_H;
  }
}

/** Group の narrative を簡素に取り出す (undefined → ""). */
export function getGroupNarrative(group: Group | undefined | null): string {
  return group?.narrative ?? '';
}

/** メンバーカードの並び (表示順) を決める純粋関数．現状は data 内の cards の挿入順
 *  を尊重し，グループ所属順に並べる． */
export function orderedGroupMemberCardIds(
  groupId: string,
  memberships: readonly { cardId: string; groupId: string }[]
): string[] {
  return memberships.filter((m) => m.groupId === groupId).map((m) => m.cardId);
}
