/** data URL（base64 か，URL エンコードの文字列）をバイト列にする．SVG は後者で来る． */
export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) throw new Error('画像のデータが読めません');
  const head = dataUrl.slice(0, comma);
  const body = dataUrl.slice(comma + 1);
  if (/;base64$/i.test(head)) {
    const bin = atob(body);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new TextEncoder().encode(decodeURIComponent(body));
}
