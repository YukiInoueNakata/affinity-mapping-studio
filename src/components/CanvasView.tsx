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
  makeSplitCardCommand,
  makeToggleCardCollapsedCommand,
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
  effectivePlacement,
  MergeError,
  SplitError,
} from '../domain/cards.js';
import { CardSplitDialog } from './CardSplitDialog.js';
import {
  buildRelation,
  relationExists,
  RELATION_TYPE_COLORS,
} from '../domain/relations.js';

const nodeTypes = { card: CardNode, kjgroup: GroupNode };
const edgeTypes = { relation: RelationEdge };

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

  const project = useProjectStore((s) => s.project);
  const selectedCardId = useProjectStore((s) => s.selectedCardId);
  const selectedCardIds = useProjectStore((s) => s.selectedCardIds);
  const selectedGroupId = useProjectStore((s) => s.selectedGroupId);
  const selectedGroupIds = useProjectStore((s) => s.selectedGroupIds);
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
    | { kind: 'group'; x: number; y: number; groupId: string }
    | null
  >(null);
  const [splitCardId, setSplitCardId] = useState<string | null>(null);
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
      const groupNodes: Node<GroupNodeData>[] = project.data.groups
        .filter((g) => !hiddenIds.has(g.id))
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
          zIndex: 10,
        };
      });

      return [...groupNodes, ...cardNodes];
    });
  }, [project, selectedCardId, selectedCardIds, selectedGroupId, selectedGroupIds, setNodes]);

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
      } else if (node.type === 'kjgroup') {
        const pos = project.data.group_positions.find((p) => p.groupId === node.id);
        if (pos) groupDragStartRef.current.set(node.id, { x: pos.x, y: pos.y });
        const desc = collectGroupDescendantsForDrag(project.data, node.id);
        groupDescendantsRef.current.set(node.id, desc);
        for (const d of desc) draggingRef.current.add(d.id);
      }
      draggingRef.current.add(node.id);
    },
    [project]
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
    [applyCommand, project]
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
        setContextMenu({ kind: 'group', x: e.clientX, y: e.clientY, groupId: node.id });
        selectGroup(node.id);
      }
    },
    [selectCard, selectGroup]
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

    // Mixed selection: cards + exactly one group → add cards to that group.
    // Read React Flow's current selected nodes (not just selectedCardIds,
    // because the store collapses to one selection bucket).
    const selectedGroupNodeIds = nodes
      .filter((n) => n.selected && n.type === 'kjgroup')
      .map((n) => n.id);

    if (selectedGroupNodeIds.length === 1) {
      const targetGroupId = selectedGroupNodeIds[0];
      const replaced: GroupMembership[] = [];
      const added: GroupMembership[] = [];
      for (const cid of selectedCardIds) {
        const existing = project.data.group_memberships.find((m) => m.cardId === cid);
        if (existing && existing.groupId === targetGroupId) continue;
        if (existing) replaced.push(existing);
        added.push({ id: newId(), cardId: cid, groupId: targetGroupId, createdAt: now });
      }
      if (added.length === 0) return;
      // Auto-fit the target group (and ancestors) with the new members.
      const cardOverrides = new Map(
        selectedCardIds
          .map((cid) => project.data.card_positions.find((p) => p.cardId === cid))
          .filter((p): p is NonNullable<typeof p> => !!p)
          .map((p) => [p.cardId, { x: p.x, y: p.y }] as const)
      );
      // Synthesize what data will look like AFTER the membership add, so
      // computeCascadedGroupBoundsUpdates includes the new cards in the
      // target group's bounding box.
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
      return;
    }

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
    applyCommand(
      makeCreateGroupCommand(
        out.group,
        out.label,
        position,
        out.memberships,
        out.conflictingMemberships
      )
    );
    selectGroup(out.group.id);
  }, [project, selectedCardIds, nodes, applyCommand, selectGroup, getMeasuredSizes]);

  // Selection of a single group + cards changes the group button into
  // "add cards to that group" mode.
  const targetExistingGroupId = (() => {
    const ids = nodes.filter((n) => n.selected && n.type === 'kjgroup').map((n) => n.id);
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
        <span className="canvas-toolbar-hint">
          Shift+ドラッグで複数選択 ／ Shift+クリックで追加選択
        </span>
      </div>
      <div className="canvas-main">
        <div className="canvas-flow" onDrop={onDrop} onDragOver={onDragOver}>
          <ReactFlow
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
            selectionOnDrag
            multiSelectionKeyCode={['Shift']}
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
