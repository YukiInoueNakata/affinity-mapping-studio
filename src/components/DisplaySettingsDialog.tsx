import { useEffect, useState } from 'react';
import { useProjectStore } from '../stores/projectStore.js';
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

  useEffect(() => {
    if (!open) return;
    setCardMaxChars(current?.cardMaxChars ?? DEFAULTS.cardMaxChars);
    setCardWrapWidth(current?.cardWrapWidth ?? DEFAULTS.cardWrapWidth);
    setCardFontSize(current?.cardFontSize ?? DEFAULTS.cardFontSize);
    setGroupFontSize(current?.groupFontSize ?? DEFAULTS.groupFontSize);
  }, [open, current]);

  if (!open) return null;

  const handleSave = () => {
    const next: DisplaySettings = {
      cardMaxChars,
      cardWrapWidth,
      cardFontSize,
      groupFontSize,
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
