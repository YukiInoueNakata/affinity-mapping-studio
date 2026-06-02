import { useEffect, useRef } from 'react';

export interface ContextMenuItem {
  /** ボタンに表示するラベル．"divider" にすると区切り線になる． */
  label: string;
  /** クリック時に呼ばれる．undefined なら disabled として表示． */
  onClick?: () => void;
  /** title 属性 (ホバー時のツールチップ)． */
  title?: string;
  /** "divider" 専用フラグ．label は表示されない． */
  divider?: boolean;
}

interface Props {
  /** 表示するメニュー項目．divider:true で区切り線． */
  items: ContextMenuItem[];
  /** ビューポート座標 (clientX/Y) ． */
  x: number;
  y: number;
  /** メニュー外クリック / Esc / 項目クリック後に呼ばれる． */
  onClose: () => void;
}

/**
 * 軽量な右クリックコンテキストメニュー．
 *  - 画面右下に近いと自動で位置調整 (はみ出し防止)
 *  - メニュー外クリックで閉じる
 *  - Esc で閉じる
 *  - 項目クリックで onClick → onClose
 */
export function ContextMenu({ items, x, y, onClose }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);

  // 外クリック検出 (mousedown キャプチャで先に閉じる)
  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('mousedown', onDocMouseDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // 画面右下にはみ出さないよう位置調整 (描画後に rect 計測)
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let nx = x;
    let ny = y;
    if (nx + r.width > vw) nx = Math.max(4, vw - r.width - 4);
    if (ny + r.height > vh) ny = Math.max(4, vh - r.height - 4);
    el.style.left = `${nx}px`;
    el.style.top = `${ny}px`;
  }, [x, y]);

  return (
    <div
      ref={ref}
      className="kj-context-menu"
      role="menu"
      style={{ position: 'fixed', left: x, top: y, zIndex: 10000 }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) => {
        if (item.divider) return <div key={`d-${i}`} className="kj-context-menu-divider" />;
        const disabled = !item.onClick;
        return (
          <button
            key={i}
            type="button"
            role="menuitem"
            className="kj-context-menu-item"
            disabled={disabled}
            title={item.title}
            onClick={() => {
              if (disabled) return;
              item.onClick?.();
              onClose();
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
