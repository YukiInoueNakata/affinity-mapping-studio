// キャンバスのミニマップ．出すかどうかは端末ごとの設定（services/miniMapPref.ts）で決める．
// ReactFlow の子として置く．

import type { CSSProperties } from 'react';
import { MiniMap, Panel } from 'reactflow';
import {
  MINIMAP_AUTO_LIMIT,
  shouldShowMiniMap,
  useMiniMapMode,
} from '../services/miniMapPref.js';

const noteStyle: CSSProperties = {
  fontSize: 11,
  padding: '3px 8px',
  borderRadius: 4,
  background: 'rgba(40, 40, 40, 0.85)',
  color: '#ddd',
  pointerEvents: 'none',
  maxWidth: 260,
};

export function CanvasMiniMap({ nodeCount }: { nodeCount: number }) {
  const mode = useMiniMapMode();
  const over = nodeCount > MINIMAP_AUTO_LIMIT;
  if (shouldShowMiniMap(mode, nodeCount)) {
    return (
      <>
        <MiniMap pannable zoomable />
        {mode === 'on' && over && (
          <Panel position="bottom-right" style={{ marginBottom: 160 }}>
            <div style={noteStyle} data-testid="minimap-heavy-note">
              図が大きいので，ミニマップを出すと動きが重くなることがあります．
            </div>
          </Panel>
        )}
      </>
    );
  }
  if (mode === 'auto' && over) {
    return (
      <Panel position="bottom-right">
        <div style={noteStyle} data-testid="minimap-hidden-note">
          図が大きいので，ミニマップを隠しています（「表示」タブの「ミニマップ」で出せます）．
        </div>
      </Panel>
    );
  }
  return null;
}
