import { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';

export interface AnalyticNodeData {
  title: string;
  subtitle?: string;
  kind: 'concept' | 'category' | 'code';
  selected?: boolean;
  isCore?: boolean;
}

function AnalyticNodeImpl({ data, selected }: NodeProps<AnalyticNodeData>) {
  const isSelected = selected || data.selected;
  const className = `analytic-node analytic-node-${data.kind} ${
    isSelected ? 'selected' : ''
  } ${data.isCore ? 'core' : ''}`;
  return (
    <div className={className}>
      <div className="analytic-node-title">{data.title || '(無名)'}</div>
      {data.subtitle && (
        <div className="analytic-node-subtitle">{data.subtitle}</div>
      )}
      <Handle id="top-s" type="source" position={Position.Top} className="analytic-handle" />
      <Handle id="top-t" type="target" position={Position.Top} className="analytic-handle" />
      <Handle id="right-s" type="source" position={Position.Right} className="analytic-handle" />
      <Handle id="right-t" type="target" position={Position.Right} className="analytic-handle" />
      <Handle id="bottom-s" type="source" position={Position.Bottom} className="analytic-handle" />
      <Handle id="bottom-t" type="target" position={Position.Bottom} className="analytic-handle" />
      <Handle id="left-s" type="source" position={Position.Left} className="analytic-handle" />
      <Handle id="left-t" type="target" position={Position.Left} className="analytic-handle" />
    </div>
  );
}

export const AnalyticNode = memo(AnalyticNodeImpl);
