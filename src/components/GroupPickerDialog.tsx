import { useMemo, useState } from 'react';
import { useProjectStore } from '../stores/projectStore.js';
import { getGroupLabel, levelPrefix } from '../domain/groups.js';

interface Props {
  open: boolean;
  title: string;
  /** If set, only groups with this exact level are selectable. */
  filterLevel?: number;
  /** If set, these group ids are excluded from the list. */
  excludeIds?: string[];
  onSelect(groupId: string): void;
  onCancel(): void;
}

export function GroupPickerDialog({
  open,
  title,
  filterLevel,
  excludeIds,
  onSelect,
  onCancel,
}: Props) {
  const project = useProjectStore((s) => s.project);
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    if (!project) return [];
    const exclude = new Set(excludeIds ?? []);
    return project.data.groups
      .filter((g) => !exclude.has(g.id))
      .filter((g) => filterLevel === undefined || g.level === filterLevel)
      .map((g) => {
        const label = getGroupLabel(project.data, g.id);
        return { group: g, displayName: label?.text || g.name };
      })
      .filter(({ displayName }) => {
        if (!query.trim()) return true;
        return displayName.toLowerCase().includes(query.toLowerCase());
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [project, filterLevel, excludeIds, query]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 480 }}>
        <header className="modal-header">
          <h2>{title}</h2>
        </header>
        <div className="modal-body">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="グループ名で絞り込み..."
            autoFocus
            style={{ width: '100%' }}
          />
          {filterLevel !== undefined && (
            <p className="muted small">
              {levelPrefix(filterLevel)} のグループだけ表示しています
            </p>
          )}
          {groups.length === 0 ? (
            <div className="muted" style={{ padding: 12 }}>
              {filterLevel !== undefined
                ? `${levelPrefix(filterLevel)} のグループがありません`
                : '該当するグループがありません'}
            </div>
          ) : (
            <ul className="card-list" style={{ maxHeight: 360, overflowY: 'auto' }}>
              {groups.map(({ group, displayName }) => (
                <li
                  key={group.id}
                  onClick={() => onSelect(group.id)}
                  style={{ cursor: 'pointer' }}
                >
                  <span className="card-list-code">{`L${group.level}`}</span>
                  <span className="card-list-body">{displayName}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <footer className="modal-footer">
          <button type="button" onClick={onCancel}>
            キャンセル
          </button>
        </footer>
      </div>
    </div>
  );
}
