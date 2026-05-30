// 最終図解の右下に表示する「表題 + 註記 + 全体叙述」の編集カード．
// 川喜田 1986/1997 の註記要件 = 作成日 / 場所 / データ出所 / 作成者 (図解の右下に記入)．
// 開閉トグル: 折りたたみ時はサマリのみ，展開時はインライン編集フォーム．
// 編集は 500ms debounce で各フィールド個別の DomainCommand に commit．

import { useEffect, useMemo, useRef, useState } from 'react';
import { useProjectStore } from '../stores/projectStore.js';
import { getFinalDiagram } from '../domain/finalDiagram.js';
import {
  makeSetFinalAnnotationCommand,
  makeSetFinalOverallNarrativeCommand,
  makeSetFinalTitleCommand,
} from '../stores/commands.js';
import type { FinalDiagramAnnotation } from '@shared/types/domain';

interface DraftState {
  title: string;
  date: string;
  place: string;
  source: string;
  authors: string;
  overall: string;
}

function buildDraft(
  title: string | undefined,
  ann: FinalDiagramAnnotation | undefined,
  overall: string | undefined
): DraftState {
  return {
    title: title ?? '',
    date: ann?.date ?? '',
    place: ann?.place ?? '',
    source: ann?.source ?? '',
    authors: ann?.authors ?? '',
    overall: overall ?? '',
  };
}

export function KJFinalAnnotationCard() {
  const project = useProjectStore((s) => s.project);
  const applyCommand = useProjectStore((s) => s.applyCommand);
  const [open, setOpen] = useState(false);

  const fd = useMemo(() => getFinalDiagram(project?.data ?? null), [project?.data]);

  const [draft, setDraft] = useState<DraftState>(() =>
    buildDraft(fd.title, fd.annotation, fd.overallNarrative)
  );
  // saved snapshot to compute diff for commands
  const savedRef = useRef<DraftState>(draft);

  // project が外部 (undo/redo, sync) で変わったら再ロード．
  useEffect(() => {
    const next = buildDraft(fd.title, fd.annotation, fd.overallNarrative);
    setDraft(next);
    savedRef.current = next;
  }, [fd]);

  // 各フィールドを debounce で保存．フィールドごとに別 useEffect．
  useDebouncedCommit(draft.title, savedRef.current.title, 500, (prev, next) => {
    applyCommand(
      makeSetFinalTitleCommand(prev === '' ? undefined : prev, next === '' ? undefined : next)
    );
    savedRef.current = { ...savedRef.current, title: next };
  });

  // annotation は 4 フィールドまとめて 1 つの command．いずれかが変わったら commit．
  const annoChanged =
    draft.date !== savedRef.current.date ||
    draft.place !== savedRef.current.place ||
    draft.source !== savedRef.current.source ||
    draft.authors !== savedRef.current.authors;
  useDebouncedCommit(
    annoChanged ? '1' : '0',
    '0',
    500,
    () => {
      const prevAnn = annotationOrUndefined(savedRef.current);
      const nextAnn = annotationOrUndefined(draft);
      applyCommand(makeSetFinalAnnotationCommand(prevAnn, nextAnn));
      savedRef.current = { ...savedRef.current, ...draft };
    }
  );

  useDebouncedCommit(draft.overall, savedRef.current.overall, 500, (prev, next) => {
    applyCommand(
      makeSetFinalOverallNarrativeCommand(
        prev === '' ? undefined : prev,
        next === '' ? undefined : next
      )
    );
    savedRef.current = { ...savedRef.current, overall: next };
  });

  if (!project) return null;

  return (
    <div className={`kj-final-anno ${open ? 'open' : 'closed'}`}>
      {!open ? (
        <button
          type="button"
          className="kj-final-anno-collapsed"
          onClick={() => setOpen(true)}
          title="表題・註記・叙述を編集"
        >
          <div className="kj-final-anno-title-line">
            {draft.title || '(表題未設定)'}
          </div>
          <div className="muted small">
            {draft.date ? `${draft.date} ` : ''}
            {draft.authors ? `／ ${draft.authors}` : ''}
            <span className="kj-final-anno-edit-hint">  ✎ 編集</span>
          </div>
        </button>
      ) : (
        <div className="kj-final-anno-open">
          <header className="kj-final-anno-head">
            <span className="kj-final-anno-head-title">表題・註記・叙述</span>
            <button
              type="button"
              className="kj-final-anno-close"
              onClick={() => setOpen(false)}
              title="閉じる"
            >
              ×
            </button>
          </header>
          <label className="kj-final-anno-row">
            <span>表題</span>
            <input
              type="text"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="図解の表題"
            />
          </label>
          <div className="kj-final-anno-row-group">
            <div className="muted small">註記 (川喜田 1986/1997: 図解の右下に記入)</div>
            <label className="kj-final-anno-row">
              <span>作成日</span>
              <input
                type="text"
                value={draft.date}
                onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                placeholder="YYYY-MM-DD など"
              />
            </label>
            <label className="kj-final-anno-row">
              <span>場所</span>
              <input
                type="text"
                value={draft.place}
                onChange={(e) => setDraft({ ...draft, place: e.target.value })}
                placeholder="作業した場所"
              />
            </label>
            <label className="kj-final-anno-row">
              <span>出所</span>
              <input
                type="text"
                value={draft.source}
                onChange={(e) => setDraft({ ...draft, source: e.target.value })}
                placeholder="データの出所 (例: インタビュー N=12)"
              />
            </label>
            <label className="kj-final-anno-row">
              <span>作成者</span>
              <input
                type="text"
                value={draft.authors}
                onChange={(e) => setDraft({ ...draft, authors: e.target.value })}
                placeholder="作成者 (複数なら , 区切り)"
              />
            </label>
          </div>
          <label className="kj-final-anno-row column">
            <span>全体叙述 (B 型: 図解全体の総括)</span>
            <textarea
              value={draft.overall}
              onChange={(e) => setDraft({ ...draft, overall: e.target.value })}
              rows={5}
              placeholder="この図解全体を言葉でまとめる．"
            />
          </label>
        </div>
      )}
    </div>
  );
}

function annotationOrUndefined(d: DraftState): FinalDiagramAnnotation | undefined {
  const ann: FinalDiagramAnnotation = {};
  if (d.date) ann.date = d.date;
  if (d.place) ann.place = d.place;
  if (d.source) ann.source = d.source;
  if (d.authors) ann.authors = d.authors;
  return Object.keys(ann).length > 0 ? ann : undefined;
}

/** 1 フィールドの debounced commit ヘルパ．next が saved と異なれば delay ms 後に effect 実行． */
function useDebouncedCommit(
  next: string,
  saved: string,
  delayMs: number,
  effect: (prev: string, next: string) => void
) {
  useEffect(() => {
    if (next === saved) return;
    const t = window.setTimeout(() => effect(saved, next), delayMs);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [next, saved, delayMs]);
}
