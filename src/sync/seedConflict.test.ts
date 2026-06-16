// Codex-C2 (2026-06-16): uploadProject() 先着レースの検出不変条件をテストする．
//
// SyncManager 全体は WebSocket provider / IndexedDB を要するためここでは立ち上げず，
// 修正が依拠する Yjs レベルの不変条件のみを検証する:
//   1. 2 クライアントが同じ空ルームへ同時に seed しても，`__sync.seedOwner` は
//      LWW で全ピアで同一値に決定論的に収束する (= 先着勝者が一意に決まる)．
//   2. 敗者は「収束した seedOwner が自分の clientID と異なる」ことで検出できる．
//   3. tables も同じ勝者の内容へ収束する (= 破損や重複は起きない)．
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';

/** 1 クライアント分の seed: tables にカードを 1 枚積み，seedOwner に自分の clientID を書く． */
function seed(doc: Y.Doc, cardId: string): number {
  const ownerId = doc.clientID;
  Y.transact(doc, () => {
    const tables = doc.getMap('tables');
    const arr = new Y.Array<Y.Map<unknown>>();
    tables.set('cards', arr);
    const card = new Y.Map<unknown>();
    card.set('id', cardId);
    arr.push([card]);
    doc.getMap('__sync').set('seedOwner', ownerId);
  });
  return ownerId;
}

function cardIds(doc: Y.Doc): string[] {
  const arr = doc.getMap('tables').get('cards') as Y.Array<Y.Map<unknown>> | undefined;
  if (!arr) return [];
  return arr.map((m) => m.get('id') as string);
}

describe('Codex-C2 seed 先着レース検出', () => {
  it('2 クライアント同時 seed で seedOwner が両ピアで同一値に収束する', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    const ownerA = seed(a, 'cardA');
    const ownerB = seed(b, 'cardB');
    expect(ownerA).not.toBe(ownerB);

    // 双方向にフル状態を交換 (オフライン同時編集 → 再接続マージ相当)．
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));

    const ownerOnA = a.getMap('__sync').get('seedOwner');
    const ownerOnB = b.getMap('__sync').get('seedOwner');
    expect(ownerOnA).toBe(ownerOnB); // 決定論的に一意収束
    expect([ownerA, ownerB]).toContain(ownerOnA); // どちらかの clientID
  });

  it('敗者は収束 seedOwner != 自分の clientID で検出でき，tables も勝者へ収束する', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    const ownerA = seed(a, 'cardA');
    const ownerB = seed(b, 'cardB');

    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));

    const winner = a.getMap('__sync').get('seedOwner') as number;
    const loser = winner === ownerA ? ownerB : ownerA;
    const loserDoc = winner === ownerA ? b : a;
    const winnerCard = winner === ownerA ? 'cardA' : 'cardB';

    // 敗者視点: seedOwner は自分でない → 検出条件成立．
    expect(loserDoc.getMap('__sync').get('seedOwner')).not.toBe(loser);

    // tables は LWW で勝者の配列に収束．重複や混在は起きない (1 枚だけ)．
    expect(cardIds(a)).toEqual([winnerCard]);
    expect(cardIds(b)).toEqual([winnerCard]);
  });

  it('単独 seed では seedOwner が自分のままで誤検出しない', () => {
    const a = new Y.Doc();
    const ownerA = seed(a, 'cardA');
    expect(a.getMap('__sync').get('seedOwner')).toBe(ownerA);
  });
});
