import { memo } from 'react';

/**
 * 最終図解ビュー (KJFinalView) 用の SVG marker 定義．
 *
 * 論文§2 分類の 15 種（14 + custom）の関係種別ごとに固有の矢じり形状を定義する．
 * - id プレフィクスは `kj-arrow-final-` で，通常 Canvas (kj-arrow-) と分離．
 * - orient="auto-start-reverse" により，同じ定義を markerStart / markerEnd の
 *   両方で使うと自動で向きが反転する（両端矢印 = 1 定義で済む）．
 * - 「鋭角でない / 180° を超えた矢じり」を含む．論文 (川喜田 1997 / 田中 2011)
 *   風のシンボル感を意識して各形状をデザインしている．
 *
 * 描画: KJFinalView の ReactFlow の隣に 1 回だけ配置する．
 */

const MARKER_COLOR = '#cccccc';

function RelationMarkerDefsImpl() {
  return (
    <svg
      style={{
        position: 'absolute',
        width: 0,
        height: 0,
        overflow: 'visible',
        pointerEvents: 'none',
      }}
      aria-hidden="true"
    >
      <defs>
        {/* 1. subsumes 包摂 ⊃ — 大きく開いたカッコ (包含) */}
        <marker
          id="kj-arrow-final-subsumes"
          viewBox="0 0 14 14"
          refX="12"
          refY="7"
          markerWidth="11"
          markerHeight="11"
          orient="auto-start-reverse"
        >
          <path
            d="M 12 0 Q 0 7 12 14"
            fill="none"
            stroke={MARKER_COLOR}
            strokeWidth="2"
          />
        </marker>

        {/* 2. exemplifies 例示 ∋ — 反り返り矢じり (180° を超えた開き．barbs が後方へ swept back) */}
        <marker
          id="kj-arrow-final-exemplifies"
          viewBox="0 0 16 14"
          refX="13"
          refY="7"
          markerWidth="12"
          markerHeight="11"
          orient="auto-start-reverse"
        >
          {/* 先端の矢じりは右向き．後方バーブが axis に向かって反り返る */}
          <path d="M 13 7 L 4 1 L 9 7 L 4 13 Z" fill={MARKER_COLOR} />
        </marker>

        {/* 3. refutes 反証 ⊗ — 円 + X (反証・否定) */}
        <marker
          id="kj-arrow-final-refutes"
          viewBox="0 0 14 14"
          refX="12"
          refY="7"
          markerWidth="11"
          markerHeight="11"
          orient="auto-start-reverse"
        >
          <circle cx="7" cy="7" r="6" fill="none" stroke={MARKER_COLOR} strokeWidth="1.6" />
          <path d="M 3.5 3.5 L 10.5 10.5 M 10.5 3.5 L 3.5 10.5" stroke={MARKER_COLOR} strokeWidth="1.6" />
        </marker>

        {/* 4. complements 補完 ＋ — 矢じり + プラス記号 */}
        <marker
          id="kj-arrow-final-complements"
          viewBox="0 0 16 14"
          refX="14"
          refY="7"
          markerWidth="12"
          markerHeight="10"
          orient="auto-start-reverse"
        >
          <path d="M 5 1 L 14 7 L 5 13 Z" fill={MARKER_COLOR} />
          <path d="M 0 7 L 4 7 M 2 5 L 2 9" stroke={MARKER_COLOR} strokeWidth="1.4" />
        </marker>

        {/* 5. opposes 対立 ⇄ — 両端矢印用．閉じた三角 */}
        <marker
          id="kj-arrow-final-opposes"
          viewBox="0 0 12 12"
          refX="11"
          refY="6"
          markerWidth="9"
          markerHeight="9"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 11 6 L 0 12 Z" fill={MARKER_COLOR} />
        </marker>

        {/* 6. parallels 並列 ∥ — 短い縦バー (両端適用で「||」になる) */}
        <marker
          id="kj-arrow-final-parallels"
          viewBox="0 0 6 14"
          refX="3"
          refY="7"
          markerWidth="5"
          markerHeight="11"
          orient="auto-start-reverse"
        >
          <path d="M 3 0 L 3 14" stroke={MARKER_COLOR} strokeWidth="2.5" />
        </marker>

        {/* 7. causes 因果 → — 標準鋭角矢じり */}
        <marker
          id="kj-arrow-final-causes"
          viewBox="0 0 12 12"
          refX="11"
          refY="6"
          markerWidth="9"
          markerHeight="9"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 11 6 L 0 12 Z" fill={MARKER_COLOR} />
        </marker>

        {/* 8. results_in 帰結 ⇒ — 標準矢じり + 直前に円ドット (帰結の印) */}
        <marker
          id="kj-arrow-final-results_in"
          viewBox="0 0 14 12"
          refX="13"
          refY="6"
          markerWidth="10"
          markerHeight="9"
          orient="auto-start-reverse"
        >
          <circle cx="2" cy="6" r="2" fill={MARKER_COLOR} />
          <path d="M 4 0 L 13 6 L 4 12 Z" fill={MARKER_COLOR} />
        </marker>

        {/* 9. presupposes 前提 ⊢ — 標準矢じり + 始点側に短い縦バー (前提条件の印) */}
        <marker
          id="kj-arrow-final-presupposes"
          viewBox="0 0 14 12"
          refX="13"
          refY="6"
          markerWidth="10"
          markerHeight="9"
          orient="auto-start-reverse"
        >
          <path d="M 2 0 L 13 6 L 2 12 Z" fill={MARKER_COLOR} />
          <path d="M 0 2 L 0 10" stroke={MARKER_COLOR} strokeWidth="2" />
        </marker>

        {/* 10. conditions 条件 ⊳ — 開放型三角 (条件) */}
        <marker
          id="kj-arrow-final-conditions"
          viewBox="0 0 14 14"
          refX="12"
          refY="7"
          markerWidth="11"
          markerHeight="11"
          orient="auto-start-reverse"
        >
          <path d="M 1 1 L 12 7 L 1 13 Z" fill="none" stroke={MARKER_COLOR} strokeWidth="1.6" />
        </marker>

        {/* 11. synonymous 同義 ≡ — 三本線 (両端適用で「≡」感．同義) */}
        <marker
          id="kj-arrow-final-synonymous"
          viewBox="0 0 8 14"
          refX="4"
          refY="7"
          markerWidth="7"
          markerHeight="11"
          orient="auto-start-reverse"
        >
          <path
            d="M 1 3 L 7 3 M 1 7 L 7 7 M 1 11 L 7 11"
            stroke={MARKER_COLOR}
            strokeWidth="1.5"
          />
        </marker>

        {/* 12. similar 類似 ≈ — 波線 (両端適用で「≈」感．類似) */}
        <marker
          id="kj-arrow-final-similar"
          viewBox="0 0 12 14"
          refX="6"
          refY="7"
          markerWidth="10"
          markerHeight="11"
          orient="auto-start-reverse"
        >
          <path
            d="M 1 5 Q 3 2 5 5 Q 7 8 9 5 M 1 9 Q 3 6 5 9 Q 7 12 9 9"
            fill="none"
            stroke={MARKER_COLOR}
            strokeWidth="1.4"
          />
        </marker>

        {/* 13. influences 影響 ⇢ — 鈍角の開いた V (開放型・影響) */}
        <marker
          id="kj-arrow-final-influences"
          viewBox="0 0 14 14"
          refX="13"
          refY="7"
          markerWidth="11"
          markerHeight="11"
          orient="auto-start-reverse"
        >
          <path d="M 0 1 L 13 7 L 0 13" fill="none" stroke={MARKER_COLOR} strokeWidth="2" />
        </marker>

        {/* 14. defines 規定 ≝ — 矢じり + 直前に波線 (規定・由来) */}
        <marker
          id="kj-arrow-final-defines"
          viewBox="0 0 16 12"
          refX="15"
          refY="6"
          markerWidth="12"
          markerHeight="10"
          orient="auto-start-reverse"
        >
          <path d="M 5 1 L 15 6 L 5 11 Z" fill={MARKER_COLOR} />
          <path
            d="M 0 6 Q 1 3 2 6 Q 3 9 4 6"
            fill="none"
            stroke={MARKER_COLOR}
            strokeWidth="1.5"
          />
        </marker>

        {/* 15. custom カスタム ◇ — 菱形 (汎用) */}
        <marker
          id="kj-arrow-final-custom"
          viewBox="0 0 14 14"
          refX="12"
          refY="7"
          markerWidth="11"
          markerHeight="11"
          orient="auto-start-reverse"
        >
          <path
            d="M 2 7 L 7 1 L 12 7 L 7 13 Z"
            fill="none"
            stroke={MARKER_COLOR}
            strokeWidth="1.5"
          />
        </marker>
      </defs>
    </svg>
  );
}

export const RelationMarkerDefs = memo(RelationMarkerDefsImpl);
