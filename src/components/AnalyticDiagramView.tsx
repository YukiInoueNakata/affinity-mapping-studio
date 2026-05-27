import { useCallback, useEffect, useMemo } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type EdgeMouseHandler,
  type Node,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useProjectStore } from '../stores/projectStore.js';
import { AnalyticNode, type AnalyticNodeData } from './AnalyticNode.js';
import { RelationEdge, type RelationEdgeData } from './RelationEdge.js';
import {
  makeCreateRelationCommand,
  makeDeleteRelationCommand,
} from '../stores/commands.js';
import {
  buildRelation,
  RELATION_TYPE_COLORS,
  relationExists,
} from '../domain/relations.js';
import type { DiagramObjectType } from '@shared/types/domain';

const nodeTypes = { analytic: AnalyticNode };
const edgeTypes = { relation: RelationEdge };

interface Props {
  /** 'm_gta' shows concepts + m_gta_categories; 'gta' shows codes + gta_categories. */
  mode: 'm_gta' | 'gta';
}

export function AnalyticDiagramView({ mode }: Props) {
  const project = useProjectStore((s) => s.project);
  const applyCommand = useProjectStore((s) => s.applyCommand);
  const selectRelation = useProjectStore((s) => s.selectRelation);
  const selectedRelationId = useProjectStore((s) => s.selectedRelationId);
  const selectConcept = useProjectStore((s) => s.selectConcept);
  const selectCode = useProjectStore((s) => s.selectCode);

  const [nodes, setNodes, onNodesChange] = useNodesState<AnalyticNodeData>([]);

  const objects = useMemo(() => {
    type Primary = { id: string; title: string; subtitle?: string; kind: 'concept' | 'code' };
    type Cat = { id: string; title: string; kind: 'category'; isCore?: boolean };
    const empty: { primary: Primary[]; categories: Cat[] } = { primary: [], categories: [] };
    if (!project) return empty;
    if (mode === 'm_gta') {
      return {
        primary: project.data.m_gta_concepts.map<Primary>((c) => ({
          id: c.id,
          title: c.name,
          subtitle: c.definition ? c.definition.slice(0, 60) : undefined,
          kind: 'concept',
        })),
        categories: project.data.m_gta_categories.map<Cat>((c) => ({
          id: c.id,
          title: c.name,
          kind: 'category',
        })),
      };
    }
    return {
      primary: project.data.gta_codes.map<Primary>((c) => ({
        id: c.id,
        title: c.name,
        subtitle: c.definition ? c.definition.slice(0, 60) : undefined,
        kind: 'code',
      })),
      categories: project.data.gta_categories.map<Cat>((c) => ({
        id: c.id,
        title: c.name,
        kind: 'category',
        isCore: c.isCoreCategory,
      })),
    };
  }, [project, mode]);

  // Auto-layout: arrange primaries in a grid, categories at the top
  useEffect(() => {
    if (!project) {
      setNodes([]);
      return;
    }
    setNodes((current) => {
      const currentPosById = new Map(current.map((n) => [n.id, n.position]));
      const categoryNodes: Node<AnalyticNodeData>[] = objects.categories.map((cat, i) => ({
        id: cat.id,
        type: 'analytic',
        position:
          currentPosById.get(cat.id) ?? { x: 80 + (i % 5) * 280, y: 40 },
        data: { title: cat.title, kind: 'category', isCore: cat.isCore },
        style: { width: 220 },
        draggable: true,
      }));
      const primaryNodes: Node<AnalyticNodeData>[] = objects.primary.map((p, i) => ({
        id: p.id,
        type: 'analytic',
        position:
          currentPosById.get(p.id) ?? {
            x: 80 + (i % 5) * 280,
            y: 220 + Math.floor(i / 5) * 160,
          },
        data: { title: p.title, subtitle: p.subtitle, kind: p.kind },
        style: { width: 220 },
        draggable: true,
      }));
      return [...categoryNodes, ...primaryNodes];
    });
  }, [project, objects, setNodes]);

  const validTypes: DiagramObjectType[] =
    mode === 'm_gta' ? ['concept', 'category'] : ['code', 'category'];

  const filteredRelations = useMemo(() => {
    if (!project) return [];
    return project.data.diagram_relations.filter(
      (r) =>
        validTypes.includes(r.sourceObjectType) &&
        validTypes.includes(r.targetObjectType)
    );
  }, [project, validTypes]);

  const edges: Edge<RelationEdgeData>[] = filteredRelations.map((r) => ({
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
  }));

  // useEdgesState exists for hook parity but we use derived edges directly
  void useEdgesState;

  const onConnect = useCallback(
    (conn: Connection) => {
      if (!project || !conn.source || !conn.target) return;
      const findType = (id: string): DiagramObjectType | null => {
        if (mode === 'm_gta') {
          if (project.data.m_gta_concepts.some((c) => c.id === id)) return 'concept';
          if (project.data.m_gta_categories.some((c) => c.id === id)) return 'category';
        } else {
          if (project.data.gta_codes.some((c) => c.id === id)) return 'code';
          if (project.data.gta_categories.some((c) => c.id === id)) return 'category';
        }
        return null;
      };
      const sType = findType(conn.source);
      const tType = findType(conn.target);
      if (!sType || !tType) return;
      if (relationExists(project.data, sType, conn.source, tType, conn.target)) return;
      try {
        const rel = buildRelation({
          sourceObjectType: sType,
          sourceObjectId: conn.source,
          targetObjectType: tType,
          targetObjectId: conn.target,
          relationType: 'causes',
          now: new Date().toISOString(),
        });
        applyCommand(makeCreateRelationCommand(rel));
        selectRelation(rel.id);
      } catch {
        // ignore self-loop
      }
    },
    [project, mode, applyCommand, selectRelation]
  );

  const onEdgeClick = useCallback<EdgeMouseHandler>(
    (_e, edge) => {
      selectRelation(edge.id);
    },
    [selectRelation]
  );

  const onNodeClick = useCallback(
    (_e: unknown, node: Node) => {
      if (mode === 'm_gta') {
        if (project?.data.m_gta_concepts.some((c) => c.id === node.id)) {
          selectConcept(node.id);
        }
      } else {
        if (project?.data.gta_codes.some((c) => c.id === node.id)) {
          selectCode(node.id);
        }
      }
    },
    [project, mode, selectConcept, selectCode]
  );

  const onPaneClick = useCallback(() => selectRelation(null), [selectRelation]);

  // Delete key removes selected relation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && !(e.key === 'Backspace' && (e.ctrlKey || e.metaKey))) {
        return;
      }
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (!project) return;
      const state = useProjectStore.getState();
      const rid = state.selectedRelationId;
      if (!rid) return;
      const r = project.data.diagram_relations.find((rr) => rr.id === rid);
      if (!r) return;
      e.preventDefault();
      applyCommand(makeDeleteRelationCommand(r));
      selectRelation(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [project, applyCommand, selectRelation]);

  return (
    <div className="canvas-wrap">
      <div className="canvas-toolbar">
        <span className="canvas-toolbar-hint">
          ノードを Shift+ドラッグで複数選択 / 側面ハンドルから別ノードへドラッグで関係作成 (デフォルト: 因果) / 関係を選択して Delete で削除
        </span>
      </div>
      <div className="canvas-flow">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onConnect={onConnect}
          onEdgeClick={onEdgeClick}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          fitView={false}
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
