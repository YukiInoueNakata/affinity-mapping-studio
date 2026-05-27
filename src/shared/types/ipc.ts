import type { ProjectFile } from './project.js';

export type SegmentSplitMode = 'blank-line' | 'line';

export interface OpenProjectResult {
  filePath: string;
  project: ProjectFile;
}

export interface SaveProjectResult {
  filePath: string;
  updatedAt: string;
}

export interface WordComment {
  id: string;
  author?: string;
  /** The text of the comment itself. */
  text: string;
  /** The text in the document that this comment is attached to (between
   *  commentRangeStart and commentRangeEnd). Used to link comments back to
   *  source segments when imported as cards. */
  commentedText?: string;
  /** Full text of the paragraph(s) that the comment range falls inside.
   *  Used as a fallback when commentedText is empty (point comments) or when
   *  the exact range fails to substring-match a segment. */
  paragraphText?: string;
}

export interface ReadTextFileResult {
  filePath: string;
  fileName: string;
  text: string;
  comments?: WordComment[];
  sourceFormat: 'txt' | 'md' | 'docx' | 'xlsx' | 'csv';
  /** Raw rows preserved as string cells for xlsx/csv. Absent for unstructured formats. */
  rows?: string[][];
}

export interface IpcApi {
  newProject(name: string): Promise<ProjectFile>;
  openProject(): Promise<OpenProjectResult | null>;
  openProjectByPath(filePath: string): Promise<OpenProjectResult | null>;
  saveProject(filePath: string | null, project: ProjectFile): Promise<SaveProjectResult | null>;
  saveProjectAs(project: ProjectFile): Promise<SaveProjectResult | null>;
  readTextFile(): Promise<ReadTextFileResult | null>;
  openSourceView(): Promise<void>;
}

declare global {
  interface Window {
    api: IpcApi;
  }
}
