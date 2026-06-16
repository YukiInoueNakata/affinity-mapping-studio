import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { docHasData } from '../syncManager.js';

// Fix #3: docHasData must NOT judge a metadata-only (or partially written) doc
// as empty.  Seeding over a non-empty doc tombstones content and risks a wipe.

describe('docHasData — Fix #3 emptiness guard', () => {
  it('returns false for a truly empty doc', () => {
    const doc = new Y.Doc();
    expect(docHasData(doc)).toBe(false);
  });

  it('returns true when any table holds rows', () => {
    const doc = new Y.Doc();
    const tables = doc.getMap('tables');
    const arr = new Y.Array<Y.Map<unknown>>();
    const row = new Y.Map<unknown>();
    row.set('id', 'c1');
    arr.push([row]);
    tables.set('cards', arr);
    expect(docHasData(doc)).toBe(true);
  });

  it('returns true for a metadata-only doc (no table rows)', () => {
    const doc = new Y.Doc();
    doc.getMap('metadata').set('title', 'プロジェクト');
    expect(docHasData(doc)).toBe(true);
  });

  it('returns false when tables exist but every table is empty', () => {
    const doc = new Y.Doc();
    const tables = doc.getMap('tables');
    tables.set('cards', new Y.Array());
    tables.set('groups', new Y.Array());
    expect(docHasData(doc)).toBe(false);
  });
});
