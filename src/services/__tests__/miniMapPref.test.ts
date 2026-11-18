import { describe, it, expect } from 'vitest';
import {
  MINIMAP_AUTO_LIMIT,
  getMiniMapMode,
  setMiniMapMode,
  shouldShowMiniMap,
} from '../miniMapPref.js';

describe('miniMapPref', () => {
  it('localStorage が無くても既定は auto', () => {
    expect(getMiniMapMode()).toBe('auto');
  });

  it('auto は上限まで出し，超えたら隠す', () => {
    expect(shouldShowMiniMap('auto', 338)).toBe(true); // giro2026 の規模（カード 220＋グループ 118）
    expect(shouldShowMiniMap('auto', MINIMAP_AUTO_LIMIT)).toBe(true);
    expect(shouldShowMiniMap('auto', MINIMAP_AUTO_LIMIT + 1)).toBe(false);
  });

  it('on は大きくても出し，off は小さくても出さない', () => {
    expect(shouldShowMiniMap('on', MINIMAP_AUTO_LIMIT * 5)).toBe(true);
    expect(shouldShowMiniMap('off', 1)).toBe(false);
  });

  it('setMiniMapMode は保存できなくても値を変える', () => {
    setMiniMapMode('off');
    expect(getMiniMapMode()).toBe('off');
    setMiniMapMode('auto');
    expect(getMiniMapMode()).toBe('auto');
  });
});
