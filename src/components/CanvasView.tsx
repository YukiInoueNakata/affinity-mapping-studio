import { useCallback, useEffect, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  useNodesState,
  useReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type EdgeMouseHandler,
  type Node,
  type NodeChange,
  type NodeMouseHandler,
  type OnSelectionChangeFunc,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useProjectStore } from '../stores/projectStore.js';
import { syncManager } from '../sync/syncManager.js';
import {
  createSnapshot,
  fetchSnapshots,
  restoreSnapshot,
  SnapshotApiError,
  type SnapshotEntry,
} from '../api/snapshotApi.js';
import { CardNode, type CardNodeData } from './CardNode.js';
import { GroupNode, type GroupNodeData } from './GroupNode.js';
import { RelationEdge, type RelationEdgeData } from './RelationEdge.js';
import {
  makeAddCardsToGroupCommand,
  makeBulkApplyCardStyleCommand,
  makeBulkApplyGroupStyleCommand,
  makeCreateGroupCommand,
  makeCreateRelationCommand,
  makeDeleteCardCommand,
  makeDeleteGroupCommand,
  makeMergeCardsCommand,
  makeMoveCardCommand,
  makeMoveCardsBulkCommand,
  makeMoveGroupWithChildrenCommand,
  makeNestGroupsCommand,
  makeNestIntoExistingGroupCommand,
  makeRemoveCardFromGroupCommand,
  makeSetCardPlacementCommand,
  makeSetCardZCommand,
  makeSplitCardCommand,
  makeToggleCardCollapsedCommand,
  makeUnmergeCardCommand,
  makeUnnestGroupCommand,
  type PositionDelta,
} from '../stores/commands.js';
import { StylePickerDialog } from './StylePickerDialog.js';
import type { DisplayStyle } from '@shared/types/domain';
import { GroupPickerDialog } from './GroupPickerDialog.js';
import type { GroupMembership } from '@shared/types/domain';
import { newId } from '../domain/ids.js';
import {
  buildGroupFromCards,
  buildParentGroup,
  collectGroupDescendantsForDrag,
  computeCascadedGroupBoundsUpdates,
  computeGroupAutoBounds,
  packGroupCards,
  getContainerGroupIds,
  getGroupLabel,
  getGroupPosition,
  getHiddenIds,
  resolveOverlapWithGroups,
  type GroupDescendantPosition,
} from '../domain/groups.js';
import {
  buildMergedCard,
  buildSplitCards,
  buildUnmergeCard,
  canUnmergeCard,
  effectivePlacement,
  MergeError,
  SplitError,
  UnmergeError,
} from '../domain/cards.js';
import { CardSplitDialog } from './CardSplitDialog.js';
import {
  buildRelation,
  relationExists,
  RELATION_TYPE_COLORS,
} from '../domain/relations.js';
import { confirmBulkOperation } from '../utils/bulkGuard.js';

const nodeTypes = { card: CardNode, kjgroup: GroupNode };
const edgeTypes = { relation: RelationEdge };

// 対策4: スナップショットの trigger を日本語ラベル化して「操作・復元履歴」を読みやすく．
const SNAPSHOT_TRIGGER_LABELS: Record<string, string> = {
  manual: '手動',
  count: '自動(操作)',
  time: '自動(時間)',
  'pre-compact': '整理前',
  'circuit-breaker-prestate': '大規模変更の直前',
  'pre-restore': '復元前',
};
function snapshotTriggerLabel(trigger: string): string {
  return SNAPSHOT_TRIGGER_LABELS[trigger] ?? trigger;
}

type AnyNodeData = CardNodeData | GroupNodeData;

export function CanvasView() {
  return (
    <ReactFlowProvider>
      <CanvasViewImpl />
    </ReactFlowProvider>
  );
}

function CanvasViewImpl() {
  const { screenToFlowPosition, fitView, setCenter } = useReactFlow();

  useEffect(() => {
    const handler = () => {
      fitView({ padding: 0.2, duration: 300 });
    };
    window.addEventListener('kj.requestFitView', handler);
    return () => window.removeEventListener('kj.requestFitView', handler);
  }, [fitView]);

  // (#5) 未分類/保留ペインがカードをキャンバスに配置する際に使う「現在の表示中心
  // (flow 座標)」を取得する関数を公開する.  CanvasView がマウントされている間だけ
  // 有効. 未マウント時 (原文ビューアタブ等) は CardPlacementPane 側が fallback.
  useEffect(() => {
    (window as unknown as { __kjGetCanvasCenter?: () => { x: number; y: number } | null }).
      __kjGetCanvasCenter = () => {
      const el = document.querySelector('.react-flow');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    };
    return () => {
      delete (window as unknown as { __kjGetCanvasCenter?: unknown }).__kjGetCanvasCenter;
    };
  }, [screenToFlowPosition]);

  // 2026-06-02: カード整列でカード同士が被る問題対応．React Flow の実測サイズを
  // App.tsx の整列処理から参照できるよう公開する．カード ID (data.id) で引ける．
  useEffect(() => {
    const w = window as unknown as {
      __kjGetNodeSize?: (id: string) => { width: number; height: number } | null;
    };
    w.__kjGetNodeSize = (id: string) => {
      // ReactFlow renders nodes as elements with data-id attribute
      const el = document.querySelector(`.react-flow__node[data-id="${id}"]`) as HTMLElement | null;
      if (!el) return null;
      // offsetWidth/Height = ReactFlow に表示される実サイズ (zoom 影響なし)
      return { width: el.offsetWidth, height: el.offsetHeight };
    };
    return () => {
      delete w.__kjGetNodeSize;
    };
  }, []);

  // (#6) 階層表示などから「キャンバスでこのカードを表示」: ビューを移動 + 選択.
  useEffect(() => {
    const handler = (ev: Event) => {
      const cardId = (ev as CustomEvent).detail?.cardId as string | undefined;
      if (!cardId) return;
      const proj = useProjectStore.getState().project;
      if (!proj) return;
      useProjectStore.getState().selectCard(cardId);
      const pos = proj.data.card_positions.find((p) => p.cardId === cardId);
      if (pos) {
        setCenter(pos.x, pos.y, { zoom: 1, duration: 400 });
      } else {
        fitView({ padding: 0.2, duration: 300 });
      }
    };
    window.addEventListener('kj.centerOnCard', handler as EventListener);
    return () => window.removeEventListener('kj.centerOnCard', handler as EventListener);
  }, [setCenter, fitView]);

  // 2026-06-02: グループへのジャンプ．group_positions の中心へビューを移動 + 選択．
  useEffect(() => {
    const handler = (ev: Event) => {
      const groupId = (ev as CustomEvent).detail?.groupId as string | undefined;
      if (!groupId) return;
      const proj = useProjectStore.getState().project;
      if (!proj) return;
      useProjectStore.getState().selectGroup(groupId);
      const gp = proj.data.group_positions.find((p) => p.groupId === groupId);
      if (gp) {
        // group_positions の x,y は左上．中心へ補正．
        setCenter(gp.x + gp.width / 2, gp.y + gp.height / 2, { zoom: 0.85, duration: 400 });
      } else {
        fitView({ padding: 0.2, duration: 300 });
      }
    };
    window.addEventListener('kj.centerOnGroup', handler as EventListener);
    return () => window.removeEventListener('kj.centerOnGroup', handler as EventListener);
  }, [setCenter, fitView]);

  const project = useProjectStore((s) => s.project);
  const selectedCardId = useProjectStore((s) => s.selectedCardId);
  const selectedCardIds = useProjectStore((s) => s.selectedCardIds);
  const selectedGroupId = useProjectStore((s) => s.selectedGroupId);
  const selectedGroupIds = useProjectStore((s) => s.selectedGroupIds);
  // 2026-06-02: 表示・非表示フィルタ (左ペインで目アイコンで toggle)
  const hiddenParticipantIds = useProjectStore((s) => s.hiddenParticipantIds);
  const hiddenGroupIds = useProjectStore((s) => s.hiddenGroupIds);
  const hiddenTags = useProjectStore((s) => s.hiddenTags);
  // 2026-06-02: キャンバスモード (pan / select)
  const canvasMode = useProjectStore((s) => s.canvasInteractionMode);
  const setCanvasMode = useProjectStore((s) => s.setCanvasInteractionMode);
  const selectCard = useProjectStore((s) => s.selectCard);
  const selectCardIds = useProjectStore((s) => s.selectCardIds);
  const selectGroup = useProjectStore((s) => s.selectGroup);
  const selectGroupIds = useProjectStore((s) => s.selectGroupIds);
  const selectMixed = useProjectStore((s) => s.selectMixed);
  const selectSegment = useProjectStore((s) => s.selectSegment);
  const selectRelation = useProjectStore((s) => s.selectRelation);
  const selectedRelationId = useProjectStore((s) => s.selectedRelationId);
  const applyCommand = useProjectStore((s) => s.applyCommand);

  const [nodes, setNodes, onNodesChangeInternal] = useNodesState<AnyNodeData>([]);

  /**
   * Read measured DOM sizes from the current React Flow nodes. Used by
   * group auto-fit so the rectangle hugs actual card edges instead of
   * relying on the conservative defaults.
   */
  const getMeasuredSizes = useCallback(() => {
    const map = new Map<string, { width: number; height: number }>();
    for (const n of nodes) {
      if (typeof n.width === 'number' && typeof n.height === 'number') {
        map.set(n.id, { width: n.width, height: n.height });
      }
    }
    return map;
  }, [nodes]);
  const [contextMenu, setContextMenu] = useState<
    | { kind: 'card'; x: number; y: number; cardId: string }
    | { kind: 'group'; x: number; y: number; groupId: string; cardIds: string[] }
    | null
  >(null);
  const [splitCardId, setSplitCardId] = useState<string | null>(null);
  // 段階2: アプリ内スナップショット (手動作成 + 一覧)．
  const [snapshotConnected, setSnapshotConnected] = useState<boolean>(
    () => syncManager.getSnapshotApiTarget() !== null
  );
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [snapshotMsg, setSnapshotMsg] = useState<string | null>(null);
  const [snapshotListOpen, setSnapshotListOpen] = useState(false);
  const [snapshotItems, setSnapshotItems] = useState<SnapshotEntry[] | null>(null);
  const [snapshotListError, setSnapshotListError] = useState<string | null>(null);
  // 対策5: 復元は editor / admin のみ．role 未通知は editor 既定 (safe fallback)．
  const [canRestore, setCanRestore] = useState<boolean>(() => {
    const r = syncManager.getState().role?.role;
    return r !== 'viewer';
  });
  const [restoreBusy, setRestoreBusy] = useState<string | null>(null);

  useEffect(() => {
    // 接続状態 / role が変わったらボタンの有効/無効を更新．
    const update = () => {
      setSnapshotConnected(syncManager.getSnapshotApiTarget() !== null);
      setCanRestore(syncManager.getState().role?.role !== 'viewer');
    };
    update();
    return syncManager.on(update);
  }, []);

  const onCreateSnapshot = useCallback(async () => {
    const label = window.prompt('スナップショットのラベル（任意）', '');
    if (label === null) return; // キャンセル
    setSnapshotBusy(true);
    setSnapshotMsg(null);
    try {
      const entry = await createSnapshot(label.trim() || undefined);
      setSnapshotMsg(
        `スナップショットを作成しました（cards=${entry.counts.cards} groups=${entry.counts.groups}）`
      );
    } catch (e) {
      setSnapshotMsg(
        e instanceof SnapshotApiError ? e.message : `作成に失敗しました: ${String(e)}`
      );
    } finally {
      setSnapshotBusy(false);
    }
  }, []);

  const openSnapshotList = useCallback(async () => {
    setSnapshotListOpen(true);
    setSnapshotItems(null);
    setSnapshotListError(null);
    try {
      setSnapshotItems(await fetchSnapshots());
    } catch (e) {
      setSnapshotListError(
        e instanceof SnapshotApiError ? e.message : `取得に失敗しました: ${String(e)}`
      );
    }
  }, []);

  // 対策5: スナップショット復元．二段確認 → サーバー復元 → 再接続で復元状態を取得．
  const onRestoreSnapshot = useCallback(async (s: SnapshotEntry) => {
    const when = new Date(s.ts).toLocaleString();
    if (
      !window.confirm(
        `この状態に復元します。\n` +
          `${when} / ${snapshotTriggerLabel(s.trigger)} / ` +
          `C${s.counts.cards} G${s.counts.groups} M${s.counts.memberships}`
      )
    )
      return;
    if (
      !window.confirm(
        '現在の状態は上書きされます（復元前の状態も自動で退避されます）。\n' +
          '全員が一旦切断され、再接続で復元後の状態になります。復元しますか？'
      )
    )
      return;
    setRestoreBusy(s.id);
    setSnapshotMsg(null);
    try {
      await restoreSnapshot(s.id);
      setSnapshotListOpen(false);
      setSnapshotMsg('復元しました。再接続しています…');
      try {
        await syncManager.reconnect();
        setSnapshotMsg('復元して再接続しました。');
      } catch {
        setSnapshotMsg('復元しました。手動で再接続してください。');
      }
    } catch (e) {
      setSnapshotMsg(
        e instanceof SnapshotApiError ? e.message : `復元に失敗しました: ${String(e)}`
      );
    } finally {
      setRestoreBusy(null);
    }
  }, []);
  const [pickerFor, setPickerFor] = useState<
    | { kind: 'card'; cardId: string }
    | { kind: 'group'; groupId: string }
    | null
  >(null);
  const [styleEditorFor, setStyleEditorFor] = useState<
    | { kind: 'card'; cardId: string }
    | { kind: 'group'; groupId: string }
    | null
  >(null);
  const cardDragStartRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const groupDragStartRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const groupDescendantsRef = useRef<Map<string, GroupDescendantPosition[]>>(new Map());
  const draggingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!project) {
      setNodes([]);
      return;
    }
    const partMap = new Map(project.data.participants.map((p) => [p.id, p.code]));
    const posMap = new Map(project.data.card_positions.map((p) => [p.cardId, p]));
    const settings = project.metadata.displaySettings;
    const memberCountMap = new Map<string, number>();
    const cardById = new Map(project.data.cards.map((c) => [c.id, c]));
    for (const m of project.data.group_memberships) {
      const c = cardById.get(m.cardId);
      if (!c) continue; // skip stale memberships (deleted cards)
      if (effectivePlacement(c) !== 'canvas') continue; // count only what's drawn
      memberCountMap.set(m.groupId, (memberCountMap.get(m.groupId) ?? 0) + 1);
    }
    const cardSelectedSet = new Set(selectedCardIds);
    setNodes((current) => {
      const currentPosMap = new Map(current.map((n) => [n.id, n.position]));

      const groupSelectedSet = new Set(selectedGroupIds);
      const hiddenIds = getHiddenIds(project.data);
      // 2026-06-02: 表示フィルタを適用するための補助 set
      const hiddenPartSet = new Set(hiddenParticipantIds);
      const hiddenGroupSet = new Set(hiddenGroupIds);
      const hiddenTagSet = new Set(hiddenTags);
      // 非表示グループに属するカードもキャンバスから隠す
      const cardsHiddenByGroup = new Set<string>();
      if (hiddenGroupSet.size > 0) {
        for (const m of project.data.group_memberships) {
          if (hiddenGroupSet.has(m.groupId)) cardsHiddenByGroup.add(m.cardId);
        }
      }
      const groupNodes: Node<GroupNodeData>[] = project.data.groups
        .filter((g) => !hiddenIds.has(g.id))
        .filter((g) => !hiddenGroupSet.has(g.id))
        .map((g) => {
        const pos = project.data.group_positions.find((p) => p.groupId === g.id);
        const live = draggingRef.current.has(g.id) ? currentPosMap.get(g.id) : undefined;
        const position = live ?? { x: pos?.x ?? 0, y: pos?.y ?? 0 };
        const label = getGroupLabel(project.data, g.id);
        const isSelected = groupSelectedSet.has(g.id) || g.id === selectedGroupId;
        const width = pos?.width ?? 320;
        const height = pos?.height ?? 200;
        return {
          id: g.id,
          type: 'kjgroup',
          position,
          style: { width, height },
          data: {
            name: g.name,
            labelText: label?.text ?? '',
            memberCount: memberCountMap.get(g.id) ?? 0,
            width,
            height,
            selected: isSelected,
            level: g.level,
            collapsed: g.collapsed,
            effectiveFontSize: g.displayStyle?.fontSize ?? settings?.groupFontSize,
            effectiveFontWeight: g.displayStyle?.fontWeight,
            effectiveColor: g.displayStyle?.color,
            effectiveBackground: g.displayStyle?.background,
            effectiveBorderColor: g.displayStyle?.borderColor,
            effectiveBorderWidth: g.displayStyle?.borderWidth,
            effectiveBorderStyle: g.displayStyle?.borderStyle,
          },
          selected: isSelected,
          zIndex: Math.max(-50, 10 - g.level * 5),
          draggable: true,
          selectable: true,
          deletable: false,
        };
      });

      const cardNodes: Node<CardNodeData>[] = project.data.cards
        .filter((c) => !hiddenIds.has(c.id) && effectivePlacement(c) === 'canvas')
        .filter((c) => !hiddenPartSet.has(c.participantId))
        .filter((c) => !cardsHiddenByGroup.has(c.id))
        .filter(
          (c) => hiddenTagSet.size === 0 || !(c.tags ?? []).some((t) => hiddenTagSet.has(t))
        )
        .map((c) => {
        const storedPos = posMap.get(c.id);
        const livePos = draggingRef.current.has(c.id) ? currentPosMap.get(c.id) : undefined;
        const position = livePos ?? { x: storedPos?.x ?? 0, y: storedPos?.y ?? 0 };
        const isSelected = cardSelectedSet.has(c.id) || c.id === selectedCardId;
        const cardStyle = c.displayStyle;
        const collapsed = c.collapsed === true;
        return {
          id: c.id,
          type: 'card',
          position,
          style: collapsed
            ? { width: 'auto' as const }
            : settings?.cardWrapWidth
              ? { width: settings.cardWrapWidth }
              : undefined,
          data: {
            code: c.code,
            body: c.body,
            participantCode: partMap.get(c.participantId) ?? '',
            selected: isSelected,
            effectiveFontSize: cardStyle?.fontSize ?? settings?.cardFontSize,
            effectiveFontWeight: cardStyle?.fontWeight,
            effectiveColor: cardStyle?.color,
            effectiveBackground: cardStyle?.background,
            effectiveBorderColor: cardStyle?.borderColor,
            effectiveBorderWidth: cardStyle?.borderWidth,
            effectiveBorderStyle: cardStyle?.borderStyle,
            maxChars: settings?.cardMaxChars,
            collapsed,
            mergedFrom: c.mergedFrom,
          },
          selected: isSelected,
          zIndex: 10 + (storedPos?.z ?? 0),
        };
      });

      return [...groupNodes, ...cardNodes];
    });
  }, [
    project,
    selectedCardId,
    selectedCardIds,
    selectedGroupId,
    selectedGroupIds,
    setNodes,
    hiddenParticipantIds,
    hiddenGroupIds,
    hiddenTags,
  ]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChangeInternal(changes);
    },
    [onNodesChangeInternal]
  );

  const onSelectionChange = useCallback<OnSelectionChangeFunc>(
    ({ nodes: selectedNodes }) => {
      const selectedCardNodeIds: string[] = [];
      const selectedGroupNodeIds: string[] = [];
      for (const n of selectedNodes) {
        if (n.type === 'card') selectedCardNodeIds.push(n.id);
        else if (n.type === 'kjgroup') selectedGroupNodeIds.push(n.id);
      }
      // Mixed selection: keep both buckets populated so the "add to existing
      // group" flow can read both at once. Pure selections behave as before.
      if (selectedCardNodeIds.length > 0 && selectedGroupNodeIds.length > 0) {
        selectMixed(selectedCardNodeIds, selectedGroupNodeIds);
      } else if (selectedGroupNodeIds.length > 0) {
        selectGroupIds(selectedGroupNodeIds);
      } else if (selectedCardNodeIds.length > 0) {
        selectCardIds(selectedCardNodeIds);
        if (selectedCardNodeIds.length === 1 && project) {
          const link = project.data.card_source_links.find(
            (l) => l.cardId === selectedCardNodeIds[0]
          );
          if (link) selectSegment(link.segmentId);
        }
      } else {
        selectCard(null);
        selectGroup(null);
      }
    },
    [project, selectCard, selectCardIds, selectGroup, selectGroupIds, selectMixed, selectSegment]
  );

  const onNodeDragStart = useCallback<NodeMouseHandler>(
    (_e, node) => {
      if (!project) return;
      if (node.type === 'card') {
        const pos = project.data.card_positions.find((p) => p.cardId === node.id);
        if (pos) cardDragStartRef.current.set(node.id, { x: pos.x, y: pos.y });
        // 複数選択中は選択カード全ての開始位置も記録し，DragStop で一括保存する．
        if (selectedCardIds.length > 1 && selectedCardIds.includes(node.id)) {
          for (const id of selectedCardIds) {
            if (id === node.id) continue;
            const p = project.data.card_positions.find((pp) => pp.cardId === id);
            if (p) cardDragStartRef.current.set(id, { x: p.x, y: p.y });
          }
        }
      } else if (node.type === 'kjgroup') {
        const pos = project.data.group_positions.find((p) => p.groupId === node.id);
        if (pos) groupDragStartRef.current.set(node.id, { x: pos.x, y: pos.y });
        const desc = collectGroupDescendantsForDrag(project.data, node.id);
        groupDescendantsRef.current.set(node.id, desc);
        for (const d of desc) draggingRef.current.add(d.id);
      }
      draggingRef.current.add(node.id);
    },
    [project, selectedCardIds]
  );

  const onNodeDrag = useCallback<NodeMouseHandler>(
    (_e, node) => {
      if (node.type !== 'kjgroup') return;
      const start = groupDragStartRef.current.get(node.id);
      const desc = groupDescendantsRef.current.get(node.id);
      if (!start || !desc || desc.length === 0) return;
      const dx = node.position.x - start.x;
      const dy = node.position.y - start.y;
      const startMap = new Map(desc.map((d) => [d.id, d.startPos]));
      setNodes((curr) =>
        curr.map((n) => {
          const sp = startMap.get(n.id);
          if (!sp) return n;
          return { ...n, position: { x: sp.x + dx, y: sp.y + dy } };
        })
      );
    },
    [setNodes]
  );

  const onNodeDragStop = useCallback<NodeMouseHandler>(
    (_e, node) => {
      draggingRef.current.delete(node.id);
      let to = { x: node.position.x, y: node.position.y };
      if (node.type === 'card') {
        const from = cardDragStartRef.current.get(node.id);
        cardDragStartRef.current.delete(node.id);
        if (!from) return;
        if (Math.abs(from.x - to.x) < 1 && Math.abs(from.y - to.y) < 1) return;

        // 複数選択ドラッグ: 掴んだカードと同じ delta で選択カード全てを一括移動する．
        // React Flow は視覚的に全選択カードを動かすが，従来は掴んだ 1 枚しか
        // 保存されず他が元に戻っていた (バグ)．bulk コマンドで全て保存する．
        const isMulti = selectedCardIds.length > 1 && selectedCardIds.includes(node.id);
        if (isMulti && project) {
          const dx = to.x - from.x;
          const dy = to.y - from.y;
          const moves: Array<{
            cardId: string;
            from: { x: number; y: number };
            to: { x: number; y: number };
          }> = [];
          const overrides = new Map<string, { x: number; y: number }>();
          for (const id of selectedCardIds) {
            const f = cardDragStartRef.current.get(id) ??
              (id === node.id ? from : undefined);
            cardDragStartRef.current.delete(id);
            if (!f) continue;
            const t = { x: f.x + dx, y: f.y + dy };
            moves.push({ cardId: id, from: f, to: t });
            overrides.set(id, t);
          }
          // 対策1: 大量カードの一括移動は確認する．キャンセル時は視覚位置を元へ戻す．
          if (!confirmBulkOperation(moves.length, '一括で移動')) {
            const fromById = new Map(moves.map((m) => [m.cardId, m.from]));
            setNodes((curr) =>
              curr.map((n) => {
                const f = fromById.get(n.id);
                return f ? { ...n, position: { x: f.x, y: f.y } } : n;
              })
            );
            return;
          }
          const cardWrapWidth = project.metadata.displaySettings?.cardWrapWidth;
          const groupBoundsUpdates = computeCascadedGroupBoundsUpdates(
            project.data,
            overrides,
            new Map(),
            { measuredSizes: getMeasuredSizes(), defaultCardWidth: cardWrapWidth }
          );
          applyCommand(makeMoveCardsBulkCommand(moves, groupBoundsUpdates));
          return;
        }

        // Push the card out of any group rectangle it does not belong to.
        if (project) {
          const containers = getContainerGroupIds(project.data, node.id, 'card');
          const measured = getMeasuredSizes().get(node.id);
          const size = {
            width: measured?.width ?? 220,
            height: measured?.height ?? 100,
          };
          to = resolveOverlapWithGroups(project.data, to, size, containers);
        }
        const overrides = new Map<string, { x: number; y: number }>([[node.id, to]]);
        const cardWrapWidth = project?.metadata.displaySettings?.cardWrapWidth;
        const groupBoundsUpdates = project
          ? computeCascadedGroupBoundsUpdates(project.data, overrides, new Map(), {
              measuredSizes: getMeasuredSizes(),
              defaultCardWidth: cardWrapWidth,
            })
          : [];
        applyCommand(makeMoveCardCommand(node.id, from, to, groupBoundsUpdates));
      } else if (node.type === 'kjgroup') {
        const from = groupDragStartRef.current.get(node.id);
        const desc = groupDescendantsRef.current.get(node.id) ?? [];
        groupDragStartRef.current.delete(node.id);
        groupDescendantsRef.current.delete(node.id);
        for (const d of desc) draggingRef.current.delete(d.id);
        if (!from) return;
        if (Math.abs(from.x - to.x) < 1 && Math.abs(from.y - to.y) < 1) return;
        // Push the dragged group out of any group rect that is not an ancestor.
        // Descendants will move with the same delta, preserving relative layout.
        if (project) {
          const containers = getContainerGroupIds(project.data, node.id, 'group');
          const draggedPos = project.data.group_positions.find(
            (p) => p.groupId === node.id
          );
          if (draggedPos) {
            const adjusted = resolveOverlapWithGroups(
              project.data,
              to,
              { width: draggedPos.width, height: draggedPos.height },
              containers
            );
            to = adjusted;
          }
        }
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const childMoves: PositionDelta[] = desc.map((d) => ({
          id: d.id,
          type: d.type,
          from: d.startPos,
          to: { x: d.startPos.x + dx, y: d.startPos.y + dy },
        }));
        // Compute ancestor group auto-fit updates. Build card and group
        // overrides from the new positions so the cascade sees post-drag state.
        const cardOverrides = new Map<string, { x: number; y: number }>();
        const groupOverrides = new Map<
          string,
          { x: number; y: number; width: number; height: number }
        >();
        // The dragged group itself translates; pass its new position as override.
        if (project) {
          const draggedPos = project.data.group_positions.find(
            (p) => p.groupId === node.id
          );
          if (draggedPos) {
            groupOverrides.set(node.id, {
              x: to.x,
              y: to.y,
              width: draggedPos.width,
              height: draggedPos.height,
            });
          }
        }
        for (const m of childMoves) {
          if (m.type === 'card') cardOverrides.set(m.id, m.to);
          else if (m.type === 'group') {
            const orig = project?.data.group_positions.find(
              (p) => p.groupId === m.id
            );
            if (orig) {
              groupOverrides.set(m.id, {
                x: m.to.x,
                y: m.to.y,
                width: orig.width,
                height: orig.height,
              });
            }
          }
        }
        const cardWrapWidth = project?.metadata.displaySettings?.cardWrapWidth;
        const ancestorUpdates = project
          ? computeCascadedGroupBoundsUpdates(
              project.data,
              cardOverrides,
              groupOverrides,
              { measuredSizes: getMeasuredSizes(), defaultCardWidth: cardWrapWidth }
            ).filter(
              (u) =>
                u.next.groupId !== node.id &&
                !childMoves.some((m) => m.type === 'group' && m.id === u.next.groupId)
            )
          : [];
        applyCommand(
          makeMoveGroupWithChildrenCommand(node.id, from, to, childMoves, ancestorUpdates)
        );
      }
    },
    [applyCommand, project, selectedCardIds]
  );

  const onPaneClick = useCallback(() => {
    selectCard(null);
    selectGroup(null);
    selectRelation(null);
    setContextMenu(null);
  }, [selectCard, selectGroup, selectRelation]);

  const onNodeContextMenu = useCallback<NodeMouseHandler>(
    (e, node) => {
      e.preventDefault();
      if (node.type === 'card') {
        setContextMenu({ kind: 'card', x: e.clientX, y: e.clientY, cardId: node.id });
        selectCard(node.id);
      } else if (node.type === 'kjgroup') {
        // selectGroup(node.id) はカード選択をクリアするため，右クリック時点で
        // 選択中だったカードを退避し，「このグループへ編入」メニューで使う．
        setContextMenu({
          kind: 'group',
          x: e.clientX,
          y: e.clientY,
          groupId: node.id,
          cardIds: [...selectedCardIds],
        });
        selectGroup(node.id);
      }
    },
    [selectCard, selectGroup, selectedCardIds]
  );

  const changePlacement = useCallback(
    (cardId: string, placement: 'canvas' | 'unclassified' | 'pending') => {
      if (!project) return;
      const card = project.data.cards.find((c) => c.id === cardId);
      if (!card) return;
      const oldPos = project.data.card_positions.find((p) => p.cardId === cardId);
      applyCommand(
        makeSetCardPlacementCommand(
          cardId,
          {
            placement: effectivePlacement(card),
            position: oldPos ? { x: oldPos.x, y: oldPos.y } : null,
            updatedAt: card.updatedAt,
          },
          {
            placement,
            position: placement === 'canvas' && oldPos ? { x: oldPos.x, y: oldPos.y } : undefined,
            now: new Date().toISOString(),
          }
        )
      );
      setContextMenu(null);
    },
    [project, applyCommand]
  );

  const openSplit = useCallback(
    (cardId: string) => {
      setSplitCardId(cardId);
      setContextMenu(null);
    },
    []
  );

  const handleConfirmSplit = useCallback(
    (parts: string[]) => {
      if (!project || !splitCardId) return;
      try {
        const out = buildSplitCards(project.data, {
          cardId: splitCardId,
          bodyParts: parts,
          now: new Date().toISOString(),
        });
        applyCommand(makeSplitCardCommand(out));
        setSplitCardId(null);
        if (out.newCards.length > 0) selectCard(out.newCards[0].id);
        // 分割後カードは元カードの配置 (placement) を継承する．未分類だと
        // キャンバス上に現れず「見えない」ため，未分類ペインへ誘導する．
        if (out.newCards.some((c) => (c.placement ?? 'canvas') === 'unclassified')) {
          alert(
            '分割後のカードは元カードと同じ「未分類」に置かれます．\n' +
              '左の未分類ペインを確認してください（キャンバスには表示されません）．'
          );
        }
      } catch (e) {
        if (e instanceof SplitError) alert(e.message);
        else throw e;
      }
    },
    [project, splitCardId, applyCommand, selectCard]
  );

  const toggleCardCollapsed = useCallback(
    (cardId: string) => {
      if (!project) return;
      const card = project.data.cards.find((c) => c.id === cardId);
      if (!card) return;
      applyCommand(
        makeToggleCardCollapsedCommand(
          card.id,
          !(card.collapsed === true),
          new Date().toISOString(),
          card.updatedAt
        )
      );
      setContextMenu(null);
    },
    [project, applyCommand]
  );

  const setCardZOrder = useCallback(
    (cardId: string, dir: 'front' | 'back') => {
      if (!project) return;
      const positions = project.data.card_positions;
      const cur = positions.find((p) => p.cardId === cardId);
      const prevZ = cur?.z ?? 0;
      const zs = positions.map((p) => p.z ?? 0);
      const nextZ =
        dir === 'front'
          ? (zs.length > 0 ? Math.max(...zs) : 0) + 1
          : (zs.length > 0 ? Math.min(...zs) : 0) - 1;
      if (nextZ !== prevZ) {
        applyCommand(
          makeSetCardZCommand(cardId, prevZ, nextZ, dir === 'front' ? '最前面へ' : '最背面へ')
        );
      }
      setContextMenu(null);
    },
    [project, applyCommand]
  );

  const unmergeCard = useCallback(
    (cardId: string) => {
      if (!project) return;
      try {
        const out = buildUnmergeCard(project.data, cardId);
        applyCommand(makeUnmergeCardCommand(out));
        if (out.restoredCards.length > 0) selectCardIds(out.restoredCards.map((c) => c.id));
      } catch (e) {
        if (e instanceof UnmergeError) alert(e.message);
        else throw e;
      }
      setContextMenu(null);
    },
    [project, applyCommand, selectCardIds]
  );

  const removeCardFromGroupViaMenu = useCallback(
    (cardId: string) => {
      if (!project) return;
      const card = project.data.cards.find((c) => c.id === cardId);
      const membership = project.data.group_memberships.find((m) => m.cardId === cardId);
      if (!card || !membership) {
        setContextMenu(null);
        return;
      }
      const synthesized = {
        ...project.data,
        group_memberships: project.data.group_memberships.filter(
          (m) => m.id !== membership.id
        ),
      };
      const cardWrapWidth = project.metadata.displaySettings?.cardWrapWidth;
      const cardOverrides = new Map<string, { x: number; y: number }>();
      const pos = project.data.card_positions.find((p) => p.cardId === cardId);
      if (pos) cardOverrides.set(cardId, { x: pos.x, y: pos.y });
      const groupOverride = new Map<
        string,
        { x: number; y: number; width: number; height: number }
      >();
      const sourcePos = project.data.group_positions.find(
        (p) => p.groupId === membership.groupId
      );
      if (sourcePos) {
        groupOverride.set(membership.groupId, {
          x: sourcePos.x,
          y: sourcePos.y,
          width: sourcePos.width,
          height: sourcePos.height,
        });
      }
      const groupBoundsUpdates = computeCascadedGroupBoundsUpdates(
        synthesized,
        cardOverrides,
        groupOverride,
        {
          defaultCardWidth: cardWrapWidth,
          measuredSizes: getMeasuredSizes(),
        }
      );
      applyCommand(makeRemoveCardFromGroupCommand(membership, groupBoundsUpdates));
      setContextMenu(null);
    },
    [project, applyCommand, getMeasuredSizes]
  );

  const dissolveGroup = useCallback(
    (groupId: string) => {
      if (!project) return;
      const group = project.data.groups.find((g) => g.id === groupId);
      if (!group) return;
      if (
        !confirm(
          `グループ「${group.name}」を解除しますか？\n` +
            'メンバーカード/子グループはこのグループから外れ, グループ自体は削除されます (Undo で復元可)'
        )
      )
        return;
      const label =
        project.data.labels.find((l) => l.groupId === groupId) ?? null;
      const position = getGroupPosition(project.data, groupId);
      const memberships = project.data.group_memberships.filter(
        (m) => m.groupId === groupId
      );
      // If this group has a parent, recompute the parent (and further ancestors)
      // since they now have one less child.
      let ancestorUpdates: ReturnType<
        typeof computeCascadedGroupBoundsUpdates
      > = [];
      if (group.parentGroupId) {
        const synthesized = {
          ...project.data,
          groups: project.data.groups.filter((g) => g.id !== groupId),
          group_memberships: project.data.group_memberships.filter(
            (m) => m.groupId !== groupId
          ),
        };
        const groupOverride = new Map<
          string,
          { x: number; y: number; width: number; height: number }
        >();
        const parentPos = project.data.group_positions.find(
          (p) => p.groupId === group.parentGroupId
        );
        if (parentPos) {
          groupOverride.set(group.parentGroupId!, {
            x: parentPos.x,
            y: parentPos.y,
            width: parentPos.width,
            height: parentPos.height,
          });
        }
        const cardWrapWidth = project.metadata.displaySettings?.cardWrapWidth;
        ancestorUpdates = computeCascadedGroupBoundsUpdates(
          synthesized,
          new Map(),
          groupOverride,
          { defaultCardWidth: cardWrapWidth, measuredSizes: getMeasuredSizes() }
        );
      }
      applyCommand(
        makeDeleteGroupCommand(group, label, position, memberships, ancestorUpdates)
      );
      setContextMenu(null);
    },
    [project, applyCommand, getMeasuredSizes]
  );

  // (#3) ラベル位置 (グループ枠の左上) を固定したまま，メンバーカードを隙間なく
  // グリッド整列する．枠は再フィットで縮むが x,y は不変なのでラベルは動かない．
  const alignGroupToLabel = useCallback(
    (groupId: string) => {
      if (!project) return;
      const cardWrapWidth = project.metadata.displaySettings?.cardWrapWidth;
      const packed = packGroupCards(project.data, groupId, {
        measuredSizes: getMeasuredSizes(),
        defaultCardWidth: cardWrapWidth,
      });
      if (!packed || packed.cardTargets.length === 0) {
        setContextMenu(null);
        return;
      }
      const moves = packed.cardTargets
        .map((t) => {
          const cur = project.data.card_positions.find(
            (p) => p.cardId === t.cardId
          );
          if (!cur) return null;
          if (cur.x === t.x && cur.y === t.y) return null;
          return {
            cardId: t.cardId,
            from: { x: cur.x, y: cur.y },
            to: { x: t.x, y: t.y },
          };
        })
        .filter(
          (m): m is { cardId: string; from: { x: number; y: number }; to: { x: number; y: number } } =>
            m !== null
        );
      if (moves.length === 0) {
        setContextMenu(null);
        return;
      }
      // このグループ + 祖先の枠を新カード位置から再フィット (枠 x,y は不変)．
      const cardOverride = new Map(
        packed.cardTargets.map((t) => [t.cardId, { x: t.x, y: t.y }] as const)
      );
      const groupBoundsUpdates = computeCascadedGroupBoundsUpdates(
        project.data,
        cardOverride,
        new Map(),
        { measuredSizes: getMeasuredSizes(), defaultCardWidth: cardWrapWidth }
      );
      applyCommand(makeMoveCardsBulkCommand(moves, groupBoundsUpdates));
      setContextMenu(null);
    },
    [project, applyCommand, getMeasuredSizes]
  );

  // 選択中のカード群を既存グループへ編入する．トグル無関係で，グループ枠 (と祖先) を
  // 新メンバーを含めて再フィットする．ツールバーの混在選択と右クリックメニューの
  // 両方から呼ぶ．
  const incorporateCardsIntoGroup = useCallback(
    (targetGroupId: string, cardIds: string[]) => {
      if (!project || cardIds.length === 0) return;
      const now = new Date().toISOString();
      const replaced: GroupMembership[] = [];
      const added: GroupMembership[] = [];
      for (const cid of cardIds) {
        const existing = project.data.group_memberships.find((m) => m.cardId === cid);
        if (existing && existing.groupId === targetGroupId) continue;
        if (existing) replaced.push(existing);
        added.push({ id: newId(), cardId: cid, groupId: targetGroupId, createdAt: now });
      }
      if (added.length === 0) return;
      // 対策1: 大量カードのグループ編入 (メンバーシップ一括付替) は確認する．
      if (!confirmBulkOperation(added.length, 'グループに編入')) return;
      const cardOverrides = new Map(
        cardIds
          .map((cid) => project.data.card_positions.find((p) => p.cardId === cid))
          .filter((p): p is NonNullable<typeof p> => !!p)
          .map((p) => [p.cardId, { x: p.x, y: p.y }] as const)
      );
      const synthesizedData = {
        ...project.data,
        group_memberships: [
          ...project.data.group_memberships.filter(
            (m) => !replaced.some((r) => r.id === m.id)
          ),
          ...added,
        ],
      };
      const cardWrapWidth = project.metadata.displaySettings?.cardWrapWidth;
      const groupBoundsUpdates = computeCascadedGroupBoundsUpdates(
        synthesizedData,
        cardOverrides,
        new Map(),
        { defaultCardWidth: cardWrapWidth, measuredSizes: getMeasuredSizes() }
      );
      applyCommand(
        makeAddCardsToGroupCommand(targetGroupId, added, replaced, groupBoundsUpdates)
      );
      selectGroup(targetGroupId);
    },
    [project, applyCommand, selectGroup, getMeasuredSizes]
  );

  const unnestFromParent = useCallback(
    (groupId: string) => {
      if (!project) return;
      const group = project.data.groups.find((g) => g.id === groupId);
      if (!group || !group.parentGroupId) {
        setContextMenu(null);
        return;
      }
      const parentId = group.parentGroupId;
      // The old parent has one less child group → recompute its bounds.
      const synthesized = {
        ...project.data,
        groups: project.data.groups.map((g) =>
          g.id === groupId ? { ...g, parentGroupId: null } : g
        ),
      };
      const groupOverride = new Map<
        string,
        { x: number; y: number; width: number; height: number }
      >();
      const parentPos = project.data.group_positions.find(
        (p) => p.groupId === parentId
      );
      if (parentPos) {
        groupOverride.set(parentId, {
          x: parentPos.x,
          y: parentPos.y,
          width: parentPos.width,
          height: parentPos.height,
        });
      }
      const cardWrapWidth = project.metadata.displaySettings?.cardWrapWidth;
      const ancestorUpdates = computeCascadedGroupBoundsUpdates(
        synthesized,
        new Map(),
        groupOverride,
        { defaultCardWidth: cardWrapWidth, measuredSizes: getMeasuredSizes() }
      );
      applyCommand(
        makeUnnestGroupCommand(
          groupId,
          parentId,
          new Date().toISOString(),
          group.updatedAt,
          ancestorUpdates
        )
      );
      setContextMenu(null);
    },
    [project, applyCommand]
  );

  // Picker confirms: add card to existing group, OR nest existing group under another.
  const handlePickGroup = useCallback(
    (targetGroupId: string) => {
      if (!project || !pickerFor) return;
      const now = new Date().toISOString();
      if (pickerFor.kind === 'card') {
        const cardId = pickerFor.cardId;
        const existing = project.data.group_memberships.find(
          (m) => m.cardId === cardId
        );
        if (existing && existing.groupId === targetGroupId) {
          setPickerFor(null);
          return;
        }
        const newMembership = {
          id: newId(),
          cardId,
          groupId: targetGroupId,
          createdAt: now,
        };
        const replaced = existing ? [existing] : [];
        const cardWrapWidth = project.metadata.displaySettings?.cardWrapWidth;
        const cardOverrides = new Map<string, { x: number; y: number }>();
        const pos = project.data.card_positions.find((p) => p.cardId === cardId);
        if (pos) cardOverrides.set(cardId, { x: pos.x, y: pos.y });
        const synthesized = {
          ...project.data,
          group_memberships: [
            ...project.data.group_memberships.filter(
              (m) => !replaced.some((r) => r.id === m.id)
            ),
            newMembership,
          ],
        };
        const updates = computeCascadedGroupBoundsUpdates(
          synthesized,
          cardOverrides,
          new Map(),
          { defaultCardWidth: cardWrapWidth }
        );
        applyCommand(
          makeAddCardsToGroupCommand(targetGroupId, [newMembership], replaced, updates)
        );
        selectCard(cardId);
      } else {
        const groupId = pickerFor.groupId;
        const target = project.data.groups.find((g) => g.id === targetGroupId);
        const src = project.data.groups.find((g) => g.id === groupId);
        if (!target || !src) {
          setPickerFor(null);
          return;
        }
        if (target.level <= src.level) {
          alert('上位のレベルのグループにしか入れられません');
          setPickerFor(null);
          return;
        }
        const prev: Record<string, string | null> = {
          [groupId]: src.parentGroupId,
        };
        // Synthesize post-nest data: the new parent now has groupId as a child.
        // Recompute the target parent (and its ancestors) so the bound covers
        // the newly nested group.
        const synthesized = {
          ...project.data,
          groups: project.data.groups.map((g) =>
            g.id === groupId ? { ...g, parentGroupId: targetGroupId } : g
          ),
        };
        const groupOverride = new Map<
          string,
          { x: number; y: number; width: number; height: number }
        >();
        const targetPos = project.data.group_positions.find(
          (p) => p.groupId === targetGroupId
        );
        if (targetPos) {
          groupOverride.set(targetGroupId, {
            x: targetPos.x,
            y: targetPos.y,
            width: targetPos.width,
            height: targetPos.height,
          });
        }
        // Also include the old parent (which loses this child) so it shrinks.
        if (src.parentGroupId) {
          const oldParentPos = project.data.group_positions.find(
            (p) => p.groupId === src.parentGroupId
          );
          if (oldParentPos) {
            groupOverride.set(src.parentGroupId, {
              x: oldParentPos.x,
              y: oldParentPos.y,
              width: oldParentPos.width,
              height: oldParentPos.height,
            });
          }
        }
        const cardWrapWidth = project.metadata.displaySettings?.cardWrapWidth;
        const boundsUpdates = computeCascadedGroupBoundsUpdates(
          synthesized,
          new Map(),
          groupOverride,
          { defaultCardWidth: cardWrapWidth, measuredSizes: getMeasuredSizes() }
        );
        applyCommand(
          makeNestIntoExistingGroupCommand(
            targetGroupId,
            [groupId],
            prev,
            now,
            boundsUpdates
          )
        );
        selectGroup(groupId);
      }
      setPickerFor(null);
    },
    [project, pickerFor, applyCommand, selectCard, selectGroup]
  );

  const deleteCard = useCallback(
    (cardId: string) => {
      if (!project) return;
      const card = project.data.cards.find((c) => c.id === cardId);
      if (!card) return;
      if (!confirm(`カード ${card.code} を削除しますか？ (Undo で復元できます)`)) return;
      const links = project.data.card_source_links.filter((l) => l.cardId === cardId);
      const pos = project.data.card_positions.find((p) => p.cardId === cardId) ?? null;
      applyCommand(makeDeleteCardCommand(card, links, pos));
      selectCard(null);
      setContextMenu(null);
    },
    [project, applyCommand, selectCard]
  );

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [contextMenu]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/kjproj-card-id')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const cardId = e.dataTransfer.getData('application/kjproj-card-id');
      if (!cardId || !project) return;
      const card = project.data.cards.find((c) => c.id === cardId);
      if (!card) return;
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const oldPos = project.data.card_positions.find((p) => p.cardId === cardId);
      applyCommand(
        makeSetCardPlacementCommand(
          cardId,
          {
            placement: effectivePlacement(card),
            position: oldPos ? { x: oldPos.x, y: oldPos.y } : null,
            updatedAt: card.updatedAt,
          },
          {
            placement: 'canvas',
            position: { x: pos.x, y: pos.y },
            now: new Date().toISOString(),
          }
        )
      );
      selectCard(cardId);
    },
    [project, applyCommand, screenToFlowPosition, selectCard]
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      if (!project || !conn.source || !conn.target) return;
      const sourceIsGroup = project.data.groups.some((g) => g.id === conn.source);
      const targetIsGroup = project.data.groups.some((g) => g.id === conn.target);
      const sourceType = sourceIsGroup ? 'group' : 'card';
      const targetType = targetIsGroup ? 'group' : 'card';
      if (
        relationExists(project.data, sourceType, conn.source, targetType, conn.target)
      ) {
        return;
      }
      try {
        const rel = buildRelation({
          sourceObjectType: sourceType,
          sourceObjectId: conn.source,
          targetObjectType: targetType,
          targetObjectId: conn.target,
          relationType: 'causes',
          now: new Date().toISOString(),
        });
        applyCommand(makeCreateRelationCommand(rel));
        selectRelation(rel.id);
      } catch {
        // ignore (e.g., self-loop)
      }
    },
    [project, applyCommand, selectRelation]
  );

  const onEdgeClick = useCallback<EdgeMouseHandler>(
    (_e, edge) => {
      selectRelation(edge.id);
    },
    [selectRelation]
  );

  // Detect "nest into existing parent" case: the selection has exactly one
  // group at the highest level AND all other selected groups are exactly one
  // level below it (and not already parented elsewhere).
  const nestIntoExisting = (() => {
    if (!project || selectedGroupIds.length < 2) return null;
    const sel = selectedGroupIds
      .map((id) => project.data.groups.find((g) => g.id === id))
      .filter((g): g is NonNullable<typeof g> => !!g);
    if (sel.length !== selectedGroupIds.length) return null;
    const maxLevel = Math.max(...sel.map((g) => g.level));
    const parents = sel.filter((g) => g.level === maxLevel);
    const children = sel.filter((g) => g.level === maxLevel - 1);
    if (parents.length !== 1) return null;
    if (children.length === 0) return null;
    if (children.length + parents.length !== sel.length) return null;
    // All children must be unparented or already this parent's (skip already).
    const parentId = parents[0].id;
    const valid = children.filter((c) => c.parentGroupId !== parentId);
    if (valid.length === 0) return null;
    return { parentId, childIds: valid.map((c) => c.id) };
  })();

  const onCreateParentGroup = useCallback(() => {
    if (!project) return;
    const now = new Date().toISOString();
    // Branch 1: nest selected child groups under an existing higher group.
    if (nestIntoExisting) {
      const prev: Record<string, string | null> = {};
      for (const cid of nestIntoExisting.childIds) {
        const g = project.data.groups.find((gg) => gg.id === cid);
        prev[cid] = g?.parentGroupId ?? null;
      }
      applyCommand(
        makeNestIntoExistingGroupCommand(
          nestIntoExisting.parentId,
          nestIntoExisting.childIds,
          prev,
          now
        )
      );
      selectGroup(nestIntoExisting.parentId);
      return;
    }
    // Branch 2: wrap selected groups into a fresh new parent.
    const candidateIds = selectedGroupIds.filter((id) => {
      const g = project.data.groups.find((gg) => gg.id === id);
      return g && g.parentGroupId === null;
    });
    if (candidateIds.length < 1) return;
    const out = buildParentGroup(project.data, { childGroupIds: candidateIds, now });
    applyCommand(
      makeNestGroupsCommand(out.parent, out.parentLabel, out.parentPosition, out.childGroups, now)
    );
    selectGroup(out.parent.id);
  }, [project, selectedGroupIds, nestIntoExisting, applyCommand, selectGroup]);

  const canMakeParentGroup =
    !!nestIntoExisting ||
    (selectedGroupIds.length >= 1 &&
      !!project &&
      selectedGroupIds.every((id) => {
        const g = project.data.groups.find((gg) => gg.id === id);
        return g && g.parentGroupId === null;
      }));

  const onMergeCards = useCallback(() => {
    if (!project) return;
    if (selectedCardIds.length < 2) return;
    const oldCards = project.data.cards.filter((c) => selectedCardIds.includes(c.id));
    const participantIds = new Set(oldCards.map((c) => c.participantId));
    if (participantIds.size > 1) {
      alert('異なる参加者のカードは結合できません');
      return;
    }
    const codes = oldCards
      .slice()
      .sort((a, b) => a.serialNumber - b.serialNumber)
      .map((c) => c.code)
      .join(', ');
    if (!confirm(`${oldCards.length} 枚のカード (${codes}) を 1 枚に結合しますか？\n(Undo で復元できます)`)) {
      return;
    }
    try {
      const now = new Date().toISOString();
      const out = buildMergedCard(project.data, { cardIds: selectedCardIds, now });
      applyCommand(makeMergeCardsCommand(out));
      selectCard(out.newCard.id);
    } catch (e) {
      if (e instanceof MergeError) {
        alert(e.message);
      } else {
        throw e;
      }
    }
  }, [project, selectedCardIds, applyCommand, selectCard]);

  const canMergeCards =
    selectedCardIds.length >= 2 &&
    !!project &&
    (() => {
      const ids = new Set(selectedCardIds);
      const ps = new Set(
        project.data.cards.filter((c) => ids.has(c.id)).map((c) => c.participantId)
      );
      return ps.size === 1;
    })();

  const onCreateGroup = useCallback(() => {
    if (!project || selectedCardIds.length === 0) return;
    const now = new Date().toISOString();

    // Mixed selection: cards + exactly one group → 既存グループへ編入．
    // React Flow のノード選択が不安定な場合に備え, ストアの selectedGroupIds も参照する．
    const selectedGroupNodeIds = (() => {
      const fromNodes = nodes
        .filter((n) => n.selected && n.type === 'kjgroup')
        .map((n) => n.id);
      return fromNodes.length > 0 ? fromNodes : selectedGroupIds;
    })();

    if (selectedGroupNodeIds.length === 1) {
      incorporateCardsIntoGroup(selectedGroupNodeIds[0], selectedCardIds);
      return;
    }

    // 対策1: 大量カードを 1 グループにまとめる操作は誤爆リスクが高いので確認する．
    if (!confirmBulkOperation(selectedCardIds.length, '1 つのグループにまとめ')) return;

    // Default: create a new group from selected cards.
    const cardPositions = project.data.card_positions.filter((p) =>
      selectedCardIds.includes(p.cardId)
    );
    const out = buildGroupFromCards(project.data, {
      cardIds: selectedCardIds,
      cardPositions,
      now,
    });
    // (#2) buildGroupFromCards はデフォルトのカードサイズで枠を算出するため，実際の
    // 描画サイズと合わず「一度動かさないと枠がフィットしない」状態になる．ここで
    // 測定済みサイズを使って即座にフィットさせる．
    const cardWrapWidth = project.metadata.displaySettings?.cardWrapWidth;
    const synthesized = {
      ...project.data,
      groups: [...project.data.groups, out.group],
      group_memberships: [
        ...project.data.group_memberships.filter(
          (m) => !out.conflictingMemberships.some((c) => c.id === m.id)
        ),
        ...out.memberships,
      ],
      group_positions: [...project.data.group_positions, out.position],
    };
    const fitted = computeGroupAutoBounds(synthesized, out.group.id, {
      measuredSizes: getMeasuredSizes(),
      defaultCardWidth: cardWrapWidth,
    });
    const position = fitted ? { groupId: out.group.id, ...fitted } : out.position;

    // (#2) グループ化と同時にメンバーカードを自動整列する (既定 ON)．方向と列/行数は
    // 表示設定で変更できる．整列後に枠を再フィットし, カード移動はグループ作成コマンドへ
    // 統合して 1 回の undo で戻せるようにする．
    const ds = project.metadata.displaySettings;
    const autoPack = ds?.autoPackOnGroup !== false;
    let cardMoves: Array<{
      cardId: string;
      from: { x: number; y: number };
      to: { x: number; y: number };
    }> = [];
    let finalPosition = position;
    if (autoPack) {
      const packSynth = {
        ...synthesized,
        group_positions: [...project.data.group_positions, position],
      };
      const packed = packGroupCards(packSynth, out.group.id, {
        measuredSizes: getMeasuredSizes(),
        defaultCardWidth: cardWrapWidth,
        orientation: ds?.autoPackOrientation ?? 'cols',
        count: ds?.autoPackCount,
      });
      if (packed && packed.cardTargets.length > 0) {
        cardMoves = packed.cardTargets
          .map((t) => {
            const cur = project.data.card_positions.find((p) => p.cardId === t.cardId);
            if (!cur) return null;
            if (cur.x === t.x && cur.y === t.y) return null;
            return { cardId: t.cardId, from: { x: cur.x, y: cur.y }, to: { x: t.x, y: t.y } };
          })
          .filter(
            (m): m is { cardId: string; from: { x: number; y: number }; to: { x: number; y: number } } =>
              m !== null
          );
        const packedOverride = new Map(
          packed.cardTargets.map((t) => [t.cardId, { x: t.x, y: t.y }] as const)
        );
        const refit = computeGroupAutoBounds(packSynth, out.group.id, {
          cardPosOverride: packedOverride,
          measuredSizes: getMeasuredSizes(),
          defaultCardWidth: cardWrapWidth,
        });
        if (refit) finalPosition = { groupId: out.group.id, ...refit };
      }
    }
    applyCommand(
      makeCreateGroupCommand(
        out.group,
        out.label,
        finalPosition,
        out.memberships,
        out.conflictingMemberships,
        cardMoves
      )
    );
    selectGroup(out.group.id);
  }, [
    project,
    selectedCardIds,
    selectedGroupIds,
    nodes,
    applyCommand,
    selectGroup,
    getMeasuredSizes,
    incorporateCardsIntoGroup,
  ]);

  // Selection of a single group + cards changes the group button into
  // "add cards to that group" mode.
  const targetExistingGroupId = (() => {
    const fromNodes = nodes
      .filter((n) => n.selected && n.type === 'kjgroup')
      .map((n) => n.id);
    const ids = fromNodes.length > 0 ? fromNodes : selectedGroupIds;
    return ids.length === 1 && selectedCardIds.length > 0 ? ids[0] : null;
  })();
  const canMakeGroup = selectedCardIds.length >= 1;

  const edges: Edge<RelationEdgeData>[] = project
    ? project.data.diagram_relations.map((r) => ({
        id: r.id,
        source: r.sourceObjectId,
        target: r.targetObjectId,
        type: 'relation',
        selected: r.id === selectedRelationId,
        data: { relationType: r.relationType, label: r.label },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: RELATION_TYPE_COLORS[r.relationType],
        },
      }))
    : [];

  // Unified group button. Behavior depends on selection:
  //  - N cards only → make new group from cards
  //  - N cards + 1 group → add cards to that group
  //  - N groups only (no cards) → wrap them into a parent group
  const groupButtonLabel = (() => {
    if (targetExistingGroupId)
      return `既存グループへ追加 (${selectedCardIds.length} 枚)`;
    if (selectedCardIds.length > 0)
      return `グループ化 (${selectedCardIds.length} 枚)`;
    if (nestIntoExisting)
      return `既存上位グループへネスト (${nestIntoExisting.childIds.length} 個)`;
    if (canMakeParentGroup)
      return `親グループ化 (${selectedGroupIds.length} 個)`;
    return 'グループ化';
  })();
  const groupButtonEnabled = canMakeGroup || canMakeParentGroup;
  const groupButtonClick = () => {
    if (selectedCardIds.length > 0) onCreateGroup();
    else if (canMakeParentGroup) onCreateParentGroup();
  };

  return (
    <div className="canvas-wrap">
      <div className="canvas-toolbar">
        <button
          type="button"
          onClick={groupButtonClick}
          disabled={!groupButtonEnabled}
          title={
            !groupButtonEnabled
              ? 'カードまたはグループを選択してください'
              : targetExistingGroupId
                ? '選択中の既存グループにカードを追加'
                : selectedCardIds.length > 0
                  ? 'カード選択をひとつのグループに'
                  : 'グループ選択を上位グループにまとめる (何階層でも可)'
          }
        >
          {groupButtonLabel}
        </button>
        <button
          type="button"
          onClick={onMergeCards}
          disabled={!canMergeCards}
          title={
            canMergeCards
              ? '選択したカードを 1 枚に結合（同じ参加者のみ）'
              : '同じ参加者の 2 枚以上を選択してください'
          }
        >
          {canMergeCards
            ? `結合 (${selectedCardIds.length} 枚 → 1)`
            : 'カード結合'}
        </button>
        <button
          type="button"
          onClick={onCreateSnapshot}
          disabled={!snapshotConnected || snapshotBusy}
          title={
            snapshotConnected
              ? '現在の状態をサーバーにスナップショット保存（手動）'
              : 'ルームに接続しているときに使えます'
          }
        >
          {snapshotBusy ? 'スナップショット中…' : 'スナップショット作成'}
        </button>
        <button
          type="button"
          onClick={openSnapshotList}
          disabled={!snapshotConnected}
          title="操作・復元履歴を表示し、任意の時点へ復元する"
        >
          操作・復元履歴
        </button>
        {snapshotMsg && <span className="canvas-toolbar-hint">{snapshotMsg}</span>}
        <span className="canvas-toolbar-hint">
          Shift+ドラッグで複数選択 ／ Shift+クリックで追加選択
        </span>
      </div>
      {snapshotListOpen && (
        <div
          className="snapshot-modal-backdrop"
          onClick={() => setSnapshotListOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.35)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            className="snapshot-modal"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--panel-bg, #fff)',
              color: 'var(--text, #111)',
              borderRadius: 8,
              padding: 16,
              width: 'min(640px, 92vw)',
              maxHeight: '80vh',
              overflow: 'auto',
              boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 8,
              }}
            >
              <strong>操作・復元履歴（スナップショット）</strong>
              <button type="button" onClick={() => setSnapshotListOpen(false)}>
                閉じる
              </button>
            </div>
            <p style={{ fontSize: 12, opacity: 0.75, marginTop: 0 }}>
              自動（5分 / 20操作 / compact前 / 大規模変更の直前）と手動の記録です。
              「復元」で任意の時点へ巻き戻せます（復元点の粒度で巻き戻します。個々の操作だけの取り消しではありません）。
              {!canRestore && '（復元には editor 権限が必要です）'}
            </p>
            {snapshotListError && (
              <p style={{ color: '#c00' }}>{snapshotListError}</p>
            )}
            {!snapshotListError && snapshotItems === null && <p>読み込み中…</p>}
            {!snapshotListError && snapshotItems && snapshotItems.length === 0 && (
              <p>スナップショットはまだありません。</p>
            )}
            {!snapshotListError && snapshotItems && snapshotItems.length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
                    <th style={{ padding: '4px 6px' }}>日時</th>
                    <th style={{ padding: '4px 6px' }}>種別</th>
                    <th style={{ padding: '4px 6px' }}>作者</th>
                    <th style={{ padding: '4px 6px' }}>ラベル</th>
                    <th style={{ padding: '4px 6px' }}>枚数</th>
                    <th style={{ padding: '4px 6px' }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshotItems.map((s) => {
                    const isIncidentMark = s.trigger === 'circuit-breaker-prestate';
                    return (
                      <tr
                        key={s.id}
                        style={{
                          borderBottom: '1px solid #eee',
                          background: isIncidentMark ? 'rgba(220,0,0,0.08)' : undefined,
                        }}
                      >
                        <td style={{ padding: '4px 6px', whiteSpace: 'nowrap' }}>
                          {new Date(s.ts).toLocaleString()}
                        </td>
                        <td
                          style={{
                            padding: '4px 6px',
                            color: isIncidentMark ? '#c00' : undefined,
                            fontWeight: isIncidentMark ? 600 : undefined,
                            whiteSpace: 'nowrap',
                          }}
                          title={
                            isIncidentMark
                              ? 'ここで大規模な構造変更が検知されました（この直前の状態）'
                              : undefined
                          }
                        >
                          {isIncidentMark ? '⚠ ' : ''}
                          {snapshotTriggerLabel(s.trigger)}
                        </td>
                        <td style={{ padding: '4px 6px' }}>{s.author ?? '-'}</td>
                        <td style={{ padding: '4px 6px' }}>{s.label ?? ''}</td>
                        <td style={{ padding: '4px 6px', whiteSpace: 'nowrap' }}>
                          C{s.counts.cards}/G{s.counts.groups}/M{s.counts.memberships}
                        </td>
                        <td style={{ padding: '4px 6px', whiteSpace: 'nowrap' }}>
                          <button
                            type="button"
                            disabled={!canRestore || restoreBusy !== null}
                            onClick={() => onRestoreSnapshot(s)}
                            title={
                              canRestore
                                ? 'この状態に復元（現在の状態は上書き・自動退避されます）'
                                : '復元には editor 権限が必要です'
                            }
                          >
                            {restoreBusy === s.id ? '復元中…' : '復元'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
      <div className="canvas-main">
        <div className="canvas-flow" onDrop={onDrop} onDragOver={onDragOver}>
          <ReactFlow
            style={{
              background:
                project?.metadata.displaySettings?.canvasBackground ?? '#ffffff',
            }}
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onSelectionChange={onSelectionChange}
            onNodeDragStart={onNodeDragStart}
            onNodeDrag={onNodeDrag}
            onNodeDragStop={onNodeDragStop}
            onPaneClick={onPaneClick}
            onNodeContextMenu={onNodeContextMenu}
            onConnect={onConnect}
            onEdgeClick={onEdgeClick}
            fitView={false}
            proOptions={{ hideAttribution: true }}
            /* 2026-06-02: pan / select モード切替．
             * pan: panOnDrag=true / selectionOnDrag=false → ドラッグで視点移動
             * select: panOnDrag=false / selectionOnDrag=true → ドラッグで範囲選択 */
            panOnDrag={canvasMode === 'pan'}
            selectionOnDrag={canvasMode === 'select'}
            /* Shift と Ctrl/Cmd の両方で複数選択できるように (ユーザー要望) */
            multiSelectionKeyCode={['Shift', 'Control', 'Meta']}
            elevateNodesOnSelect={false}
            /* Performance: only render nodes whose bounding box overlaps the
             * current viewport.  Big difference on 500+ card projects. */
            onlyRenderVisibleElements
            nodesFocusable={false}
          >
            <Background />
            <Controls />
            {/* MiniMap re-renders all nodes as SVG dots; for very large
             * projects we hide it to keep pan/zoom smooth. */}
            {nodes.length <= 300 && <MiniMap pannable zoomable />}
            {/* 2026-06-02: キャンバスモード切替 (pan / select)．
             * ReactFlow の Controls の上に重ねて表示 (左下) */}
            <div
              className="kj-canvas-mode-toggle"
              style={{ position: 'absolute', bottom: 130, left: 8, zIndex: 5 }}
            >
              <button
                type="button"
                className={canvasMode === 'pan' ? 'active' : ''}
                onClick={() => setCanvasMode('pan')}
                title="移動モード: キャンバスをドラッグで視点移動．ノードクリックで個別選択"
              >
                ✥ 移動
              </button>
              <button
                type="button"
                className={canvasMode === 'select' ? 'active' : ''}
                onClick={() => setCanvasMode('select')}
                title="範囲選択モード: キャンバスをドラッグで矩形範囲選択"
              >
                □ 範囲
              </button>
            </div>
          </ReactFlow>
        </div>
      </div>
      {contextMenu && contextMenu.kind === 'card' && (
        <div
          className="card-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button type="button" onClick={() => changePlacement(contextMenu.cardId, 'pending')}>
            保留に移す
          </button>
          <button
            type="button"
            onClick={() => changePlacement(contextMenu.cardId, 'unclassified')}
          >
            未分類に戻す
          </button>
          <div className="card-context-menu-sep" />
          <button type="button" onClick={() => setCardZOrder(contextMenu.cardId, 'front')}>
            最前面へ
          </button>
          <button type="button" onClick={() => setCardZOrder(contextMenu.cardId, 'back')}>
            最背面へ
          </button>
          {(() => {
            const c = project?.data.cards.find((x) => x.id === contextMenu.cardId);
            return c && canUnmergeCard(c) ? (
              <button type="button" onClick={() => unmergeCard(contextMenu.cardId)}>
                統合を解除
              </button>
            ) : null;
          })()}
          <div className="card-context-menu-sep" />
          <button type="button" onClick={() => openSplit(contextMenu.cardId)}>
            分割...
          </button>
          <button
            type="button"
            onClick={() => toggleCardCollapsed(contextMenu.cardId)}
          >
            {(() => {
              const c = project?.data.cards.find((x) => x.id === contextMenu.cardId);
              return c?.collapsed ? '展開 (本文を表示)' : '折りたたみ (ID のみ)';
            })()}
          </button>
          <div className="card-context-menu-sep" />
          {project?.data.group_memberships.some(
            (m) => m.cardId === contextMenu.cardId
          ) && (
            <button
              type="button"
              onClick={() => removeCardFromGroupViaMenu(contextMenu.cardId)}
            >
              このカードだけグループから外す
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setPickerFor({ kind: 'card', cardId: contextMenu.cardId });
              setContextMenu(null);
            }}
          >
            既存グループに入れる...
          </button>
          <button
            type="button"
            onClick={() => {
              setStyleEditorFor({ kind: 'card', cardId: contextMenu.cardId });
              setContextMenu(null);
            }}
          >
            スタイル...
          </button>
          <div className="card-context-menu-sep" />
          <button type="button" onClick={() => deleteCard(contextMenu.cardId)} className="danger">
            カードを削除
          </button>
        </div>
      )}
      {contextMenu && contextMenu.kind === 'group' && (
        <div
          className="card-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {(() => {
            const g = project?.data.groups.find((x) => x.id === contextMenu.groupId);
            return (
              <>
                {contextMenu.cardIds.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        incorporateCardsIntoGroup(contextMenu.groupId, contextMenu.cardIds);
                        setContextMenu(null);
                      }}
                      title="右クリック直前に選択していたカードをこのグループへ編入する"
                    >
                      選択中のカードをこのグループへ編入 ({contextMenu.cardIds.length} 枚)
                    </button>
                    <div className="card-context-menu-sep" />
                  </>
                )}
                <button
                  type="button"
                  onClick={() => alignGroupToLabel(contextMenu.groupId)}
                  title="ラベル位置を固定したまま, メンバーカードを隙間なくグリッド整列"
                >
                  ラベルに合わせて整列
                </button>
                <div className="card-context-menu-sep" />
                <button
                  type="button"
                  onClick={() => dissolveGroup(contextMenu.groupId)}
                >
                  グループを解除 (このグループだけ削除)
                </button>
                {g?.parentGroupId && (
                  <button
                    type="button"
                    onClick={() => unnestFromParent(contextMenu.groupId)}
                  >
                    上位グループから外す
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setPickerFor({ kind: 'group', groupId: contextMenu.groupId });
                    setContextMenu(null);
                  }}
                >
                  既存グループに入れる...
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStyleEditorFor({ kind: 'group', groupId: contextMenu.groupId });
                    setContextMenu(null);
                  }}
                >
                  スタイル...
                </button>
              </>
            );
          })()}
        </div>
      )}
      <CardSplitDialog
        open={splitCardId !== null}
        card={
          splitCardId && project
            ? project.data.cards.find((c) => c.id === splitCardId) ?? null
            : null
        }
        onClose={() => setSplitCardId(null)}
        onConfirm={handleConfirmSplit}
      />
      <StylePickerDialog
        open={styleEditorFor !== null}
        title={styleEditorFor?.kind === 'card' ? 'カードのスタイル' : 'グループのスタイル'}
        initial={
          (() => {
            if (!styleEditorFor || !project) return undefined;
            if (styleEditorFor.kind === 'card') {
              return project.data.cards.find((c) => c.id === styleEditorFor.cardId)
                ?.displayStyle;
            }
            return project.data.groups.find((g) => g.id === styleEditorFor.groupId)
              ?.displayStyle;
          })()
        }
        onClose={() => setStyleEditorFor(null)}
        onClear={() => {
          if (!project || !styleEditorFor) return;
          const now = new Date().toISOString();
          if (styleEditorFor.kind === 'card') {
            const c = project.data.cards.find(
              (x) => x.id === styleEditorFor.cardId
            );
            const prev = new Map<string, DisplayStyle | undefined>([
              [styleEditorFor.cardId, c?.displayStyle],
            ]);
            applyCommand(
              makeBulkApplyCardStyleCommand(
                [styleEditorFor.cardId],
                prev,
                undefined,
                now
              )
            );
          } else {
            const g = project.data.groups.find(
              (x) => x.id === styleEditorFor.groupId
            );
            const prev = new Map<string, DisplayStyle | undefined>([
              [styleEditorFor.groupId, g?.displayStyle],
            ]);
            applyCommand(
              makeBulkApplyGroupStyleCommand(
                [styleEditorFor.groupId],
                prev,
                undefined,
                now
              )
            );
          }
          setStyleEditorFor(null);
        }}
        onApply={(next) => {
          if (!project || !styleEditorFor) return;
          const now = new Date().toISOString();
          if (styleEditorFor.kind === 'card') {
            const c = project.data.cards.find(
              (x) => x.id === styleEditorFor.cardId
            );
            const prev = new Map<string, DisplayStyle | undefined>([
              [styleEditorFor.cardId, c?.displayStyle],
            ]);
            applyCommand(
              makeBulkApplyCardStyleCommand(
                [styleEditorFor.cardId],
                prev,
                next,
                now
              )
            );
          } else {
            const g = project.data.groups.find(
              (x) => x.id === styleEditorFor.groupId
            );
            const prev = new Map<string, DisplayStyle | undefined>([
              [styleEditorFor.groupId, g?.displayStyle],
            ]);
            applyCommand(
              makeBulkApplyGroupStyleCommand(
                [styleEditorFor.groupId],
                prev,
                next,
                now
              )
            );
          }
          setStyleEditorFor(null);
        }}
      />
      <GroupPickerDialog
        open={pickerFor !== null}
        title={
          pickerFor?.kind === 'card'
            ? 'カードを入れるグループを選択'
            : '上位グループを選択 (このグループより上位レベル)'
        }
        filterLevel={
          pickerFor?.kind === 'card'
            ? 1
            : pickerFor?.kind === 'group'
              ? undefined
              : undefined
        }
        excludeIds={
          pickerFor?.kind === 'group' ? [pickerFor.groupId] : undefined
        }
        onSelect={handlePickGroup}
        onCancel={() => setPickerFor(null)}
      />
    </div>
  );
}
