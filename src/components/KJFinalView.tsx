// 最終図解ビュー (KJ 法 1986/1997 版「A 型図解化」専用)．
// 田中 2011 / 川喜田 1986・1997 を参照．
//
// MVP スコープ (Phase 2):
// - 独立 ReactFlow．グループ (島) のみ表示．カード非表示．
// - 配置は data.final_diagram.groupLayout を優先．無ければ data.group_positions から流用．
// - グループ間の既存 RelationEdge を描画．
// - グループドラッグ → makeSetFinalGroupLayoutCommand で undo/redo．
//
// Phase 3 以降: drill-down / 叙述メモ / 表題・註記 / 図形パレット / 4-NOT バナー．

import { useCallback, useMemo, useRef } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlowProvider,
  useNodesState,
  type Edge,
  type Node,
  type NodeChange,
  type NodeMouseHandler,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useProjectStore } from '../stores/projectStore.js';
import { GroupNode, type GroupNodeData } from './GroupNode.js';
import { RelationEdge, type RelationEdgeData } from './RelationEdge.js';
import { makeSetFinalGroupLayoutCommand } from '../stores/commands.js';
import {
  getFinalDiagram,
  resolveFinalGroupPosition,
} from '../domain/finalDiagram.js';
import { getGroupLabel } from '../domain/groups.js';
import { RELATION_TYPE_COLORS } from '../domain/relations.js';

const nodeTypes = { kjgroup: GroupNode };
const edgeTypes = { relation: RelationEdge };

function KJFinalViewImpl() {
  const project = useProjectStore((s) => s.project);
  const applyCommand = useProjectStore((s) => s.applyCommand);
  const selectGroup = useProjectStore((s) => s.selectGroup);
  const selectedGroupId = useProjectStore((s) => s.selectedGroupId);

  // 最終図解ビューでは「グループ」のみ表示．カードと未グループ化要素は隠す．
  const fd = useMemo(() => getFinalDiagram(project?.data ?? null), [project?.data]);

  const nodes: Node<GroupNodeData>[] = useMemo(() => {
    if (!project) return [];
    return project.data.groups
      .map((g) => {
        const pos = resolveFinalGroupPosition(fd, project.data.group_positions, g.id);
        if (!pos) return null;
        const label = getGroupLabel(project.data, g.id);
        const memberships = project.data.group_memberships.filter((m) => m.groupId === g.id);
        const data: GroupNodeData = {
          name: g.name,
          labelText: label?.text ?? g.name,
          memberCount: memberships.length,
          width: pos.width ?? 320,
          height: pos.height ?? 200,
          selected: g.id === selectedGroupId,
          level: g.level,
          collapsed: g.collapsed,
          effectiveFontSize: g.displayStyle?.fontSize,
          effectiveFontWeight: g.displayStyle?.fontWeight,
          effectiveColor: g.displayStyle?.color,
          effectiveBackground: g.displayStyle?.background,
          effectiveBorderColor: g.displayStyle?.borderColor,
          effectiveBorderWidth: g.displayStyle?.borderWidth,
          effectiveBorderStyle: g.displayStyle?.borderStyle,
        };
        const node: Node<GroupNodeData> = {
          id: g.id,
          type: 'kjgroup',
          position: { x: pos.x, y: pos.y },
          data,
          selected: g.id === selectedGroupId,
          style: { width: pos.width ?? 320, height: pos.height ?? 200 },
        };
        return node;
      })
      .filter((n): n is Node<GroupNodeData> => n !== null);
  }, [project, fd, selectedGroupId]);

  const edges: Edge<RelationEdgeData>[] = useMemo(() => {
    if (!project) return [];
    return project.data.diagram_relations
      // 最終図解はグループ間のみを描く．カード参照のエッジは表示しない．
      .filter((r) => r.sourceObjectType === 'group' && r.targetObjectType === 'group')
      .map((r) => ({
        id: r.id,
        source: r.sourceObjectId,
        target: r.targetObjectId,
        type: 'relation',
        data: { relationType: r.relationType, label: r.label },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: RELATION_TYPE_COLORS[r.relationType],
        },
      }));
  }, [project]);

  // ReactFlow の内部 nodes state (ドラッグ中の暫定位置を保持)．
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<GroupNodeData>(nodes);

  // project が変わったら同期．
  useMemo(() => setRfNodes(nodes), [nodes, setRfNodes]);

  // ドラッグ開始時の位置を覚える (undo の prev 用)．
  const dragStartRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const onNodeDragStart: NodeMouseHandler = useCallback((_e, node) => {
    dragStartRef.current.set(node.id, { x: node.position.x, y: node.position.y });
  }, []);

  // ドラッグ終了時に commit．
  const onNodeDragStop: NodeMouseHandler = useCallback(
    (_e, node) => {
      const prevPos = dragStartRef.current.get(node.id);
      dragStartRef.current.delete(node.id);
      if (!prevPos) return;
      const { x: nx, y: ny } = node.position;
      if (prevPos.x === nx && prevPos.y === ny) return;
      const w = (node.style?.width as number | undefined) ?? undefined;
      const h = (node.style?.height as number | undefined) ?? undefined;
      const prev: { x: number; y: number; width?: number; height?: number } = {
        x: prevPos.x,
        y: prevPos.y,
        width: w,
        height: h,
      };
      const next = { x: nx, y: ny, width: w, height: h };
      applyCommand(makeSetFinalGroupLayoutCommand(node.id, prev, next));
    },
    [applyCommand]
  );

  // クリック → グループ選択 (Phase 3 で右ペインの drill-down 用フック)．
  const onNodeClick: NodeMouseHandler = useCallback(
    (_e, node) => {
      selectGroup(node.id);
    },
    [selectGroup]
  );

  const onPaneClick = useCallback(() => {
    selectGroup(null);
  }, [selectGroup]);

  // 内部ノードのドラッグ用に onNodesChange を渡す (位置のみ反映、他は無視)．
  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // 位置変更のみ即時反映．その他 (selection 等) は store 経由でやる．
      const positionOnly = changes.filter((c) => c.type === 'position' || c.type === 'dimensions');
      if (positionOnly.length > 0) onNodesChange(positionOnly);
    },
    [onNodesChange]
  );

  if (!project) {
    return (
      <div className="empty-state" style={{ padding: 24 }}>
        プロジェクトを開いてください
      </div>
    );
  }

  if (project.data.groups.length === 0) {
    return (
      <div className="empty-state" style={{ padding: 24, lineHeight: 1.7 }}>
        グループがまだありません．キャンバスでカードをグループ化してから
        最終図解ビューを開いてください．
        <br />
        <br />
        <span className="muted small">
          ※ KJ 法 1986/1997 版「A 型図解化」は，グループ編成 (表札作り) を経た後に，
          島の空間配置 → 島間関連付け → シンボル → 表題・註記 の順で行います．
          (田中 2011)
        </span>
      </div>
    );
  }

  return (
    <div className="kj-final-view" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div className="canvas-flow" style={{ flex: 1, minHeight: 0 }}>
        <ReactFlow
          nodes={rfNodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={handleNodesChange}
          onNodeDragStart={onNodeDragStart}
          onNodeDragStop={onNodeDragStop}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          fitView
          proOptions={{ hideAttribution: true }}
          onlyRenderVisibleElements
        >
          <Background />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
    </div>
  );
}

export function KJFinalView() {
  return (
    <ReactFlowProvider>
      <KJFinalViewImpl />
    </ReactFlowProvider>
  );
}
