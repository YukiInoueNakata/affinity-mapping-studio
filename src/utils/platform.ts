// 2026-11-07: 画面の説明が「Ctrl+クリック」だけだった．Mac では Ctrl+クリックは右クリックになり，
// 同じ働きは command キー（処理は metaKey も受けている）．説明の文言はここを通して OS に合わせる．
export const IS_MAC =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '');

/** 画面に出す修飾キーの名前（Mac は Command，ほかは Ctrl）． */
export const MOD_KEY = IS_MAC ? 'Command' : 'Ctrl';
