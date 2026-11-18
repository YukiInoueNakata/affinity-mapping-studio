// ミニマップを出すかどうかの設定（端末ごと．localStorage に置き，共有の doc には入れない）．
//
// - auto（既定）: ノード（カード＋グループ）が MINIMAP_AUTO_LIMIT 以下なら出し，超えたら隠す．
// - on: いつも出す（大きな図では重くなることがある）．
// - off: 出さない．
//
// 4 つのキャンバス（第 1 段・第 n 段・分析図・最終図解）が同じ設定を読む．

import { useSyncExternalStore } from 'react';

export type MiniMapMode = 'auto' | 'on' | 'off';

/** 自動のときにミニマップを出すノードの数の上限（2026-11-18 実測で決めた値．WORKLOG 参照）． */
export const MINIMAP_AUTO_LIMIT = 1000;

const KEY = 'kj.miniMapMode';
const subscribers = new Set<() => void>();

function load(): MiniMapMode {
  try {
    const v = window.localStorage.getItem(KEY);
    if (v === 'auto' || v === 'on' || v === 'off') return v;
  } catch {
    /* localStorage が使えないときは既定 */
  }
  return 'auto';
}

let mode: MiniMapMode = load();

export function getMiniMapMode(): MiniMapMode {
  return mode;
}

export function setMiniMapMode(next: MiniMapMode) {
  mode = next;
  try {
    window.localStorage.setItem(KEY, next);
  } catch {
    /* 保存できなくても，このセッションの中では効く */
  }
  subscribers.forEach((f) => f());
}

export function useMiniMapMode(): MiniMapMode {
  return useSyncExternalStore(
    (cb) => {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
    () => mode
  );
}

/** そのノードの数でミニマップを出すか． */
export function shouldShowMiniMap(m: MiniMapMode, nodeCount: number): boolean {
  if (m === 'off') return false;
  if (m === 'on') return true;
  return nodeCount <= MINIMAP_AUTO_LIMIT;
}
