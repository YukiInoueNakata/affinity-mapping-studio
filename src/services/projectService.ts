import type { ProjectFile } from '@shared/types/project';
import type {
  OpenProjectResult,
  SaveProjectResult,
  ReadTextFileResult,
} from '@shared/types/ipc';

export const projectService = {
  newProject(name: string): Promise<ProjectFile> {
    return window.api.newProject(name);
  },
  openProject(): Promise<OpenProjectResult | null> {
    return window.api.openProject();
  },
  openProjectByPath(filePath: string): Promise<OpenProjectResult | null> {
    return window.api.openProjectByPath(filePath);
  },
  saveProject(
    filePath: string | null,
    project: ProjectFile
  ): Promise<SaveProjectResult | null> {
    return window.api.saveProject(filePath, project);
  },
  saveProjectAs(project: ProjectFile): Promise<SaveProjectResult | null> {
    return window.api.saveProjectAs(project);
  },
  readTextFile(): Promise<ReadTextFileResult | null> {
    return window.api.readTextFile();
  },
};
