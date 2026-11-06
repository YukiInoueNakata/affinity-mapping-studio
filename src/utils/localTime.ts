// 時刻を地方時（パソコンの時間帯）の文字列にする．
//
// 2026-11-07: 保存した時刻・カードの作成日時・書き出したファイル名などを，
// ISO 文字列（UTC）の slice でそのまま出していたため，日本では 9 時間ずれて見えた
// （「保存済み 22:51:03」が実際は 7:51）．表示とファイル名はすべてここを通す．
// 保存する値（created_at など）は今までどおり ISO 文字列（UTC）のまま．

const pad = (n: number) => String(n).padStart(2, '0');

export type LocalTimeUnit = 'date' | 'minute' | 'second' | 'time';

/**
 * ISO 文字列（または Date）を地方時で書く．
 * - date: `YYYY-MM-DD`
 * - minute: `YYYY-MM-DD HH:MM`
 * - second: `YYYY-MM-DD HH:MM:SS`
 * - time: `HH:MM:SS`
 * 読めない値のときは，元の文字列を今までと同じ形に切って返す（表示を空にしない）．
 */
export function formatLocal(value: string | Date | undefined | null, unit: LocalTimeUnit = 'second'): string {
  if (value === undefined || value === null || value === '') return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    const s = String(value);
    if (unit === 'date') return s.slice(0, 10);
    if (unit === 'minute') return s.slice(0, 16).replace('T', ' ');
    if (unit === 'time') return s.slice(11, 19);
    return s.slice(0, 19).replace('T', ' ');
  }
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const hms = `${hm}:${pad(d.getSeconds())}`;
  if (unit === 'date') return date;
  if (unit === 'minute') return `${date} ${hm}`;
  if (unit === 'time') return hms;
  return `${date} ${hms}`;
}

/** 書き出すファイル名に付ける地方時の日時（`YYYY-MM-DD-HH-MM`）． */
export function fileTimestamp(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}-${pad(d.getMinutes())}`;
}
