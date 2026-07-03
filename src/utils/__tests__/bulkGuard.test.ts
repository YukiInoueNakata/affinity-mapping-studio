import { afterEach, describe, expect, it, vi } from 'vitest';
import { BULK_CONFIRM_THRESHOLD, confirmBulkOperation } from '../bulkGuard.js';

describe('confirmBulkOperation (対策1)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('閾値未満は確認せず true（通常操作を阻害しない）', () => {
    const confirmSpy = vi.fn(() => false);
    vi.stubGlobal('window', { confirm: confirmSpy });
    expect(confirmBulkOperation(BULK_CONFIRM_THRESHOLD - 1, 'グループ化')).toBe(true);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('閾値以上は confirm を呼び，OK なら true', () => {
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal('window', { confirm: confirmSpy });
    expect(confirmBulkOperation(104, 'グループ化')).toBe(true);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
  });

  it('閾値以上でキャンセルなら false（誤爆を止める）', () => {
    const confirmSpy = vi.fn(() => false);
    vi.stubGlobal('window', { confirm: confirmSpy });
    expect(confirmBulkOperation(104, 'グループ化')).toBe(false);
  });

  it('window が無い環境（テスト等）は true でブロックしない', () => {
    vi.stubGlobal('window', undefined);
    expect(confirmBulkOperation(1000, 'グループ化')).toBe(true);
  });
});
