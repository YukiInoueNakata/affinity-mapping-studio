// 最終図解ビュー上の図形 1 個を描画する ReactFlow カスタムノード．
// 14 種の DiagramRelationType (glyph) + 装飾形状 (circle / rect / cloud / bracket /
// arrow_standalone / text) に対応．rotation は CSS transform で適用．
// ラベルはダブルクリックで inline 編集．

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { type NodeProps } from 'reactflow';
import { useProjectStore } from '../stores/projectStore.js';
import { makeUpdateFinalShapeCommand } from '../stores/commands.js';
import type { FinalDiagramShape, FinalDiagramShapeKind } from '@shared/types/domain';
import {
  RELATION_TYPE_COLORS,
  RELATION_TYPE_GLYPHS,
  RELATION_TYPE_LABELS,
} from '../domain/relations.js';

export interface KJFinalShapeNodeData {
  shape: FinalDiagramShape;
}

const PRIMITIVE_KINDS: ReadonlySet<FinalDiagramShapeKind> = new Set([
  'circle',
  'rect',
  'cloud',
  'bracket',
  'arrow_standalone',
  'text',
]);

function isPrimitive(kind: FinalDiagramShapeKind): boolean {
  return PRIMITIVE_KINDS.has(kind);
}

function defaultColor(kind: FinalDiagramShapeKind): string {
  if (isPrimitive(kind)) return '#888888';
  // relation type
  return (RELATION_TYPE_COLORS as Record<string, string>)[kind] ?? '#888888';
}

function defaultGlyph(kind: FinalDiagramShapeKind): string {
  if (isPrimitive(kind)) {
    switch (kind) {
      case 'circle':
        return '○';
      case 'rect':
        return '□';
      case 'cloud':
        return '☁';
      case 'bracket':
        return ']';
      case 'arrow_standalone':
        return '→';
      case 'text':
        return '';
    }
  }
  return (RELATION_TYPE_GLYPHS as Record<string, string>)[kind] ?? '';
}

export function KJFinalShapeNode({ id, data, selected }: NodeProps<KJFinalShapeNodeData>) {
  const applyCommand = useProjectStore((s) => s.applyCommand);
  const shape = data.shape;
  const color = shape.color ?? defaultColor(shape.kind);
  const glyph = defaultGlyph(shape.kind);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(shape.label ?? '');
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (editing) {
      const t = window.setTimeout(() => taRef.current?.focus(), 10);
      return () => window.clearTimeout(t);
    }
  }, [editing]);

  const commitLabel = () => {
    setEditing(false);
    if (draft === (shape.label ?? '')) return;
    const now = new Date().toISOString();
    applyCommand(
      makeUpdateFinalShapeCommand(
        shape.id,
        { label: shape.label },
        { label: draft },
        now
      )
    );
  };

  const cancelLabel = () => {
    setEditing(false);
    setDraft(shape.label ?? '');
  };

  // outer wrapper handles rotation; inner content fills the box
  const wrapperStyle: CSSProperties = {
    width: '100%',
    height: '100%',
    transform: shape.rotation ? `rotate(${shape.rotation}deg)` : undefined,
    transformOrigin: 'center center',
    pointerEvents: 'auto',
  };

  return (
    <div
      className={`kj-final-shape kj-final-shape-${shape.kind} ${selected ? 'selected' : ''}`}
      style={wrapperStyle}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setDraft(shape.label ?? '');
        setEditing(true);
      }}
    >
      <ShapeBackground kind={shape.kind} color={color} />
      <div className="kj-final-shape-content" style={{ color }}>
        {shape.kind === 'text' ? (
          editing ? null : (
            <span className="kj-final-shape-textonly">{shape.label || 'テキスト'}</span>
          )
        ) : (
          <>
            <span className="kj-final-shape-glyph">{glyph}</span>
            {shape.label && !editing && (
              <span className="kj-final-shape-label">{shape.label}</span>
            )}
          </>
        )}
        {editing && (
          <textarea
            ref={taRef}
            className="kj-final-shape-edit"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitLabel}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                cancelLabel();
              } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                commitLabel();
              }
            }}
            rows={2}
          />
        )}
      </div>
      <span className="muted small kj-final-shape-kindbadge" title={kindLabel(shape.kind)}>
        {kindLabel(shape.kind)}
      </span>
    </div>
  );
}

function kindLabel(kind: FinalDiagramShapeKind): string {
  if (isPrimitive(kind)) {
    switch (kind) {
      case 'circle':
        return '円';
      case 'rect':
        return '矩形';
      case 'cloud':
        return '雲';
      case 'bracket':
        return '括弧';
      case 'arrow_standalone':
        return '矢印';
      case 'text':
        return 'テキスト';
    }
  }
  return (RELATION_TYPE_LABELS as Record<string, string>)[kind] ?? kind;
}

function ShapeBackground({ kind, color }: { kind: FinalDiagramShapeKind; color: string }) {
  // Simple SVG primitives for the geometric kinds; relation glyphs stay text-only.
  if (kind === 'circle') {
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="kj-final-shape-bg">
        <ellipse cx="50" cy="50" rx="48" ry="48" fill="none" stroke={color} strokeWidth="2" />
      </svg>
    );
  }
  if (kind === 'rect') {
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="kj-final-shape-bg">
        <rect x="2" y="2" width="96" height="96" fill="none" stroke={color} strokeWidth="2" />
      </svg>
    );
  }
  if (kind === 'cloud') {
    return (
      <svg viewBox="0 0 100 60" preserveAspectRatio="none" className="kj-final-shape-bg">
        <path
          d="M 20 50 q -15 0 -15 -15 q 0 -12 12 -14 q 2 -12 15 -12 q 12 0 16 10 q 8 -4 16 2 q 8 6 4 16 q 10 2 10 12 q 0 9 -10 11 z"
          fill="none"
          stroke={color}
          strokeWidth="2"
        />
      </svg>
    );
  }
  if (kind === 'bracket') {
    return (
      <svg viewBox="0 0 20 100" preserveAspectRatio="none" className="kj-final-shape-bg">
        <path d="M 18 2 Q 4 2 4 14 L 4 86 Q 4 98 18 98" fill="none" stroke={color} strokeWidth="2" />
      </svg>
    );
  }
  if (kind === 'arrow_standalone') {
    return (
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="kj-final-shape-bg">
        <line x1="2" y1="20" x2="86" y2="20" stroke={color} strokeWidth="3" />
        <polygon points="86,10 98,20 86,30" fill={color} />
      </svg>
    );
  }
  // 'text' or relation-type glyph: no background
  return null;
}
