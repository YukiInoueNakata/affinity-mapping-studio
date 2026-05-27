import { useEffect, useMemo, useState } from 'react';
import type { SegmentSplitMode, WordComment } from '@shared/types/ipc';
import type { Participant } from '@shared/types/domain';
import { useProjectStore } from '../stores/projectStore.js';
import { isValidParticipantCode, newId } from '../domain/ids.js';
import { buildCommentSegments, buildSegments, splitTextIntoSegments } from '../domain/segments.js';
import { makeAddParticipantCommand, makeImportSegmentsCommand } from '../stores/commands.js';
import { projectService } from '../services/projectService.js';

interface Props {
  open: boolean;
  onClose(): void;
}

export function ImportTextDialog({ open, onClose }: Props) {
  const project = useProjectStore((s) => s.project);
  const applyCommand = useProjectStore((s) => s.applyCommand);

  const [fileName, setFileName] = useState<string>('');
  const [text, setText] = useState<string>('');
  const [comments, setComments] = useState<WordComment[]>([]);
  const [includeComments, setIncludeComments] = useState<boolean>(true);
  const [mode, setMode] = useState<SegmentSplitMode>('blank-line');
  const [participantId, setParticipantId] = useState<string>('__new__');
  const [newCode, setNewCode] = useState<string>('P01');
  const [newName, setNewName] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setFileName('');
      setText('');
      setComments([]);
      setIncludeComments(true);
      setMode('blank-line');
      setParticipantId('__new__');
      setNewCode(suggestNextCode(project?.data.participants ?? []));
      setNewName('');
      setError(null);
    }
  }, [open, project]);

  const segmentsPreview = useMemo(
    () => (text ? splitTextIntoSegments(text, mode) : []),
    [text, mode]
  );

  async function handleSelectFile() {
    setError(null);
    const r = await projectService.readTextFile();
    if (!r) return;
    setFileName(r.fileName);
    setText(r.text);
    setComments(r.comments ?? []);
    if (r.sourceFormat === 'xlsx' || r.sourceFormat === 'csv') {
      setMode('blank-line');
    }
  }

  function handleConfirm() {
    if (!project) return;
    if (!text) {
      setError('テキストファイルを選択してください');
      return;
    }
    let chosenParticipant: Participant | null = null;
    const now = new Date().toISOString();

    if (participantId === '__new__') {
      const code = newCode.trim();
      const name = newName.trim() || code;
      if (!isValidParticipantCode(code)) {
        setError('参加者コードは英字始まり 1〜10 文字 (英数字) で入力してください');
        return;
      }
      if (project.data.participants.some((p) => p.code === code)) {
        setError(`参加者コード "${code}" は既に存在します`);
        return;
      }
      chosenParticipant = {
        id: newId(),
        code,
        displayName: name,
        createdAt: now,
      };
      applyCommand(makeAddParticipantCommand(chosenParticipant));
    } else {
      chosenParticipant =
        project.data.participants.find((p) => p.id === participantId) ?? null;
      if (!chosenParticipant) {
        setError('参加者を選択してください');
        return;
      }
    }

    const segments = buildSegments(
      chosenParticipant.id,
      fileName,
      text,
      mode,
      now
    );
    if (segments.length === 0 && (!includeComments || comments.length === 0)) {
      setError('セグメントが生成できませんでした (空ファイル？)');
      return;
    }
    const allSegments = [...segments];
    if (includeComments && comments.length > 0) {
      const commentSegments = buildCommentSegments(
        chosenParticipant.id,
        `${fileName} (コメント)`,
        comments,
        now,
        segments.length
      );
      allSegments.push(...commentSegments);
    }
    applyCommand(makeImportSegmentsCommand(allSegments));
    onClose();
  }

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2>テキストを取り込む</h2>
        </header>
        <div className="modal-body">
          <div className="form-row">
            <label>ファイル</label>
            <div className="file-row">
              <button type="button" onClick={handleSelectFile}>
                ファイルを選択...
              </button>
              <span className="file-name">{fileName || '(未選択)'}</span>
            </div>
          </div>

          <div className="form-row">
            <label>参加者</label>
            <select
              value={participantId}
              onChange={(e) => setParticipantId(e.target.value)}
            >
              <option value="__new__">+ 新規参加者を作成</option>
              {project?.data.participants.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.displayName}
                </option>
              ))}
            </select>
          </div>

          {participantId === '__new__' && (
            <>
              <div className="form-row">
                <label>参加者コード</label>
                <input
                  type="text"
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                  placeholder="P01"
                />
              </div>
              <div className="form-row">
                <label>表示名</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="協力者 A"
                />
              </div>
            </>
          )}

          <div className="form-row">
            <label>セグメント区切り</label>
            <div className="radio-row">
              <label>
                <input
                  type="radio"
                  name="mode"
                  value="blank-line"
                  checked={mode === 'blank-line'}
                  onChange={() => setMode('blank-line')}
                />
                空行区切り (推奨)
              </label>
              <label>
                <input
                  type="radio"
                  name="mode"
                  value="line"
                  checked={mode === 'line'}
                  onChange={() => setMode('line')}
                />
                行区切り
              </label>
            </div>
          </div>

          {comments.length > 0 && (
            <div className="form-row">
              <label>Word コメント</label>
              <div>
                <label>
                  <input
                    type="checkbox"
                    checked={includeComments}
                    onChange={(e) => setIncludeComments(e.target.checked)}
                  />
                  {' '}コメントもセグメントとして取り込む ({comments.length} 件)
                </label>
                {includeComments && (
                  <div className="preview" style={{ marginTop: 6 }}>
                    <div className="preview-meta">先頭 3 件プレビュー</div>
                    <ol className="preview-list">
                      {comments.slice(0, 3).map((c) => (
                        <li key={c.id}>
                          {c.author && <strong>[{c.author}] </strong>}
                          {c.text.slice(0, 120)}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="form-row">
            <label>プレビュー</label>
            <div className="preview">
              <div className="preview-meta">
                本文セグメント数: {segmentsPreview.length}
                {includeComments && comments.length > 0 && ` + コメント ${comments.length} 件`}
              </div>
              <ol className="preview-list">
                {segmentsPreview.slice(0, 3).map((t, i) => (
                  <li key={i}>{t.slice(0, 200)}</li>
                ))}
              </ol>
            </div>
          </div>

          {error && <div className="error">{error}</div>}
        </div>
        <footer className="modal-footer">
          <button type="button" onClick={onClose}>
            キャンセル
          </button>
          <button type="button" className="primary" onClick={handleConfirm}>
            取り込む
          </button>
        </footer>
      </div>
    </div>
  );
}

function suggestNextCode(existing: Participant[]): string {
  let n = 1;
  const codes = new Set(existing.map((p) => p.code));
  while (codes.has(`P${String(n).padStart(2, '0')}`)) n++;
  return `P${String(n).padStart(2, '0')}`;
}
