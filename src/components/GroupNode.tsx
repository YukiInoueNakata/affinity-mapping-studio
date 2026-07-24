import { memo, useEffect, useRef, useState } from 'react';
import {
  Handle,
  NodeResizer,
  Position,
  type NodeProps,
  type OnResize,
  type OnResizeEnd,
  type OnResizeStart,
} from 'reactflow';
import { useProjectStore } from '../stores/projectStore.js';
import { useIsViewer } from '../sync/useSyncManager.js';
import {
  makeEditLabelCommand,
  makeRenameGroupCommand,
  makeResizeGroupCommand,
  makeToggleGroupCollapsedCommand,
} from '../stores/commands.js';
import { computeCascadedGroupBoundsUpdates } from '../domain/groups.js';

export interface GroupNodeData {
  name: string;
  labelText: string;
  memberCount: number;
  width: number;
  height: number;
  selected: boolean;
  level: number;
  collapsed: boolean;
  /** 連番コード（例 "L1-3"）．showCode が true のとき表札の前に表示する． */
  code?: string;
  /** コード表示のトグル（DisplaySettings.showGroupCode）． */
  showCode?: boolean;
  effectiveFontSize?: number;
  effectiveFontWeight?: 'normal' | 'bold';
  effectiveColor?: string;
  effectiveBackground?: string;
  effectiveBorderColor?: string;
  effectiveBorderWidth?: number;
  effectiveBorderStyle?: 'solid' | 'dashed' | 'dotted';
}

interface ResizeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function GroupNodeImpl({ id, data, selected }: NodeProps<GroupNodeData>) {
  const project = useProjectStore((s) => s.project);
  const applyCommand = useProjectStore((s) => s.applyCommand);
  const selectGroup = useProjectStore((s) => s.selectGroup);
  const selectGroupIds = useProjectStore((s) => s.selectGroupIds);
  const selectedGroupIds = useProjectStore((s) => s.selectedGroupIds);
  const startRect = useRef<ResizeRect | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const editInputRef = useRef<HTMLTextAreaElement | null>(null);

  // 編集モードに入った瞬間に input にフォーカスし全選択
  useEffect(() => {
    if (editing && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editing]);

  /** 表札テキストを編集中の値で確定．Label レコードがあればその text を更新．
   *  無ければ Group.name を更新．既存と同一なら何もしない． */
  const commitEdit = () => {
    if (!project) {
      setEditing(false);
      return;
    }
    const next = draft.trim();
    const group = project.data.groups.find((g) => g.id === id);
    if (!group) {
      setEditing(false);
      return;
    }
    const label = project.data.labels.find((l) => l.groupId === id);
    const currentText = (label?.text ?? '').trim() || group.name;
    if (next === currentText) {
      setEditing(false);
      return;
    }
    const now = new Date().toISOString();
    if (label) {
      applyCommand(
        makeEditLabelCommand(label.id, 'text', label.text, next, now, label.updatedAt)
      );
    } else {
      applyCommand(makeRenameGroupCommand(id, group.name, next, now, group.updatedAt));
    }
    setEditing(false);
  };

  const cancelEdit = () => {
    setEditing(false);
  };

  const isViewer = useIsViewer();
  const startEdit = () => {
    if (!project) return;
    // Sec-003/009 Phase 2C: viewer は表札テキストを直接編集できない．
    // (memoLogs への追記は applyCommand 側で許可されているため，
    //  メモ系 UI からは引き続き操作可能)
    if (isViewer) return;
    const group = project.data.groups.find((g) => g.id === id);
    if (!group) return;
    const label = project.data.labels.find((l) => l.groupId === id);
    setDraft((label?.text ?? '').trim() || group.name);
    setEditing(true);
  };

  const handleHeaderClick = (e: React.MouseEvent) => {
    // The header sits above the node bounds, so React Flow does not
    // naturally treat clicks on it as node clicks. Forward selection manually.
    e.stopPropagation();
    if (e.shiftKey) {
      // Shift+click toggles this group's membership in the current selection.
      const current = new Set(selectedGroupIds);
      if (current.has(id)) current.delete(id);
      else current.add(id);
      selectGroupIds(Array.from(current));
    } else {
      selectGroup(id);
    }
  };

  const isSelected = selected || data.selected;
  const headerText = data.labelText.trim() || data.name;
  const isParent = data.level >= 2;
  const isCollapsed = data.collapsed;

  const toggleCollapsed = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!project) return;
    const g = project.data.groups.find((gg) => gg.id === id);
    if (!g) return;
    // Synthesize post-toggle state and recompute ancestor bounds so they
    // shrink (collapse) or grow (expand) with this child's size change.
    const synthesized = {
      ...project.data,
      groups: project.data.groups.map((gg) =>
        gg.id === id ? { ...gg, collapsed: !gg.collapsed } : gg
      ),
    };
    const groupOverride = new Map<
      string,
      { x: number; y: number; width: number; height: number }
    >();
    const pos = project.data.group_positions.find((p) => p.groupId === id);
    if (pos) {
      groupOverride.set(id, {
        x: pos.x,
        y: pos.y,
        width: pos.width,
        height: pos.height,
      });
    }
    const cardWrapWidth = project.metadata.displaySettings?.cardWrapWidth;
    const ancestorUpdates = computeCascadedGroupBoundsUpdates(
      synthesized,
      new Map(),
      groupOverride,
      { defaultCardWidth: cardWrapWidth }
    ).filter((u) => u.next.groupId !== id);
    applyCommand(
      makeToggleGroupCollapsedCommand(
        id,
        !g.collapsed,
        new Date().toISOString(),
        g.updatedAt,
        ancestorUpdates
      )
    );
  };

  const onStart: OnResizeStart = (_e, params) => {
    startRect.current = {
      x: params.x,
      y: params.y,
      width: params.width,
      height: params.height,
    };
  };

  const onResize: OnResize = () => {
    // visual update is handled by React Flow's internal node sizing
  };

  const onEnd: OnResizeEnd = (_e, params) => {
    const start = startRect.current;
    startRect.current = null;
    if (!start || !project) return;
    const to: ResizeRect = {
      x: params.x,
      y: params.y,
      width: params.width,
      height: params.height,
    };
    if (
      Math.abs(start.x - to.x) < 1 &&
      Math.abs(start.y - to.y) < 1 &&
      Math.abs(start.width - to.width) < 1 &&
      Math.abs(start.height - to.height) < 1
    ) {
      return;
    }
    const groupPos = project.data.group_positions.find((p) => p.groupId === id);
    if (!groupPos) return;
    // Recompute ancestor groups so that they grow/shrink with this resize.
    const groupOverride = new Map<
      string,
      { x: number; y: number; width: number; height: number }
    >([[id, to]]);
    const cardWrapWidth = project.metadata.displaySettings?.cardWrapWidth;
    const ancestorUpdates = computeCascadedGroupBoundsUpdates(
      project.data,
      new Map(),
      groupOverride,
      { defaultCardWidth: cardWrapWidth }
    ).filter((u) => u.next.groupId !== id);
    applyCommand(makeResizeGroupCommand(id, start, to, ancestorUpdates));
  };

  return (
    <>
      <NodeResizer
        isVisible={isSelected}
        minWidth={160}
        minHeight={120}
        onResizeStart={onStart}
        onResize={onResize}
        onResizeEnd={onEnd}
        lineClassName="kj-group-resizer-line"
        handleClassName="kj-group-resizer-handle"
      />
      <div
        className={`kj-group-node ${isSelected ? 'selected' : ''} ${
          isParent ? 'kj-group-parent' : ''
        } ${isCollapsed ? 'collapsed' : ''}`}
        style={{
          width: '100%',
          height: '100%',
          background: data.effectiveBackground,
          borderColor: data.effectiveBorderColor,
          borderWidth:
            data.effectiveBorderWidth !== undefined
              ? data.effectiveBorderWidth
              : undefined,
          borderStyle:
            data.effectiveBorderWidth !== undefined
              ? data.effectiveBorderStyle ?? 'solid'
              : undefined,
        }}
      >
        <div
          className="kj-group-node-header"
          onClick={handleHeaderClick}
          onContextMenu={(e) => {
            // 右クリックで表札編集モードへ（デフォルトコンテキストメニュー抑止）
            e.preventDefault();
            e.stopPropagation();
            startEdit();
          }}
          title="クリック: 選択 / ダブルクリック・右クリック: 表札を編集"
        >
          <button
            type="button"
            className="kj-group-collapse-btn"
            onClick={toggleCollapsed}
            title={isCollapsed ? '展開' : '折りたたむ'}
          >
            {isCollapsed ? '▶' : '▼'}
          </button>
          {data.showCode && data.code && (
            <span className="kj-group-node-code" title={`グループコード: ${data.code}`}>
              {data.code}
            </span>
          )}
          {editing ? (
            <textarea
              ref={editInputRef}
              className="kj-group-node-title-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.nativeEvent.isComposing) return;
                // Enter で確定（Ctrl+Enter / Shift+Enter は改行を許可）
                if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                  e.preventDefault();
                  commitEdit();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  cancelEdit();
                }
              }}
              rows={1}
              style={{
                fontSize: data.effectiveFontSize,
                fontWeight: data.effectiveFontWeight,
                color: data.effectiveColor,
                flex: 1,
                minWidth: 80,
                resize: 'none',
                fontFamily: 'inherit',
              }}
            />
          ) : (
            <span
              className="kj-group-node-title"
              style={{
                fontSize: data.effectiveFontSize,
                fontWeight: data.effectiveFontWeight,
                color: data.effectiveColor,
                cursor: 'text',
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                startEdit();
              }}
              title="ダブルクリックで表札を編集"
            >
              {headerText}
            </span>
          )}
          {!isParent && <span className="kj-group-node-count">{data.memberCount} 枚</span>}
          {isCollapsed && (
            <span className="kj-group-node-count" style={{ color: '#e0b34c' }}>
              （折りたたみ中）
            </span>
          )}
        </div>
        <Handle id="top-s" type="source" position={Position.Top} className="kj-group-handle" />
        <Handle id="top-t" type="target" position={Position.Top} className="kj-group-handle" />
        <Handle id="right-s" type="source" position={Position.Right} className="kj-group-handle" />
        <Handle id="right-t" type="target" position={Position.Right} className="kj-group-handle" />
        <Handle id="bottom-s" type="source" position={Position.Bottom} className="kj-group-handle" />
        <Handle id="bottom-t" type="target" position={Position.Bottom} className="kj-group-handle" />
        <Handle id="left-s" type="source" position={Position.Left} className="kj-group-handle" />
        <Handle id="left-t" type="target" position={Position.Left} className="kj-group-handle" />
      </div>
    </>
  );
}

export const GroupNode = memo(GroupNodeImpl);
