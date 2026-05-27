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

function yMapToRecord(m: Y.Map<unknown>): Record<string, unknown> {
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

  /** Snapshot the Y.Doc as plain ProjectData. */
  toProjectData(): ProjectData {
    const tables = this.doc.getMap('tables');
    const out: Partial<Record<TableName, unknown[]>> = {};
    for (const name of TABLE_NAMES) {
      const arr = tables.get(name) as Y.Array<Y.Map<unknown>> | undefined;
      out[name] = arr
        ? (arr.toArray() as Y.Map<unknown>[]).map((m) => yMapToRecord(m))
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
   *  the latest ProjectData snapshot — wire it into the Zustand store. */
  observe(onRemoteChange: (data: ProjectData) => void): () => void {
    const handler = (transaction: Y.Transaction) => {
      if (transaction.origin === this.localOrigin) return;
      onRemoteChange(this.toProjectData());
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
