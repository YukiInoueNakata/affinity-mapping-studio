import { memo } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from 'reactflow';
import type { DiagramRelationType } from '@shared/types/domain';
import {
  RELATION_TYPE_COLORS,
  RELATION_TYPE_GLYPHS,
  RELATION_TYPE_LABELS,
} from '../domain/relations.js';

export interface RelationEdgeData {
  relationType: DiagramRelationType;
  label?: string;
  /** 最終図解ビュー用: 色分けをやめて単色 + 記号 (グリフ) で種別を示す．
   *  論文/印刷用途に合わせたモノクロ表現． */
  monochrome?: boolean;
}

/** モノクロ時のストローク・テキスト色．CSS は var(--text)，ReactFlow が生成する
 *  SVG marker は CSS 変数を解釈しないため，markerEnd.color にはリテラル値を使う． */
const MONO_COLOR = 'var(--text)';
export const FINAL_VIEW_RELATION_STROKE = '#cccccc';

function RelationEdgeImpl({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps<RelationEdgeData>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const relationType = data?.relationType ?? 'custom';
  const monochrome = data?.monochrome === true;
  const typeColor = RELATION_TYPE_COLORS[relationType];
  const baseColor = monochrome ? MONO_COLOR : typeColor;
  const glyph = RELATION_TYPE_GLYPHS[relationType];
  const typeLabel = RELATION_TYPE_LABELS[relationType];
  const customLabel = data?.label && data.label.trim().length > 0 ? data.label : undefined;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={`url(#kj-arrow-${relationType})`}
        style={{
          stroke: selected ? '#fff' : baseColor,
          strokeWidth: selected ? 3 : 2,
        }}
      />
      <EdgeLabelRenderer>
        <div
          className={`kj-relation-edge-label ${monochrome ? 'mono' : ''}`}
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            borderColor: selected ? '#fff' : baseColor,
            color: selected ? '#fff' : baseColor,
          }}
        >
          {monochrome ? (
            <>
              <span
                className="kj-relation-edge-glyph"
                aria-label={typeLabel}
                title={typeLabel}
              >
                {glyph}
              </span>
              {customLabel && (
                <span className="kj-relation-edge-sublabel">{customLabel}</span>
              )}
            </>
          ) : (
            customLabel ?? typeLabel
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export const RelationEdge = memo(RelationEdgeImpl);
