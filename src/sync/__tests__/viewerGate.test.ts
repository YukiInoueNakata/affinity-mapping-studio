// Sec-003/009 (2026-06-03): viewer ロール時の edit gate が機能することを確認する
// 回帰テスト．store 層の applyCommand が viewer モードでは block されることを保証．

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useProjectStore, setEditGateRole, getEditGateRole } from '../../stores/projectStore.js';
import {
  makeAddParticipantCommand,
  makeAddCardMemoEntryCommand,
  makeAddLabelMemoEntryCommand,
  makeDeleteCardMemoEntryCommand,
} from '../../stores/commands.js';
import { newId } from '../../domain/ids.js';
import { makeEmptyProject } from '@shared/types/project';
import type { Card, Label, MemoEntry, Participant } from '@shared/types/domain';

const NOW = '2026-06-03T00:00:00.000Z';

const initial = useProjectStore.getState();

beforeEach(() => {
  setEditGateRole(null);
  useProjectStore.getState().attachSyncBridge(null);
  useProjectStore.setState(initial, true);
});

afterEach(() => {
  setEditGateRole(null);
  useProjectStore.getState().attachSyncBridge(null);
});

function makeParticipant(code: string): Participant {
  return { id: newId(), code, displayName: code, createdAt: NOW };
}

describe('viewer edit gate (Sec-003/009)', () => {
  it('null role (= editor 既定) では applyCommand が通常通り動作する', () => {
    const project = makeEmptyProject('test', 'proj-' + newId(), NOW);
    useProjectStore.getState().loadProject(null, project);
    expect(getEditGateRole()).toBe(null);

    const p = makeParticipant('P01');
    useProjectStore.getState().applyCommand(makeAddParticipantCommand(p));

    expect(useProjectStore.getState().project?.data.participants).toHaveLength(1);
    expect(useProjectStore.getState().isDirty).toBe(true);
  });

  it('editor ロールでも applyCommand が動作する', () => {
    const project = makeEmptyProject('test', 'proj-' + newId(), NOW);
    useProjectStore.getState().loadProject(null, project);
    setEditGateRole('editor');

    const p = makeParticipant('P01');
    useProjectStore.getState().applyCommand(makeAddParticipantCommand(p));

    expect(useProjectStore.getState().project?.data.participants).toHaveLength(1);
  });

  it('viewer ロールでは applyCommand が block される (project state は変化しない)', () => {
    const project = makeEmptyProject('test', 'proj-' + newId(), NOW);
    useProjectStore.getState().loadProject(null, project);
    // alert を mock してテスト中の UI 副作用を抑止
    const alertSpy = vi.fn();
    if (typeof globalThis !== 'undefined') {
      (globalThis as unknown as { alert?: (msg?: string) => void }).alert = alertSpy;
    }
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    setEditGateRole('viewer');

    const p = makeParticipant('P01');
    useProjectStore.getState().applyCommand(makeAddParticipantCommand(p));

    expect(useProjectStore.getState().project?.data.participants).toHaveLength(0);
    expect(useProjectStore.getState().isDirty).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      '[viewer-gate] blocked applyCommand:',
      expect.stringContaining('P01')
    );

    warnSpy.mockRestore();
  });

  it('viewer から editor に切り替わると applyCommand が再び通る', () => {
    const project = makeEmptyProject('test', 'proj-' + newId(), NOW);
    useProjectStore.getState().loadProject(null, project);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    if (typeof globalThis !== 'undefined') {
      (globalThis as unknown as { alert?: (msg?: string) => void }).alert = vi.fn();
    }

    setEditGateRole('viewer');
    useProjectStore.getState().applyCommand(makeAddParticipantCommand(makeParticipant('P01')));
    expect(useProjectStore.getState().project?.data.participants).toHaveLength(0);

    setEditGateRole('editor');
    useProjectStore.getState().applyCommand(makeAddParticipantCommand(makeParticipant('P02')));
    expect(useProjectStore.getState().project?.data.participants).toHaveLength(1);

    warnSpy.mockRestore();
  });

  it('viewer 解除 (null) でも applyCommand が通る (オフライン編集に戻った場合)', () => {
    const project = makeEmptyProject('test', 'proj-' + newId(), NOW);
    useProjectStore.getState().loadProject(null, project);

    setEditGateRole('viewer');
    setEditGateRole(null);

    useProjectStore.getState().applyCommand(makeAddParticipantCommand(makeParticipant('P01')));
    expect(useProjectStore.getState().project?.data.participants).toHaveLength(1);
  });

  // ---- Phase 2B: viewerAllowed コマンドの個別解放 ----

  function seedWithCardAndLabel(): { card: Card; label: Label } {
    const project = makeEmptyProject('test', 'proj-' + newId(), NOW);
    const card: Card = {
      id: 'c1',
      participantId: 'p1',
      code: 'P01-001',
      serialNumber: 1,
      body: 'テスト本文',
      status: 'active',
      createdAt: NOW,
      updatedAt: NOW,
    };
    const label: Label = {
      id: 'l1',
      groupId: 'g1',
      text: '表札',
      sharedMemo: '',
      basisMemo: '',
      holdMemo: '',
      createdAt: NOW,
      updatedAt: NOW,
    };
    project.data.cards = [card];
    project.data.labels = [label];
    useProjectStore.getState().loadProject(null, project);
    return { card, label };
  }

  it('Phase 2B: viewer はカードメモ追記 (viewerAllowed: true) を実行できる', () => {
    const { card } = seedWithCardAndLabel();
    setEditGateRole('viewer');

    const entry: MemoEntry = { id: 'm1', text: '気になった点', timestamp: NOW };
    const cmd = makeAddCardMemoEntryCommand(card.id, entry, NOW, card.updatedAt);
    expect(cmd.viewerAllowed).toBe(true);

    useProjectStore.getState().applyCommand(cmd);
    const updated = useProjectStore.getState().project?.data.cards[0];
    expect(updated?.memoLog).toEqual([entry]);
  });

  it('Phase 2B: viewer は表札メモ追記 (viewerAllowed: true) を実行できる', () => {
    const { label } = seedWithCardAndLabel();
    setEditGateRole('viewer');

    const entry: MemoEntry = { id: 'm2', text: '叙述コメント', timestamp: NOW };
    const cmd = makeAddLabelMemoEntryCommand(label.id, 'sharedMemo', entry, NOW, label.updatedAt);
    expect(cmd.viewerAllowed).toBe(true);

    useProjectStore.getState().applyCommand(cmd);
    const updated = useProjectStore.getState().project?.data.labels[0];
    expect(updated?.memoLogs?.sharedMemo).toEqual([entry]);
  });

  it('Phase 2B: viewer のメモ削除は viewerAllowed=false なので block される', () => {
    const { card } = seedWithCardAndLabel();
    // 先に editor として 1 件追記
    setEditGateRole('editor');
    const entry: MemoEntry = { id: 'm3', text: '初期メモ', timestamp: NOW };
    useProjectStore.getState().applyCommand(
      makeAddCardMemoEntryCommand(card.id, entry, NOW, card.updatedAt)
    );
    expect(useProjectStore.getState().project?.data.cards[0]?.memoLog).toHaveLength(1);

    // viewer に降格して削除を試みる → block
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    if (typeof globalThis !== 'undefined') {
      (globalThis as unknown as { alert?: (msg?: string) => void }).alert = vi.fn();
    }
    setEditGateRole('viewer');
    const deleteCmd = makeDeleteCardMemoEntryCommand(card.id, entry, NOW, NOW);
    expect(deleteCmd.viewerAllowed).toBeUndefined();
    useProjectStore.getState().applyCommand(deleteCmd);
    expect(useProjectStore.getState().project?.data.cards[0]?.memoLog).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
