import { useEffect, useMemo, useState } from 'react';
import { useProjectStore } from '../stores/projectStore.js';
import { getGroupLabel, getUngroupedCards } from '../domain/groups.js';
import { useKeyboardScroll } from '../hooks/useKeyboardScroll.js';
import type { Card, Group, ProjectData } from '@shared/types/domain';

interface TreeNode {
  kind: 'group' | 'card';
  id: string;
  level: number; // depth in the tree (display indentation)
  group?: Group;
  card?: Card;
  labelText?: string;
  memberCount?: number;
  hasChildren: boolean;
}

/**
 * Walk the project tree depth-first, skipping subtrees whose root group is
 * in `collapsed`. The result is directly renderable (no post-filtering).
 *
 * Tree shape per group node:
 *   [group g (depth d)]
 *     [child groups recursively]
 *     [direct member cards (depth d+1)]
 */
function buildVisibleTree(
  data: ProjectData,
  collapsed: Set<string>
): TreeNode[] {
  const result: TreeNode[] = [];

  // Index group memberships once.
  const cardsByGroup = new Map<string, Card[]>();
  for (const m of data.group_memberships) {
    const c = data.cards.find((x) => x.id === m.cardId);
    if (!c) continue;
    if (!cardsByGroup.has(m.groupId)) cardsByGroup.set(m.groupId, []);
    cardsByGroup.get(m.groupId)!.push(c);
  }
  for (const [, arr] of cardsByGroup) arr.sort((a, b) => a.serialNumber - b.serialNumber);

  const childGroupsByParent = new Map<string | null, Group[]>();
  for (const g of data.groups) {
    const key = g.parentGroupId;
    if (!childGroupsByParent.has(key)) childGroupsByParent.set(key, []);
    childGroupsByParent.get(key)!.push(g);
  }
  for (const [, arr] of childGroupsByParent) {
    arr.sort((a, b) => b.level - a.level || a.name.localeCompare(b.name));
  }

  const walkGroup = (g: Group, depth: number) => {
    const label = getGroupLabel(data, g.id);
    const cards = cardsByGroup.get(g.id) ?? [];
    const childGroups = childGroupsByParent.get(g.id) ?? [];
    const hasChildren = cards.length > 0 || childGroups.length > 0;
    result.push({
      kind: 'group',
      id: g.id,
      level: depth,
      group: g,
      labelText: label?.text || g.name,
      memberCount: cards.length,
      hasChildren,
    });
    if (collapsed.has(g.id)) return; // children hidden
    for (const cg of childGroups) walkGroup(cg, depth + 1);
    for (const c of cards) {
      result.push({
        kind: 'card',
        id: c.id,
        level: depth + 1,
        card: c,
        hasChildren: false,
      });
    }
  };

  const roots = childGroupsByParent.get(null) ?? [];
  for (const r of roots) walkGroup(r, 0);

  // Ungrouped cards section.
  const ungrouped = getUngroupedCards(data);
  if (ungrouped.length > 0) {
    const hasChildren = ungrouped.length > 0;
    result.push({
      kind: 'group',
      id: '__ungrouped__',
      level: 0,
      labelText: `(未グループ化) ${ungrouped.length} 枚`,
      hasChildren,
    });
    if (!collapsed.has('__ungrouped__')) {
      for (const c of ungrouped) {
        result.push({
          kind: 'card',
          id: c.id,
          level: 1,
          card: c,
          hasChildren: false,
        });
      }
    }
  }
  return result;
}

const STORAGE_KEY = 'kj.hierarchyCollapsed';

export function HierarchyPane({ onClose }: { onClose(): void }) {
  const project = useProjectStore((s) => s.project);
  const selectCard = useProjectStore((s) => s.selectCard);
  const selectGroup = useProjectStore((s) => s.selectGroup);
  const selectedCardId = useProjectStore((s) => s.selectedCardId);
  const selectedGroupId = useProjectStore((s) => s.selectedGroupId);
  const kbScroll = useKeyboardScroll();

  // Inverted state: the user explicitly collapses subtrees; everything else
  // stays visible. Default empty set = all groups expanded, all cards shown.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return new Set();
      return new Set(JSON.parse(raw) as string[]);
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(collapsed)));
    } catch {
      // ignore
    }
  }, [collapsed]);

  const visible = useMemo<TreeNode[]>(() => {
    if (!project) return [];
    return buildVisibleTree(project.data, collapsed);
  }, [project, collapsed]);

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const maxGroupLevel = useMemo(() => {
    if (!project) return 1;
    return project.data.groups.reduce((m, g) => Math.max(m, g.level), 1);
  }, [project]);

  /**
   * Collapse every group whose Group.level is BELOW N. Groups at level >= N
   * stay expanded, so the user sees the hierarchy down to level N, and
   * everything below (and member cards) is hidden.
   *
   * Special case: N = 1 collapses nothing (full expansion).
   */
  const showDownToLevel = (n: number) => {
    if (!project) return;
    const next = new Set<string>();
    for (const g of project.data.groups) {
      if (g.level < n) next.add(g.id);
    }
    // Ungrouped section is treated as level 0 — collapse it when N > 0.
    if (n > 0) next.add('__ungrouped__');
    setCollapsed(next);
  };

  const expandAll = () => setCollapsed(new Set());

  const collapseAll = () => {
    if (!project) return;
    const next = new Set<string>();
    for (const g of project.data.groups) next.add(g.id);
    next.add('__ungrouped__');
    setCollapsed(next);
  };

  if (!project) {
    return (
      <aside className="hierarchy-pane">
        <header className="hierarchy-pane-header">
          <span>階層表示</span>
        </header>
        <div className="empty-state">プロジェクトを開いてください</div>
      </aside>
    );
  }

  return (
    <aside className="hierarchy-pane">
      <header className="hierarchy-pane-header">
        <span>階層表示</span>
      </header>
      <div className="hierarchy-pane-toolbar">
        <button type="button" onClick={expandAll} title="全グループを展開しカードまで表示">
          全展開 (カードまで)
        </button>
        <button
          type="button"
          onClick={collapseAll}
          title="全グループを折りたたみ (トップだけ表示)"
        >
          全閉
        </button>
      </div>
      <div className="hierarchy-pane-toolbar" style={{ borderTop: '1px solid var(--border)' }}>
        <span className="muted small" title="レベルNだけ展開し, それより細かい階層とカードを隠します">
          Lv まで開く:
        </span>
        {Array.from({ length: maxGroupLevel }, (_, i) => i + 1).map((lvl) => (
          <button
            key={lvl}
            type="button"
            onClick={() => showDownToLevel(lvl)}
            title={
              lvl === 1
                ? 'Lv 1 グループまで表示 (= カードも表示)'
                : `Lv ${lvl} 以上のグループだけ表示 ・ Lv ${lvl - 1} 以下とカードは折りたたみ`
            }
            className="hierarchy-level-btn"
          >
            Lv{lvl}
          </button>
        ))}
      </div>
      <div className="muted small" style={{ padding: '2px 8px', borderBottom: '1px solid var(--border)' }}>
        各行の ▼/▶ で個別開閉．グループの「N 枚」は所属カード数
      </div>
      <div className="hierarchy-pane-body" {...kbScroll}>
        {visible.length === 0 ? (
          <div className="muted small" style={{ padding: 8 }}>
            (まだグループ・カードがありません)
          </div>
        ) : (
          <ul className="hierarchy-tree">
            {visible.map((n) => {
              const isCollapsed = collapsed.has(n.id);
              const sel =
                (n.kind === 'card' && n.id === selectedCardId) ||
                (n.kind === 'group' && n.id === selectedGroupId);
              return (
                <li
                  key={`${n.kind}-${n.id}`}
                  className={`hierarchy-row ${n.kind} ${sel ? 'active' : ''}`}
                  style={{ paddingLeft: 4 + n.level * 12 }}
                  onClick={() => {
                    if (n.kind === 'card') selectCard(n.id);
                    else if (n.group) selectGroup(n.id);
                  }}
                  onContextMenu={
                    n.kind === 'card'
                      ? (e) => {
                          e.preventDefault();
                          selectCard(n.id);
                          // (#6) 右クリックでそのカードのキャンバス位置へジャンプ.
                          // App がキャンバスタブへ切替え後 kj.centerOnCard を再発行.
                          window.dispatchEvent(
                            new CustomEvent('kj.jumpToCard', { detail: { cardId: n.id } })
                          );
                        }
                      : undefined
                  }
                  title={n.kind === 'card' ? '右クリックでキャンバス表示' : undefined}
                >
                  {n.kind === 'group' && n.hasChildren ? (
                    <button
                      type="button"
                      className="hierarchy-toggle"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle(n.id);
                      }}
                      title={isCollapsed ? '展開' : '折りたたむ'}
                    >
                      {isCollapsed ? '▶' : '▼'}
                    </button>
                  ) : (
                    <span className="hierarchy-toggle-placeholder" />
                  )}
                  {n.kind === 'group' ? (
                    <>
                      <span className="hierarchy-badge">
                        {n.group ? `L${n.group.level}` : '—'}
                      </span>
                      <span className="hierarchy-label">{n.labelText}</span>
                      {typeof n.memberCount === 'number' && (
                        <span className="muted small">{n.memberCount} 枚</span>
                      )}
                    </>
                  ) : (
                    <>
                      <span className="hierarchy-code">{n.card?.code}</span>
                      <span className="hierarchy-body muted small">
                        {n.card?.body.slice(0, 50) || '(本文なし)'}
                      </span>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
