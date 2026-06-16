// Phase 4b-3a: client-side bridge between Zustand's ProjectData and a Y.Doc.
//
// The Y.Doc is the source of truth when collaborating; the bridge exposes:
//   - seedFromProjectData(data): bulk-fill a fresh Y.Doc with existing data
//   - toProjectData(): dump the current Y.Doc state back as ProjectData
//   - observe(callback): subscribe to remote changes (rebuilds ProjectData
//     on every transaction whose `origin` is NOT this bridge)
//   - applyLocal(fn): run a closure as a Y.Doc transaction whose origin is
//     this bridge — so our own changes don't echo back through observe()
//
// The schema mapping mirrors kj-trace-server/src/yjs-schema.js exactly.
// (Kept as a separate file rather than shared module because the server side
// stays vanilla JS for portability.)

import * as Y from 'yjs';
import type { ProjectData, ProjectMetadata } from '@shared/types/domain';

/** Tables we mirror.  Order matches `ProjectData`. */
export const TABLE_NAMES = [
  'participants',
  'source_segments',
  'cards',
  'card_source_links',
  'card_positions',
  'groups',
  'group_memberships',
  'labels',
  'group_positions',
  'text_revisions',
  'analysis_methods',
  'analysis_sessions',
  'analytic_object_links',
  'm_gta_settings',
  'm_gta_concepts',
  'm_gta_variations',
  'm_gta_categories',
  'theoretical_memos',
  'diagram_relations',
  'gta_codes',
  'gta_code_applications',
  'gta_categories',
] as const satisfies ReadonlyArray<keyof ProjectData>;

export type TableName = (typeof TABLE_NAMES)[number];

/** String fields stored as Y.Text for character-level collaborative editing. */
export const Y_TEXT_FIELDS: Partial<Record<TableName, ReadonlyArray<string>>> = {
  source_segments: ['text'],
  cards: ['body'],
  labels: ['text', 'sharedMemo', 'basisMemo', 'holdMemo'],
  theoretical_memos: ['body'],
  m_gta_concepts: ['definition'],
  m_gta_variations: ['interpretation'],
  m_gta_categories: ['definition'],
  gta_codes: ['definition'],
  gta_categories: ['definition'],
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    v !== null &&
    typeof v === 'object' &&
    !(v instanceof Y.AbstractType) &&
    !Array.isArray(v) &&
    Object.getPrototypeOf(v) === Object.prototype
  );
}

function cloneShallow<T extends Record<string, unknown>>(o: T): T {
  const out = {} as T;
  for (const k of Object.keys(o) as Array<keyof T>) {
    out[k] = o[k];
  }
  return out;
}

function recordToYMap(tableName: TableName, record: Record<string, unknown>): Y.Map<unknown> {
  const m = new Y.Map();
  const ytextFields = Y_TEXT_FIELDS[tableName] ?? [];
  for (const [k, v] of Object.entries(record)) {
    if (v === undefined) continue;
    if (ytextFields.includes(k) && typeof v === 'string') {
      const t = new Y.Text();
      if (v.length > 0) t.insert(0, v);
      m.set(k, t);
    } else if (v === null) {
      m.set(k, null);
    } else if (Array.isArray(v)) {
      m.set(k, (v as unknown[]).slice());
    } else if (isPlainObject(v)) {
      m.set(k, cloneShallow(v));
    } else {
      m.set(k, v);
    }
  }
  return m;
}

/** Shallow value equality for the scalar/array/object shapes we store in a
 *  Y.Map field.  Used to skip no-op writes so incremental updates don't add
 *  needless CRDT operations (and tombstones). */
function fieldEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!fieldEquals(a[i], b[i])) return false;
    }
    return true;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    for (const k of ak) {
      if (!fieldEquals(a[k], (b as Record<string, unknown>)[k])) return false;
    }
    return true;
  }
  return false;
}

/** Reconcile a Y.Text to equal `next` by editing only the changed middle
 *  span.  Computes the common prefix and suffix between the current string and
 *  `next`, then deletes/inserts only the differing run in between.
 *
 *  Why: the previous implementation deleted the entire string and reinserted
 *  it on every change.  Yjs keeps deletions as tombstones forever, so a single
 *  keystroke tombstoned the whole field — over an editing session this is a
 *  primary CRDT-bloat vector.  Prefix/suffix diffing tombstones only the
 *  characters that actually changed (usually 0–1 per keystroke). */
function applyYTextDiff(cur: Y.Text, next: string): void {
  const curStr = cur.toString();
  if (curStr === next) return;

  const curLen = curStr.length;
  const nextLen = next.length;
  const maxPrefix = Math.min(curLen, nextLen);

  let prefix = 0;
  while (prefix < maxPrefix && curStr.charCodeAt(prefix) === next.charCodeAt(prefix)) {
    prefix++;
  }

  // Common suffix, not overlapping the prefix region on either string.
  let suffix = 0;
  const maxSuffix = Math.min(curLen - prefix, nextLen - prefix);
  while (
    suffix < maxSuffix &&
    curStr.charCodeAt(curLen - 1 - suffix) === next.charCodeAt(nextLen - 1 - suffix)
  ) {
    suffix++;
  }

  const delCount = curLen - prefix - suffix; // chars to remove from the middle
  const insStr = next.slice(prefix, nextLen - suffix); // chars to add in the middle

  if (delCount > 0) cur.delete(prefix, delCount);
  if (insStr.length > 0) cur.insert(prefix, insStr);
}

/** Update an existing Y.Map in place to match `record`.  Only fields that
 *  actually changed are written.  Y.Text fields are edited (not replaced) so
 *  concurrent character-level edits still merge. */
function updateYMapFields(
  tableName: TableName,
  m: Y.Map<unknown>,
  record: Record<string, unknown>
): void {
  const ytextFields = Y_TEXT_FIELDS[tableName] ?? [];
  for (const [k, v] of Object.entries(record)) {
    if (v === undefined) continue;
    if (ytextFields.includes(k) && typeof v === 'string') {
      const cur = m.get(k);
      if (cur instanceof Y.Text) {
        applyYTextDiff(cur, v);
      } else {
        const t = new Y.Text();
        if (v.length > 0) t.insert(0, v);
        m.set(k, t);
      }
    } else if (v === null) {
      if (m.get(k) !== null) m.set(k, null);
    } else if (Array.isArray(v)) {
      if (!fieldEquals(m.get(k), v)) m.set(k, (v as unknown[]).slice());
    } else if (isPlainObject(v)) {
      if (!fieldEquals(m.get(k), v)) m.set(k, cloneShallow(v));
    } else {
      if (m.get(k) !== v) m.set(k, v);
    }
  }
  // Remove fields no longer present in the record.
  for (const k of Array.from(m.keys())) {
    if (!(k in record)) m.delete(k);
  }
}

function yMapToRecord(m: Y.Map<unknown> | Record<string, unknown> | unknown): Record<string, unknown> {
  // 防御 (2026-06-02 incident): サーバー側のスクリプト不具合等で YArray に
  // 素オブジェクトが格納されているケースに備える．素オブジェクトなら shallow
  // copy して返し，crash を避ける．
  if (!(m instanceof Y.Map)) {
    if (m && typeof m === 'object' && !Array.isArray(m)) {
      return { ...(m as Record<string, unknown>) };
    }
    return {};
  }
  const r: Record<string, unknown> = {};
  m.forEach((v, k) => {
    if (v instanceof Y.Text) {
      r[k] = v.toString();
    } else if (v instanceof Y.Map) {
      r[k] = yMapToRecord(v as Y.Map<unknown>);
    } else if (v instanceof Y.Array) {
      r[k] = (v.toArray() as unknown[]).map((x) =>
        x instanceof Y.Map ? yMapToRecord(x as Y.Map<unknown>) : x
      );
    } else if (Array.isArray(v)) {
      r[k] = (v as unknown[]).slice();
    } else if (isPlainObject(v)) {
      r[k] = cloneShallow(v);
    } else {
      r[k] = v;
    }
  });
  return r;
}

// #134 防御 (2026-06-10 incident): 壊れた room データ (Y.Array 内に同一 id の
// レコードが複数) をそのまま store に流すと UI 全域で重複表示や MiniSearch crash の
// 引き金になる．hydrate 境界で最初の 1 件だけ残して落とす．根本修復は dedup-room.mjs．
function uniqById(
  records: Record<string, unknown>[],
  table: string
): Record<string, unknown>[] {
  const seen = new Set<string>();
  let dropped = 0;
  const out: Record<string, unknown>[] = [];
  for (const r of records) {
    const id = r.id;
    if (typeof id === 'string') {
      if (seen.has(id)) {
        dropped += 1;
        continue;
      }
      seen.add(id);
    }
    out.push(r);
  }
  if (dropped > 0) {
    console.warn(`[yjsBridge] table=${table}: dropped ${dropped} duplicate-id record(s) on hydrate`);
  }
  return out;
}

export class YjsSyncBridge {
  readonly doc: Y.Doc;
  /** Used as the `origin` for transactions we initiate locally — lets observers
   *  filter out their own changes when they echo back through Y.Doc. */
  readonly localOrigin: symbol;

  constructor(doc?: Y.Doc) {
    this.doc = doc ?? new Y.Doc();
    this.localOrigin = Symbol('yjsBridge-local');
  }

  /** Bulk-load ProjectData into the Y.Doc.  Destructive — replaces existing
   *  table contents.  Used when the user opens a project for the first time. */
  seedFromProjectData(data: ProjectData, metadata?: ProjectMetadata): void {
    Y.transact(
      this.doc,
      () => {
        const tables = this.doc.getMap('tables');
        for (const name of TABLE_NAMES) {
          let arr = tables.get(name) as Y.Array<Y.Map<unknown>> | undefined;
          if (!arr) {
            arr = new Y.Array<Y.Map<unknown>>();
            tables.set(name, arr);
          } else if (arr.length > 0) {
            arr.delete(0, arr.length);
          }
          const records = ((data?.[name] ?? []) as unknown) as Array<Record<string, unknown>>;
          if (records.length === 0) continue;
          arr.push(records.map((r) => recordToYMap(name, r)));
        }
        if (metadata) {
          const m = this.doc.getMap('metadata');
          for (const [k, v] of Object.entries(metadata)) {
            m.set(k, isPlainObject(v) ? cloneShallow(v) : v);
          }
        }
      },
      this.localOrigin
    );
  }

  /** Incrementally reconcile the Y.Doc to match `next` ProjectData.
   *
   *  Unlike seedFromProjectData (which deletes and recreates every record on
   *  each call — pathological for the CRDT because deletions become tombstones
   *  that never shrink), this touches only added / removed / changed records.
   *  This is what local edits must use: a single card touch produces a tiny
   *  delta instead of re-encoding the entire document.
   *
   *  Runs inside one localOrigin transaction so observers ignore the echo. */
  applyDiff(next: ProjectData, metadata?: ProjectMetadata): void {
    this.applyLocal(() => {
      const tables = this.doc.getMap('tables');
      for (const name of TABLE_NAMES) {
        const nextRecords = ((next?.[name] ?? []) as unknown) as Array<Record<string, unknown>>;
        let arr = tables.get(name) as Y.Array<Y.Map<unknown>> | undefined;

        if (!arr) {
          if (nextRecords.length === 0) continue;
          arr = new Y.Array<Y.Map<unknown>>();
          tables.set(name, arr);
          arr.push(nextRecords.map((r) => recordToYMap(name, r)));
          continue;
        }

        // Index current records by id.  First occurrence of each id is the
        // canonical survivor; later duplicates are pruned in the delete pass
        // below (byId identity check).  Id-less entries are garbage (every
        // legit record carries a string id) and are also pruned.
        const byId = new Map<string, Y.Map<unknown>>();
        for (const m of arr) {
          if (m instanceof Y.Map) {
            const id = m.get('id');
            if (typeof id === 'string' && !byId.has(id)) byId.set(id, m);
          }
        }

        // Codex-W4: 無言 drop を可視化するための garbage カウンタ．正当な削除
        // (id が next から消えた) は数えない — あくまで「本来あり得ない不正データ」
        // (id 無し / 重複) を計上し，検出時のみ警告する (schema バグ / 破損の早期検知)．
        let incomingIdless = 0; // 受信側: id を持たないレコード
        let incomingDup = 0; // 受信側: 同一 id の重複
        let prunedNonMap = 0; // 保存側: Y.Map でない要素
        let prunedIdless = 0; // 保存側: id 無しの Y.Map
        let prunedDup = 0; // 保存側: canonical でない重複コピー

        // Upsert each next record (append new, update existing in place).
        const nextIds = new Set<string>();
        for (const rec of nextRecords) {
          const id = rec.id;
          if (typeof id !== 'string') {
            incomingIdless += 1;
            continue; // reject id-less incoming
          }
          if (nextIds.has(id)) {
            incomingDup += 1;
            continue; // first wins among incoming duplicates
          }
          nextIds.add(id);
          const existing = byId.get(id);
          if (existing) {
            updateYMapFields(name, existing, rec);
          } else {
            arr.push([recordToYMap(name, rec)]);
          }
        }

        // Delete pass (back-to-front keeps indices valid).  Removes, in order:
        //   - non-Y.Map / id-less garbage
        //   - records whose id disappeared from `next`
        //   - duplicate copies of an id (anything that isn't the byId survivor)
        for (let i = arr.length - 1; i >= 0; i--) {
          const m = arr.get(i);
          if (!(m instanceof Y.Map)) {
            prunedNonMap += 1;
            arr.delete(i, 1);
            continue;
          }
          const id = m.get('id');
          if (typeof id !== 'string') {
            prunedIdless += 1;
            arr.delete(i, 1);
            continue;
          }
          if (!nextIds.has(id)) {
            arr.delete(i, 1); // 正当な削除 (garbage ではない) — 計上しない
            continue;
          }
          // Prune only true duplicates: an id present in byId whose canonical
          // survivor is a DIFFERENT Y.Map.  Records newly appended during this
          // upsert are absent from byId (snapshotted before the push) and must
          // be kept — guarding on byId.has(id) prevents deleting them.
          if (byId.has(id) && byId.get(id) !== m) {
            prunedDup += 1;
            arr.delete(i, 1); // duplicate of a surviving canonical record
          }
        }

        // Codex-W4: garbage を検出したら 1 テーブル 1 行で警告する．恒常的に出る
        // ようなら受信元 (他クライアント / 永続層) かスキーマに不整合がある合図．
        if (incomingIdless || incomingDup || prunedNonMap || prunedIdless || prunedDup) {
          console.warn(
            `[yjsBridge] applyDiff table=${name}: dropped garbage — ` +
              `incoming(idless=${incomingIdless}, dup=${incomingDup}) ` +
              `stored(nonMap=${prunedNonMap}, idless=${prunedIdless}, dup=${prunedDup})`,
          );
        }
      }

      if (metadata) {
        const m = this.doc.getMap('metadata');
        const nextKeys = new Set(Object.keys(metadata));
        for (const [k, v] of Object.entries(metadata)) {
          const val = isPlainObject(v) ? cloneShallow(v) : v;
          if (!fieldEquals(m.get(k), val)) m.set(k, val);
        }
        // Remove metadata keys no longer present.
        for (const k of Array.from(m.keys())) {
          if (!nextKeys.has(k)) m.delete(k);
        }
      }
    });
  }

  /** Snapshot the Y.Doc as plain ProjectData. */
  toProjectData(): ProjectData {
    const tables = this.doc.getMap('tables');
    const out: Partial<Record<TableName, unknown[]>> = {};
    for (const name of TABLE_NAMES) {
      const arr = tables.get(name) as Y.Array<Y.Map<unknown>> | undefined;
      out[name] = arr
        ? uniqById((arr.toArray() as Y.Map<unknown>[]).map((m) => yMapToRecord(m)), name)
        : [];
    }
    return out as ProjectData;
  }

  /** Snapshot the metadata Y.Map as plain object. */
  toMetadata(): Partial<ProjectMetadata> | null {
    const m = this.doc.getMap('metadata');
    if (m.size === 0) return null;
    const out: Record<string, unknown> = {};
    m.forEach((v, k) => {
      out[k] = isPlainObject(v) ? cloneShallow(v) : v;
    });
    return out as Partial<ProjectMetadata>;
  }

  /** Subscribe to remote-originated changes.  The callback fires after each
   *  transaction whose origin is NOT this bridge's localOrigin.  It receives
   *  the latest ProjectData snapshot AND metadata — wire both into the store.
   *  (Codex-W2: remote metadata 変更も反映させるため metadata を同梱する．) */
  observe(
    onRemoteChange: (data: ProjectData, metadata: Partial<ProjectMetadata> | null) => void
  ): () => void {
    const handler = (transaction: Y.Transaction) => {
      if (transaction.origin === this.localOrigin) return;
      onRemoteChange(this.toProjectData(), this.toMetadata());
    };
    this.doc.on('afterTransaction', handler);
    return () => this.doc.off('afterTransaction', handler);
  }

  /** Run a callback inside a Y.Doc transaction whose origin is this bridge,
   *  so observe()-style listeners can distinguish local from remote changes. */
  applyLocal<T>(fn: () => T): T {
    let result!: T;
    Y.transact(
      this.doc,
      () => {
        result = fn();
      },
      this.localOrigin
    );
    return result;
  }

  // ---- Convenience helpers (small, table-scoped operations) ----

  /** Append a record to a table.  Returns the created Y.Map (callers rarely
   *  need it, but it's useful for tests). */
  appendRecord<K extends TableName>(
    tableName: K,
    record: ProjectData[K] extends Array<infer R> ? R : never
  ): Y.Map<unknown> {
    let created!: Y.Map<unknown>;
    this.applyLocal(() => {
      const tables = this.doc.getMap('tables');
      let arr = tables.get(tableName) as Y.Array<Y.Map<unknown>> | undefined;
      if (!arr) {
        arr = new Y.Array<Y.Map<unknown>>();
        tables.set(tableName, arr);
      }
      created = recordToYMap(tableName, record as Record<string, unknown>);
      arr.push([created]);
    });
    return created;
  }

  findRecordById(tableName: TableName, id: string): Y.Map<unknown> | null {
    const tables = this.doc.getMap('tables');
    const arr = tables.get(tableName) as Y.Array<Y.Map<unknown>> | undefined;
    if (!arr) return null;
    for (const m of arr) {
      if (m instanceof Y.Map && m.get('id') === id) return m;
    }
    return null;
  }

  deleteRecordById(tableName: TableName, id: string): boolean {
    let removed = false;
    this.applyLocal(() => {
      const tables = this.doc.getMap('tables');
      const arr = tables.get(tableName) as Y.Array<Y.Map<unknown>> | undefined;
      if (!arr) return;
      for (let i = 0; i < arr.length; i++) {
        const m = arr.get(i);
        if (m instanceof Y.Map && m.get('id') === id) {
          arr.delete(i, 1);
          removed = true;
          return;
        }
      }
    });
    return removed;
  }
}
