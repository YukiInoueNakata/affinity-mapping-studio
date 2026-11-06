import { describe, expect, it } from 'vitest';
import { dataUrlToBytes } from '../dataUrl.js';

describe('dataUrlToBytes', () => {
  it('base64（PNG の形）', () => {
    const bytes = dataUrlToBytes('data:image/png;base64,iVBORw0K');
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
  it('URL エンコード（html-to-image の SVG の形）', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>表札</text></svg>';
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    expect(new TextDecoder().decode(dataUrlToBytes(url))).toBe(svg);
  });
  it('カンマが無いと失敗を知らせる', () => {
    expect(() => dataUrlToBytes('broken')).toThrow();
  });
});
