import { memo, useEffect, useRef, useState } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { useProjectStore } from '../stores/projectStore.js';
import {
  makeEditCardBodyCommand,
  makeToggleCardCollapsedCommand,
} from '../stores/commands.js';

export interface CardNodeData {
  code: string;
  body: string;
  participantCode: string;
  selected: boolean;
  effectiveFontSize?: number;
  effectiveFontWeight?: 'normal' | 'bold';
  effectiveColor?: string;
  effectiveBackground?: string;
  effectiveBorderColor?: string;
  effectiveBorderWidth?: number;
  effectiveBorderStyle?: 'solid' | 'dashed' | 'dotted';
  maxChars?: number;
  collapsed?: boolean;
  /** (#7) source serials for a merged card → shown as "← 003,005". */
  mergedFrom?: number[];
}

function CardNodeImpl({ id, data, selected }: NodeProps<CardNodeData>) {
  const project = useProjectStore((s) => s.project);
  const applyCommand = useProjectStore((s) => s.applyCommand);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [editing]);

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraft(data.body);
    setEditing(true);
  };

  const commit = () => {
    if (!project) {
      setEditing(false);
      return;
    }
    const card = project.data.cards.find((c) => c.id === id);
    if (!card) {
      setEditing(false);
      return;
    }
    if (draft !== card.body) {
      applyCommand(
        makeEditCardBodyCommand(
          card.id,
          card.body,
          draft,
          new Date().toISOString(),
          card.updatedAt
        )
      );
    }
    setEditing(false);
  };

  const cancel = () => {
    setEditing(false);
    setDraft(data.body);
  };

  const cardStyle: React.CSSProperties = {};
  if (data.effectiveBackground) cardStyle.background = data.effectiveBackground;
  if (data.effectiveBorderWidth !== undefined) {
    cardStyle.borderWidth = data.effectiveBorderWidth;
    cardStyle.borderStyle = data.effectiveBorderStyle ?? 'solid';
    if (data.effectiveBorderColor) cardStyle.borderColor = data.effectiveBorderColor;
  } else if (data.effectiveBorderColor) {
    cardStyle.borderColor = data.effectiveBorderColor;
  }

  const bodyStyle: React.CSSProperties = {};
  if (data.effectiveFontSize) bodyStyle.fontSize = data.effectiveFontSize;
  if (data.effectiveFontWeight) bodyStyle.fontWeight = data.effectiveFontWeight;
  if (data.effectiveColor) bodyStyle.color = data.effectiveColor;

  const maxChars = data.maxChars ?? 90;
  const isCollapsed = data.collapsed === true && !editing;

  return (
    <div
      className={`card-node ${selected || data.selected ? 'selected' : ''} ${editing ? 'editing' : ''} ${isCollapsed ? 'collapsed' : ''}`}
      style={cardStyle}
      title={isCollapsed ? `${data.code} (折りたたみ — 右クリックで展開)` : undefined}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <div className="card-node-code">
        <button
          type="button"
          className="card-collapse-btn"
          onClick={(e) => {
            e.stopPropagation();
            const cur = useProjectStore.getState().project;
            const card = cur?.data.cards.find((c) => c.id === id);
            if (!card) return;
            useProjectStore.getState().applyCommand(
              makeToggleCardCollapsedCommand(
                card.id,
                !(card.collapsed === true),
                new Date().toISOString(),
                card.updatedAt
              )
            );
          }}
          title={isCollapsed ? '本文を表示' : 'ID のみに折りたたむ'}
        >
          {isCollapsed ? '▶' : '▼'}
        </button>
        <span>{data.code}</span>
        {data.mergedFrom && data.mergedFrom.length > 0 && (
          <span
            className="card-node-merged-from"
            title={`結合元: ${data.mergedFrom.map((n) => String(n).padStart(3, '0')).join(', ')}`}
          >
            ← {data.mergedFrom.map((n) => String(n).padStart(3, '0')).join(',')}
          </span>
        )}
      </div>
      {isCollapsed ? null : editing ? (
        <textarea
          ref={textareaRef}
          className="card-node-edit"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              cancel();
            } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              commit();
            }
          }}
          onClick={(e) => e.stopPropagation()}
          rows={Math.max(3, Math.min(10, draft.split('\n').length + 1))}
        />
      ) : (
        <div
          className="card-node-body"
          style={bodyStyle}
          onDoubleClick={handleDoubleClick}
          title="ダブルクリックで編集"
        >
          {truncate(data.body, maxChars)}
        </div>
      )}
      {!isCollapsed && <div className="card-node-footer">{data.participantCode}</div>}
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

export const CardNode = memo(CardNodeImpl);
