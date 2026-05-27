import { useEffect, useRef, useState } from 'react';
import { toPng, toSvg } from 'html-to-image';
import { jsPDF } from 'jspdf';
import { useProjectStore } from '../stores/projectStore.js';

type Format = 'png' | 'pdf' | 'svg';

interface Props {
  open: boolean;
  onClose(): void;
}

interface PreviewState {
  dataUrl: string;
  format: Format;
  /** natural (pre-scale) width / height of the captured viewport */
  width: number;
  height: number;
}

/**
 * Locate the React Flow viewport DOM element. We capture the inner
 * `.react-flow__viewport` (which holds the nodes/edges layer) rather than
 * the whole canvas chrome (controls / minimap) for a clean export.
 */
function findViewportEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.react-flow__viewport');
}

export function ExportDialog({ open, onClose }: Props) {
  const project = useProjectStore((s) => s.project);

  const [format, setFormat] = useState<Format>('png');
  const [scale, setScale] = useState<number>(1);
  /** Optional font-size override; null = use whatever the canvas renders. */
  const [fontSizeOverride, setFontSizeOverride] = useState<number | null>(null);
  const [pageSize, setPageSize] = useState<'A4' | 'A3' | 'Letter'>('A4');
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>(
    'landscape'
  );
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const fontTagRef = useRef<HTMLStyleElement | null>(null);

  // Inject a temporary <style> that overrides font-size for the export. Reset
  // when the dialog closes or fontSizeOverride is null.
  useEffect(() => {
    if (!open) return;
    if (fontSizeOverride === null) {
      if (fontTagRef.current) {
        fontTagRef.current.remove();
        fontTagRef.current = null;
      }
      return;
    }
    const tag = document.createElement('style');
    tag.textContent = `
      .react-flow__viewport .card-node-body,
      .react-flow__viewport .kj-group-node-title {
        font-size: ${fontSizeOverride}px !important;
      }
    `;
    document.head.appendChild(tag);
    fontTagRef.current = tag;
    return () => {
      if (fontTagRef.current) {
        fontTagRef.current.remove();
        fontTagRef.current = null;
      }
    };
  }, [open, fontSizeOverride]);

  if (!open) return null;

  const generatePreview = async () => {
    const el = findViewportEl();
    if (!el) {
      alert('キャンバスが見つかりません．キャンバスを表示してから再試行してください．');
      return;
    }
    setBusy(true);
    try {
      // Use html-to-image to render the viewport. The default options work
      // for our DOM nodes.
      const fn = format === 'svg' ? toSvg : toPng;
      const dataUrl = await fn(el, {
        backgroundColor: '#ffffff',
        pixelRatio: 2,
        skipFonts: false,
      });
      const rect = el.getBoundingClientRect();
      setPreview({
        dataUrl,
        format,
        width: rect.width,
        height: rect.height,
      });
    } catch (e) {
      alert(`プレビュー生成に失敗しました: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const downloadDataUrl = (dataUrl: string, filename: string) => {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handleExport = async () => {
    if (!preview) {
      await generatePreview();
      return;
    }
    const baseName = (project?.metadata.name ?? 'kj-export').replace(
      /[\\/:*?"<>|]/g,
      '_'
    );
    const ts = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

    if (format === 'png') {
      downloadDataUrl(preview.dataUrl, `${baseName}_${ts}.png`);
      return;
    }
    if (format === 'svg') {
      downloadDataUrl(preview.dataUrl, `${baseName}_${ts}.svg`);
      return;
    }
    // PDF: embed the PNG into a jsPDF page sized A4/A3/Letter
    const sizes: Record<'A4' | 'A3' | 'Letter', { w: number; h: number }> = {
      A4: { w: 297, h: 210 }, // mm, landscape default
      A3: { w: 420, h: 297 },
      Letter: { w: 279.4, h: 215.9 },
    };
    let pageW: number;
    let pageH: number;
    if (orientation === 'landscape') {
      pageW = sizes[pageSize].w;
      pageH = sizes[pageSize].h;
    } else {
      pageW = sizes[pageSize].h;
      pageH = sizes[pageSize].w;
    }
    const pdf = new jsPDF({
      orientation,
      unit: 'mm',
      format: pageSize === 'Letter' ? 'letter' : pageSize.toLowerCase(),
    });
    // Fit image into page with padding
    const margin = 10;
    const availW = pageW - margin * 2;
    const availH = pageH - margin * 2;
    const aspect = preview.width / preview.height;
    let w = availW;
    let h = availW / aspect;
    if (h > availH) {
      h = availH;
      w = availH * aspect;
    }
    const x = (pageW - w) / 2;
    const y = (pageH - h) / 2;
    pdf.addImage(preview.dataUrl, 'PNG', x, y, w, h);
    pdf.save(`${baseName}_${ts}.pdf`);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 760, maxHeight: '90vh' }}
      >
        <header className="modal-header">
          <h2>キャンバスをエクスポート</h2>
        </header>
        <div className="modal-body" style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: '0 0 220px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <fieldset
              style={{
                padding: 8,
                border: '1px solid var(--border)',
                borderRadius: 3,
              }}
            >
              <legend className="muted small">形式</legend>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {(['png', 'pdf', 'svg'] as const).map((f) => (
                  <label key={f} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <input
                      type="radio"
                      name="format"
                      value={f}
                      checked={format === f}
                      onChange={() => {
                        setFormat(f);
                        setPreview(null);
                      }}
                    />
                    {f.toUpperCase()}
                  </label>
                ))}
              </div>
            </fieldset>
            {format === 'pdf' && (
              <fieldset
                style={{
                  padding: 8,
                  border: '1px solid var(--border)',
                  borderRadius: 3,
                }}
              >
                <legend className="muted small">PDF</legend>
                <label className="muted small">ページサイズ</label>
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(e.target.value as typeof pageSize)}
                >
                  <option value="A4">A4</option>
                  <option value="A3">A3</option>
                  <option value="Letter">Letter</option>
                </select>
                <label className="muted small" style={{ marginTop: 6 }}>
                  向き
                </label>
                <select
                  value={orientation}
                  onChange={(e) =>
                    setOrientation(e.target.value as typeof orientation)
                  }
                >
                  <option value="landscape">横</option>
                  <option value="portrait">縦</option>
                </select>
              </fieldset>
            )}
            <fieldset
              style={{
                padding: 8,
                border: '1px solid var(--border)',
                borderRadius: 3,
              }}
            >
              <legend className="muted small">スケール</legend>
              <input
                type="range"
                min={0.25}
                max={3}
                step={0.05}
                value={scale}
                onChange={(e) => setScale(Number(e.target.value))}
                style={{ width: '100%' }}
              />
              <div className="muted small">{(scale * 100).toFixed(0)}%</div>
            </fieldset>
            <fieldset
              style={{
                padding: 8,
                border: '1px solid var(--border)',
                borderRadius: 3,
              }}
            >
              <legend className="muted small">文字サイズ補正</legend>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input
                  type="number"
                  min={8}
                  max={48}
                  step={1}
                  value={fontSizeOverride ?? ''}
                  placeholder="既定"
                  onChange={(e) => {
                    const v = e.target.value;
                    setFontSizeOverride(v === '' ? null : Number(v));
                    setPreview(null);
                  }}
                  style={{ width: 60 }}
                />
                <span className="muted small">px</span>
                <button
                  type="button"
                  className="segment-action-btn"
                  onClick={() => {
                    setFontSizeOverride(null);
                    setPreview(null);
                  }}
                >
                  既定
                </button>
              </div>
            </fieldset>
            <button type="button" onClick={generatePreview} disabled={busy}>
              {busy ? 'プレビュー生成中...' : 'プレビュー生成'}
            </button>
          </div>
          <div
            style={{
              flex: 1,
              border: '1px solid var(--border)',
              borderRadius: 3,
              overflow: 'auto',
              minHeight: 320,
              background: '#fff',
            }}
          >
            {preview ? (
              <img
                src={preview.dataUrl}
                style={{
                  width: preview.width * scale,
                  height: preview.height * scale,
                  display: 'block',
                  maxWidth: 'none',
                }}
                alt="export preview"
              />
            ) : (
              <div
                className="muted"
                style={{
                  padding: 16,
                  textAlign: 'center',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                }}
              >
                左の「プレビュー生成」ボタンを押してください
              </div>
            )}
          </div>
        </div>
        <footer className="modal-footer">
          <button type="button" onClick={onClose}>
            キャンセル
          </button>
          <button
            type="button"
            className="primary"
            onClick={handleExport}
            disabled={busy}
          >
            {preview ? `${format.toUpperCase()} で保存` : 'プレビュー生成'}
          </button>
        </footer>
      </div>
    </div>
  );
}
