import { useEffect, useState } from 'react';
import type { MGtaSettings } from '@shared/types/domain';

interface Props {
  open: boolean;
  initial: MGtaSettings | null;
  onClose(): void;
  onSubmit(input: {
    analysisTheme: string;
    focalPerson: string;
    researchQuestion?: string;
    notes?: string;
  }): void;
}

export function MGtaSettingsDialog({ open, initial, onClose, onSubmit }: Props) {
  const [theme, setTheme] = useState('');
  const [focal, setFocal] = useState('');
  const [rq, setRq] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTheme(initial?.analysisTheme ?? '');
    setFocal(initial?.focalPerson ?? '');
    setRq(initial?.researchQuestion ?? '');
    setNotes(initial?.notes ?? '');
    setError(null);
  }, [open, initial]);

  if (!open) return null;

  const handleSubmit = () => {
    if (!theme.trim()) {
      setError('分析テーマは必須です');
      return;
    }
    if (!focal.trim()) {
      setError('分析焦点者は必須です');
      return;
    }
    onSubmit({
      analysisTheme: theme,
      focalPerson: focal,
      researchQuestion: rq.trim() || undefined,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2>M-GTA 設定</h2>
        </header>
        <div className="modal-body">
          <p className="muted small">
            M-GTA では「分析テーマ」と「分析焦点者」を明示することが重要です．未設定だと概念や図解の意味が定まりません．
          </p>
          <div className="form-row">
            <label>分析テーマ *</label>
            <input
              type="text"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              placeholder="例：思春期の親子関係における自律性の発達過程"
              autoFocus
            />
          </div>
          <div className="form-row">
            <label>分析焦点者 *</label>
            <input
              type="text"
              value={focal}
              onChange={(e) => setFocal(e.target.value)}
              placeholder="例：中学生（13-15 歳）の本人視点"
            />
          </div>
          <div className="form-row">
            <label>研究問題（任意）</label>
            <textarea
              value={rq}
              onChange={(e) => setRq(e.target.value)}
              rows={2}
              placeholder="例：自律性はいかに獲得されるか"
            />
          </div>
          <div className="form-row">
            <label>備考（任意）</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>
          {error && <div className="error">{error}</div>}
        </div>
        <footer className="modal-footer">
          <button type="button" onClick={onClose}>キャンセル</button>
          <button type="button" className="primary" onClick={handleSubmit}>
            {initial ? '更新' : '作成'}
          </button>
        </footer>
      </div>
    </div>
  );
}
