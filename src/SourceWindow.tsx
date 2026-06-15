import { useEffect } from 'react';
import { useProjectStore } from './stores/projectStore.js';
import { SourceViewer } from './components/SourceViewer.js';

export function SourceWindow() {
  const project = useProjectStore((s) => s.project);
  const isDirty = useProjectStore((s) => s.isDirty);
  const filePath = useProjectStore((s) => s.filePath);

  useEffect(() => {
    document.title = project
      ? `原文ビューア — ${project.metadata.name}${isDirty ? ' *' : ''}`
      : '原文ビューア (プロジェクト未読込)';
  }, [project, isDirty]);

  if (!project) {
    return (
      <div className="app-root">
        <header className="app-header">
          <div className="app-title">原文ビューア — Affinity Mapping Studio</div>
        </header>
        <main className="app-main">
          <div className="empty-state">
            <p>メイン窓でプロジェクトを開くと、こちらに原文が表示されます。</p>
            <p className="muted small">
              この窓は読み取り専用ではありませんが、編集はメイン窓と同期されます。
            </p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app-root">
      <header className="app-header">
        <div className="app-title">
          原文ビューア — {project.metadata.name}
          {isDirty ? ' *' : ''}
        </div>
        <div className="app-toolbar">
          <span className="save-status muted">
            {filePath ? '同期中（メイン窓に編集を反映）' : '未保存プロジェクト'}
          </span>
        </div>
      </header>
      <main className="app-main">
        <section className="center-pane">
          <SourceViewer />
        </section>
      </main>
    </div>
  );
}
