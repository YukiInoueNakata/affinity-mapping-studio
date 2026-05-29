import { useCallback } from 'react';

/**
 * (#8) ホイールパッド (Panasonic Let's note 等) の縁スクロールが WebView2 で効かない
 * 環境向けの, ホイール非依存なキーボードスクロール fallback.
 *
 * 戻り値をスクロール領域 (overflow-y:auto の要素) に spread すると, クリック等で
 * その領域へフォーカスが当たった状態で次のキーでスクロールできる:
 *   ArrowUp/Down, PageUp/Down, Space (+Shift で上), Home/End.
 *
 * INPUT / TEXTAREA / contenteditable にフォーカスがある間は何もしない.
 */
export function useKeyboardScroll() {
  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLElement>) => {
    // スクロール領域そのものにフォーカスがある時だけ処理する. 子のボタン等に
    // フォーカスがある場合は何もしない (Space でのボタン誤操作を防ぐ).
    if (e.target !== e.currentTarget) return;
    const el = e.currentTarget;
    const page = Math.max(40, el.clientHeight - 40);
    let dy = 0;
    switch (e.key) {
      case 'ArrowDown':
        dy = 48;
        break;
      case 'ArrowUp':
        dy = -48;
        break;
      case 'PageDown':
        dy = page;
        break;
      case 'PageUp':
        dy = -page;
        break;
      case ' ':
        dy = e.shiftKey ? -page : page;
        break;
      case 'Home':
        el.scrollTo({ top: 0 });
        e.preventDefault();
        return;
      case 'End':
        el.scrollTo({ top: el.scrollHeight });
        e.preventDefault();
        return;
      default:
        return;
    }
    el.scrollBy({ top: dy });
    e.preventDefault();
  }, []);

  return { tabIndex: 0 as const, onKeyDown, 'data-kbscroll': '' };
}
