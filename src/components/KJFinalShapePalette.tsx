// 最終図解の図形パレット (左サイドバー)．
// KJ 法 1986/1997 版で使われる関係記号 (14 種) + 装飾形状 (円/矩形/雲/括弧/矢印/テキスト) を
// クリックして "配置待ち" にし，キャンバスをクリックでその位置に置く．
// 配置待ち状態は親 (KJFinalView) が管理．パレットは選択状態を表示するだけ．

import { Fragment } from 'react';
import type { FinalDiagramShapeKind } from '@shared/types/domain';
import {
  RELATION_TYPE_GLYPHS,
  RELATION_TYPE_LABELS,
  RELATION_TYPE_ORDER,
} from '../domain/relations.js';

export interface KJFinalShapePaletteProps {
  pendingKind: FinalDiagramShapeKind | null;
  onPick(kind: FinalDiagramShapeKind | null): void;
}

const PRIMITIVE_GROUP: ReadonlyArray<{ kind: FinalDiagramShapeKind; glyph: string; label: string }> = [
  { kind: 'circle', glyph: '○', label: '円' },
  { kind: 'rect', glyph: '□', label: '矩形' },
  { kind: 'cloud', glyph: '☁', label: '雲' },
  { kind: 'bracket', glyph: ']', label: '括弧' },
  { kind: 'arrow_standalone', glyph: '→', label: '矢印' },
  { kind: 'text', glyph: 'T', label: 'テキスト' },
];

export function KJFinalShapePalette({ pendingKind, onPick }: KJFinalShapePaletteProps) {
  return (
    <aside className="kj-final-palette">
      <header className="kj-final-palette-head">
        <span>図形パレット</span>
        {pendingKind && (
          <button
            type="button"
            className="kj-final-palette-cancel"
            onClick={() => onPick(null)}
            title="配置をキャンセル (Esc)"
          >
            ×
          </button>
        )}
      </header>
      <div className="kj-final-palette-group">
        <div className="kj-final-palette-sub">関係記号 (川喜田 1997)</div>
        <div className="kj-final-palette-grid">
          {RELATION_TYPE_ORDER.map((kind) => {
            const glyph = (RELATION_TYPE_GLYPHS as Record<string, string>)[kind] ?? '?';
            const label = (RELATION_TYPE_LABELS as Record<string, string>)[kind] ?? kind;
            const active = pendingKind === (kind as FinalDiagramShapeKind);
            // 最終図解は論文準拠でモノクロ．種別の差はグリフ (記号) で示す．
            return (
              <button
                key={kind}
                type="button"
                className={`kj-final-palette-btn ${active ? 'active' : ''}`}
                onClick={() => onPick(active ? null : (kind as FinalDiagramShapeKind))}
                title={`${label} を配置 (クリック → キャンバスをクリックで配置)`}
              >
                <span className="kj-final-palette-glyph">{glyph}</span>
                <span className="kj-final-palette-label">{label}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="kj-final-palette-group">
        <div className="kj-final-palette-sub">装飾</div>
        <div className="kj-final-palette-grid">
          {PRIMITIVE_GROUP.map((p) => {
            const active = pendingKind === p.kind;
            return (
              <Fragment key={p.kind}>
                <button
                  type="button"
                  className={`kj-final-palette-btn ${active ? 'active' : ''}`}
                  onClick={() => onPick(active ? null : p.kind)}
                  title={`${p.label} を配置`}
                >
                  <span className="kj-final-palette-glyph">{p.glyph}</span>
                  <span className="kj-final-palette-label">{p.label}</span>
                </button>
              </Fragment>
            );
          })}
        </div>
      </div>
      <div className="kj-final-palette-hint muted small">
        {pendingKind
          ? '配置待ち：キャンバスをクリックすると置きます'
          : 'クリックして選び，キャンバスに配置．ダブルクリックでラベル編集．'}
      </div>
    </aside>
  );
}
