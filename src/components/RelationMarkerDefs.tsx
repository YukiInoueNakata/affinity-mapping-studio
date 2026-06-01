import { memo } from 'react';

/**
 * 最終図解ビュー (KJFinalView) 用の SVG marker 定義．
 *
 * 14 種の関係種別ごとに固有の矢じり形状を定義する．
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
        {/* 1. causes 因果 → — 標準鋭角矢じり */}
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

        {/* 2. promotes 促進 ⇧ — 鈍角の開いた V (開放型・押し上げ) */}
        <marker
          id="kj-arrow-final-promotes"
          viewBox="0 0 14 14"
          refX="13"
          refY="7"
          markerWidth="11"
          markerHeight="11"
          orient="auto-start-reverse"
        >
          <path d="M 0 1 L 13 7 L 0 13" fill="none" stroke={MARKER_COLOR} strokeWidth="2" />
        </marker>

        {/* 3. inhibits 抑制 ⇩ — T-bar (堰き止め記号) */}
        <marker
          id="kj-arrow-final-inhibits"
          viewBox="0 0 8 14"
          refX="6"
          refY="7"
          markerWidth="7"
          markerHeight="11"
          orient="auto-start-reverse"
        >
          <path d="M 6 0 L 6 14" stroke={MARKER_COLOR} strokeWidth="2.5" />
        </marker>

        {/* 4. precedes 前提 ⊢ — 標準矢じり + 始点側に短い縦バー (前提条件の印) */}
        <marker
          id="kj-arrow-final-precedes"
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

        {/* 5. follows 後続 ⊣ — 標準矢じり + 直前に円ドット (帰結の印) */}
        <marker
          id="kj-arrow-final-follows"
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

        {/* 6. contrasts_with 対立 ⇄ — 両端矢印用．閉じた三角 */}
        <marker
          id="kj-arrow-final-contrasts_with"
          viewBox="0 0 12 12"
          refX="11"
          refY="6"
          markerWidth="9"
          markerHeight="9"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 11 6 L 0 12 Z" fill={MARKER_COLOR} />
        </marker>

        {/* 7. supports 支持 ＋ — 矢じり + プラス記号 */}
        <marker
          id="kj-arrow-final-supports"
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

        {/* 8. questions 疑問 ？ — 破線で描いた開放型矢じり (不確実) */}
        <marker
          id="kj-arrow-final-questions"
          viewBox="0 0 14 12"
          refX="13"
          refY="6"
          markerWidth="10"
          markerHeight="9"
          orient="auto-start-reverse"
        >
          <path
            d="M 1 1 L 13 6 L 1 11"
            fill="none"
            stroke={MARKER_COLOR}
            strokeWidth="1.5"
            strokeDasharray="2 1"
          />
        </marker>

        {/* 9. part_of 含意 ⊂ — 大きく開いたカッコ (包含) */}
        <marker
          id="kj-arrow-final-part_of"
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

        {/* 10. example_of 具体例 ∋ — 反り返り矢じり (180° を超えた開き．barbs が後方へ swept back) */}
        <marker
          id="kj-arrow-final-example_of"
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

        {/* 11. abstracts 抽象化 ⇪ — V を二段重ねた矢じり (階層的抽象化) */}
        <marker
          id="kj-arrow-final-abstracts"
          viewBox="0 0 16 14"
          refX="15"
          refY="7"
          markerWidth="12"
          markerHeight="11"
          orient="auto-start-reverse"
        >
          <path d="M 0 1 L 7 7 L 0 13" fill="none" stroke={MARKER_COLOR} strokeWidth="2" />
          <path d="M 7 1 L 14 7 L 7 13" fill="none" stroke={MARKER_COLOR} strokeWidth="2" />
        </marker>

        {/* 12. derived_from 派生 ⤳ — 矢じり + 直前に波線 (派生・由来) */}
        <marker
          id="kj-arrow-final-derived_from"
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

        {/* 13. co_occurs_with 同時 ≈ — 短い縦バー (両端適用で「||」になる) */}
        <marker
          id="kj-arrow-final-co_occurs_with"
          viewBox="0 0 6 14"
          refX="3"
          refY="7"
          markerWidth="5"
          markerHeight="11"
          orient="auto-start-reverse"
        >
          <path d="M 3 0 L 3 14" stroke={MARKER_COLOR} strokeWidth="2.5" />
        </marker>

        {/* 14. custom カスタム ◇ — 菱形 (汎用) */}
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
