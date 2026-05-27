import { useEffect, useState } from 'react';
import { useProjectStore } from '../stores/projectStore.js';
import {
  makeBulkApplyCardStyleCommand,
  makeBulkApplyGroupStyleCommand,
} from '../stores/commands.js';
import type { DisplayStyle } from '@shared/types/domain';

interface Props {
  open: boolean;
  onClose(): void;
}

const FONT_SIZE_OPTIONS = [10, 11, 12, 13, 14, 16, 18, 20, 22];
const COLOR_PRESETS = [
  { name: '標準', value: '' },
  { name: '赤', value: '#e06c75' },
  { name: '橙', value: '#e0b34c' },
  { name: '緑', value: '#6fc88a' },
  { name: '青', value: '#4ea1ff' },
  { name: '紫', value: '#c678dd' },
  { name: '灰', value: '#888' },
];

export function BulkStyleDialog({ open, onClose }: Props) {
  const project = useProjectStore((s) => s.project);
  const applyCommand = useProjectStore((s) => s.applyCommand);
  const selectedCardIds = useProjectStore((s) => s.selectedCardIds);
  const selectedGroupIds = useProjectStore((s) => s.selectedGroupIds);

  const [target, setTarget] = useState<'selected_cards' | 'selected_groups' | 'all_cards' | 'all_groups'>(
    'selected_cards'
  );
  const [fontSize, setFontSize] = useState<number | ''>('');
  const [fontWeight, setFontWeight] = useState<'normal' | 'bold' | ''>('');
  const [color, setColor] = useState<string>('');

  useEffect(() => {
    if (!open) return;
    setFontSize('');
    setFontWeight('');
    setColor('');
    if (selectedCardIds.length > 0) setTarget('selected_cards');
    else if (selectedGroupIds.length > 0) setTarget('selected_groups');
  }, [open, selectedCardIds.length, selectedGroupIds.length]);

  if (!open || !project) return null;

  const targetIds = (() => {
    if (target === 'selected_cards') return selectedCardIds;
    if (target === 'selected_groups') return selectedGroupIds;
    if (target === 'all_cards') return project.data.cards.map((c) => c.id);
    return project.data.groups.map((g) => g.id);
  })();

  const isCardTarget = target.endsWith('_cards');

  const buildNextStyle = (): DisplayStyle | undefined => {
    const s: DisplayStyle = {};
    if (fontSize !== '') s.fontSize = Number(fontSize);
    if (fontWeight !== '') s.fontWeight = fontWeight;
    if (color !== '') s.color = color;
    if (Object.keys(s).length === 0) return undefined;
    return s;
  };

  const handleApply = () => {
    const next = buildNextStyle();
    if (targetIds.length === 0) {
      alert('対象が空です');
      return;
    }
    const now = new Date().toISOString();
    if (isCardTarget) {
      const prevMap = new Map<string, DisplayStyle | undefined>();
      for (const id of targetIds) {
        const c = project.data.cards.find((x) => x.id === id);
        if (c) prevMap.set(id, c.displayStyle);
      }
      applyCommand(makeBulkApplyCardStyleCommand(targetIds, prevMap, next, now));
    } else {
      const prevMap = new Map<string, DisplayStyle | undefined>();
      for (const id of targetIds) {
        const g = project.data.groups.find((x) => x.id === id);
        if (g) prevMap.set(id, g.displayStyle);
      }
      applyCommand(makeBulkApplyGroupStyleCommand(targetIds, prevMap, next, now));
    }
    onClose();
  };

  const handleClear = () => {
    if (targetIds.length === 0) return;
    if (!confirm(`${targetIds.length} 件のスタイルをリセットしますか？`)) return;
    const now = new Date().toISOString();
    if (isCardTarget) {
      const prevMap = new Map<string, DisplayStyle | undefined>();
      for (const id of targetIds) {
        const c = project.data.cards.find((x) => x.id === id);
        if (c) prevMap.set(id, c.displayStyle);
      }
      applyCommand(makeBulkApplyCardStyleCommand(targetIds, prevMap, undefined, now));
    } else {
      const prevMap = new Map<string, DisplayStyle | undefined>();
      for (const id of targetIds) {
        const g = project.data.groups.find((x) => x.id === id);
        if (g) prevMap.set(id, g.displayStyle);
      }
      applyCommand(makeBulkApplyGroupStyleCommand(targetIds, prevMap, undefined, now));
    }
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2>文字スタイル一括適用</h2>
        </header>
        <div className="modal-body">
          <div className="form-row">
            <label>対象</label>
            <select value={target} onChange={(e) => setTarget(e.target.value as typeof target)}>
              <option value="selected_cards">
                選択中のカード ({selectedCardIds.length} 件)
              </option>
              <option value="selected_groups">
                選択中のグループ ({selectedGroupIds.length} 件)
              </option>
              <option value="all_cards">
                全カード ({project.data.cards.length} 件)
              </option>
              <option value="all_groups">
                全グループ ({project.data.groups.length} 件)
              </option>
            </select>
          </div>
          <div className="form-row">
            <label>フォントサイズ</label>
            <select
              value={fontSize}
              onChange={(e) =>
                setFontSize(e.target.value === '' ? '' : Number(e.target.value))
              }
            >
              <option value="">（変更しない）</option>
              {FONT_SIZE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}px
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label>太字</label>
            <select
              value={fontWeight}
              onChange={(e) => setFontWeight(e.target.value as 'normal' | 'bold' | '')}
            >
              <option value="">（変更しない）</option>
              <option value="normal">標準</option>
              <option value="bold">太字</option>
            </select>
          </div>
          <div className="form-row">
            <label>文字色</label>
            <div className="radio-row" style={{ flexWrap: 'wrap' }}>
              {COLOR_PRESETS.map((p) => (
                <label key={p.value} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                  <input
                    type="radio"
                    name="color"
                    checked={color === p.value}
                    onChange={() => setColor(p.value)}
                  />
                  <span
                    style={{
                      width: 12,
                      height: 12,
                      background: p.value || 'transparent',
                      border: '1px solid var(--border)',
                      borderRadius: 2,
                      display: 'inline-block',
                    }}
                  />
                  {p.name}
                </label>
              ))}
            </div>
          </div>
          <p className="muted small">
            未設定の項目は変更されません．「リセット」で対象の全スタイルを削除．
          </p>
        </div>
        <footer className="modal-footer">
          <button type="button" onClick={onClose}>キャンセル</button>
          <button type="button" onClick={handleClear}>リセット</button>
          <button type="button" className="primary" onClick={handleApply}>
            適用 ({targetIds.length} 件)
          </button>
        </footer>
      </div>
    </div>
  );
}
