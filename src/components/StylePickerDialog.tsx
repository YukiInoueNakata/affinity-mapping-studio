import { useEffect, useState } from 'react';
import type { DisplayStyle } from '@shared/types/domain';

/**
 * Office-inspired preset palette. Each row is a color family with tints.
 * Designed to harmonize on light / dark backgrounds.
 */
const PRESET_PALETTE: string[][] = [
  ['#ffffff', '#f2f2f2', '#d9d9d9', '#bfbfbf', '#a6a6a6', '#808080', '#595959', '#262626', '#000000'],
  ['#fff2cc', '#ffe699', '#ffd966', '#ffbf00', '#f59e0b', '#d97706', '#92400e', '#451a03'],
  ['#fce7f3', '#fbcfe8', '#f9a8d4', '#f472b6', '#ec4899', '#db2777', '#9d174d', '#500724'],
  ['#fee2e2', '#fecaca', '#fca5a5', '#f87171', '#ef4444', '#dc2626', '#991b1b', '#450a0a'],
  ['#fef3c7', '#fde68a', '#fcd34d', '#fbbf24', '#f59e0b', '#d97706', '#78350f', '#451a03'],
  ['#d1fae5', '#a7f3d0', '#6ee7b7', '#34d399', '#10b981', '#059669', '#064e3b', '#022c22'],
  ['#dbeafe', '#bfdbfe', '#93c5fd', '#60a5fa', '#3b82f6', '#1d4ed8', '#1e3a8a', '#0c1e54'],
  ['#e0e7ff', '#c7d2fe', '#a5b4fc', '#818cf8', '#6366f1', '#4338ca', '#312e81', '#1e1b4b'],
  ['#f3e8ff', '#e9d5ff', '#d8b4fe', '#c084fc', '#a855f7', '#7c3aed', '#581c87', '#2e1065'],
];

interface Props {
  open: boolean;
  initial: DisplayStyle | undefined;
  /** Display the panel title (e.g. "カードのスタイル"). */
  title: string;
  onApply(next: DisplayStyle): void;
  onClear(): void;
  onClose(): void;
}

export function StylePickerDialog({
  open,
  initial,
  title,
  onApply,
  onClear,
  onClose,
}: Props) {
  const [draft, setDraft] = useState<DisplayStyle>(initial ?? {});

  useEffect(() => {
    if (open) setDraft(initial ?? {});
  }, [open, initial]);

  if (!open) return null;

  const setField = <K extends keyof DisplayStyle>(k: K, v: DisplayStyle[K]) => {
    setDraft((prev) => ({ ...prev, [k]: v }));
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 540 }}
      >
        <header className="modal-header">
          <h2>{title}</h2>
        </header>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <ColorPickerRow
            label="背景色"
            value={draft.background}
            onChange={(v) => setField('background', v)}
          />
          <ColorPickerRow
            label="文字色"
            value={draft.color}
            onChange={(v) => setField('color', v)}
          />

          <fieldset
            style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 8, alignItems: 'center', padding: 8, border: '1px solid var(--border)', borderRadius: 3 }}
          >
            <legend className="muted small">枠線</legend>
            <span className="muted small">色</span>
            <PresetSwatches
              value={draft.borderColor ?? ''}
              onChange={(v) => setField('borderColor', v)}
              showCustom
            />
            <span className="muted small">太さ</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {[1, 2, 3, 4].map((w) => (
                <button
                  key={w}
                  type="button"
                  className={draft.borderWidth === w ? 'tab active' : 'tab'}
                  onClick={() => setField('borderWidth', w)}
                >
                  {w}px
                </button>
              ))}
              <button
                type="button"
                className="segment-action-btn"
                onClick={() => setField('borderWidth', undefined)}
              >
                クリア
              </button>
            </div>
            <span className="muted small">スタイル</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['solid', 'dashed', 'dotted'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  className={draft.borderStyle === s ? 'tab active' : 'tab'}
                  onClick={() => setField('borderStyle', s)}
                >
                  {s === 'solid' ? '実線' : s === 'dashed' ? '破線' : '点線'}
                </button>
              ))}
              <button
                type="button"
                className="segment-action-btn"
                onClick={() => setField('borderStyle', undefined)}
              >
                クリア
              </button>
            </div>
          </fieldset>

          <fieldset
            style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 8, alignItems: 'center', padding: 8, border: '1px solid var(--border)', borderRadius: 3 }}
          >
            <legend className="muted small">文字</legend>
            <span className="muted small">サイズ</span>
            <input
              type="number"
              min={8}
              max={48}
              step={1}
              value={draft.fontSize ?? ''}
              placeholder="(既定)"
              onChange={(e) => {
                const v = e.target.value;
                setField('fontSize', v === '' ? undefined : Number(v));
              }}
              style={{ width: 80 }}
            />
            <span className="muted small">太字</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                type="button"
                className={draft.fontWeight === 'bold' ? 'tab active' : 'tab'}
                onClick={() =>
                  setField(
                    'fontWeight',
                    draft.fontWeight === 'bold' ? undefined : 'bold'
                  )
                }
              >
                太字
              </button>
            </div>
          </fieldset>

          <div className="muted small">
            プレビュー:{' '}
            <span
              style={{
                display: 'inline-block',
                padding: '6px 10px',
                background: draft.background ?? '#f6f4ea',
                color: draft.color ?? '#222',
                border:
                  draft.borderWidth !== undefined
                    ? `${draft.borderWidth}px ${draft.borderStyle ?? 'solid'} ${draft.borderColor ?? '#666'}`
                    : '1px solid #bbb',
                fontSize: draft.fontSize ?? 12,
                fontWeight: draft.fontWeight ?? 'normal',
                borderRadius: 4,
              }}
            >
              プレビュー
            </span>
          </div>
        </div>
        <footer className="modal-footer">
          <button type="button" onClick={onClear}>
            すべてクリア
          </button>
          <button type="button" onClick={onClose}>
            キャンセル
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => onApply(draft)}
          >
            適用
          </button>
        </footer>
      </div>
    </div>
  );
}

function ColorPickerRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | undefined;
  onChange(v: string | undefined): void;
}) {
  return (
    <fieldset
      style={{
        display: 'grid',
        gridTemplateColumns: '80px 1fr',
        gap: 8,
        alignItems: 'center',
        padding: 8,
        border: '1px solid var(--border)',
        borderRadius: 3,
      }}
    >
      <legend className="muted small">{label}</legend>
      <span className="muted small">パレット</span>
      <PresetSwatches value={value ?? ''} onChange={onChange} showCustom />
    </fieldset>
  );
}

export function PresetSwatches({
  value,
  onChange,
  showCustom,
}: {
  value: string;
  onChange(v: string | undefined): void;
  showCustom: boolean;
}) {
  const [custom, setCustom] = useState<string>(
    value && !PRESET_PALETTE.flat().includes(value) ? value : '#ffffff'
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {PRESET_PALETTE.map((row, i) => (
        <div key={i} style={{ display: 'flex', gap: 2 }}>
          {row.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onChange(c)}
              title={c}
              style={{
                width: 20,
                height: 20,
                background: c,
                border:
                  value === c
                    ? '2px solid var(--accent)'
                    : '1px solid var(--border)',
                borderRadius: 2,
                cursor: 'pointer',
                padding: 0,
              }}
            />
          ))}
        </div>
      ))}
      {showCustom && (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 2 }}>
          <span className="muted small">RGB</span>
          <input
            type="color"
            value={custom}
            onChange={(e) => {
              setCustom(e.target.value);
              onChange(e.target.value);
            }}
            style={{ width: 36, height: 24, padding: 0, border: '1px solid var(--border)' }}
          />
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value || undefined)}
            placeholder="#rrggbb"
            style={{ flex: 1, fontSize: 11 }}
          />
          <button
            type="button"
            className="segment-action-btn"
            onClick={() => onChange(undefined)}
            title="この色設定をクリア"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
