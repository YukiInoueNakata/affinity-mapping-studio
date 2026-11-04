import { confirm as tauriConfirm } from '@tauri-apps/plugin-dialog';

/**
 * 「OK / キャンセル」の確認ダイアログ．OK なら true．
 *
 * デスクトップ版では window.confirm を使わない．tauri-plugin-dialog が起動時に
 * window.confirm を非同期の関数へ差し替えるため，返り値が Promise（常に真）になり，
 * `if (!confirm(...)) return` が必ず素通りする．さらに差し替え先の
 * `plugin:dialog|confirm` コマンドは 2.7 で無くなっていてダイアログも出ない．
 * プラグインの confirm() は許可済みの message コマンドを使うのでこちらを使う．
 * ブラウザ（開発用の vite・テスト）では標準の window.confirm を使う．
 */
export async function confirmDialog(message: string): Promise<boolean> {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    try {
      return await tauriConfirm(message, {
        title: 'Affinity Mapping Studio',
        kind: 'warning',
        okLabel: 'OK',
        cancelLabel: 'キャンセル',
      });
    } catch (e) {
      // ダイアログが出せないときは，確かめられないので「キャンセル」として扱う．
      console.error('[confirmDialog] failed', e);
      return false;
    }
  }
  return window.confirm(message);
}
