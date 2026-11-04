// 段の範囲の表を CSV / Excel (.xlsx) で書き出すダイアログ．
// 例: 第 4 段から第 2 段まで → 1 行 = 第 2 段のグループ 1 つ，列 = 第 4〜2 段のコードと表札．
// 下の段に「カード」を選ぶと 1 行 = カード 1 枚．計算は domain/levels.ts の buildLevelTable．

import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import * as XLSX from 'xlsx';
import { useProjectStore } from '../stores/projectStore.js';
import { buildLevelTable, maxGroupLevel, tableToCsv } from '../domain/levels.js';

type Format = 'xlsx' | 'csv';

export function LevelTableExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const project = useProjectStore((s) => s.project);
  const maxLevel = project ? Math.max(1, maxGroupLevel(project.data)) : 1;
  const [fromLevel, setFromLevel] = useState<number>(maxLevel);
  const [toLevel, setToLevel] = useState<number>(1);
  const [includeLabels, setIncludeLabels] = useState(true);
  const [format, setFormat] = useState<Format>('xlsx');
  const [saving, setSaving] = useState(false);

  // 開くたびに「最上段から第 1 段まで」に合わせ直す (部品はプロジェクトを開く前から
  // 置かれているので，useState の初期値だけだと最上段が 1 のままになる)．
  useEffect(() => {
    if (open) {
      setFromLevel(maxLevel);
      setToLevel(1);
    }
  }, [open, maxLevel]);

  const hi = Math.min(Math.max(fromLevel, toLevel), maxLevel);
  const lo = Math.min(fromLevel, toLevel);
  const rows = useMemo(
    () => (project ? buildLevelTable(project.data, { fromLevel: hi, toLevel: lo, includeLabels }) : []),
    [project, hi, lo, includeLabels]
  );

  if (!open || !project) return null;

  const levelOptions = Array.from({ length: maxLevel }, (_, i) => maxLevel - i);

  const onSave = async () => {
    setSaving(true);
    try {
      const safe = (project.metadata.name || 'project').replace(/[\\/:*?"<>|]/g, '_');
      const range = lo === 0 ? `L${hi}-cards` : `L${hi}-L${lo}`;
      const ts = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      const fileName = `${safe}_${range}_${ts}.${format}`;
      let bytes: Uint8Array;
      if (format === 'xlsx') {
        const ws = XLSX.utils.aoa_to_sheet(rows);
        // 列の幅: 表札・本文は広めに．
        ws['!cols'] = rows[0].map((h) => ({ wch: /表札|本文/.test(h) ? 40 : 12 }));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, lo === 0 ? `第${hi}段-カード` : `第${hi}-${lo}段`);
        const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
        bytes = new Uint8Array(out);
      } else {
        bytes = new TextEncoder().encode(tableToCsv(rows));
      }
      const path = await invoke<string | null>('pick_save_file', {
        title: '段の表の保存先',
        defaultFileName: fileName,
        filters:
          format === 'xlsx'
            ? [{ name: 'Excel ブック', extensions: ['xlsx'] }]
            : [{ name: 'CSV', extensions: ['csv'] }],
      });
      if (!path) return;
      await invoke('write_bytes', { path, contents: Array.from(bytes) });
      alert(`保存しました:\n${path}`);
    } catch (e) {
      alert(`段の表の保存に失敗しました: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const preview = rows.slice(0, 11);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 820 }}>
        <header className="modal-header">
          <h2>段の表を出力（Excel / CSV）</h2>
        </header>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <label>
              上の段{' '}
              <select value={fromLevel} onChange={(e) => setFromLevel(Number(e.target.value))}>
                {levelOptions.map((lv) => (
                  <option key={lv} value={lv}>
                    第{lv}段
                  </option>
                ))}
              </select>
            </label>
            <span>から</span>
            <label>
              下の段{' '}
              <select value={toLevel} onChange={(e) => setToLevel(Number(e.target.value))}>
                {levelOptions.map((lv) => (
                  <option key={lv} value={lv}>
                    第{lv}段
                  </option>
                ))}
                <option value={0}>カード（1 行 = 1 枚）</option>
              </select>
            </label>
            <span>まで</span>
            <label>
              <input
                type="checkbox"
                checked={includeLabels}
                onChange={(e) => setIncludeLabels(e.target.checked)}
              />{' '}
              表札も出す
            </label>
            <label>
              <input type="radio" name="lvfmt" checked={format === 'xlsx'} onChange={() => setFormat('xlsx')} /> Excel
              (.xlsx)
            </label>
            <label>
              <input type="radio" name="lvfmt" checked={format === 'csv'} onChange={() => setFormat('csv')} /> CSV
            </label>
          </div>
          <div className="muted small">
            1 行が{lo === 0 ? ' 1 枚のカード' : `第${lo}段のグループ 1 つ`}です．全 {rows.length - 1} 行．
            上の段のグループに入っていないものは空欄になります．はじめの 10 行を下に示します．
          </div>
          <div style={{ overflow: 'auto', maxHeight: 320, border: '1px solid var(--border, #ddd)' }}>
            <table className="level-table-preview">
              <thead>
                <tr>
                  {preview[0]?.map((h, i) => (
                    <th key={i}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.slice(1).map((r, i) => (
                  <tr key={i}>
                    {r.map((c, j) => (
                      <td key={j}>{c}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <footer className="modal-footer">
          <button type="button" onClick={onClose}>
            閉じる
          </button>
          <button type="button" className="primary" onClick={onSave} disabled={saving || rows.length <= 1}>
            {saving ? '保存中…' : '保存'}
          </button>
        </footer>
      </div>
    </div>
  );
}
