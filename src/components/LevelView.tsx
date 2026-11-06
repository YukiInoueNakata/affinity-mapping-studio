import { MOD_KEY } from '../utils/platform.js';
import { confirmDialog } from '../services/confirmDialog.js';
// 段のタブ (第 2 段以降)．
//
// 第 n 段のタブでは，1 つ下の段までのまとまり (箱) を並べ，第 n 段のグループ (枠) で
// 束ねる．配置は段ごとに level_positions に持つ (第 1 段のキャンバスとは独立)．
// - 箱を動かす → その段の配置だけが変わる．
// - 箱を別の枠の中へ落とす → その枠のグループに入れる (第 1 段の親子も同じに変わる)．
// - 枠を動かす → 中の箱がまとめて動く．
// - 箱を選んで「まとめる」→ 第 n 段のグループを新しく作る．
// - 箱を選んで「枠から外す」→ 第 n 段のグループから外す．
// 計算は domain/levels.ts．

import { useRegisterExportTarget } from '../services/canvasExport.js';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Node,
  type NodeChange,
  type NodeDragHandler,
  type NodeMouseHandler,
  type NodeProps,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useProjectStore } from '../stores/projectStore.js';
import { useIsViewer } from '../sync/useSyncManager.js';
import {
  makeCompositeCommand,
  makeNestGroupsCommand,
  makeNestIntoExistingGroupCommand,
  makeSetLevelPositionsCommand,
  makeUnnestGroupCommand,
  type DomainCommand,
} from '../stores/commands.js';
import {
  buildParentGroup,
  computeCascadedGroupBoundsUpdates,
  computeGroupCodes,
  getGroupLabel,
  nextHierarchyGroupName,
} from '../domain/groups.js';
import {
  computeLevelLayout,
  findFrameAt,
  getLevelItems,
  levelPositionId,
  makeLevelPosition,
} from '../domain/levels.js';
import type { LevelPosition, ProjectData } from '@shared/types/domain';

interface LevelBoxData {
  kind: 'box';
  code: string;
  labelText: string;
  level: number;
  cardCount: number;
  childGroupCount: number;
}

interface LevelFrameData {
  kind: 'frame';
  code: string;
  labelText: string;
  childCount: number;
}

type LevelNodeData = LevelBoxData | LevelFrameData;

const LevelBoxNode = memo(function LevelBoxNode({ data, selected }: NodeProps<LevelBoxData>) {
  return (
    <div className={`level-box ${selected ? 'selected' : ''}`} title="ドラッグで移動・別の枠に落とすとそのグループに入る">
      <div className="level-box-code">
        {data.code}
        <span className="level-box-meta">
          第{data.level}段・{data.cardCount} 枚
          {data.childGroupCount > 0 ? `・${data.childGroupCount} グループ` : ''}
        </span>
      </div>
      <div className="level-box-label">{data.labelText || '（表札なし）'}</div>
    </div>
  );
});

const LevelFrameNode = memo(function LevelFrameNode({ data, selected }: NodeProps<LevelFrameData>) {
  return (
    <div className={`level-frame ${selected ? 'selected' : ''}`}>
      <div className="level-frame-header" title="ドラッグで中の箱ごと移動">
        <span className="level-frame-code">{data.code}</span>
        <span className="level-frame-label">{data.labelText || '（表札なし）'}</span>
        <span className="level-frame-count">{data.childCount} 個</span>
      </div>
    </div>
  );
});

const nodeTypes = { levelbox: LevelBoxNode, levelframe: LevelFrameNode };

/** グループの下にあるカードの枚数 (子孫のグループを含む)． */
function descendantCardCounts(data: ProjectData): Map<string, number> {
  const direct = new Map<string, number>();
  for (const m of data.group_memberships) direct.set(m.groupId, (direct.get(m.groupId) ?? 0) + 1);
  const children = new Map<string, string[]>();
  for (const g of data.groups) {
    if (!g.parentGroupId) continue;
    const arr = children.get(g.parentGroupId) ?? [];
    arr.push(g.id);
    children.set(g.parentGroupId, arr);
  }
  const memo = new Map<string, number>();
  const visit = (id: string, depth: number): number => {
    if (memo.has(id)) return memo.get(id)!;
    if (depth > 1000) return 0;
    let n = direct.get(id) ?? 0;
    for (const c of children.get(id) ?? []) n += visit(c, depth + 1);
    memo.set(id, n);
    return n;
  };
  for (const g of data.groups) visit(g.id, 0);
  return memo;
}

/** 第 1 段のキャンバスで，親子が変わった後の親グループの大きさを計算し直す
 *  (CanvasView の「既存グループへ入れる」と同じ手順)． */
function tab1BoundsAfterReparent(
  data: ProjectData,
  childId: string,
  newParentId: string | null,
  /** カードの折り返し幅 (表示の設定)．第 1 段のキャンバスと同じ幅で計算するため．
   *  画面で測った大きさ (measuredSizes) は第 1 段を表示していないと取れないので渡さない． */
  defaultCardWidth: number | undefined
) {
  const child = data.groups.find((g) => g.id === childId);
  const synthesized: ProjectData = {
    ...data,
    groups: data.groups.map((g) => (g.id === childId ? { ...g, parentGroupId: newParentId } : g)),
  };
  const override = new Map<string, { x: number; y: number; width: number; height: number }>();
  for (const pid of [newParentId, child?.parentGroupId ?? null]) {
    if (!pid) continue;
    const p = data.group_positions.find((gp) => gp.groupId === pid);
    if (p) override.set(pid, { x: p.x, y: p.y, width: p.width, height: p.height });
  }
  return computeCascadedGroupBoundsUpdates(synthesized, new Map(), override, { defaultCardWidth });
}

function LevelViewImpl({ level }: { level: number }) {
  useRegisterExportTarget();
  // リボンの「全体を表示」(kj.requestFitView) は第 1 段の CanvasView だけが聞いていたので，ここでも聞く．
  const { fitView } = useReactFlow();
  useEffect(() => {
    const h = () => fitView({ padding: 0.1 });
    window.addEventListener('kj.requestFitView', h);
    return () => window.removeEventListener('kj.requestFitView', h);
  }, [fitView]);
  const project = useProjectStore((s) => s.project);
  const applyCommand = useProjectStore((s) => s.applyCommand);
  const selectGroup = useProjectStore((s) => s.selectGroup);
  const selectGroupIds = useProjectStore((s) => s.selectGroupIds);
  const isViewer = useIsViewer();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const data = project?.data ?? null;
  const cardWrapWidth = project?.metadata.displaySettings?.cardWrapWidth;
  const layout = useMemo(() => (data ? computeLevelLayout(data, level) : null), [data, level]);
  const items = useMemo(() => (data ? getLevelItems(data, level) : null), [data, level]);

  const nodes: Node<LevelNodeData>[] = useMemo(() => {
    if (!data || !layout || !items) return [];
    const codes = computeGroupCodes(data.groups);
    const cardCounts = descendantCardCounts(data);
    // 箱・枠ごとに find / filter を回すと O(n²) になるので，索引を一度だけ作る．
    const labelText = new Map<string, string>();
    for (const l of data.labels) if (l.groupId && !labelText.has(l.groupId)) labelText.set(l.groupId, l.text);
    const childGroupCount = new Map<string, number>();
    for (const g of data.groups) if (g.parentGroupId) childGroupCount.set(g.parentGroupId, (childGroupCount.get(g.parentGroupId) ?? 0) + 1);
    const boxCountInFrame = new Map<string, number>();
    for (const b of items.boxes) if (b.parentGroupId) boxCountInFrame.set(b.parentGroupId, (boxCountInFrame.get(b.parentGroupId) ?? 0) + 1);
    const out: Node<LevelNodeData>[] = [];
    for (const f of items.frames) {
      const r = layout.frames.get(f.id);
      if (!r) continue;
      out.push({
        id: f.id,
        type: 'levelframe',
        position: { x: r.x, y: r.y },
        data: {
          kind: 'frame',
          code: codes.get(f.id) ?? '',
          labelText: labelText.get(f.id) || f.name,
          childCount: boxCountInFrame.get(f.id) ?? 0,
        },
        style: { width: r.width, height: r.height },
        zIndex: 0,
        selected: selectedIds.includes(f.id),
        dragHandle: '.level-frame-header',
      });
    }
    for (const b of items.boxes) {
      const r = layout.boxes.get(b.id);
      if (!r) continue;
      out.push({
        id: b.id,
        type: 'levelbox',
        position: { x: r.x, y: r.y },
        data: {
          kind: 'box',
          code: codes.get(b.id) ?? '',
          labelText: labelText.get(b.id) || b.name,
          level: b.level,
          cardCount: cardCounts.get(b.id) ?? 0,
          childGroupCount: childGroupCount.get(b.id) ?? 0,
        },
        style: { width: r.width, height: r.height },
        zIndex: 1,
        selected: selectedIds.includes(b.id),
      });
    }
    return out;
  }, [data, layout, items, selectedIds]);

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<LevelNodeData>(nodes);
  useEffect(() => setRfNodes(nodes), [nodes, setRfNodes]);

  // 引いているもの．React Flow は選択中のノードをまとめて動かすので，引いた全ノード
  // (nodes) の始めの位置と，引いた枠の中の箱 (自分は引かれていないもの) を覚える．
  const dragStart = useRef<{
    id: string;
    x: number;
    y: number;
    dragged: Map<string, { x: number; y: number; type: string | undefined }>;
    children: Map<string, { x: number; y: number }>;
  } | null>(null);

  const onNodeDragStart: NodeDragHandler = useCallback(
    (_e, node, nodes) => {
      const all = nodes.length > 0 ? nodes : [node];
      const dragged = new Map<string, { x: number; y: number; type: string | undefined }>();
      for (const n of all) dragged.set(n.id, { x: n.position.x, y: n.position.y, type: n.type });
      const children = new Map<string, { x: number; y: number }>();
      if (items && layout) {
        for (const n of all) {
          if (n.type !== 'levelframe') continue;
          for (const b of items.boxes) {
            if (b.parentGroupId !== n.id || dragged.has(b.id)) continue;
            const r = layout.boxes.get(b.id);
            if (r) children.set(b.id, { x: r.x, y: r.y });
          }
        }
      }
      dragStart.current = { id: node.id, x: node.position.x, y: node.position.y, dragged, children };
    },
    [items, layout]
  );

  // 枠を動かしている間は中の箱も一緒に動かして見せる (選択中で React Flow が
  // 自分で動かす箱は children に入れていないので，二重には動かない)．
  const onNodeDrag: NodeDragHandler = useCallback(
    (_e, node) => {
      const s = dragStart.current;
      if (!s || s.id !== node.id || s.children.size === 0) return;
      const dx = node.position.x - s.x;
      const dy = node.position.y - s.y;
      setRfNodes((curr) =>
        curr.map((n) => {
          const c = s.children.get(n.id);
          return c ? { ...n, position: { x: c.x + dx, y: c.y + dy } } : n;
        })
      );
    },
    [setRfNodes]
  );

  const rowsById = useMemo(() => {
    const m = new Map<string, LevelPosition>();
    for (const p of data?.level_positions ?? []) if (!m.has(p.id)) m.set(p.id, p);
    return m;
  }, [data]);

  const onNodeDragStop: NodeDragHandler = useCallback(
    async (_e, node, nodes) => {
      const s = dragStart.current;
      dragStart.current = null;
      if (!s || !data || !layout || !items || isViewer) return;
      const dx = node.position.x - s.x;
      const dy = node.position.y - s.y;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      const now = new Date().toISOString();
      const all = nodes.length > 0 ? nodes : [node];

      // 位置の書き込み: 箱はその位置，中に箱のある枠は中の箱 (枠の位置は中の箱から決まる)，
      // 空の枠は枠の位置．
      const changes: Array<{ prev: LevelPosition | undefined; next: LevelPosition }> = [];
      const put = (id: string, x: number, y: number) =>
        changes.push({ prev: rowsById.get(levelPositionId(level, id)), next: makeLevelPosition(level, id, x, y) });
      for (const n of all) {
        if (n.type === 'levelframe') {
          const hasChild = items.boxes.some((b) => b.parentGroupId === n.id);
          if (!hasChild) put(n.id, n.position.x, n.position.y);
        } else {
          put(n.id, n.position.x, n.position.y);
        }
      }
      for (const [id, c] of s.children) put(id, c.x + dx, c.y + dy);
      if (changes.length === 0) return;

      const onlyOneBox = all.length === 1 && node.type === 'levelbox';
      const label =
        all.length > 1 ? `第${level}段: ${all.length} 個を移動` : node.type === 'levelframe' ? `第${level}段: 枠を移動` : `第${level}段: 箱を移動`;
      const move = makeSetLevelPositionsCommand(changes, label);
      if (!onlyOneBox) {
        // 複数を引いたときは位置だけ．グループの出し入れは 1 つずつ行う．
        applyCommand(move);
        return;
      }

      // 箱 1 つ: 位置を書き，別の枠に落ちていればそのグループに入れる．
      const box = data.groups.find((g) => g.id === node.id);
      if (!box) return;
      const r = layout.boxes.get(box.id);
      const center = {
        x: node.position.x + (r?.width ?? 0) / 2,
        y: node.position.y + (r?.height ?? 0) / 2,
      };
      const ownFrame = items.frames.some((f) => f.id === box.parentGroupId) ? box.parentGroupId : null;
      const target = findFrameAt(layout, center, ownFrame);
      if (!target) {
        applyCommand(move);
        return;
      }
      // 親がこの段より上の段にある箱 (段を飛ばした親子) は，入れると上の段の親から外れる．
      // 黙って構造を変えないよう確かめる．
      if (box.parentGroupId && !ownFrame) {
        const upper = data.groups.find((g) => g.id === box.parentGroupId);
        const upperName = upper ? getGroupLabel(data, upper.id)?.text || upper.name : '';
        const ok = (await confirmDialog(
          `この箱は第${upper?.level ?? '?'}段のグループ「${upperName}」に入っています．\n` +
            `第${level}段の枠に入れると，「${upperName}」から外れます．入れますか？\n` +
            `（「キャンセル」なら位置だけを動かします）`
        ));
        if (!ok) {
          applyCommand(move);
          return;
        }
      }
      const nest = makeNestIntoExistingGroupCommand(
        target,
        [box.id],
        { [box.id]: box.parentGroupId },
        now,
        tab1BoundsAfterReparent(data, box.id, target, cardWrapWidth)
      );
      applyCommand(makeCompositeCommand(`第${level}段: 箱を別のグループへ`, [move, nest]));
    },
    [data, layout, items, isViewer, rowsById, level, applyCommand, cardWrapWidth]
  );

  const onNodeClick: NodeMouseHandler = useCallback(
    (e, node) => {
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      setSelectedIds((cur) => {
        const next = additive
          ? cur.includes(node.id)
            ? cur.filter((id) => id !== node.id)
            : [...cur, node.id]
          : [node.id];
        if (next.length === 1) selectGroup(next[0]);
        else selectGroupIds(next);
        return next;
      });
    },
    [selectGroup, selectGroupIds]
  );

  const onPaneClick = useCallback(() => {
    setSelectedIds([]);
    selectGroup(null);
  }, [selectGroup]);

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const keep = changes.filter((c) => c.type === 'position' || c.type === 'dimensions');
      if (keep.length > 0) onNodesChange(keep);
    },
    [onNodesChange]
  );

  // 選んだ箱の分類．
  const selectedBoxes = useMemo(
    () => (items ? items.boxes.filter((b) => selectedIds.includes(b.id)) : []),
    [items, selectedIds]
  );
  const canGroup = !isViewer && selectedBoxes.length >= 1 && selectedBoxes.every((b) => b.parentGroupId === null);
  const frameIds = useMemo(() => new Set(items?.frames.map((f) => f.id) ?? []), [items]);
  const canUngroup =
    !isViewer && selectedBoxes.length >= 1 && selectedBoxes.every((b) => b.parentGroupId && frameIds.has(b.parentGroupId));

  const onGroup = useCallback(() => {
    if (!data || !canGroup) return;
    const now = new Date().toISOString();
    const out = buildParentGroup(data, { childGroupIds: selectedBoxes.map((b) => b.id), now });
    // 箱の段がそろっていなくても，このタブの段のグループにする．
    const parent = { ...out.parent, level, name: nextHierarchyGroupName(data, level) };
    applyCommand(makeNestGroupsCommand(parent, out.parentLabel, out.parentPosition, out.childGroups, now));
    setSelectedIds([parent.id]);
    selectGroup(parent.id);
  }, [data, canGroup, selectedBoxes, level, applyCommand, selectGroup]);

  const onUngroup = useCallback(() => {
    if (!data || !canUngroup) return;
    const now = new Date().toISOString();
    const cmds: DomainCommand[] = [];
    let cur = data;
    for (const b of selectedBoxes) {
      const g = cur.groups.find((x) => x.id === b.id)!;
      const cmd = makeUnnestGroupCommand(g.id, g.parentGroupId, now, g.updatedAt, tab1BoundsAfterReparent(cur, g.id, null, cardWrapWidth));
      cmds.push(cmd);
      cur = cmd.apply(cur);
    }
    applyCommand(makeCompositeCommand(`第${level}段: 枠から外す`, cmds));
  }, [data, canUngroup, selectedBoxes, level, applyCommand, cardWrapWidth]);

  if (!project || !items) {
    return <div className="empty-state" style={{ padding: 24 }}>プロジェクトを開いてください</div>;
  }
  if (items.boxes.length === 0 && items.frames.length === 0) {
    return (
      <div className="empty-state" style={{ padding: 24, lineHeight: 1.7 }}>
        第{level}段で束ねる材料がまだありません．第{level - 1}段のタブでグループを作ってから開いてください．
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div className="level-toolbar">
        <span className="muted small">
          第{level}段: 箱 {items.boxes.length} 個・グループ {items.frames.length} 個．
          Shift か {MOD_KEY} を押しながらクリックで複数選択．
        </span>
        <button type="button" onClick={onGroup} disabled={!canGroup} title={`選んだ箱を，第 ${level} 段の新しいグループにまとめる`}>
          選んだ箱を第{level}段のグループにまとめる
        </button>
        <button type="button" onClick={onUngroup} disabled={!canUngroup} title={`選んだ箱を，入っている第 ${level} 段のグループから外す`}>
          枠から外す
        </button>
      </div>
      <div className="canvas-flow" style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <ReactFlow
          nodes={rfNodes}
          nodeTypes={nodeTypes}
          onNodesChange={handleNodesChange}
          onNodeDragStart={onNodeDragStart}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          nodesDraggable={!isViewer}
          nodesConnectable={false}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
    </div>
  );
}

export function LevelView({ level }: { level: number }) {
  return (
    <ReactFlowProvider key={level}>
      <LevelViewImpl level={level} />
    </ReactFlowProvider>
  );
}
