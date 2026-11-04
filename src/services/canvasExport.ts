// 「図を出力」で，いま表示しているキャンバス（第 1 段・第 n 段・最終図解）を
// 画面の見え方に関係なく図全体で写すための仕組み．
//
// - 各キャンバスは useRegisterExportTarget() で自分の React Flow を登録する
//   （ExportDialog は ReactFlowProvider の外にあるので，ここを経由して取る）．
// - キャンバスは onlyRenderVisibleElements で画面の外のノードを描かないため，
//   書き出すあいだだけ useRenderAll() が true になり，全ノードを描かせる．
// - captureWholeFlow() は全ノードの範囲を計算し，拡大なし（scale 1）で写す．
//   書き出しのあいだは <html> に kj-exporting を付け，暗い配色の色を
//   白い背景で読める色に差し替える（styles.css）．

import { useEffect, useSyncExternalStore } from 'react';
import { getRectOfNodes, useReactFlow, type ReactFlowInstance } from 'reactflow';
import { toPng, toSvg } from 'html-to-image';

let target: ReactFlowInstance | null = null;
let renderAll = false;
const subscribers = new Set<() => void>();

function setRenderAll(v: boolean) {
  renderAll = v;
  subscribers.forEach((f) => f());
}

/** 書き出し中は true．キャンバスは onlyRenderVisibleElements={!renderAll} にする． */
export function useRenderAll(): boolean {
  return useSyncExternalStore(
    (cb) => {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
    () => renderAll
  );
}

/** ReactFlowProvider の中で呼ぶ．表示中のキャンバスを書き出しの対象にする． */
export function useRegisterExportTarget() {
  const rf = useReactFlow();
  useEffect(() => {
    target = rf;
    return () => {
      if (target === rf) target = null;
    };
  }, [rf]);
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

export interface CaptureResult {
  dataUrl: string;
  width: number;
  height: number;
}

/**
 * 表示中のキャンバスを図全体で写す．ノードが 1 つも無い・キャンバスが無いときは
 * Error を投げる（黙って空の画像を返さない）．
 */
export async function captureWholeFlow(
  format: 'png' | 'svg',
  opts: { padding?: number; pixelRatio?: number } = {}
): Promise<CaptureResult> {
  const rf = target;
  const el = document.querySelector<HTMLElement>('.react-flow__viewport');
  if (!rf || !el) throw new Error('キャンバスが見つかりません．キャンバスを表示してから再試行してください．');
  const nodes = rf.getNodes().filter((n) => !n.hidden);
  if (nodes.length === 0) throw new Error('書き出すカード・グループがありません．');
  const pad = opts.padding ?? 40;

  setRenderAll(true);
  document.documentElement.classList.add('kj-exporting');
  try {
    // 画面の外のノードが描かれ，大きさが測られるのを待つ．
    await nextFrame();
    await nextFrame();
    await new Promise((r) => setTimeout(r, 80));
    // 測り直した大きさで範囲を取る（描かれていなかったノードは width が未確定のことがある）．
    const b = getRectOfNodes(rf.getNodes().filter((n) => !n.hidden));
    const width = Math.ceil(b.width + pad * 2);
    const height = Math.ceil(b.height + pad * 2);
    const fn = format === 'svg' ? toSvg : toPng;
    const dataUrl = await fn(el, {
      backgroundColor: '#ffffff',
      pixelRatio: opts.pixelRatio ?? 2,
      skipFonts: false,
      width,
      height,
      style: {
        width: `${width}px`,
        height: `${height}px`,
        transform: `translate(${pad - b.x}px, ${pad - b.y}px) scale(1)`,
      },
    });
    return { dataUrl, width, height };
  } finally {
    document.documentElement.classList.remove('kj-exporting');
    setRenderAll(false);
  }
}
