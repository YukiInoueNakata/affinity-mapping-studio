import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useProjectStore } from './stores/projectStore.js';
import { LeftPanel } from './components/LeftPanel.js';
import { SourceViewer } from './components/SourceViewer.js';
import { CanvasView } from './components/CanvasView.js';
import { KJFinalView } from './components/KJFinalView.js';
import { RightPanel } from './components/RightPanel.js';
import { ImportWizard } from './components/ImportWizard.js';
import { PromptDialog } from './components/PromptDialog.js';
import { BulkReplaceDialog } from './components/BulkReplaceDialog.js';
import { BulkStyleDialog } from './components/BulkStyleDialog.js';
import { DisplaySettingsDialog } from './components/DisplaySettingsDialog.js';
import { AuditExportDialog } from './components/AuditExportDialog.js';
import { TagEditorDialog } from './components/TagEditorDialog.js';
import { VersionHistoryDialog } from './components/VersionHistoryDialog.js';
import { SyncConnectDialog } from './components/SyncConnectDialog.js';
import { SyncStatusBadge } from './components/SyncStatusBadge.js';
import { syncManager, type SyncState } from './sync/syncManager.js';
import { ExportDialog } from './components/ExportDialog.js';
import { WordExportWizard } from './components/WordExportWizard.js';
import { HierarchyPane } from './components/HierarchyPane.js';
import { CardPlacementPane } from './components/CardPlacementPane.js';
// M-GTA / GTA ワークスペースは当面 UI 非表示．import を残すと未使用警告になるため削除．
// 将来再有効化時は再度 import + AppMode 分岐 + ribbon ボタンを復活させる．
import { useResizableWidth } from './hooks/useResizableWidth.js';
import { projectService } from './services/projectService.js';
import type { SearchHit } from './domain/search.js';
import {
  makeDeleteCardCommand,
  makeDeleteGroupCommand,
  makeDeleteRelationCommand,
  makeMoveNodesBulkCommand,
  makeSetCardsCollapsedBulkCommand,
  makeSetGroupsCollapsedBulkCommand,
} from './stores/commands.js';
import {
  alignNodes,
  arrangeInGrid,
  distributeNodes,
  type AlignAxis,
  type AlignNodeInput,
} from './domain/align.js';
import { collectGroupDescendantsForDrag } from './domain/groups.js';
import {
  computeCascadedGroupBoundsUpdates,
  getGroupLabel,
  getGroupPosition,
} from './domain/groups.js';

type CenterTab = 'canvas' | 'source' | 'final';

export function App() {
  const project = useProjectStore((s) => s.project);
  const filePath = useProjectStore((s) => s.filePath);
  const isDirty = useProjectStore((s) => s.isDirty);
  const past = useProjectStore((s) => s.past);
  const future = useProjectStore((s) => s.future);
  const loadProject = useProjectStore((s) => s.loadProject);
  const markSaved = useProjectStore((s) => s.markSaved);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const selectCard = useProjectStore((s) => s.selectCard);
  const selectGroup = useProjectStore((s) => s.selectGroup);
  const selectSegment = useProjectStore((s) => s.selectSegment);
  const selectRelation = useProjectStore((s) => s.selectRelation);
  const applyCommand = useProjectStore((s) => s.applyCommand);
  const mode = useProjectStore((s) => s.mode);
  const setMode = useProjectStore((s) => s.setMode);
  // 2026-06-02: キャンバス操作モード (pan / select) — リボンと canvas 内に表示
  const canvasMode = useProjectStore((s) => s.canvasInteractionMode);
  const setCanvasMode = useProjectStore((s) => s.setCanvasInteractionMode);

  const [centerTab, setCenterTab] = useState<CenterTab>('canvas');
  const [ribbonTab, setRibbonTab] = useState<
    'file' | 'edit' | 'view' | 'align' | 'bulk'
  >('file');
  const [viewLevelInput, setViewLevelInput] = useState<number>(1);
  const [gridRowsInput, setGridRowsInput] = useState<number>(2);
  const [gridColsInput, setGridColsInput] = useState<number>(2);
  const [importOpen, setImportOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [bulkReplaceOpen, setBulkReplaceOpen] = useState(false);
  const [bulkStyleOpen, setBulkStyleOpen] = useState(false);
  const [displaySettingsOpen, setDisplaySettingsOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [tagEditorOpen, setTagEditorOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [wordWizardOpen, setWordWizardOpen] = useState(false);
  const [recentFiles, setRecentFiles] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem('kj.recentFiles');
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });
  const [recentMenuOpen, setRecentMenuOpen] = useState(false);

  // (Team) Subscribe to sync state so we can gate New/Open while connected to a
  // room.  In the studio (sync-off) build syncManager is the no-op stub, so
  // this stays idle and nothing is gated.
  const [syncSnapshot, setSyncSnapshot] = useState<SyncState>(() =>
    syncManager.getState()
  );
  useEffect(() => syncManager.on(setSyncSnapshot), []);
  // Sec-003/009 Phase 2C: body の data 属性に現在のロールを反映．CSS の
  // `[data-kj-role="viewer"]` セレクタで広域的に視覚 disable を効かせる．
  useEffect(() => {
    const r = syncSnapshot.role?.role;
    if (r) document.body.dataset.kjRole = r;
    else delete document.body.dataset.kjRole;
  }, [syncSnapshot.role?.role]);
  const inRoom = !!syncSnapshot.meta;
  // Sec-003/009 Phase 2C: viewer ロールのときは UI 全体を「閲覧者モード」として扱う．
  // 編集系操作は applyCommand 入口で block されるが，UX 上は事前に視覚で示す．
  const isViewer = syncSnapshot.role?.role === 'viewer';
  const projectHasData =
    !!project &&
    (project.data.cards.length > 0 ||
      project.data.source_segments.length > 0 ||
      project.data.participants.length > 0 ||
      project.data.groups.length > 0);
  // While connected to a room, lock 新規/開く when the room already has data
  // (the shared room is authoritative) OR while we don't yet know the room's
  // state (not synced).  In an empty, synced room they stay enabled so the user
  // can open a local project and upload it.  Not in a room → never locked.
  const roomLocksFileOps = inRoom && (projectHasData || !syncSnapshot.synced);

  // Track recent files when filePath changes
  useEffect(() => {
    if (!filePath) return;
    setRecentFiles((prev) => {
      const next = [filePath, ...prev.filter((p) => p !== filePath)].slice(0, 10);
      try {
        window.localStorage.setItem('kj.recentFiles', JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, [filePath]);

  const openRecent = useCallback(
    async (path: string) => {
      if (isDirty && !confirm('未保存の変更があります。破棄して別のプロジェクトを開きますか？')) return;
      const r = await projectService.openProjectByPath(path);
      if (r) {
        if (syncManager.isInRoom()) {
          // Connected to an (empty) room: upload rather than just load locally.
          try {
            syncManager.uploadProject(r.project);
          } catch {
            alert(
              'このルームには既にデータがあるため読み込めません。\n' +
                '空のルームでのみプロジェクトを読み込めます。'
            );
          }
          setRecentMenuOpen(false);
          return;
        }
        loadProject(r.filePath, r.project);
        setRecentMenuOpen(false);
      } else {
        alert(`ファイルを開けませんでした: ${path}\n削除されたか、別の場所に移動した可能性があります。`);
        setRecentFiles((prev) => {
          const next = prev.filter((p) => p !== path);
          try {
            window.localStorage.setItem('kj.recentFiles', JSON.stringify(next));
          } catch {
            // ignore
          }
          return next;
        });
      }
    },
    [isDirty, loadProject]
  );
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [hierarchyOpen, setHierarchyOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try {
      const v = window.localStorage.getItem('kj.hierarchyOpen');
      // First-time users see the pane open. Only explicit "0" hides it.
      return v !== '0';
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem('kj.hierarchyOpen', hierarchyOpen ? '1' : '0');
    } catch {
      // ignore
    }
  }, [hierarchyOpen]);
  const leftPane = useResizableWidth({
    initial: 280,
    min: 200,
    max: 540,
    direction: 'right',
    storageKey: 'kj.leftPaneWidth',
  });
  const rightPane = useResizableWidth({
    initial: 360,
    min: 260,
    max: 620,
    direction: 'left',
    storageKey: 'kj.rightPaneWidth',
  });
  const hierarchyPane = useResizableWidth({
    initial: 280,
    min: 180,
    max: 520,
    direction: 'right',
    storageKey: 'kj.hierarchyPaneWidth',
  });
  const placementPane = useResizableWidth({
    initial: 240,
    min: 160,
    max: 480,
    direction: 'left',
    storageKey: 'kj.placementPaneWidth',
  });
  const [placementCollapsed, setPlacementCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem('kj.placementPaneOpen') === '0';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(
        'kj.placementPaneOpen',
        placementCollapsed ? '0' : '1'
      );
    } catch {
      // ignore
    }
  }, [placementCollapsed]);

  // (#3) 画面全体のズーム.  Ctrl/Cmd + Plus/Minus/0 で UI 全体 (ペイン・リボン・
  // キャンバス) のスケールを変える.  WebView2/Chromium の `zoom` を使う.
  // sync デバッグオーバーレイ表示フラグ．既定 OFF．localStorage に永続化．
  // トラブルシュート時のみオンにする想定．
  const [showDebugOverlay, setShowDebugOverlay] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem('kj.showDebugOverlay') === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem('kj.showDebugOverlay', showDebugOverlay ? '1' : '0');
    } catch {
      // ignore
    }
  }, [showDebugOverlay]);

  const [uiScale, setUiScale] = useState<number>(() => {
    try {
      const v = parseFloat(localStorage.getItem('kj.uiScale') ?? '1');
      return Number.isFinite(v) && v > 0 ? v : 1;
    } catch {
      return 1;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('kj.uiScale', String(uiScale));
    } catch {
      // ignore
    }
  }, [uiScale]);
  useEffect(() => {
    const onZoomKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.isComposing) return; // IME 変換中はスキップ
      // JIS / US / テンキー / Shift 修飾の各バリアントをすべて拾う．
      // e.key (文字), e.code (物理キー) の双方で判定して取りこぼし防止．
      const k = e.key;
      const code = e.code;
      const isPlus =
        k === '+' || k === '=' || k === 'Add' ||
        (k === ';' && e.shiftKey) || // JIS で Shift+; が +
        code === 'Equal' || code === 'NumpadAdd' || code === 'Semicolon';
      const isMinus =
        k === '-' || k === '_' || k === 'Subtract' ||
        code === 'Minus' || code === 'NumpadSubtract';
      const isZero = k === '0' || code === 'Digit0' || code === 'Numpad0';
      if (isPlus) {
        e.preventDefault();
        setUiScale((s) => Math.min(2.5, Math.round((s + 0.1) * 10) / 10));
      } else if (isMinus) {
        e.preventDefault();
        setUiScale((s) => Math.max(0.5, Math.round((s - 0.1) * 10) / 10));
      } else if (isZero) {
        e.preventDefault();
        setUiScale(1);
      }
    };
    // capture フェーズで拾うと input 内でも先に preventDefault できる
    window.addEventListener('keydown', onZoomKey, true);
    return () => window.removeEventListener('keydown', onZoomKey, true);
  }, []);

  const onJumpTo = useCallback(
    (hit: SearchHit) => {
      if (hit.kind === 'segment') {
        setCenterTab('source');
        selectSegment(hit.refId);
      } else if (hit.kind === 'card') {
        setCenterTab('canvas');
        selectCard(hit.refId);
      } else if (hit.kind === 'group' || hit.kind === 'label') {
        setCenterTab('canvas');
        selectGroup(hit.refId);
      }
    },
    [selectCard, selectGroup, selectSegment]
  );

  // Listen for "show in source viewer" requests from other components
  // (e.g., CardRightPanel's 原文ビューアで表示 button).
  useEffect(() => {
    const handler = () => {
      setMode('kj');
      setCenterTab('source');
    };
    window.addEventListener('kj.requestSourceView', handler as EventListener);
    return () =>
      window.removeEventListener('kj.requestSourceView', handler as EventListener);
  }, [setMode]);

  // (#6) 階層表示・検索から「キャンバスで表示」: KJ モード + canvas タブへ切替えてから
  // CanvasView がマウント済みのタイミングで kj.centerOnCard / kj.centerOnGroup を再発行する.
  useEffect(() => {
    const cardHandler = (ev: Event) => {
      const cardId = (ev as CustomEvent).detail?.cardId as string | undefined;
      if (!cardId) return;
      setMode('kj');
      setCenterTab('canvas');
      window.setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent('kj.centerOnCard', { detail: { cardId } })
        );
        // 配置ペイン (未分類・分類保留) でも目的のカードまでスクロール
        window.dispatchEvent(
          new CustomEvent('kj.scrollToCard', { detail: { cardId } })
        );
      }, 120);
    };
    const groupHandler = (ev: Event) => {
      const groupId = (ev as CustomEvent).detail?.groupId as string | undefined;
      if (!groupId) return;
      setMode('kj');
      setCenterTab('canvas');
      window.setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent('kj.centerOnGroup', { detail: { groupId } })
        );
      }, 120);
    };
    window.addEventListener('kj.jumpToCard', cardHandler as EventListener);
    window.addEventListener('kj.jumpToGroup', groupHandler as EventListener);
    return () => {
      window.removeEventListener('kj.jumpToCard', cardHandler as EventListener);
      window.removeEventListener('kj.jumpToGroup', groupHandler as EventListener);
    };
  }, [setMode]);

  const onNew = useCallback(() => {
    if (isDirty && !confirm('未保存の変更があります。破棄して新規プロジェクトを作りますか？')) return;
    setNewProjectOpen(true);
  }, [isDirty]);

  const handleCreateNewProject = useCallback(
    async (rawName: string) => {
      const name = rawName.trim() || '新規プロジェクト';
      const p = await projectService.newProject(name);
      loadProject(null, p);
      setNewProjectOpen(false);
    },
    [loadProject]
  );

  // Welcome 画面から既存ルームに参加するためのショートカット．空 ProjectFile を
  // 即座に作って canvas をマウント → Sync ダイアログを開く．接続成功すると
  // Y.Doc の中身（ルーム既存データ）が yjsBridge 経由で Zustand に流れ込む．
  const onConnectExisting = useCallback(async () => {
    if (isDirty && !confirm('未保存の変更があります．破棄してサーバーに接続しますか？')) return;
    const p = await projectService.newProject('（サーバー接続中…）');
    loadProject(null, p);
    setSyncDialogOpen(true);
  }, [isDirty, loadProject]);

  // UI スケール変更ヘルパ．既存の uiScale state (line ~248) を直接更新．
  // リボンの「表示倍率」ボタン群からも使う．
  const adjustUiScale = useCallback(
    (next: number) => {
      const clamped = Math.max(0.5, Math.min(2.5, Math.round(next * 10) / 10));
      setUiScale(clamped);
    },
    [setUiScale]
  );
  const zoomIn = useCallback(
    () => setUiScale((s) => Math.min(2.5, Math.round((s + 0.1) * 10) / 10)),
    [setUiScale]
  );
  const zoomOut = useCallback(
    () => setUiScale((s) => Math.max(0.5, Math.round((s - 0.1) * 10) / 10)),
    [setUiScale]
  );
  const zoomReset = useCallback(() => setUiScale(1), [setUiScale]);

  const onOpen = useCallback(async () => {
    if (isDirty && !confirm('未保存の変更があります。破棄して別のプロジェクトを開きますか？')) return;
    const r = await projectService.openProject();
    if (!r) return;
    if (inRoom) {
      // Connected to an (empty) room: upload the opened project INTO the room
      // so it becomes the shared data, rather than replacing only our local view.
      try {
        syncManager.uploadProject(r.project);
      } catch {
        alert(
          'このルームには既にデータがあるため読み込めません。\n' +
            '空のルームでのみプロジェクトを読み込めます。'
        );
      }
      return;
    }
    loadProject(r.filePath, r.project);
  }, [isDirty, loadProject, inRoom]);

  const onSave = useCallback(async () => {
    if (!project) return;
    const r = await projectService.saveProject(filePath, project);
    if (r) markSaved(r.filePath, r.updatedAt);
  }, [project, filePath, markSaved]);

  const onSaveAs = useCallback(async () => {
    if (!project) return;
    const r = await projectService.saveProjectAs(project);
    if (r) markSaved(r.filePath, r.updatedAt);
  }, [project, markSaved]);

  useEffect(() => {
    const ev = (window as unknown as {
      menuEvents?: { onAction(cb: (a: string) => void): () => void };
    }).menuEvents;
    if (!ev) return;
    const off = ev.onAction((action) => {
      if (action === 'new') void onNew();
      else if (action === 'open') void onOpen();
      else if (action === 'save') void onSave();
      else if (action === 'saveAs') void onSaveAs();
      else if (action === 'undo') undo();
      else if (action === 'redo') redo();
      else if (action === 'importText') setImportOpen(true);
    });
    return off;
  }, [onNew, onOpen, onSave, onSaveAs, undo, redo]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        const target = e.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.isContentEditable)
        ) {
          return;
        }
        selectCard(null);
        selectGroup(null);
        selectSegment(null);
        selectRelation(null);
        return;
      }
      if (e.key === 'Delete' || (e.key === 'Backspace' && (e.ctrlKey || e.metaKey))) {
        const target = e.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.isContentEditable)
        ) {
          return;
        }
        const state = useProjectStore.getState();
        const proj = state.project;
        if (!proj) return;
        const cardId = state.selectedCardId;
        const groupId = state.selectedGroupId;
        const relationId = state.selectedRelationId;
        if (relationId) {
          const r = proj.data.diagram_relations.find((rr) => rr.id === relationId);
          if (!r) return;
          e.preventDefault();
          applyCommand(makeDeleteRelationCommand(r));
          selectRelation(null);
          return;
        }
        if (cardId) {
          const card = proj.data.cards.find((c) => c.id === cardId);
          if (!card) return;
          const links = proj.data.card_source_links.filter((l) => l.cardId === cardId);
          const pos = proj.data.card_positions.find((p) => p.cardId === cardId) ?? null;
          e.preventDefault();
          applyCommand(makeDeleteCardCommand(card, links, pos));
          selectCard(null);
          return;
        }
        if (groupId) {
          const group = proj.data.groups.find((g) => g.id === groupId);
          if (!group) return;
          const label = getGroupLabel(proj.data, groupId);
          const position = getGroupPosition(proj.data, groupId);
          const memberships = proj.data.group_memberships.filter((m) => m.groupId === groupId);
          e.preventDefault();
          applyCommand(makeDeleteGroupCommand(group, label, position, memberships));
          selectGroup(null);
          return;
        }
      }
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.key === 'y') || (e.shiftKey && e.key.toLowerCase() === 'z')) {
        e.preventDefault();
        redo();
      } else if (e.key === 's' && !e.shiftKey) {
        e.preventDefault();
        void onSave();
      } else if (e.key === 's' && e.shiftKey) {
        e.preventDefault();
        void onSaveAs();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, onSave, onSaveAs, selectCard, selectGroup, selectSegment, selectRelation, applyCommand]);

  const handleFitView = useCallback(() => {
    window.dispatchEvent(new CustomEvent('kj.requestFitView'));
  }, []);

  const handleSetAllCardsCollapsed = useCallback(
    (next: boolean) => {
      if (!project) return;
      const entries = project.data.cards
        .map((c) => ({ cardId: c.id, prev: c.collapsed === true, next }))
        .filter((e) => e.prev !== e.next);
      if (entries.length === 0) return;
      applyCommand(
        makeSetCardsCollapsedBulkCommand(entries, new Date().toISOString())
      );
    },
    [project, applyCommand]
  );

  /**
   * Apply a bulk set of collapsed-flag changes AND recompute ancestor group
   * bounds in the same command so the rectangles shrink/grow to match.
   */
  const applyBulkCollapse = useCallback(
    (entries: Array<{ groupId: string; prev: boolean; next: boolean }>) => {
      if (!project || entries.length === 0) return;
      // Build a synthesized data view where the collapsed flags reflect the
      // post-change state; computeCascadedGroupBoundsUpdates reads this to
      // decide each parent's new bounds.
      const nextById = new Map(entries.map((e) => [e.groupId, e.next]));
      const synthesized = {
        ...project.data,
        groups: project.data.groups.map((g) =>
          nextById.has(g.id) ? { ...g, collapsed: nextById.get(g.id)! } : g
        ),
      };
      const groupOverride = new Map<
        string,
        { x: number; y: number; width: number; height: number }
      >();
      for (const e of entries) {
        const p = project.data.group_positions.find(
          (gp) => gp.groupId === e.groupId
        );
        if (p)
          groupOverride.set(e.groupId, {
            x: p.x,
            y: p.y,
            width: p.width,
            height: p.height,
          });
      }
      const cardWrapWidth = project.metadata.displaySettings?.cardWrapWidth;
      const boundsUpdates = computeCascadedGroupBoundsUpdates(
        synthesized,
        new Map(),
        groupOverride,
        { defaultCardWidth: cardWrapWidth }
      );
      applyCommand(
        makeSetGroupsCollapsedBulkCommand(
          entries,
          new Date().toISOString(),
          boundsUpdates
        )
      );
    },
    [project, applyCommand]
  );

  const handleSetAllGroupsCollapsed = useCallback(
    (next: boolean) => {
      if (!project) return;
      const entries = project.data.groups
        .map((g) => ({ groupId: g.id, prev: g.collapsed, next }))
        .filter((e) => e.prev !== e.next);
      applyBulkCollapse(entries);
    },
    [project, applyBulkCollapse]
  );

  /**
   * Expand groups with level >= N (show their members), collapse groups with
   * level < N. Matches the HierarchyPane "Lv N まで開く" semantics on the
   * canvas, with cascaded ancestor auto-fit.
   */
  const handleExpandGroupsToLevel = useCallback(
    (n: number) => {
      if (!project) return;
      const entries = project.data.groups
        .map((g) => ({
          groupId: g.id,
          prev: g.collapsed,
          next: g.level < n,
        }))
        .filter((e) => e.prev !== e.next);
      applyBulkCollapse(entries);
    },
    [project, applyBulkCollapse]
  );

  /**
   * Collapse groups with level <= N (fold the lower part of the tree), and
   * expand groups with level > N. "Lv N まで閉じる" — fold the hierarchy
   * down to and including level N.
   */
  const handleCollapseGroupsToLevel = useCallback(
    (n: number) => {
      if (!project) return;
      const entries = project.data.groups
        .map((g) => ({
          groupId: g.id,
          prev: g.collapsed,
          next: g.level <= n,
        }))
        .filter((e) => e.prev !== e.next);
      applyBulkCollapse(entries);
    },
    [project, applyBulkCollapse]
  );

  const maxGroupLevelInProject = useMemo(() => {
    if (!project) return 1;
    return project.data.groups.reduce((m, g) => Math.max(m, g.level), 1);
  }, [project]);

  const selectedCardIds = useProjectStore((s) => s.selectedCardIds);
  const selectedGroupIds = useProjectStore((s) => s.selectedGroupIds);

  /**
   * Collect AlignNodeInput list for the current selection. Returns a tagged
   * array so callers know which entries are cards vs groups.
   *
   * Selection rules:
   *  - 2+ cards alone → align those cards
   *  - 2+ groups alone → align those groups (each rect = stored width/height)
   *  - cards + groups mixed → align all of them as a flat set
   *  - 1 group → fall back to its member cards (for grid mode this is the
   *    primary path)
   */
  const collectAlignTargets = useCallback((): Array<
    AlignNodeInput & { kind: 'card' | 'group' }
  > | null => {
    if (!project) return null;
    // 2026-06-02 修正: カード高さに固定値 100 を使うと，本文が長いカードで
    // 整列後に被ってしまう（ご報告のバグ）．React Flow がレンダリングした
    // 実測サイズを window.__kjGetNodeSize 経由で取得し，無ければ従来固定値．
    const CARD_W = 220;
    const CARD_H = 100;
    const getSize = (window as unknown as {
      __kjGetNodeSize?: (id: string) => { width: number; height: number } | null;
    }).__kjGetNodeSize;
    const measure = (id: string, fallbackW: number, fallbackH: number) => {
      if (!getSize) return { width: fallbackW, height: fallbackH };
      const s = getSize(id);
      return s ?? { width: fallbackW, height: fallbackH };
    };
    const out: Array<AlignNodeInput & { kind: 'card' | 'group' }> = [];
    for (const cid of selectedCardIds) {
      const card = project.data.cards.find((c) => c.id === cid);
      if (!card) continue;
      const pos = project.data.card_positions.find((p) => p.cardId === cid);
      if (!pos) continue;
      const { width, height } = measure(
        cid,
        card.collapsed ? 80 : CARD_W,
        card.collapsed ? 32 : CARD_H
      );
      out.push({ id: cid, kind: 'card', x: pos.x, y: pos.y, width, height });
    }
    for (const gid of selectedGroupIds) {
      const pos = project.data.group_positions.find((p) => p.groupId === gid);
      if (!pos) continue;
      out.push({
        id: gid,
        kind: 'group',
        x: pos.x,
        y: pos.y,
        width: pos.width,
        height: pos.height,
      });
    }
    if (out.length >= 2) return out;
    // Fallback: a single selected group → align its direct member cards
    if (selectedGroupIds.length === 1 && out.length < 2) {
      const gid = selectedGroupIds[0];
      const memberIds = project.data.group_memberships
        .filter((m) => m.groupId === gid)
        .map((m) => m.cardId);
      const fb: Array<AlignNodeInput & { kind: 'card' | 'group' }> = [];
      for (const id of memberIds) {
        const card = project.data.cards.find((c) => c.id === id);
        if (!card) continue;
        const pos = project.data.card_positions.find((p) => p.cardId === id);
        if (!pos) continue;
        const { width, height } = measure(
          id,
          card.collapsed ? 80 : CARD_W,
          card.collapsed ? 32 : CARD_H
        );
        fb.push({ id, kind: 'card', x: pos.x, y: pos.y, width, height });
      }
      return fb.length >= 2 ? fb : null;
    }
    return null;
  }, [project, selectedCardIds, selectedGroupIds]);

  /**
   * Apply a layout result (computed positions per node) by:
   *  - converting to bulk move command (cards + groups)
   *  - expanding each group move to also move its descendants (cards inside
   *    + nested groups) by the same delta
   *  - cascading bounds updates on ancestor groups for fit
   */
  const applyNodeMoves = useCallback(
    (
      targets: Array<AlignNodeInput & { kind: 'card' | 'group' }>,
      next: Array<{ id: string; x: number; y: number }>
    ) => {
      if (!project) return;
      const targetById = new Map(targets.map((t) => [t.id, t]));
      const cardMoves: Array<{
        cardId: string;
        from: { x: number; y: number };
        to: { x: number; y: number };
      }> = [];
      const groupMoves: Array<{
        groupId: string;
        from: { x: number; y: number };
        to: { x: number; y: number };
      }> = [];
      const cardOverridesForBounds = new Map<string, { x: number; y: number }>();
      const groupOverridesForBounds = new Map<
        string,
        { x: number; y: number; width: number; height: number }
      >();
      for (const n of next) {
        const t = targetById.get(n.id);
        if (!t) continue;
        if (Math.abs(t.x - n.x) < 0.5 && Math.abs(t.y - n.y) < 0.5) continue;
        if (t.kind === 'card') {
          cardMoves.push({
            cardId: n.id,
            from: { x: t.x, y: t.y },
            to: { x: n.x, y: n.y },
          });
          cardOverridesForBounds.set(n.id, { x: n.x, y: n.y });
        } else {
          groupMoves.push({
            groupId: n.id,
            from: { x: t.x, y: t.y },
            to: { x: n.x, y: n.y },
          });
          groupOverridesForBounds.set(n.id, {
            x: n.x,
            y: n.y,
            width: t.width,
            height: t.height,
          });
          // Drag the descendants by the same delta so the visual layout follows
          const dx = n.x - t.x;
          const dy = n.y - t.y;
          const descendants = collectGroupDescendantsForDrag(project.data, n.id);
          for (const d of descendants) {
            const to = { x: d.startPos.x + dx, y: d.startPos.y + dy };
            if (d.type === 'card') {
              cardMoves.push({
                cardId: d.id,
                from: d.startPos,
                to,
              });
              cardOverridesForBounds.set(d.id, to);
            } else {
              groupMoves.push({
                groupId: d.id,
                from: d.startPos,
                to,
              });
              const orig = project.data.group_positions.find(
                (gp) => gp.groupId === d.id
              );
              groupOverridesForBounds.set(d.id, {
                x: to.x,
                y: to.y,
                width: orig?.width ?? 0,
                height: orig?.height ?? 0,
              });
            }
          }
        }
      }
      if (cardMoves.length === 0 && groupMoves.length === 0) return;
      const cardWrapWidth = project.metadata.displaySettings?.cardWrapWidth;
      const boundsUpdates = computeCascadedGroupBoundsUpdates(
        project.data,
        cardOverridesForBounds,
        groupOverridesForBounds,
        { defaultCardWidth: cardWrapWidth }
      ).filter(
        // exclude bounds entries for groups we are directly moving — those
        // groups' new positions are tracked via groupMoves, not bounds.
        (u) => !groupMoves.some((m) => m.groupId === u.next.groupId)
      );
      applyCommand(makeMoveNodesBulkCommand(cardMoves, groupMoves, boundsUpdates));
    },
    [project, applyCommand]
  );

  const handleAlign = useCallback(
    (axis: AlignAxis) => {
      const targets = collectAlignTargets();
      if (!targets) return;
      applyNodeMoves(targets, alignNodes(targets, axis));
    },
    [collectAlignTargets, applyNodeMoves]
  );

  const handleDistribute = useCallback(
    (direction: 'horizontal' | 'vertical') => {
      const targets = collectAlignTargets();
      if (!targets) return;
      applyNodeMoves(targets, distributeNodes(targets, direction));
    },
    [collectAlignTargets, applyNodeMoves]
  );

  /**
   * Grid arrange. Targets in priority order:
   *  - 2+ selected groups (top level peers) → arrange those groups
   *  - 1 selected group → arrange its direct member cards
   */
  const handleArrangeGrid = useCallback(
    (kind: 'rows' | 'cols', count: number) => {
      if (!project) return;
      let targets: Array<AlignNodeInput & { kind: 'card' | 'group' }> = [];
      let baseX: number;
      let baseY: number;

      if (selectedGroupIds.length >= 2) {
        // Multiple groups in a grid (sorted by name for stability)
        const groups = selectedGroupIds
          .map((id) => project.data.groups.find((g) => g.id === id))
          .filter((g): g is NonNullable<typeof g> => !!g)
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name));
        for (const g of groups) {
          const pos = project.data.group_positions.find(
            (p) => p.groupId === g.id
          );
          if (!pos) continue;
          targets.push({
            id: g.id,
            kind: 'group',
            x: pos.x,
            y: pos.y,
            width: pos.width,
            height: pos.height,
          });
        }
        if (targets.length === 0) return;
        baseX = Math.min(...targets.map((t) => t.x));
        baseY = Math.min(...targets.map((t) => t.y));
      } else if (selectedGroupIds.length === 1) {
        const gid = selectedGroupIds[0];
        const memberIds = project.data.group_memberships
          .filter((m) => m.groupId === gid)
          .map((m) => m.cardId);
        const cardsInOrder = memberIds
          .map((id) => project.data.cards.find((c) => c.id === id))
          .filter((c): c is NonNullable<typeof c> => !!c)
          .slice()
          .sort((a, b) => a.code.localeCompare(b.code));
        const CARD_W = 220;
        const CARD_H = 100;
        // 2026-06-02: 実測サイズを優先（被り回避）
        const getSize = (window as unknown as {
          __kjGetNodeSize?: (id: string) => { width: number; height: number } | null;
        }).__kjGetNodeSize;
        type T = AlignNodeInput & { kind: 'card' | 'group' };
        targets = cardsInOrder
          .map((c): T | null => {
            const pos = project.data.card_positions.find(
              (p) => p.cardId === c.id
            );
            if (!pos) return null;
            const fallbackW = c.collapsed ? 80 : CARD_W;
            const fallbackH = c.collapsed ? 32 : CARD_H;
            const measured = getSize?.(c.id);
            return {
              id: c.id,
              kind: 'card',
              x: pos.x,
              y: pos.y,
              width: measured?.width ?? fallbackW,
              height: measured?.height ?? fallbackH,
            };
          })
          .filter((t): t is T => t !== null);
        if (targets.length === 0) return;
        const groupPos = project.data.group_positions.find(
          (p) => p.groupId === gid
        );
        baseX = (groupPos?.x ?? Math.min(...targets.map((t) => t.x))) + 10;
        baseY = (groupPos?.y ?? Math.min(...targets.map((t) => t.y))) + 10;
      } else {
        return;
      }

      const next = arrangeInGrid(
        targets,
        kind === 'rows' ? { kind: 'rows', count } : { kind: 'cols', count },
        { baseX, baseY, gap: 20, cellMode: 'variable' }
      );
      applyNodeMoves(targets, next);
    },
    [project, selectedGroupIds, applyNodeMoves]
  );

  const alignAvailable =
    selectedCardIds.length >= 2 ||
    selectedGroupIds.length >= 2 ||
    selectedCardIds.length + selectedGroupIds.length >= 2 ||
    (selectedGroupIds.length === 1 &&
      !!project &&
      project.data.group_memberships.filter(
        (m) => m.groupId === selectedGroupIds[0]
      ).length >= 2);
  const gridAvailable =
    selectedGroupIds.length >= 1 ||
    selectedGroupIds.length >= 2;

  const [autosaveFlash, setAutosaveFlash] = useState(false);
  const [autosaveCountdown, setAutosaveCountdown] = useState(60);
  const [autosaveEnabled, setAutosaveEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try {
      return window.localStorage.getItem('kj.autosaveEnabled') !== '0';
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(
        'kj.autosaveEnabled',
        autosaveEnabled ? '1' : '0'
      );
    } catch {
      // ignore
    }
  }, [autosaveEnabled]);
  const autosaveRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (autosaveRef.current) {
      clearInterval(autosaveRef.current);
      autosaveRef.current = null;
    }
    if (!project || !filePath || !autosaveEnabled) {
      setAutosaveCountdown(60);
      return;
    }
    autosaveRef.current = setInterval(async () => {
      const dirty = useProjectStore.getState().isDirty;
      if (!dirty) {
        setAutosaveCountdown(60);
        return;
      }
      setAutosaveCountdown((prev) => {
        if (prev <= 1) {
          void (async () => {
            await onSave();
            setAutosaveFlash(true);
            setTimeout(() => setAutosaveFlash(false), 1500);
          })();
          return 60;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (autosaveRef.current) clearInterval(autosaveRef.current);
      autosaveRef.current = null;
    };
  }, [project, filePath, onSave, autosaveEnabled]);

  // Reset countdown whenever the project becomes clean (e.g., manual save)
  useEffect(() => {
    if (!isDirty) setAutosaveCountdown(60);
  }, [isDirty]);

  const saveStatus = !project
    ? ''
    : !filePath
      ? '未保存 — 「保存」で .kjproj として保存'
      : autosaveFlash
        ? `自動保存しました ${project.metadata.updated_at.slice(11, 19)}`
        : isDirty
          ? autosaveEnabled
            ? `未保存 — 自動保存まで ${autosaveCountdown} 秒`
            : '未保存 (自動保存 OFF)'
          : `保存済み ${project.metadata.updated_at.slice(11, 19)}`;

  const saveStatusClass = !project
    ? ''
    : !filePath
      ? 'status-new'
      : autosaveFlash
        ? 'status-flash'
        : isDirty
          ? 'status-dirty'
          : 'status-saved';

  const title = project
    ? `${project.metadata.name}${isDirty ? ' *' : ''} — KJ Trace Studio`
    : 'KJ Trace Studio';
  useEffect(() => {
    document.title = title;
  }, [title]);

  return (
    <div className="app-root" style={uiScale !== 1 ? { zoom: uiScale } : undefined}>
      <header className="app-header ribbon-header">
        <div className="ribbon-row-1">
          <div className="app-title">
            {title}
            <span className="app-version" title={`KJ Trace Studio v${__APP_VERSION__}`}>
              v{__APP_VERSION__}
            </span>
          </div>
          <nav className="ribbon-tabs">
            <button
              type="button"
              className={`ribbon-tab ${ribbonTab === 'file' ? 'active' : ''}`}
              onClick={() => setRibbonTab('file')}
            >
              ファイル
            </button>
            <button
              type="button"
              className={`ribbon-tab ${ribbonTab === 'edit' ? 'active' : ''}`}
              onClick={() => setRibbonTab('edit')}
            >
              編集
            </button>
            <button
              type="button"
              className={`ribbon-tab ${ribbonTab === 'view' ? 'active' : ''}`}
              onClick={() => setRibbonTab('view')}
            >
              表示
            </button>
            <button
              type="button"
              className={`ribbon-tab ${ribbonTab === 'align' ? 'active' : ''}`}
              onClick={() => setRibbonTab('align')}
            >
              整列
            </button>
            <button
              type="button"
              className={`ribbon-tab ${ribbonTab === 'bulk' ? 'active' : ''}`}
              onClick={() => setRibbonTab('bulk')}
            >
              一括操作
            </button>
          </nav>
          {saveStatus && (
            <span
              className={`save-status ${saveStatusClass}`}
              title="自動保存: ファイル保存後、変更があれば 60 秒ごとに自動保存します"
            >
              {saveStatus}
            </span>
          )}
          {project && filePath && (
            <button
              type="button"
              className={`autosave-toggle ${autosaveEnabled ? 'on' : 'off'}`}
              onClick={() => setAutosaveEnabled((v) => !v)}
              title={
                autosaveEnabled
                  ? '自動保存 ON — クリックで OFF にする'
                  : '自動保存 OFF — クリックで ON にする'
              }
            >
              {autosaveEnabled ? '自動保存 ON' : '自動保存 OFF'}
            </button>
          )}
          {__INCLUDE_SYNC__ && <SyncStatusBadge onOpenConnect={() => setSyncDialogOpen(true)} />}
          {/* 2026-06-02 デバッグオーバーレイ: トグルで ON/OFF．既定 OFF． */}
          {showDebugOverlay && (
            <div
              style={{
                position: 'fixed',
                bottom: 6,
                right: 6,
                fontSize: 10,
                padding: '4px 8px',
                background: 'rgba(0,0,0,0.7)',
                color: '#9efc7e',
                fontFamily: 'monospace',
                borderRadius: 4,
                zIndex: 9999,
                pointerEvents: 'none',
              }}
            >
              cards={project?.data.cards.length ?? '-'}
              {' '}segs={project?.data.source_segments.length ?? '-'}
              {' '}groups={project?.data.groups.length ?? '-'}
              {' '}sync={syncSnapshot.status}{syncSnapshot.synced ? '✓' : ''}
            </div>
          )}
          {/* 分析モード切替 (KJ / M-GTA / GTA) は当面 KJ のみのため UI 上は非表示．
              データ構造・型 (AppMode) は温存しており，将来再有効化可能． */}
        </div>
        {isViewer && (
          <div
            className="viewer-mode-banner"
            role="status"
            title="サーバーから viewer ロールが付与されています．編集は無効化されています．"
          >
            <span className="viewer-mode-banner-icon" aria-hidden="true">●</span>
            <span className="viewer-mode-banner-text">
              閲覧者モード — カード・グループの編集は無効です．
              カードと表札へのメモ追記 (コメント) は実行できます．
            </span>
          </div>
        )}
        <div className="ribbon-row-2" data-ribbon-tab={ribbonTab}>
          {ribbonTab === 'file' && (
            <>
              <RibbonSection label="ファイル">
                <button
                  type="button"
                  className="rb-btn-lg"
                  onClick={onNew}
                  disabled={roomLocksFileOps}
                  title={
                    roomLocksFileOps
                      ? 'サーバー接続中（ルームにデータあり）は新規作成できません'
                      : undefined
                  }
                >
                  <span className="rb-glyph">＋</span>
                  <span>新規</span>
                </button>
                <span className="rb-recent-wrap">
                  <button
                    type="button"
                    className="rb-btn-lg"
                    onClick={onOpen}
                    disabled={roomLocksFileOps}
                    title={
                      roomLocksFileOps
                        ? 'サーバー接続中（ルームにデータあり）は開けません'
                        : inRoom
                          ? '既存プロジェクトを開いてこの空ルームに読み込みます'
                          : undefined
                    }
                  >
                    <span className="rb-glyph">▤</span>
                    <span>{inRoom && !roomLocksFileOps ? 'ルームに読込' : '開く'}</span>
                  </button>
                  {recentFiles.length > 0 && (
                    <button
                      type="button"
                      className="recent-files-toggle"
                      onClick={() => setRecentMenuOpen((v) => !v)}
                      title="最近開いたプロジェクト"
                    >
                      ▾
                    </button>
                  )}
                  {recentMenuOpen && (
                    <div
                      className="recent-files-menu"
                      onMouseLeave={() => setRecentMenuOpen(false)}
                    >
                      <div className="recent-files-header muted small">
                        最近開いたプロジェクト
                      </div>
                      {recentFiles.map((p) => {
                        const name = p.split(/[\\/]/).pop() ?? p;
                        return (
                          <button
                            key={p}
                            type="button"
                            className="recent-files-item"
                            onClick={() => void openRecent(p)}
                            title={p}
                          >
                            <div className="recent-files-name">{name}</div>
                            <div className="recent-files-path muted small">{p}</div>
                          </button>
                        );
                      })}
                      <div className="recent-files-footer">
                        <button
                          type="button"
                          onClick={() => {
                            setRecentFiles([]);
                            try {
                              window.localStorage.removeItem('kj.recentFiles');
                            } catch {
                              // ignore
                            }
                            setRecentMenuOpen(false);
                          }}
                        >
                          履歴をクリア
                        </button>
                      </div>
                    </div>
                  )}
                </span>
                <button
                  type="button"
                  className="rb-btn-lg"
                  onClick={onSave}
                  disabled={!project}
                >
                  <span className="rb-glyph">▼</span>
                  <span>保存</span>
                </button>
              </RibbonSection>
              <RibbonSection label="取り込み">
                <button
                  type="button"
                  className="rb-btn-lg"
                  onClick={() => setImportOpen(true)}
                  disabled={!project}
                  title="テキスト・CSV・Excel・Word から原文を取り込む"
                >
                  <span className="rb-glyph">↓</span>
                  <span>テキスト取り込み</span>
                </button>
              </RibbonSection>
              <RibbonSection label="表示倍率">
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    alignItems: 'stretch',
                    padding: '0 4px',
                  }}
                >
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <button
                      type="button"
                      onClick={zoomOut}
                      title="表示を縮小 (Ctrl + -)"
                      style={{ width: 32 }}
                    >
                      −
                    </button>
                    <span
                      className="muted small"
                      style={{ minWidth: 40, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}
                      title="現在の表示倍率"
                    >
                      {Math.round(uiScale * 100)}%
                    </span>
                    <button
                      type="button"
                      onClick={zoomIn}
                      title="表示を拡大 (Ctrl + +)"
                      style={{ width: 32 }}
                    >
                      ＋
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <button
                      type="button"
                      onClick={() => adjustUiScale(0.85)}
                      title="文字を小さく (85%)"
                      style={{ flex: 1, fontSize: 10 }}
                    >
                      小
                    </button>
                    <button
                      type="button"
                      onClick={zoomReset}
                      title="標準に戻す (Ctrl + 0)"
                      style={{ flex: 1, fontSize: 11 }}
                    >
                      標準
                    </button>
                    <button
                      type="button"
                      onClick={() => adjustUiScale(1.25)}
                      title="文字を大きく (125%)"
                      style={{ flex: 1, fontSize: 14 }}
                    >
                      大
                    </button>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowDebugOverlay((v) => !v)}
                  title="同期デバッグオーバーレイ（画面右下に store 状態表示）"
                  style={{ fontSize: 10, marginLeft: 6, padding: '2px 8px' }}
                  className={showDebugOverlay ? 'rb-btn-active' : ''}
                >
                  debug {showDebugOverlay ? 'ON' : 'OFF'}
                </button>
              </RibbonSection>
              <RibbonSection label="連携">
                <button
                  type="button"
                  className="rb-btn-lg"
                  onClick={() => {
                    const api = (window as unknown as {
                      api?: { openSourceView?: () => Promise<void> };
                    }).api;
                    if (api?.openSourceView) void api.openSourceView();
                    else alert('Electron でのみ利用可能です');
                  }}
                  disabled={!project}
                  title="原文ビューアを別ウィンドウで開く（マルチモニタ向け）"
                >
                  <span className="rb-glyph">⧉</span>
                  <span>原文を別窓</span>
                </button>
              </RibbonSection>
              <RibbonSection label="エクスポート">
                <button
                  type="button"
                  className="rb-btn-lg"
                  onClick={() => setExportOpen(true)}
                  disabled={!project}
                  title="キャンバスを PNG / PDF / SVG として出力 (印刷プレビュー付き)"
                >
                  <span className="rb-glyph">E</span>
                  <span>図を出力</span>
                </button>
                <button
                  type="button"
                  className="rb-btn-lg"
                  onClick={() => setWordWizardOpen(true)}
                  disabled={!project}
                  title="KJ 法論文用 Word (.docx) をウィザードで生成"
                >
                  <span className="rb-glyph">W</span>
                  <span>Word 出力</span>
                </button>
              </RibbonSection>
            </>
          )}
          {ribbonTab === 'edit' && (
            <>
              <RibbonSection label="履歴">
                <button
                  type="button"
                  className="rb-btn-lg"
                  onClick={undo}
                  disabled={past.length === 0}
                >
                  <span className="rb-glyph">↶</span>
                  <span>Undo</span>
                </button>
                <button
                  type="button"
                  className="rb-btn-lg"
                  onClick={redo}
                  disabled={future.length === 0}
                >
                  <span className="rb-glyph">↷</span>
                  <span>Redo</span>
                </button>
              </RibbonSection>
              {/* 2026-06-02: キャンバス操作モード (移動 / 範囲選択) */}
              <RibbonSection label="操作モード">
                <button
                  type="button"
                  className={`rb-btn-lg ${canvasMode === 'pan' ? 'rb-btn-active' : ''}`}
                  onClick={() => setCanvasMode('pan')}
                  title="キャンバスをドラッグで視点移動（ノードクリックで個別選択）"
                >
                  <span className="rb-glyph">✥</span>
                  <span>移動</span>
                </button>
                <button
                  type="button"
                  className={`rb-btn-lg ${canvasMode === 'select' ? 'rb-btn-active' : ''}`}
                  onClick={() => setCanvasMode('select')}
                  title="キャンバスをドラッグで矩形範囲選択"
                >
                  <span className="rb-glyph">□</span>
                  <span>範囲</span>
                </button>
              </RibbonSection>
              <RibbonSection label="タグ">
                <button
                  type="button"
                  className="rb-btn-lg"
                  onClick={() => setTagEditorOpen(true)}
                  disabled={!project}
                  title="全タグの一覧・名前変更・統合・削除"
                >
                  <span className="rb-glyph">#</span>
                  <span>タグ管理</span>
                </button>
              </RibbonSection>
            </>
          )}
          {ribbonTab === 'view' && (
            <>
              <RibbonSection label="ズーム">
                <button
                  type="button"
                  className="rb-btn-lg"
                  onClick={handleFitView}
                  disabled={!project}
                  title="キャンバスのすべての要素が見えるようにズーム"
                >
                  <span className="rb-glyph">⤢</span>
                  <span>全体表示</span>
                </button>
              </RibbonSection>
              <RibbonSection label="カード">
                <button
                  type="button"
                  className="rb-btn-lg"
                  onClick={() => handleSetAllCardsCollapsed(false)}
                  disabled={!project}
                  title="すべてのカードを展開 (本文を表示)"
                >
                  <span className="rb-glyph">▽</span>
                  <span>全展開</span>
                </button>
                <button
                  type="button"
                  className="rb-btn-lg"
                  onClick={() => handleSetAllCardsCollapsed(true)}
                  disabled={!project}
                  title="すべてのカードを折りたたみ (ID のみ)"
                >
                  <span className="rb-glyph">▷</span>
                  <span>全折りたたみ</span>
                </button>
              </RibbonSection>
              <RibbonSection label="グループ">
                <button
                  type="button"
                  className="rb-btn-lg"
                  onClick={() => handleSetAllGroupsCollapsed(false)}
                  disabled={!project}
                  title="すべてのグループを展開"
                >
                  <span className="rb-glyph">▽</span>
                  <span>全展開</span>
                </button>
                <button
                  type="button"
                  className="rb-btn-lg"
                  onClick={() => handleSetAllGroupsCollapsed(true)}
                  disabled={!project}
                  title="すべてのグループを折りたたみ (表札のみ)"
                >
                  <span className="rb-glyph">▷</span>
                  <span>全折りたたみ</span>
                </button>
              </RibbonSection>
              <RibbonSection label="履歴">
                <button
                  type="button"
                  className="rb-btn-lg"
                  onClick={() => setHistoryOpen(true)}
                  disabled={!project}
                  title="バージョン履歴 (スナップショット) を開く"
                >
                  <span className="rb-glyph">H</span>
                  <span>バージョン履歴</span>
                </button>
              </RibbonSection>
              <RibbonSection label="レベル指定">
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    alignItems: 'stretch',
                  }}
                >
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <span className="muted small">Lv</span>
                    <input
                      type="number"
                      min={1}
                      max={Math.max(1, maxGroupLevelInProject)}
                      step={1}
                      value={viewLevelInput}
                      onChange={(e) =>
                        setViewLevelInput(
                          Math.max(1, Math.min(20, Number(e.target.value) || 1))
                        )
                      }
                      style={{ width: 48 }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => handleExpandGroupsToLevel(viewLevelInput)}
                    disabled={!project}
                    title="指定 Lv 以上のグループを展開し, それより下のグループとカードを折りたたむ"
                  >
                    このレベルまで展開
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCollapseGroupsToLevel(viewLevelInput)}
                    disabled={!project}
                    title="指定 Lv 以下のグループをすべて折りたたみ, Lv より上は展開のまま"
                  >
                    このレベルまで閉じる
                  </button>
                </div>
              </RibbonSection>
            </>
          )}
          {ribbonTab === 'align' && (
            <>
              <RibbonSection label="端揃え">
                <button
                  type="button"
                  className="rb-btn-lg"
                  onClick={() => handleAlign('left')}
                  disabled={!alignAvailable}
                  title="選択カードの左端を揃える"
                >
                  <span className="rb-glyph">⫷</span>
                  <span>左揃え</span>
                </button>
                <button
                  type="button"
                  className="rb-btn-lg"
                  onClick={() => handleAlign('right')}
                  disabled={!alignAvailable}
                  title="選択カードの右端を揃える"
                >
                  <span className="rb-glyph">⫸</span>
                  <span>右揃え</span>
                </button>
                <button
                  type="button"
                  className="rb-btn-lg"
                  onClick={() => handleAlign('top')}
                  disabled={!alignAvailable}
                  title="選択カードの上端を揃える"
                >
                  <span className="rb-glyph">⫴</span>
                  <span>上揃え</span>
                </button>
                <button
                  type="button"
                  className="rb-btn-lg"
                  onClick={() => handleAlign('bottom')}
                  disabled={!alignAvailable}
                  title="選択カードの下端を揃える"
                >
                  <span className="rb-glyph">⫵</span>
                  <span>下揃え</span>
                </button>
              </RibbonSection>
              <RibbonSection label="中央揃え">
                <button
                  type="button"
                  className="rb-btn-lg"
                  onClick={() => handleAlign('hcenter')}
                  disabled={!alignAvailable}
                  title="選択カードの水平中心を揃える"
                >
                  <span className="rb-glyph">≣</span>
                  <span>水平中央</span>
                </button>
                <button
                  type="button"
                  className="rb-btn-lg"
                  onClick={() => handleAlign('vcenter')}
                  disabled={!alignAvailable}
                  title="選択カードの垂直中心を揃える"
                >
                  <span className="rb-glyph">⫼</span>
                  <span>垂直中央</span>
                </button>
              </RibbonSection>
              <RibbonSection label="等間隔">
                <button
                  type="button"
                  className="rb-btn-lg"
                  onClick={() => handleDistribute('horizontal')}
                  disabled={!alignAvailable}
                  title="選択カードを水平方向に等間隔配置"
                >
                  <span className="rb-glyph">⇋</span>
                  <span>水平等間隔</span>
                </button>
                <button
                  type="button"
                  className="rb-btn-lg"
                  onClick={() => handleDistribute('vertical')}
                  disabled={!alignAvailable}
                  title="選択カードを垂直方向に等間隔配置"
                >
                  <span className="rb-glyph">⇅</span>
                  <span>垂直等間隔</span>
                </button>
              </RibbonSection>
              <RibbonSection label="グリッド配置 (グループ複数 or 単一グループの中身)">
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    alignItems: 'stretch',
                  }}
                >
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <span className="muted small">行数</span>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      step={1}
                      value={gridRowsInput}
                      onChange={(e) =>
                        setGridRowsInput(
                          Math.max(1, Math.min(50, Number(e.target.value) || 1))
                        )
                      }
                      style={{ width: 48 }}
                    />
                    <button
                      type="button"
                      onClick={() => handleArrangeGrid('rows', gridRowsInput)}
                      disabled={!gridAvailable}
                      title="グループ内カードを指定行数で並べる"
                    >
                      行で整列
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <span className="muted small">列数</span>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      step={1}
                      value={gridColsInput}
                      onChange={(e) =>
                        setGridColsInput(
                          Math.max(1, Math.min(50, Number(e.target.value) || 1))
                        )
                      }
                      style={{ width: 48 }}
                    />
                    <button
                      type="button"
                      onClick={() => handleArrangeGrid('cols', gridColsInput)}
                      disabled={!gridAvailable}
                      title="グループ内カードを指定列数で並べる"
                    >
                      列で整列
                    </button>
                  </div>
                </div>
              </RibbonSection>
            </>
          )}
          {ribbonTab === 'bulk' && (
            <>
              <RibbonSection label="編集">
                <button
                  type="button"
                  className="rb-btn-lg"
                  onClick={() => setBulkReplaceOpen(true)}
                  disabled={!project}
                  title="カード本文・表札・メモを横断して検索置換"
                >
                  <span className="rb-glyph">R</span>
                  <span>一括置換</span>
                </button>
                <button
                  type="button"
                  className="rb-btn-lg"
                  onClick={() => setBulkStyleOpen(true)}
                  disabled={!project}
                  title="選択または全カード/グループの文字スタイルを一括変更"
                >
                  <span className="rb-glyph">A</span>
                  <span>スタイル</span>
                </button>
              </RibbonSection>
              <RibbonSection label="設定">
                <button
                  type="button"
                  className="rb-btn-lg"
                  onClick={() => setDisplaySettingsOpen(true)}
                  disabled={!project}
                  title="プロジェクト全体のカード表示設定"
                >
                  <span className="rb-glyph">D</span>
                  <span>表示設定</span>
                </button>
              </RibbonSection>
              <RibbonSection label="記録">
                <button
                  type="button"
                  className="rb-btn-lg"
                  onClick={() => setAuditOpen(true)}
                  disabled={!project}
                  title="プロジェクト統計と操作履歴を出力（論文・査読対応）"
                >
                  <span className="rb-glyph">M</span>
                  <span>監査</span>
                </button>
              </RibbonSection>
            </>
          )}
          <span className="ribbon-spacer" />
          {mode === 'kj' && (
            <div className="ribbon-view-tabs">
              <button
                type="button"
                className={centerTab === 'canvas' ? 'tab active' : 'tab'}
                onClick={() => setCenterTab('canvas')}
              >
                キャンバス
              </button>
              <button
                type="button"
                className={centerTab === 'source' ? 'tab active' : 'tab'}
                onClick={() => setCenterTab('source')}
              >
                原文ビューア
              </button>
              <button
                type="button"
                className={centerTab === 'final' ? 'tab active' : 'tab'}
                onClick={() => setCenterTab('final')}
                title="KJ 法 1986/1997 版 A 型図解化用ビュー"
              >
                最終図解
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="app-main">
        {project ? (
          // M-GTA / GTA ワークスペースは UI 上は非表示．常に KJ レイアウト．
          // (将来再有効化する場合は mode === 'm_gta'/'gta' の分岐を復活させる)
          (
            <>
              {leftCollapsed ? (
                <button
                  type="button"
                  className="pane-tab pane-tab-left"
                  onClick={() => setLeftCollapsed(false)}
                  title="検索ペインを開く"
                >
                  <span className="pane-tab-text">▶ 検索</span>
                </button>
              ) : (
                <div
                  className="pane-with-toggle pane-left"
                  style={{ width: leftPane.width + 22 }}
                >
                  <LeftPanel onOpenImport={() => setImportOpen(true)} onJumpTo={onJumpTo} />
                  <div
                    className={`pane-resize-handle pane-resize-handle-vertical ${
                      leftPane.isDragging ? 'dragging' : ''
                    }`}
                    onMouseDown={leftPane.startDrag}
                    onDoubleClick={leftPane.resetWidth}
                    title="ドラッグで幅変更 / ダブルクリックで初期化"
                  />
                  <button
                    type="button"
                    className="pane-collapse-btn"
                    onClick={() => setLeftCollapsed(true)}
                    title="左ペインを閉じる"
                  >
                    ◀
                  </button>
                </div>
              )}
              {hierarchyOpen ? (
                <div
                  className="pane-with-toggle pane-left"
                  style={{ width: hierarchyPane.width + 22 }}
                >
                  <HierarchyPane onClose={() => setHierarchyOpen(false)} />
                  <div
                    className={`pane-resize-handle pane-resize-handle-vertical ${
                      hierarchyPane.isDragging ? 'dragging' : ''
                    }`}
                    onMouseDown={hierarchyPane.startDrag}
                    onDoubleClick={hierarchyPane.resetWidth}
                    title="ドラッグで幅変更 / ダブルクリックで初期化"
                  />
                  <button
                    type="button"
                    className="pane-collapse-btn"
                    onClick={() => setHierarchyOpen(false)}
                    title="階層ペインを閉じる"
                  >
                    ◀
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="pane-tab pane-tab-left"
                  onClick={() => setHierarchyOpen(true)}
                  title="階層表示ペインを開く"
                >
                  <span className="pane-tab-text">▶ 階層表示</span>
                </button>
              )}
              <section className="center-pane">
                {centerTab === 'canvas' ? (
                  <CanvasView />
                ) : centerTab === 'final' ? (
                  <KJFinalView />
                ) : (
                  <SourceViewer />
                )}
              </section>
              {/* Detail-pane reopen tab gets rendered BEFORE the placement pane
                  when placement is open and right is collapsed, so it stays
                  visible (body has overflow: hidden — otherwise the right-most
                  18px tab gets clipped off the viewport). */}
              {rightCollapsed && !placementCollapsed && (
                <button
                  type="button"
                  className="pane-tab pane-tab-right"
                  onClick={() => setRightCollapsed(false)}
                  title="カード詳細ペインを開く"
                >
                  <span className="pane-tab-text">◀ 詳細</span>
                </button>
              )}
              {placementCollapsed ? (
                <button
                  type="button"
                  className="pane-tab pane-tab-right"
                  onClick={() => setPlacementCollapsed(false)}
                  title="未分類・分類留保ペインを開く"
                >
                  <span className="pane-tab-text">◀ 未分類・分類留保</span>
                </button>
              ) : (
                <div
                  className="pane-with-toggle pane-right"
                  style={{ width: placementPane.width + 22 }}
                >
                  <button
                    type="button"
                    className="pane-collapse-btn"
                    onClick={() => setPlacementCollapsed(true)}
                    title="未分類・分類留保ペインを閉じる"
                  >
                    ▶
                  </button>
                  <div
                    className={`pane-resize-handle pane-resize-handle-vertical ${
                      placementPane.isDragging ? 'dragging' : ''
                    }`}
                    onMouseDown={placementPane.startDrag}
                    onDoubleClick={placementPane.resetWidth}
                    title="ドラッグで幅変更 / ダブルクリックで初期化"
                  />
                  <CardPlacementPane layout="right" />
                </div>
              )}
              {/* The detail tab is rendered here only when BOTH panes are
                  collapsed (so two tabs stack at the right edge as before).
                  When only the detail is collapsed the tab is rendered above
                  (before placement) to stay visible. */}
              {rightCollapsed && placementCollapsed && (
                <button
                  type="button"
                  className="pane-tab pane-tab-right"
                  onClick={() => setRightCollapsed(false)}
                  title="カード詳細ペインを開く"
                >
                  <span className="pane-tab-text">◀ 詳細</span>
                </button>
              )}
              {!rightCollapsed && (
                <div
                  className="pane-with-toggle pane-right"
                  style={{ width: rightPane.width + 22 }}
                >
                  <button
                    type="button"
                    className="pane-collapse-btn"
                    onClick={() => setRightCollapsed(true)}
                    title="右ペインを閉じる"
                  >
                    ▶
                  </button>
                  <div
                    className={`pane-resize-handle pane-resize-handle-vertical ${
                      rightPane.isDragging ? 'dragging' : ''
                    }`}
                    onMouseDown={rightPane.startDrag}
                    onDoubleClick={rightPane.resetWidth}
                    title="ドラッグで幅変更 / ダブルクリックで初期化"
                  />
                  <RightPanel />
                </div>
              )}
            </>
          )
        ) : (
          <div className="welcome">
            <h1>KJ Trace Studio</h1>
            <p>プロジェクトを新規作成するか、既存のファイルを開いてください。</p>
            <div className="welcome-actions">
              <button type="button" className="primary" onClick={onNew}>新規プロジェクト</button>
              <button type="button" onClick={onOpen}>開く...</button>
              {__INCLUDE_SYNC__ && (
                <button type="button" onClick={onConnectExisting}>
                  サーバーに接続して既存ルームに参加…
                </button>
              )}
            </div>
            {__INCLUDE_SYNC__ && (
              <p className="muted small" style={{ marginTop: 16 }}>
                共同編集サーバーに既存ルームがある場合は「サーバーに接続して既存ルームに参加」を
                クリックすると，自動で空プロジェクトが作られ，接続後にルームのカード・原文が
                流れ込んできます．
              </p>
            )}
          </div>
        )}
      </main>

      <ImportWizard open={importOpen} onClose={() => setImportOpen(false)} />
      {__INCLUDE_SYNC__ && (
        <SyncConnectDialog open={syncDialogOpen} onClose={() => setSyncDialogOpen(false)} />
      )}
      <BulkReplaceDialog open={bulkReplaceOpen} onClose={() => setBulkReplaceOpen(false)} />
      <BulkStyleDialog open={bulkStyleOpen} onClose={() => setBulkStyleOpen(false)} />
      <DisplaySettingsDialog
        open={displaySettingsOpen}
        onClose={() => setDisplaySettingsOpen(false)}
      />
      <AuditExportDialog open={auditOpen} onClose={() => setAuditOpen(false)} />
      <TagEditorDialog open={tagEditorOpen} onClose={() => setTagEditorOpen(false)} />
      <VersionHistoryDialog open={historyOpen} onClose={() => setHistoryOpen(false)} />
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
      <WordExportWizard open={wordWizardOpen} onClose={() => setWordWizardOpen(false)} />
      <PromptDialog
        open={newProjectOpen}
        title="新規プロジェクト"
        label="プロジェクト名"
        initialValue="新規プロジェクト"
        okLabel="作成"
        onSubmit={handleCreateNewProject}
        onCancel={() => setNewProjectOpen(false)}
      />
    </div>
  );
}

/**
 * Office-Ribbon-style section: a vertical column of buttons with a bottom
 * label and a right-side divider. Used inside the active ribbon tab.
 */
function RibbonSection({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="ribbon-section">
      <div className="ribbon-section-buttons">{children}</div>
      <div className="ribbon-section-label">{label}</div>
    </div>
  );
}
