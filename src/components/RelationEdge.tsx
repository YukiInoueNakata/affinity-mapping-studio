import { memo } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from 'reactflow';
import type { DiagramRelationType } from '@shared/types/domain';
import { RELATION_TYPE_COLORS, RELATION_TYPE_LABELS } from '../domain/relations.js';

export interface RelationEdgeData {
  relationType: DiagramRelationType;
  label?: string;
}

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
  const color = RELATION_TYPE_COLORS[relationType];
  const displayLabel =
    data?.label && data.label.trim().length > 0
      ? data.label
      : RELATION_TYPE_LABELS[relationType];

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={`url(#kj-arrow-${relationType})`}
        style={{
          stroke: selected ? '#fff' : color,
          strokeWidth: selected ? 3 : 2,
        }}
      />
      <EdgeLabelRenderer>
        <div
          className="kj-relation-edge-label"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            borderColor: selected ? '#fff' : color,
            color: selected ? '#fff' : color,
          }}
        >
          {displayLabel}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export const RelationEdge = memo(RelationEdgeImpl);
