// 最終図解ビュー (KJ 法 1986/1997 版「A 型図解化」専用)．
// 田中 2011 / 川喜田 1986・1997 を参照．
//
// 機能:
// - 独立 ReactFlow．グループ (島) + 図形パレットから配置したシンボル．
// - 配置は data.final_diagram.groupLayout / data.final_diagram.shapes に独立保持．
// - グループ間の既存 RelationEdge を描画．
// - ドラッグ → undo/redo 可．Delete キーで選択中の図形を削除．
// - 左: 図形パレット (KJ 標準記号 + 装飾)．右: メンバーカード一覧 + 叙述メモ．

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeChange,
  type NodeMouseHandler,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useProjectStore } from '../stores/projectStore.js';
import { GroupNode, type GroupNodeData } from './GroupNode.js';
import { GroupMemberPanel } from './GroupMemberPanel.js';
import { KJFinalAnnotationCard } from './KJFinalAnnotationCard.js';
import {
  KJFinalShapeNode,
  type KJFinalShapeNodeData,
} from './KJFinalShapeNode.js';
import { KJFinalShapePalette } from './KJFinalShapePalette.js';
import { RelationEdge, type RelationEdgeData, FINAL_VIEW_RELATION_STROKE } from './RelationEdge.js';
import { RelationMarkerDefs } from './RelationMarkerDefs.js';
import {
  makeCreateFinalShapeCommand,
  makeDeleteFinalShapeCommand,
  makeSetFinalGroupLayoutCommand,
  makeUpdateFinalShapeCommand,
} from '../stores/commands.js';
import {
  createFinalShape,
  getFinalDiagram,
  resolveFinalGroupPosition,
} from '../domain/finalDiagram.js';
import { getGroupLabel } from '../domain/groups.js';
import type {
  FinalDiagramShape,
  FinalDiagramShapeKind,
} from '@shared/types/domain';

const nodeTypes = { kjgroup: GroupNode, kjfinalshape: KJFinalShapeNode };
const edgeTypes = { relation: RelationEdge };

type AnyNodeData = GroupNodeData | KJFinalShapeNodeData;

const FOUR_NOT_DISMISS_KEY = 'kj.finalView.fourNotDismissed';

function FourNotBanner() {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return window.localStorage.getItem(FOUR_NOT_DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });
  if (dismissed) return null;
  return (
    <div className="kj-final-fournot">
      <div className="kj-final-fournot-title">KJ 法を行う前に — 田中 (2011) の 4 つの NOT</div>
      <ol className="kj-final-fournot-list">
        <li>先行研究を当てはめない（おのれを空しくしてデータをして語らしめる）</li>
        <li>KJ 法はカテゴリー分けの方法ではない（手段であって目的ではない）</li>
        <li>KJ 法は 1 種類ではない（どの版を用いたか —— 1986 / 1997 など —— を明記）</li>
        <li>評定者間一致係数は KJ 法らしくない（解釈の突き合わせが本質）</li>
      </ol>
      <button
        type="button"
        className="kj-final-fournot-close"
        onClick={() => {
          try {
            window.localStorage.setItem(FOUR_NOT_DISMISS_KEY, '1');
          } catch {
            // ignore
          }
          setDismissed(true);
        }}
        title="今後表示しない"
      >
        了解 ×
      </button>
    </div>
  );
}

function KJFinalViewImpl() {
  const project = useProjectStore((s) => s.project);
  const applyCommand = useProjectStore((s) => s.applyCommand);
  const selectGroup = useProjectStore((s) => s.selectGroup);
  const selectedGroupId = useProjectStore((s) => s.selectedGroupId);
  const { screenToFlowPosition } = useReactFlow();

  // パレットの "配置待ち" 種別 (null = 通常モード)．
  const [pendingKind, setPendingKind] = useState<FinalDiagramShapeKind | null>(null);
  // 図形ノードの選択 (ReactFlow ネイティブの selected を補助)．
  const [selectedShapeId, setSelectedShapeId] = useState<string | null>(null);

  const fd = useMemo(() => getFinalDiagram(project?.data ?? null), [project?.data]);

  // ノード = グループ (kjgroup) + 図形 (kjfinalshape)．
  const nodes: Node<AnyNodeData>[] = useMemo(() => {
    if (!project) return [];
    const groupNodes: Node<AnyNodeData>[] = [];
    for (const g of project.data.groups) {
      const pos = resolveFinalGroupPosition(fd, project.data.group_positions, g.id);
      if (!pos) continue;
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
      groupNodes.push({
        id: g.id,
        type: 'kjgroup',
        position: { x: pos.x, y: pos.y },
        data,
        selected: g.id === selectedGroupId,
        style: { width: pos.width ?? 320, height: pos.height ?? 200 },
      });
    }
    const shapeNodes: Node<AnyNodeData>[] = fd.shapes.map((s) => ({
      id: s.id,
      type: 'kjfinalshape',
      position: { x: s.x, y: s.y },
      data: { shape: s } as KJFinalShapeNodeData,
      selected: s.id === selectedShapeId,
      style: { width: s.width, height: s.height, zIndex: s.z ?? 0 },
    }));
    return [...groupNodes, ...shapeNodes];
  }, [project, fd, selectedGroupId, selectedShapeId]);

  const edges: Edge<RelationEdgeData>[] = useMemo(() => {
    if (!project) return [];
    return project.data.diagram_relations
      .filter((r) => r.sourceObjectType === 'group' && r.targetObjectType === 'group')
      .map((r) => ({
        id: r.id,
        source: r.sourceObjectId,
        target: r.targetObjectId,
        type: 'relation',
        // 最終図解はモノクロ + 記号 (グリフ) で識別 (論文体裁準拠)．
        data: { relationType: r.relationType, label: r.label, monochrome: true },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: FINAL_VIEW_RELATION_STROKE,
        },
      }));
  }, [project]);

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<AnyNodeData>(nodes);

  useEffect(() => {
    setRfNodes(nodes);
  }, [nodes, setRfNodes]);

  const dragStartRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const onNodeDragStart: NodeMouseHandler = useCallback((_e, node) => {
    dragStartRef.current.set(node.id, { x: node.position.x, y: node.position.y });
  }, []);

  const onNodeDragStop: NodeMouseHandler = useCallback(
    (_e, node) => {
      const prevPos = dragStartRef.current.get(node.id);
      dragStartRef.current.delete(node.id);
      if (!prevPos) return;
      const { x: nx, y: ny } = node.position;
      if (prevPos.x === nx && prevPos.y === ny) return;
      if (node.type === 'kjgroup') {
        const w = (node.style?.width as number | undefined) ?? undefined;
        const h = (node.style?.height as number | undefined) ?? undefined;
        applyCommand(
          makeSetFinalGroupLayoutCommand(
            node.id,
            { x: prevPos.x, y: prevPos.y, width: w, height: h },
            { x: nx, y: ny, width: w, height: h }
          )
        );
      } else if (node.type === 'kjfinalshape') {
        const now = new Date().toISOString();
        applyCommand(
          makeUpdateFinalShapeCommand(
            node.id,
            { x: prevPos.x, y: prevPos.y },
            { x: nx, y: ny },
            now
          )
        );
      }
    },
    [applyCommand]
  );

  const onNodeClick: NodeMouseHandler = useCallback(
    (_e, node) => {
      if (node.type === 'kjgroup') {
        selectGroup(node.id);
        setSelectedShapeId(null);
      } else if (node.type === 'kjfinalshape') {
        setSelectedShapeId(node.id);
        selectGroup(null);
      }
    },
    [selectGroup]
  );

  // キャンバスクリック: 配置待ちなら shape 配置．通常時は選択解除．
  const onPaneClick = useCallback(
    (e: React.MouseEvent) => {
      if (pendingKind) {
        const fp = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        const now = new Date().toISOString();
        const shape = createFinalShape(pendingKind, fp.x, fp.y, now);
        applyCommand(makeCreateFinalShapeCommand(shape));
        setPendingKind(null);
        setSelectedShapeId(shape.id);
        return;
      }
      selectGroup(null);
      setSelectedShapeId(null);
    },
    [pendingKind, screenToFlowPosition, applyCommand, selectGroup]
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const positionOnly = changes.filter((c) => c.type === 'position' || c.type === 'dimensions');
      if (positionOnly.length > 0) onNodesChange(positionOnly);
    },
    [onNodesChange]
  );

  // Delete キーで選択中の図形を削除 / Esc で配置待ちキャンセル．
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'Escape' && pendingKind) {
        e.preventDefault();
        setPendingKind(null);
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedShapeId) {
        const shape = (project?.data.final_diagram?.shapes ?? []).find(
          (s: FinalDiagramShape) => s.id === selectedShapeId
        );
        if (shape) {
          e.preventDefault();
          applyCommand(makeDeleteFinalShapeCommand(shape));
          setSelectedShapeId(null);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingKind, selectedShapeId, project, applyCommand]);

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
    <div className={`kj-final-view ${pendingKind ? 'pending-place' : ''}`} style={{ flex: 1, display: 'flex', minHeight: 0 }}>
      <KJFinalShapePalette pendingKind={pendingKind} onPick={setPendingKind} />
      <div className="canvas-flow" style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <FourNotBanner />
        {/* 関係種別ごとの SVG marker 定義（最終図解ビュー専用．両端矢印 + 14 種フル形状） */}
        <RelationMarkerDefs />
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
        <KJFinalAnnotationCard />
      </div>
      <GroupMemberPanel />
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
