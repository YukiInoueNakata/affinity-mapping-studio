// Codex 指摘#3 (2026-07-03): 一括ガードをコマンド層 (applyCommand) で強制することの検証．
// UI 経路以外 (alignGroupToLabel / DevTools / 別コンポーネント) から発行された
// 閾値以上の一括コマンドでも，applyCommand が確認を挟むこと．
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useProjectStore } from '../projectStore.js';
import { markBulkConfirmed, type DomainCommand } from '../commands.js';
import { newId } from '../../domain/ids.js';
import { makeEmptyProject } from '@shared/types/project';
import type { ProjectFile } from '@shared/types/project';
import { BULK_CONFIRM_THRESHOLD } from '../../utils/bulkGuard.js';

const NOW = '2026-07-03T00:00:00.000Z';
function freshProject(): ProjectFile {
  return makeEmptyProject('bulk-guard-test', 'proj-' + newId(), NOW);
}

// 影響件数 count の「一括操作」を模した最小コマンド．apply は恒等 (副作用なし)．
// 適用されたかどうかは store の past (undo スタック) 長で判定する．
function makeFakeBulk(count: number): DomainCommand {
  return {
    label: `fake bulk ${count}`,
    impactCount: count,
    bulkActionLabel: 'テスト一括',
    apply: (d) => ({ ...d }),
    revert: (d) => ({ ...d }),
  };
}
function pastLen(): number {
  return useProjectStore.getState().past.length;
}

const initial = useProjectStore.getState();

describe('applyCommand の一括ガード (Codex#3)', () => {
  beforeEach(() => {
    useProjectStore.setState(initial, true);
    useProjectStore.getState().loadProject(null, freshProject());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('閾値以上・未確認の一括コマンドは confirm がキャンセルされたら適用されない', () => {
    vi.stubGlobal('window', { confirm: vi.fn(() => false) });
    const store = useProjectStore.getState();
    store.applyCommand(makeFakeBulk(BULK_CONFIRM_THRESHOLD + 5));
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(pastLen()).toBe(0);
  });

  it('閾値以上でも confirm が OK なら適用される', () => {
    vi.stubGlobal('window', { confirm: vi.fn(() => true) });
    const store = useProjectStore.getState();
    store.applyCommand(makeFakeBulk(BULK_CONFIRM_THRESHOLD + 5));
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(pastLen()).toBe(1);
  });

  it('bulkConfirmed 済み (UI で確認済み) なら applyCommand は再確認しない', () => {
    vi.stubGlobal('window', { confirm: vi.fn(() => false) });
    const store = useProjectStore.getState();
    store.applyCommand(markBulkConfirmed(makeFakeBulk(BULK_CONFIRM_THRESHOLD + 5)));
    expect(window.confirm).not.toHaveBeenCalled();
    expect(pastLen()).toBe(1);
  });

  it('閾値未満の一括コマンドは確認せず適用される', () => {
    vi.stubGlobal('window', { confirm: vi.fn(() => false) });
    const store = useProjectStore.getState();
    store.applyCommand(makeFakeBulk(BULK_CONFIRM_THRESHOLD - 1));
    expect(window.confirm).not.toHaveBeenCalled();
    expect(pastLen()).toBe(1);
  });
});
