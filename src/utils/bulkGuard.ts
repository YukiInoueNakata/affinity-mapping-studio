// 対策1 (2026-07-03): 大規模な一括操作の確認ガード．
//
// 2026-07-03 の giro2026 インシデントでは「全カード選択 → 1 グループ化」相当の
// 一括操作 (単一トランザクション) が誤爆し，104 枚のカード / メンバーシップが
// まとめて 1 グループへ付け替えられて構造が全壊した．
//
// 一度に閾値以上の card / membership を変更する操作に確認ダイアログを挟み，
// 誤爆を止める．通常のドラッグ 1 枚移動や少数選択の操作は対象外．

/** これ以上の枚数を 1 操作で変更するとき確認する． */
export const BULK_CONFIRM_THRESHOLD = 20;

/**
 * 一括操作の確認．count が閾値未満なら常に true（確認しない）．
 * 閾値以上なら window.confirm で確認し，OK のとき true．
 * テスト環境など window が無い場合は true（＝ブロックしない）．
 */
export function confirmBulkOperation(count: number, actionLabel: string): boolean {
  if (count < BULK_CONFIRM_THRESHOLD) return true;
  if (typeof window === 'undefined' || typeof window.confirm !== 'function') return true;
  return window.confirm(
    `${count} 枚のカードを${actionLabel}します。よろしいですか？\n` +
      `（大量のカードを一度に変更しようとしています。意図しない操作の場合はキャンセルしてください）`
  );
}
