// Phase 5e: full window.api / window.menuEvents bridge backed by Tauri IPC.
//
// Originally a stub from Phase 5a-2; in Phase 5e the file/project commands
// were wired through to the Rust side (src-tauri/src/{project_io,file_dialog,
// docx,sheet,docx_writer,text_io}.rs) so the renderer copied over from
// kj-trace-studio runs unchanged.

import { type ProjectFile, type Snapshot } from '@shared/types/project.js';
import { backfillProjectData, makeEmptyProject } from '@shared/types/project.js';
import type {
  IpcApi,
  OpenProjectResult,
  SaveProjectResult,
  ReadTextFileResult,
  WordComment,
} from '@shared/types/ipc.js';
import { v4 as uuidv4 } from 'uuid';
import { invoke } from '@tauri-apps/api/core';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

// ---- Rust-side type mirrors ----------------------------------------------

interface DocxAnalysis {
  text: string;
  comments: WordComment[];
}
interface SheetData {
  rows: string[][];
  sheet_name?: string;
}
interface DialogFilter {
  name: string;
  extensions: string[];
}
/** Mirror of `project_io::ProjectPayload`. */
interface ProjectPayload {
  metadata: Record<string, unknown>;
  data: Record<string, unknown>;
  extras?: Record<string, unknown>;
}

const KJPROJ_FILTERS: DialogFilter[] = [
  { name: 'Affinity Mapping Project', extensions: ['kjproj'] },
];

// ---- helpers -------------------------------------------------------------

function basename(path: string): string {
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return idx >= 0 ? path.slice(idx + 1) : path;
}

function extLower(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot >= 0 ? path.slice(dot).toLowerCase() : '';
}

function defaultProjectFileName(project: ProjectFile): string {
  const safe = (project.metadata.name ?? 'project')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim();
  return safe.length > 0 ? `${safe}.kjproj` : 'project.kjproj';
}

// Split a ProjectFile into the Rust ProjectPayload shape (metadata.json +
// data/<table>.json + snapshots/* under extras).
function projectToPayload(project: ProjectFile): ProjectPayload {
  const { data, snapshots, ...rest } = project;
  const metadata = rest as unknown as Record<string, unknown>;
  const dataMap: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    dataMap[k] = v;
  }
  const extras: Record<string, unknown> = {};
  if (snapshots && snapshots.length > 0) {
    extras['snapshots/index.json'] = snapshots.map((s) => ({
      id: s.metadata.id,
      timestamp: s.metadata.timestamp,
      kind: s.metadata.kind,
      label: s.metadata.label,
      comment: s.metadata.comment,
    }));
    for (const s of snapshots) {
      extras[`snapshots/${s.metadata.id}.json`] = s;
    }
  }
  return { metadata, data: dataMap, extras };
}

// Rehydrate a ProjectPayload back into a ProjectFile.
function payloadToProject(payload: ProjectPayload): ProjectFile {
  const meta = payload.metadata as unknown as Omit<ProjectFile, 'data' | 'snapshots'>;
  const snapshots: Snapshot[] = [];
  if (payload.extras) {
    const indexEntry = payload.extras['snapshots/index.json'];
    if (Array.isArray(indexEntry)) {
      for (const item of indexEntry as Array<{ id: string }>) {
        const snap = payload.extras[`snapshots/${item.id}.json`];
        if (snap && typeof snap === 'object') {
          snapshots.push(snap as Snapshot);
        }
      }
    }
  }
  return {
    ...meta,
    // 旧スキーマ (.kjproj に後発テーブルの JSON が無い) は空配列で補完する．
    data: backfillProjectData(payload.data as Partial<ProjectFile['data']>),
    ...(snapshots.length > 0 ? { snapshots } : {}),
  };
}

async function pickKjprojOpen(): Promise<string | null> {
  return invoke<string | null>('pick_open_file', {
    title: 'プロジェクトを開く',
    filters: KJPROJ_FILTERS,
  });
}

async function pickKjprojSave(defaultFileName?: string): Promise<string | null> {
  return invoke<string | null>('pick_save_file', {
    title: 'プロジェクトを保存',
    defaultFileName: defaultFileName ?? null,
    filters: KJPROJ_FILTERS,
  });
}

// ---- IpcApi --------------------------------------------------------------

const api: IpcApi = {
  newProject: async (name: string): Promise<ProjectFile> => {
    const trimmed = name && name.trim().length > 0 ? name : '新規プロジェクト';
    return makeEmptyProject(trimmed, uuidv4(), new Date().toISOString());
  },

  openProject: async (): Promise<OpenProjectResult | null> => {
    const path = await pickKjprojOpen();
    if (!path) return null;
    return api.openProjectByPath(path);
  },

  openProjectByPath: async (filePath: string): Promise<OpenProjectResult | null> => {
    // 2026-07 レビュー A4: 旧実装は読込エラーを null に潰していたため，
    // 壊れた/ロック中のファイルを開いても UI が沈黙していた．throw して
    // 呼び出し側 (App.tsx) で alert する．
    try {
      const payload = await invoke<ProjectPayload>('read_kjproj', { path: filePath });
      return { filePath, project: payloadToProject(payload) };
    } catch (err) {
      console.error('[openProjectByPath]', err);
      throw err instanceof Error ? err : new Error(String(err));
    }
  },

  saveProject: async (
    filePath: string | null,
    project: ProjectFile
  ): Promise<SaveProjectResult | null> => {
    let target = filePath;
    if (!target) {
      target = await pickKjprojSave(defaultProjectFileName(project));
      if (!target) return null;
    }
    const updatedAt = new Date().toISOString();
    const stamped: ProjectFile = {
      ...project,
      metadata: { ...project.metadata, updated_at: updatedAt },
    };
    await invoke('write_kjproj', { path: target, payload: projectToPayload(stamped) });
    return { filePath: target, updatedAt };
  },

  saveProjectAs: async (project: ProjectFile): Promise<SaveProjectResult | null> => {
    const target = await pickKjprojSave(defaultProjectFileName(project));
    if (!target) return null;
    const updatedAt = new Date().toISOString();
    const stamped: ProjectFile = {
      ...project,
      metadata: { ...project.metadata, updated_at: updatedAt },
    };
    await invoke('write_kjproj', { path: target, payload: projectToPayload(stamped) });
    return { filePath: target, updatedAt };
  },

  readTextFile: async (): Promise<ReadTextFileResult | null> => {
    const filePath = await invoke<string | null>('pick_open_file', {
      title: 'テキストファイルを開く',
      filters: [
        {
          name: 'すべての対応形式',
          extensions: ['txt', 'md', 'markdown', 'docx', 'xlsx', 'csv'],
        },
        { name: 'Text', extensions: ['txt', 'md', 'markdown'] },
        { name: 'Word', extensions: ['docx'] },
        { name: 'Excel / CSV', extensions: ['xlsx', 'csv'] },
      ],
    });
    if (!filePath) return null;
    const fileName = basename(filePath);
    const ext = extLower(filePath);

    if (ext === '.docx') {
      const a = await invoke<DocxAnalysis>('analyze_docx', { path: filePath });
      return {
        filePath,
        fileName,
        text: a.text,
        comments: a.comments,
        sourceFormat: 'docx',
      };
    }
    if (ext === '.xlsx') {
      const s = await invoke<SheetData>('parse_xlsx', { path: filePath });
      const text = s.rows.map((r) => r.join('\t')).join('\n');
      return { filePath, fileName, text, rows: s.rows, sourceFormat: 'xlsx' };
    }
    if (ext === '.csv') {
      const s = await invoke<SheetData>('parse_csv', { path: filePath });
      const text = s.rows.map((r) => r.join('\t')).join('\n');
      return { filePath, fileName, text, rows: s.rows, sourceFormat: 'csv' };
    }
    // Plain text / markdown
    const text = await invoke<string>('read_text_file', { path: filePath });
    const fmt: ReadTextFileResult['sourceFormat'] =
      ext === '.md' || ext === '.markdown' ? 'md' : 'txt';
    return { filePath, fileName, text, sourceFormat: fmt };
  },

  openSourceView: async (): Promise<void> => {
    const label = 'source';
    const existing = await WebviewWindow.getByLabel(label);
    if (existing) {
      await existing.show();
      await existing.setFocus();
      return;
    }
    // Tauri 2 dev-server (Vite) doesn't serve "/index.html" — only "/".
    // Use the root path and identify the source view by Tauri window label
    // (see main.tsx).  Hash routing is unreliable across new WebviewWindow.
    const win = new WebviewWindow(label, {
      url: '/',
      title: '原文ビューア — Affinity Mapping Studio',
      width: 900,
      height: 700,
    });
    // Surface creation errors in the console; resolve void either way.
    win.once('tauri://error', (e) => {
      console.error('[openSourceView] WebviewWindow error', e);
    });
  },
};

const menuEvents = {
  onAction(_callback: (action: string) => void): () => void {
    // TODO Phase 5e+: native Tauri menu hookup.  For now no-op (the
    // ribbon-style header in App.tsx provides the same actions, and
    // window.menuEvents is only used for native menu accelerators).
    return () => {};
  },
};

declare global {
  interface Window {
    api: IpcApi;
    menuEvents: typeof menuEvents;
  }
}

window.api = api;
window.menuEvents = menuEvents;
