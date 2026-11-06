import { describe, expect, it } from 'vitest';
import { fileTimestamp, formatLocal } from '../localTime.js';

describe('formatLocal', () => {
  // 地方時の Date から作った ISO 文字列を，同じ地方時に戻せること（時間帯に依らない）
  const local = new Date(2026, 10, 7, 7, 51, 3); // 2026-11-07 07:51:03（地方時）
  const iso = local.toISOString();

  it('地方時で書く（UTC の slice にならない）', () => {
    expect(formatLocal(iso, 'second')).toBe('2026-11-07 07:51:03');
    expect(formatLocal(iso, 'minute')).toBe('2026-11-07 07:51');
    expect(formatLocal(iso, 'date')).toBe('2026-11-07');
    expect(formatLocal(iso, 'time')).toBe('07:51:03');
  });

  it('既定は second', () => {
    expect(formatLocal(iso)).toBe('2026-11-07 07:51:03');
  });

  it('Date も受ける', () => {
    expect(formatLocal(local, 'time')).toBe('07:51:03');
  });

  it('空や読めない値', () => {
    expect(formatLocal(undefined)).toBe('');
    expect(formatLocal('')).toBe('');
    expect(formatLocal('not-a-date', 'date')).toBe('not-a-date');
  });
});

describe('fileTimestamp', () => {
  it('地方時の YYYY-MM-DD-HH-MM', () => {
    expect(fileTimestamp(new Date(2026, 0, 2, 3, 4, 5))).toBe('2026-01-02-03-04');
  });
});
