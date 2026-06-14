import { useEffect, useState } from 'react';
import { useProjectStore } from '../stores/projectStore.js';
import { PresetSwatches } from './StylePickerDialog.js';
import type { DisplaySettings } from '@shared/types/domain';

interface Props {
  open: boolean;
  onClose(): void;
}

const DEFAULTS = {
  cardMaxChars: 90,
  cardWrapWidth: 220,
  cardFontSize: 12,
  groupFontSize: 12,
  canvasBackground: '#ffffff',
  autoPackOnGroup: true,
  autoPackOrientation: 'cols' as 'cols' | 'rows',
  autoPackCount: 0, // 0 = 自動 (√n)
};

export function DisplaySettingsDialog({ open, onClose }: Props) {
  const project = useProjectStore((s) => s.project);
  const setDisplaySettings = useProjectStore((s) => s.setDisplaySettings);
  const current = project?.metadata.displaySettings;
  const [cardMaxChars, setCardMaxChars] = useState<number>(
    current?.cardMaxChars ?? DEFAULTS.cardMaxChars
  );
  const [cardWrapWidth, setCardWrapWidth] = useState<number>(
    current?.cardWrapWidth ?? DEFAULTS.cardWrapWidth
  );
  const [cardFontSize, setCardFontSize] = useState<number>(
    current?.cardFontSize ?? DEFAULTS.cardFontSize
  );
  const [groupFontSize, setGroupFontSize] = useState<number>(
    current?.groupFontSize ?? DEFAULTS.groupFontSize
  );
  const [canvasBackground, setCanvasBackground] = useState<string>(
    current?.canvasBackground ?? DEFAULTS.canvasBackground
  );
  const [autoPackOnGroup, setAutoPackOnGroup] = useState<boolean>(
    current?.autoPackOnGroup ?? DEFAULTS.autoPackOnGroup
  );
  const [autoPackOrientation, setAutoPackOrientation] = useState<'cols' | 'rows'>(
    current?.autoPackOrientation ?? DEFAULTS.autoPackOrientation
  );
  const [autoPackCount, setAutoPackCount] = useState<number>(
    current?.autoPackCount ?? DEFAULTS.autoPackCount
  );

  useEffect(() => {
    if (!open) return;
    setCardMaxChars(current?.cardMaxChars ?? DEFAULTS.cardMaxChars);
    setCardWrapWidth(current?.cardWrapWidth ?? DEFAULTS.cardWrapWidth);
    setCardFontSize(current?.cardFontSize ?? DEFAULTS.cardFontSize);
    setGroupFontSize(current?.groupFontSize ?? DEFAULTS.groupFontSize);
    setCanvasBackground(current?.canvasBackground ?? DEFAULTS.canvasBackground);
    setAutoPackOnGroup(current?.autoPackOnGroup ?? DEFAULTS.autoPackOnGroup);
    setAutoPackOrientation(current?.autoPackOrientation ?? DEFAULTS.autoPackOrientation);
    setAutoPackCount(current?.autoPackCount ?? DEFAULTS.autoPackCount);
  }, [open, current]);

  if (!open) return null;

  const handleSave = () => {
    const next: DisplaySettings = {
      cardMaxChars,
      cardWrapWidth,
      cardFontSize,
      groupFontSize,
      canvasBackground,
      autoPackOnGroup,
      autoPackOrientation,
      autoPackCount: autoPackCount > 0 ? autoPackCount : undefined,
    };
    setDisplaySettings(next);
    onClose();
  };

  const handleReset = () => {
    setDisplaySettings(undefined);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2>表示設定（プロジェクト全体）</h2>
        </header>
        <div className="modal-body">
          <p className="muted small">
            すべてのカード/グループに既定として適用されます．個別のスタイル設定があれば、そちらが優先します．
          </p>
          <div className="form-row">
            <label>カード文字数上限</label>
            <input
              type="number"
              min={20}
              max={500}
              value={cardMaxChars}
              onChange={(e) => setCardMaxChars(Number(e.target.value))}
            />
          </div>
          <div className="form-row">
            <label>カード幅 (px)</label>
            <input
              type="number"
              min={140}
              max={500}
              step={10}
              value={cardWrapWidth}
              onChange={(e) => setCardWrapWidth(Number(e.target.value))}
            />
          </div>
          <div className="form-row">
            <label>カードフォントサイズ</label>
            <input
              type="number"
              min={8}
              max={24}
              value={cardFontSize}
              onChange={(e) => setCardFontSize(Number(e.target.value))}
            />
          </div>
          <div className="form-row">
            <label>グループ表札フォント</label>
            <input
              type="number"
              min={8}
              max={24}
              value={groupFontSize}
              onChange={(e) => setGroupFontSize(Number(e.target.value))}
            />
          </div>
          <fieldset
            style={{
              display: 'grid',
              gridTemplateColumns: '120px 1fr',
              gap: 8,
              alignItems: 'start',
              padding: 8,
              border: '1px solid var(--border)',
              borderRadius: 3,
              marginTop: 4,
            }}
          >
            <legend className="muted small">キャンバス背景色</legend>
            <span className="muted small">色（標準: 白）</span>
            <PresetSwatches
              value={canvasBackground}
              onChange={(v) => setCanvasBackground(v ?? DEFAULTS.canvasBackground)}
              showCustom
            />
          </fieldset>
          <fieldset
            style={{
              display: 'grid',
              gridTemplateColumns: '120px 1fr',
              gap: 8,
              alignItems: 'center',
              padding: 8,
              border: '1px solid var(--border)',
              borderRadius: 3,
              marginTop: 4,
            }}
          >
            <legend className="muted small">グループ化時の自動整列</legend>
            <label htmlFor="autoPackOnGroup">自動整列</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                id="autoPackOnGroup"
                type="checkbox"
                checked={autoPackOnGroup}
                onChange={(e) => setAutoPackOnGroup(e.target.checked)}
              />
              <span className="muted small">
                グループ化したときにカードをグリッド整列する（標準: ON）
              </span>
            </label>
            <label htmlFor="autoPackOrientation">並べ方向</label>
            <select
              id="autoPackOrientation"
              value={autoPackOrientation}
              disabled={!autoPackOnGroup}
              onChange={(e) =>
                setAutoPackOrientation(e.target.value === 'rows' ? 'rows' : 'cols')
              }
            >
              <option value="cols">列方向（列数を基準）</option>
              <option value="rows">行方向（行数を基準）</option>
            </select>
            <label htmlFor="autoPackCount">
              {autoPackOrientation === 'rows' ? '行数' : '列数'}
            </label>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                id="autoPackCount"
                type="number"
                min={0}
                max={20}
                value={autoPackCount}
                disabled={!autoPackOnGroup}
                onChange={(e) => setAutoPackCount(Number(e.target.value))}
              />
              <span className="muted small">0 = 自動（√n でほぼ正方形）</span>
            </span>
          </fieldset>
        </div>
        <footer className="modal-footer">
          <button type="button" onClick={onClose}>キャンセル</button>
          <button type="button" onClick={handleReset}>既定値に戻す</button>
          <button type="button" className="primary" onClick={handleSave}>
            適用
          </button>
        </footer>
      </div>
    </div>
  );
}
