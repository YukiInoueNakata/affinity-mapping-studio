import { useEffect, useMemo, useRef, useState } from 'react';
import type { Card } from '@shared/types/domain';

interface Props {
  open: boolean;
  card: Card | null;
  onClose(): void;
  onConfirm(parts: string[]): void;
}

// A "separator line" = a line that contains only 3+ hyphens (with optional whitespace).
const SEPARATOR_LINE_RE = /^\s*-{3,}\s*$/;
const SEPARATOR_RE = /\n\s*-{3,}\s*\n/;

type NoticeKind = 'info' | 'success' | 'warn';

// Strip lines that consist only of `---` so that quick-split strategies see
// the user's *content* (not the separators we've inserted before).
function stripSeparatorLines(text: string): string {
  return text
    .split('\n')
    .filter((line) => !SEPARATOR_LINE_RE.test(line))
    .join('\n');
}

export function CardSplitDialog({ open, card, onClose, onConfirm }: Props) {
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<{ kind: NoticeKind; msg: string } | null>(
    null
  );
  const [caret, setCaret] = useState<number>(0);
  const [focused, setFocused] = useState<boolean>(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!card || !open) return;
    setDraft(card.body);
    setNotice(null);
    setCaret(0);
  }, [card, open]);

  const caretInfo = useMemo(() => {
    const text = draft.slice(0, caret);
    const lines = text.split('\n');
    return { line: lines.length, col: lines[lines.length - 1].length + 1 };
  }, [draft, caret]);

  const updateCaret = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    setCaret(ta.selectionStart ?? 0);
  };

  // The body the strategies will operate on = the current textarea
  // with our `---` separator lines stripped out. This way edits the user
  // makes to the textarea (adding newlines, blank lines, sentences) are
  // immediately reflected in the counts and in the click behavior.
  const workingText = useMemo(() => stripSeparatorLines(draft), [draft]);

  const parts = useMemo(() => {
    return draft.split(SEPARATOR_RE).map((p) => p.trim()).filter((p) => p.length > 0);
  }, [draft]);

  const paragraphCount = useMemo(() => {
    return workingText
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0).length;
  }, [workingText]);
  const lineCount = useMemo(() => {
    return workingText
      .split(/\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0).length;
  }, [workingText]);
  const sentenceCount = useMemo(() => {
    return workingText
      .split(/(?<=[。．！？!?])\s*|(?<=\.)\s+/u)
      .map((p) => p.trim())
      .filter((p) => p.length > 0).length;
  }, [workingText]);

  if (!open || !card) return null;

  const applySegments = (segments: string[], strategyLabel: string) => {
    const trimmed = segments.map((s) => s.trim()).filter((s) => s.length > 0);
    if (trimmed.length < 2) {
      setNotice({
        kind: 'warn',
        msg: `${strategyLabel}: この方法では ${trimmed.length} 個までにしか分けられません．textarea で目印 (空行・改行・句点) を入れてから押すか，別の戦略を試してください．`,
      });
      return;
    }
    setDraft(trimmed.join('\n\n---\n\n'));
    setNotice({
      kind: 'success',
      msg: `${strategyLabel}: ${trimmed.length} 個に区切りました`,
    });
  };

  const handleByParagraph = () =>
    applySegments(workingText.split(/\n\s*\n/), '段落 (空行) 区切り');
  const handleByLine = () =>
    applySegments(workingText.split(/\n/), '改行ごと');
  const handleBySentence = () =>
    applySegments(
      workingText.split(/(?<=[。．！？!?])\s*|(?<=\.)\s+/u),
      '文 (句点) ごと'
    );

  const handleInsertAtCursor = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    const s = ta.selectionStart ?? caret;
    const e = ta.selectionEnd ?? caret;
    const before = draft.slice(0, s);
    const after = draft.slice(e);
    const needPrefix = before.length > 0 && !before.endsWith('\n');
    const needSuffix = after.length > 0 && !after.startsWith('\n');
    const insert = (needPrefix ? '\n' : '') + '---' + (needSuffix ? '\n' : '');
    const next = before + insert + after;
    setDraft(next);
    setNotice({ kind: 'info', msg: 'カーソル位置に区切りを挿入しました' });
    requestAnimationFrame(() => {
      const pos = (before + insert).length;
      ta.focus();
      ta.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  };

  const handleReset = () => {
    setDraft(card.body);
    setNotice({ kind: 'info', msg: '元の本文に戻しました' });
  };

  const helpText =
    parts.length >= 2
      ? `${parts.length} 枚に分割されます`
      : '区切り行 (---) がまだないため 1 枚のままです．上のクイック分割または「ここに区切り挿入」を試してください．';

  const noticeStyle =
    notice?.kind === 'warn'
      ? {
          background: 'rgba(255, 200, 80, 0.15)',
          border: '1px solid rgba(255, 200, 80, 0.5)',
        }
      : notice?.kind === 'success'
        ? {
            background: 'rgba(120, 220, 140, 0.12)',
            border: '1px solid rgba(120, 220, 140, 0.45)',
          }
        : {
            background: 'rgba(78, 161, 255, 0.08)',
            border: '1px solid rgba(78, 161, 255, 0.3)',
          };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 760 }}>
        <header className="modal-header">
          <h2>
            カードを分割: {card.code} → {parts.length} 枚
          </h2>
        </header>
        <div className="modal-body">
          <p className="muted small">
            分割するには，本文の中に「区切り行」(<code>---</code> を行頭に置いた行) を入れます．
            下のボタンで自動挿入もできます．
          </p>
          <p className="muted small" style={{ marginTop: -6 }}>
            <strong>段落</strong> = 空行 (連続する改行 2 つ以上) で区切られたまとまり ／{' '}
            <strong>改行ごと</strong> = 単一の改行で区切られた各行 ／{' '}
            <strong>文</strong> = 句点 (。．．. ！？!?) で区切られた各文．
            textarea を編集すると下のカウントが即時更新されます．
          </p>

          <div className="form-row">
            <label>クイック分割</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              <button
                type="button"
                onClick={handleByParagraph}
                title={
                  paragraphCount < 2
                    ? '空行 (連続改行 2 つ以上) が見当たりません．textarea で Enter を 2 回連続で入れると空行になります．'
                    : `空行で ${paragraphCount} 段落に分けます`
                }
              >
                段落ごと ({paragraphCount})
              </button>
              <button
                type="button"
                onClick={handleByLine}
                title={
                  lineCount < 2
                    ? '改行が見当たりません．textarea で Enter を押すと改行が入ります．'
                    : `${lineCount} 行に分けます`
                }
              >
                改行ごと ({lineCount})
              </button>
              <button
                type="button"
                onClick={handleBySentence}
                title={
                  sentenceCount < 2
                    ? '句点 (。.) が見当たりません'
                    : `句点で ${sentenceCount} 文に分けます`
                }
              >
                文ごと ({sentenceCount})
              </button>
              <button
                type="button"
                // Keep the textarea focused so ta.selectionStart survives the
                // click (WKWebView/Safari collapses the selection on blur).
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleInsertAtCursor}
                title={
                  focused
                    ? `textarea のカーソル位置 (行 ${caretInfo.line}, 列 ${caretInfo.col}) に区切り行を挿入`
                    : 'textarea をクリックして挿入したい場所にカーソルを置いてから押してください'
                }
              >
                ここに区切り挿入
                {focused
                  ? ` (行 ${caretInfo.line}・列 ${caretInfo.col})`
                  : ' (※先に textarea をクリック)'}
              </button>
              <button
                type="button"
                onClick={handleReset}
                title="textarea を元の本文に戻す (挿入した --- を全部消す)"
              >
                元に戻す
              </button>
            </div>
          </div>

          {notice && (
            <div
              className="small"
              style={{
                ...noticeStyle,
                borderRadius: 3,
                padding: '6px 10px',
                color: 'var(--text)',
              }}
            >
              {notice.msg}
            </div>
          )}

          <label className="block-label">
            本文（<code>---</code> を行頭に置くと区切りになります）
          </label>
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              updateCaret();
            }}
            onSelect={updateCaret}
            onClick={updateCaret}
            onKeyUp={updateCaret}
            onFocus={() => {
              setFocused(true);
              updateCaret();
            }}
            onBlur={() => setFocused(false)}
            rows={14}
            className={`card-split-textarea ${focused ? 'focused' : ''}`}
            style={{ fontFamily: 'inherit', lineHeight: 1.5 }}
          />
          <div className="muted small" style={{ marginTop: -4 }}>
            {focused
              ? `カーソル位置: 行 ${caretInfo.line}, 列 ${caretInfo.col}`
              : '※ 上の textarea をクリックすると, カーソル位置が表示されます'}
          </div>

          <div className="preview">
            <div className="preview-meta">プレビュー：{helpText}</div>
            {parts.length >= 2 ? (
              <ol className="preview-list">
                {parts.map((p, i) => (
                  <li key={i}>
                    <strong className="muted small">カード {i + 1}：</strong>
                    {p.slice(0, 200)}
                    {p.length > 200 && '…'}
                  </li>
                ))}
              </ol>
            ) : (
              <div className="muted small" style={{ padding: 4 }}>
                {parts.length === 1 ? '区切りなし — 1 つの塊のまま' : '本文が空です'}
              </div>
            )}
          </div>

          <p className="muted small">
            分割後の各カードには，元カードの<strong>原文リンクが全て複製</strong>されます（参照を残すため）．
            不要な参照は分割後に各カードから手動で外してください．グループ所属も継承．
          </p>
        </div>
        <footer className="modal-footer">
          <button type="button" onClick={onClose}>キャンセル</button>
          <button
            type="button"
            className="primary"
            disabled={parts.length < 2}
            onClick={() => onConfirm(parts)}
            title={
              parts.length < 2
                ? '本文に区切り (---) を入れてください'
                : `${parts.length} 枚のカードに分割`
            }
          >
            分割 ({parts.length} 枚に)
          </button>
        </footer>
      </div>
    </div>
  );
}
