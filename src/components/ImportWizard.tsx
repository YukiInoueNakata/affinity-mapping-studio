import { useEffect, useMemo, useState } from 'react';
import type { Participant } from '@shared/types/domain';
import type { ReadTextFileResult } from '@shared/types/ipc';
import { useProjectStore } from '../stores/projectStore.js';
import { formatCardCode, isValidParticipantCode, newId } from '../domain/ids.js';
import { nextCardSerial } from '../domain/cards.js';
import {
  applyColumnFilter,
  applySpeakerPrefixes,
  buildCommentsAsCards,
  buildCommentsAsSegments,
  buildImport,
  findSegmentForComment,
  guessPattern,
  parseFixedWidthText,
  splitBySentenceDelimiters,
  validatePlan,
  type ColumnFilter,
  type ColumnRole,
  type ColumnSpec,
  type CommentAuthorHandling,
  type CommentMode,
  type ImportPattern,
  type ImportPlan,
  type InterviewImportPlan,
  type SpeakerPrefixOptions,
  type SurveyImportPlan,
} from '../domain/importPlan.js';
import { splitTextIntoSegments } from '../domain/segments.js';
import { makeBulkImportCommand } from '../stores/commands.js';
import { projectService } from '../services/projectService.js';

interface Props {
  open: boolean;
  onClose(): void;
}

type StepId = 'file' | 'parse' | 'pattern' | 'columns' | 'comments' | 'confirm';

// Step order is built dynamically per file kind:
//  - Tabular (xlsx/csv): file → columns → pattern → comments? → confirm
//    (parse step skipped — column structure is already known)
//  - Text (txt/md/docx): file → parse → columns → pattern → comments? → confirm
// "columns" appearing early for tabular lets users prune to just the columns
// they care about before any heavier downstream calculation runs.
function buildSteps(opts: {
  isTabular: boolean;
  hasComments: boolean;
}): Array<{ id: StepId; label: string }> {
  const labels: Record<StepId, string> = {
    file: 'ファイル選択',
    parse: '区切り方法',
    pattern: 'パターン判定',
    columns: '列マッピング',
    comments: 'コメント取り込み',
    confirm: '確認・取り込み',
  };
  const order: StepId[] = opts.isTabular
    ? ['file', 'columns', 'pattern', 'confirm']
    : ['file', 'parse', 'columns', 'pattern', 'confirm'];
  if (opts.hasComments) {
    // Insert the comments step right before the confirm step
    const confirmIdx = order.indexOf('confirm');
    order.splice(confirmIdx, 0, 'comments');
  }
  return order.map((id, i) => ({ id, label: `${i + 1}. ${labels[id]}` }));
}

type ParseMode = 'tabular' | 'blank-line' | 'line' | 'sentence' | 'fixed-width';

const ROLE_LABELS: Record<ColumnRole, string> = {
  ignore: '無視',
  body: '本文',
  speaker: '話者',
  participant_code: '参加者コード',
  participant_name: '参加者名',
  custom: 'カスタム',
  auto_card: '自動カード化',
};

export function ImportWizard({ open, onClose }: Props) {
  const project = useProjectStore((s) => s.project);
  const applyCommand = useProjectStore((s) => s.applyCommand);

  const [stepIdx, setStepIdx] = useState(0);
  const [file, setFile] = useState<ReadTextFileResult | null>(null);
  // 2026-06-02: 区切り方法の既定を「行で区切り」に．インタビュー文字起こしで
  // 1 行 1 セグメントの形が最も使いやすいとの要望．
  const [parseMode, setParseMode] = useState<ParseMode>('line');
  const [fixedBreaks, setFixedBreaks] = useState<string>('10,20');
  const [sentenceDelims, setSentenceDelims] = useState<string>('。．');
  const [pattern, setPattern] = useState<ImportPattern>('interview');
  const [participantId, setParticipantId] = useState<string>('__new__');
  const [newCode, setNewCode] = useState<string>('P01');
  const [newName, setNewName] = useState<string>('');
  const [columns, setColumns] = useState<ColumnSpec[]>([]);
  // Header / data-start row indices (0-based).  Header may be null (none).
  // For Qualtrics-style CSVs with metadata rows between header and data, the
  // user sets headerRowIdx=0 and dataStartIdx>=2.
  const [headerRowIdx, setHeaderRowIdx] = useState<number | null>(0);
  const [dataStartIdx, setDataStartIdx] = useState<number>(1);
  const [commentMode, setCommentMode] = useState<CommentMode>('cards');
  const [commentAuthor, setCommentAuthor] = useState<CommentAuthorHandling>('tag');
  const [authorRemap, setAuthorRemap] = useState<Record<string, string>>({});
  // Survey-only: if true, every imported segment is automatically turned into
  // a card whose body is the full segment text.  Defaults to true because
  // questionnaire free-text answers usually become cards 1:1.
  const [surveyAutoCardEachRow, setSurveyAutoCardEachRow] = useState<boolean>(true);
  // 発言者プレフィクス（フリーテキスト用）．既定: 半角・全角コロン + 末尾空白許容．
  const [speakerPrefixesText, setSpeakerPrefixesText] = useState<string>('');
  const [speakerPunctColon, setSpeakerPunctColon] = useState<boolean>(true);
  const [speakerPunctColonFW, setSpeakerPunctColonFW] = useState<boolean>(true);
  const [speakerPunctComma, setSpeakerPunctComma] = useState<boolean>(false);
  const [speakerPunctCommaFW, setSpeakerPunctCommaFW] = useState<boolean>(false);
  const [speakerAllowSpace, setSpeakerAllowSpace] = useState<boolean>(true);
  // 2026-06-02: 区切り文字も空白も無いケース（例「面接者では…」）でも抽出．既定 ON．
  const [speakerNoSeparator, setSpeakerNoSeparator] = useState<boolean>(true);
  const [speakerContinue, setSpeakerContinue] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const STEPS = useMemo(
    () =>
      buildSteps({
        isTabular: !!(file?.rows && file.rows.length > 0),
        hasComments: (file?.comments?.length ?? 0) > 0,
      }),
    [file]
  );

  // Reset everything when the dialog opens (not when project changes while open).
  // v0.2.14 Fix-1: depending on `project` caused every sync transaction or local
  // mutation to re-reset the wizard mid-input (e.g. speaker prefix chips), kicking
  // the user back to the file-selection step. project is read via closure to get
  // the latest snapshot at the moment of opening.
  useEffect(() => {
    if (open) {
      setStepIdx(0);
      setFile(null);
      setParseMode('line');
      setFixedBreaks('10,20');
      setSentenceDelims('。．');
      setPattern('interview');
      setParticipantId('__new__');
      setNewCode(suggestNextCode(project?.data.participants ?? []));
      setNewName('');
      setColumns([]);
      setHeaderRowIdx(0);
      setDataStartIdx(1);
      setCommentMode('cards');
      setCommentAuthor('tag');
      setAuthorRemap({});
      setSurveyAutoCardEachRow(true);
      setSpeakerPrefixesText('');
      setSpeakerPunctColon(true);
      setSpeakerPunctColonFW(true);
      setSpeakerPunctComma(false);
      setSpeakerPunctCommaFW(false);
      setSpeakerAllowSpace(true);
      setSpeakerNoSeparator(true);
      setSpeakerContinue(true);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /** 発言者プレフィクス検出に使うオプション．プレフィクスが 1 つも未入力なら無効． */
  const speakerOpts: SpeakerPrefixOptions | null = useMemo(() => {
    const list = speakerPrefixesText
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (list.length === 0) return null;
    const puncts: string[] = [];
    if (speakerPunctColon) puncts.push(':');
    if (speakerPunctColonFW) puncts.push('：');
    if (speakerPunctComma) puncts.push(',');
    if (speakerPunctCommaFW) puncts.push('，');
    return {
      prefixes: list,
      punctuations: puncts,
      allowSpace: speakerAllowSpace,
      allowNoSeparator: speakerNoSeparator,
      continueOnUnmatched: speakerContinue,
    };
  }, [
    speakerPrefixesText,
    speakerPunctColon,
    speakerPunctColonFW,
    speakerPunctComma,
    speakerPunctCommaFW,
    speakerAllowSpace,
    speakerNoSeparator,
    speakerContinue,
  ]);

  /** Parsed row preview based on the chosen parse mode. */
  const rows: string[][] = useMemo(() => {
    if (!file) return [];
    let base: string[][];
    if (file.rows && file.rows.length > 0) {
      // xlsx/csv: use structured rows directly when in 'tabular' mode; otherwise reflatten
      if (parseMode === 'tabular') return file.rows;
      const lines = file.rows.map((r) => r.join('\t')).filter((l) => l.length > 0);
      base = wrapLines(lines, parseMode, fixedBreaks, sentenceDelims);
    } else {
      base = wrapLines(splitToLines(file.text), parseMode, fixedBreaks, sentenceDelims);
    }
    // 非 tabular 経路でのみ発言者プレフィクスを適用（[speaker, body] の 2 列化）
    if (speakerOpts && parseMode !== 'tabular') {
      return applySpeakerPrefixes(base, speakerOpts);
    }
    return base;
  }, [file, parseMode, fixedBreaks, sentenceDelims, speakerOpts]);

  // Initialise column spec when rows change and we land on the columns step
  useEffect(() => {
    if (rows.length === 0) {
      setColumns([]);
      return;
    }
    const headerRow = headerRowIdx !== null ? rows[headerRowIdx] ?? null : null;
    // Reduce-based max avoids spread (no stack overhead on very wide rows)
    let ncols = 0;
    for (const r of rows) if (r.length > ncols) ncols = r.length;
    setColumns((prev) => {
      // If the column count matches, preserve prior choices
      if (prev.length === ncols && prev.every((c) => c.index < ncols)) return prev;
      // Build a fresh column list
      const defaults: ColumnSpec[] = [];
      for (let i = 0; i < ncols; i++) {
        const label = headerRow?.[i]?.trim() || `列 ${i + 1}`;
        defaults.push({ index: i, role: 'ignore', label });
      }
      // Auto-mark the longest column as body, optional speaker/code detection
      const dataStart = Math.max(0, dataStartIdx);
      const colLengths = new Array<number>(ncols).fill(0);
      for (let r = dataStart; r < rows.length; r++) {
        const row = rows[r];
        for (let i = 0; i < ncols; i++) {
          colLengths[i] += row[i]?.length ?? 0;
        }
      }
      let bodyIdx = -1;
      let bodyMax = -1;
      for (let i = 0; i < colLengths.length; i++) {
        if (colLengths[i] > bodyMax) {
          bodyMax = colLengths[i];
          bodyIdx = i;
        }
      }
      if (bodyIdx >= 0) defaults[bodyIdx].role = 'body';
      // Speaker heuristic: short distinct values < 10 (only for interview)
      for (let i = 0; i < ncols; i++) {
        if (i === bodyIdx) continue;
        const vals = rows.slice(Math.max(0, dataStartIdx)).map((r) => r[i] ?? '');
        const distinct = new Set(vals.filter((v) => v.length > 0));
        const avgLen = vals.reduce((s, v) => s + v.length, 0) / Math.max(vals.length, 1);
        if (avgLen <= 8 && distinct.size <= 5 && distinct.size >= 2) {
          defaults[i].role = 'speaker';
          break;
        }
      }
      return defaults;
    });
  }, [rows, headerRowIdx, dataStartIdx]);

  // Pattern guess once when rows are first computed
  useEffect(() => {
    if (rows.length > 0) {
      setPattern(guessPattern(rows));
    }
  }, [rows]);

  async function handleSelectFile() {
    setError(null);
    const r = await projectService.readTextFile();
    if (!r) return;
    setFile(r);
    if (r.rows && r.rows.length > 0) {
      setParseMode('tabular');
    } else {
      // 2026-06-02: テキスト系のデフォルトを「行で区切り」に
      setParseMode('line');
    }
    // Reset wizard navigation so STEPS-array shape changes don't put us
    // on a now-missing step (e.g. switching from txt to xlsx removes parse)
    setStepIdx(0);
  }

  function setColumnRole(idx: number, role: ColumnRole) {
    setColumns((prev) =>
      prev.map((c, i) => {
        if (i !== idx) {
          // Enforce single-occurrence roles
          if (
            (role === 'body' && c.role === 'body') ||
            (role === 'speaker' && c.role === 'speaker') ||
            (role === 'participant_code' && c.role === 'participant_code') ||
            (role === 'participant_name' && c.role === 'participant_name')
          ) {
            return { ...c, role: 'ignore' };
          }
          return c;
        }
        return { ...c, role };
      })
    );
  }

  function setColumnLabel(idx: number, label: string) {
    setColumns((prev) => prev.map((c, i) => (i === idx ? { ...c, label } : c)));
  }

  function setColumnFilter(idx: number, filter: ColumnFilter | undefined) {
    setColumns((prev) =>
      prev.map((c, i) => (i === idx ? { ...c, filter } : c))
    );
  }

  // Roles that allow multiple columns
  // (body, custom, auto_card) — others are mutually exclusive (enforced above)

  function buildPlan(): ImportPlan | null {
    if (!file) return null;
    const fileName = file.fileName;
    if (pattern === 'interview') {
      let pid = participantId;
      if (pid === '__new__') {
        // Defer participant creation to handleConfirm — placeholder id
        pid = `__pending__${newCode}`;
      }
      const plan: InterviewImportPlan = {
        pattern: 'interview',
        participantId: pid,
        fileName,
        headerRowIndex: headerRowIdx,
        dataStartRowIndex: dataStartIdx,
        columns,
      };
      return plan;
    }
    const plan: SurveyImportPlan = {
      pattern: 'survey',
      fileName,
      headerRowIndex: headerRowIdx,
      dataStartRowIndex: dataStartIdx,
      columns,
      defaultDisplayNameTemplate: '回答者 {code}',
    };
    return plan;
  }

  const previewPlan = buildPlan();
  const planErrors = previewPlan ? validatePlan(previewPlan) : ['ファイルが選択されていません'];

  // Dry-run preview against current data
  const onConfirmStep = STEPS[stepIdx]?.id === 'confirm';

  // Heavy dry-run only when the user is actually viewing the confirm step.
  // (Previously it ran every time `rows` or `previewPlan` changed, which on a
  // 56-col / 649-row Qualtrics CSV caused noticeable freezes.)
  const buildPreview = useMemo(() => {
    if (!onConfirmStep) return null;
    if (!project || !previewPlan || planErrors.length > 0 || rows.length === 0) return null;
    try {
      const now = new Date().toISOString();
      let plan = previewPlan;
      if (plan.pattern === 'interview' && plan.participantId.startsWith('__pending__')) {
        // Use a stub id just for the dry-run count
        plan = { ...plan, participantId: 'stub' };
      }
      return buildImport(project.data, plan, rows, now);
    } catch (e) {
      console.error(e);
      return null;
    }
  }, [onConfirmStep, project, previewPlan, planErrors.length, rows]);

  /** Dry-run count of how many Word comments will be auto-linked to a segment. */
  const commentLinkPreview = useMemo(() => {
    const comments = file?.comments ?? [];
    if (
      !onConfirmStep ||
      !project ||
      !buildPreview ||
      !previewPlan ||
      previewPlan.pattern !== 'interview' ||
      commentMode !== 'cards' ||
      comments.length === 0
    )
      return null;
    const candidate = [...project.data.source_segments, ...buildPreview.segments].filter(
      (s) => s.deletedAt === null
    );
    let linked = 0;
    let withRange = 0;
    let withParagraph = 0;
    for (const c of comments) {
      if ((c.commentedText?.trim() ?? '').length > 0) withRange++;
      if ((c.paragraphText?.trim() ?? '').length > 0) withParagraph++;
      if (findSegmentForComment(candidate, c)) linked++;
    }
    return {
      linked,
      total: comments.length,
      withRange,
      withParagraph,
    };
  }, [onConfirmStep, project, buildPreview, previewPlan, commentMode, file]);

  function handleConfirm() {
    if (!project || !previewPlan) {
      setError('ファイルを選択してください');
      return;
    }
    const errs = validatePlan(previewPlan);
    if (errs.length > 0) {
      setError(errs.join(' / '));
      return;
    }
    const now = new Date().toISOString();
    let plan = previewPlan;
    let newParticipantFromInterview: Participant | null = null;

    if (plan.pattern === 'interview') {
      if (participantId === '__new__') {
        const code = newCode.trim();
        if (!isValidParticipantCode(code)) {
          setError('参加者コードは英字始まり 1〜10 文字 (英数字) で入力してください');
          return;
        }
        // v0.2.14 Fix-2: 重複コードでも confirm 後に既存 participant へ追加取込
        const existing = project.data.participants.find((p) => p.code === code);
        if (existing) {
          const ok = window.confirm(
            `参加者コード "${code}" は既に存在します (${existing.displayName})．\n\n` +
              `既存の "${code}" に追加で取り込みますか?\n` +
              `(セグメントとカードは新規発番されます．既存データは変更されません．)`,
          );
          if (!ok) {
            setError('取り込みを中止しました');
            return;
          }
          plan = { ...plan, participantId: existing.id };
        } else {
          newParticipantFromInterview = {
            id: newId(),
            code,
            displayName: newName.trim() || code,
            createdAt: now,
          };
          plan = { ...plan, participantId: newParticipantFromInterview.id };
        }
      } else {
        const exists = project.data.participants.some((p) => p.id === participantId);
        if (!exists) {
          setError('参加者を選択してください');
          return;
        }
        plan = { ...plan, participantId };
      }
    }

    // For interview: prepend the new participant (if any) to project.data view so
    // buildImport / nextCardSerial sees it as existing
    const adjustedData = newParticipantFromInterview
      ? {
          ...project.data,
          participants: [...project.data.participants, newParticipantFromInterview],
        }
      : project.data;

    const result = buildImport(adjustedData, plan, rows, now);
    if (result.segments.length === 0) {
      setError('取り込めるセグメントがありませんでした');
      return;
    }
    const combinedParticipants = newParticipantFromInterview
      ? [newParticipantFromInterview, ...result.newParticipants]
      : result.newParticipants;

    // Word comments (only meaningful for interview-mode .docx)
    const commentSegments = [];
    const commentCards = [];
    const commentCardLinks = [];
    const commentCardPositions = [];
    const wordComments = file?.comments ?? [];
    if (
      plan.pattern === 'interview' &&
      wordComments.length > 0 &&
      commentMode !== 'ignore'
    ) {
      // Determine the participant code for code formatting
      const participantForComments =
        newParticipantFromInterview ??
        project.data.participants.find((p) => p.id === plan.participantId);
      if (participantForComments) {
        const baseSerial =
          nextCardSerial(adjustedData, participantForComments.id) +
          result.cards.filter((c) => c.participantId === participantForComments.id).length;
        if (commentMode === 'segments') {
          const r = buildCommentsAsSegments({
            comments: wordComments,
            candidateSegments: [...adjustedData.source_segments, ...result.segments],
            participantId: participantForComments.id,
            participantCode: participantForComments.code,
            sourceFile: plan.fileName,
            serialStart: baseSerial,
            authorHandling: commentAuthor,
            authorRemap,
            now,
          });
          commentSegments.push(...r.segments);
        } else if (commentMode === 'cards') {
          const r = buildCommentsAsCards({
            comments: wordComments,
            candidateSegments: [...adjustedData.source_segments, ...result.segments],
            participantId: participantForComments.id,
            participantCode: participantForComments.code,
            sourceFile: plan.fileName,
            serialStart: baseSerial,
            authorHandling: commentAuthor,
            authorRemap,
            now,
          });
          commentCards.push(...r.cards);
          commentCardLinks.push(...r.cardLinks);
          commentCardPositions.push(...r.cardPositions);
        }
      }
    }

    // Survey-only: optionally synthesise one card per imported segment
    // (body = full segment text, linked to the segment).
    const surveyCards: typeof result.cards = [];
    const surveyCardLinks: typeof result.cardLinks = [];
    const surveyCardPositions: typeof result.cardPositions = [];
    if (plan.pattern === 'survey' && surveyAutoCardEachRow) {
      // Track per-participant serial seeded from existing + main-pass cards
      const serialByPid = new Map<string, number>();
      const seenInData = new Map<string, number>();
      for (const c of adjustedData.cards) {
        if (c.serialNumber > (seenInData.get(c.participantId) ?? 0)) {
          seenInData.set(c.participantId, c.serialNumber);
        }
      }
      // Include cards minted by the main buildImport pass (auto-card columns)
      const mainCardsByPid = new Map<string, number>();
      for (const c of result.cards) {
        mainCardsByPid.set(c.participantId, (mainCardsByPid.get(c.participantId) ?? 0) + 1);
      }
      const allParticipants = [
        ...adjustedData.participants,
        ...result.newParticipants,
      ];
      const codeByPid = new Map<string, string>();
      for (const p of allParticipants) codeByPid.set(p.id, p.code);

      // Position scatter per participant
      const posCount = new Map<string, number>();
      for (let i = 0; i < result.segments.length; i++) {
        const seg = result.segments[i];
        const pid = seg.participantId;
        const startSerial =
          (serialByPid.get(pid) ?? (seenInData.get(pid) ?? 0) + (mainCardsByPid.get(pid) ?? 0)) + 1;
        serialByPid.set(pid, startSerial);
        const code = codeByPid.get(pid);
        if (!code) continue;
        const cardId = newId();
        surveyCards.push({
          id: cardId,
          participantId: pid,
          code: formatCardCode(code, startSerial),
          serialNumber: startSerial,
          body: seg.text,
          status: 'active',
          placement: 'unclassified',
          createdAt: now,
          updatedAt: now,
        });
        surveyCardLinks.push({
          id: newId(),
          cardId,
          segmentId: seg.id,
          startOffset: 0,
          endOffset: seg.text.length,
          selectedTextSnapshot: seg.text,
          createdAt: now,
        });
        const c = posCount.get(pid) ?? 0;
        posCount.set(pid, c + 1);
        surveyCardPositions.push({
          cardId,
          x: 80 + (c % 12) * 28,
          y: 80 + Math.floor(c / 12) * 28,
        });
      }
    }

    applyCommand(
      makeBulkImportCommand({
        participants: combinedParticipants,
        segments: [...result.segments, ...commentSegments],
        cards: [...result.cards, ...commentCards, ...surveyCards],
        cardLinks: [...result.cardLinks, ...commentCardLinks, ...surveyCardLinks],
        cardPositions: [...result.cardPositions, ...commentCardPositions, ...surveyCardPositions],
      })
    );
    // Open the source viewer so the user can immediately verify the import.
    try {
      const api = (window as unknown as { api?: { openSourceView?: () => Promise<void> } }).api;
      if (api?.openSourceView) void api.openSourceView();
    } catch {
      // ignore — viewer is a convenience, not critical
    }
    onClose();
  }

  if (!open) return null;

  const current = STEPS[stepIdx];
  const canForward = (() => {
    if (current.id === 'file') return file !== null;
    if (current.id === 'parse') return rows.length > 0;
    if (current.id === 'pattern') {
      if (pattern === 'interview' && participantId === '__new__') {
        return isValidParticipantCode(newCode.trim());
      }
      return true;
    }
    if (current.id === 'columns') return planErrors.length === 0;
    return true;
  })();

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 920, maxHeight: '92vh' }}
      >
        <header className="modal-header">
          <h2>原文取り込みウィザード</h2>
        </header>
        <div className="modal-body" style={{ display: 'flex', gap: 12, overflow: 'hidden' }}>
          <nav
            style={{
              flex: '0 0 180px',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              borderRight: '1px solid var(--border)',
              paddingRight: 8,
            }}
          >
            {STEPS.map((s, i) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setStepIdx(i)}
                className={i === stepIdx ? 'tab active' : 'tab'}
                style={{ justifyContent: 'flex-start', textAlign: 'left' }}
              >
                {s.label}
              </button>
            ))}
          </nav>

          <div style={{ flex: 1, overflowY: 'auto', minWidth: 0 }}>
            <h3>{current.label}</h3>

            {current.id === 'file' && (
              <FileStep file={file} onSelect={handleSelectFile} />
            )}

            {current.id === 'parse' && (
              <ParseStep
                file={file}
                parseMode={parseMode}
                setParseMode={setParseMode}
                fixedBreaks={fixedBreaks}
                setFixedBreaks={setFixedBreaks}
                sentenceDelims={sentenceDelims}
                setSentenceDelims={setSentenceDelims}
                headerRowIdx={headerRowIdx}
                setHeaderRowIdx={setHeaderRowIdx}
                dataStartIdx={dataStartIdx}
                setDataStartIdx={setDataStartIdx}
                rows={rows}
                speakerPrefixesText={speakerPrefixesText}
                setSpeakerPrefixesText={setSpeakerPrefixesText}
                speakerPunctColon={speakerPunctColon}
                setSpeakerPunctColon={setSpeakerPunctColon}
                speakerPunctColonFW={speakerPunctColonFW}
                setSpeakerPunctColonFW={setSpeakerPunctColonFW}
                speakerPunctComma={speakerPunctComma}
                setSpeakerPunctComma={setSpeakerPunctComma}
                speakerPunctCommaFW={speakerPunctCommaFW}
                setSpeakerPunctCommaFW={setSpeakerPunctCommaFW}
                speakerAllowSpace={speakerAllowSpace}
                setSpeakerAllowSpace={setSpeakerAllowSpace}
                speakerNoSeparator={speakerNoSeparator}
                setSpeakerNoSeparator={setSpeakerNoSeparator}
                speakerContinue={speakerContinue}
                setSpeakerContinue={setSpeakerContinue}
              />
            )}

            {current.id === 'pattern' && (
              <PatternStep
                pattern={pattern}
                setPattern={setPattern}
                participants={project?.data.participants ?? []}
                participantId={participantId}
                setParticipantId={setParticipantId}
                newCode={newCode}
                setNewCode={setNewCode}
                newName={newName}
                setNewName={setNewName}
                surveyAutoCardEachRow={surveyAutoCardEachRow}
                setSurveyAutoCardEachRow={setSurveyAutoCardEachRow}
              />
            )}

            {current.id === 'columns' && (
              <ColumnsStep
                pattern={pattern}
                columns={columns}
                rows={rows}
                headerRowIdx={headerRowIdx}
                setHeaderRowIdx={setHeaderRowIdx}
                dataStartIdx={dataStartIdx}
                setDataStartIdx={setDataStartIdx}
                onRoleChange={setColumnRole}
                onLabelChange={setColumnLabel}
                onFilterChange={setColumnFilter}
                planErrors={planErrors}
              />
            )}

            {current.id === 'comments' && (
              <CommentStep
                comments={file?.comments ?? []}
                mode={commentMode}
                setMode={setCommentMode}
                authorHandling={commentAuthor}
                setAuthorHandling={setCommentAuthor}
                authorRemap={authorRemap}
                setAuthorRemap={setAuthorRemap}
              />
            )}

            {current.id === 'confirm' && (
              <ConfirmStep
                pattern={pattern}
                rows={rows}
                dataStartIdx={dataStartIdx}
                planErrors={planErrors}
                buildPreview={buildPreview}
                file={file}
                commentCount={file?.comments?.length ?? 0}
                commentMode={commentMode}
                commentAuthor={commentAuthor}
                commentLinkPreview={commentLinkPreview}
                participantSummary={participantSummary(
                  pattern,
                  participantId,
                  newCode,
                  newName,
                  project?.data.participants ?? []
                )}
              />
            )}

            {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}
          </div>
        </div>
        <footer
          className="modal-footer"
          style={{ display: 'flex', justifyContent: 'space-between' }}
        >
          <div>
            <button
              type="button"
              onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
              disabled={stepIdx === 0}
            >
              ＜ 戻る
            </button>
            <button
              type="button"
              onClick={() => setStepIdx((i) => Math.min(STEPS.length - 1, i + 1))}
              disabled={stepIdx === STEPS.length - 1 || !canForward}
              style={{ marginLeft: 6 }}
            >
              次へ ＞
            </button>
          </div>
          <div>
            <button type="button" onClick={onClose}>
              キャンセル
            </button>
            {/* 2026-06-02: 「取り込む」は確認ステップ (最後) のときだけ表示 */}
            {current.id === 'confirm' && (
              <button
                type="button"
                className="primary"
                onClick={handleConfirm}
                disabled={planErrors.length > 0 || rows.length === 0}
                style={{ marginLeft: 6 }}
              >
                取り込む
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

function FileStep({
  file,
  onSelect,
}: {
  file: ReadTextFileResult | null;
  onSelect: () => void;
}) {
  return (
    <div>
      <p className="muted small">
        テキスト / Markdown / Word (.docx) / Excel (.xlsx) / CSV ファイルを選んでください．
        Word のコメントが含まれている場合は，後のステップで取り込み方法を選べます．
      </p>
      <div className="file-row">
        <button type="button" onClick={onSelect}>
          ファイルを選択...
        </button>
        <span className="file-name">{file?.fileName || '(未選択)'}</span>
      </div>
      {file && (
        <div style={{ marginTop: 10 }}>
          <div className="muted small">
            形式: {file.sourceFormat}
            {file.rows && ` / 行数: ${file.rows.length}`}
          </div>
          <div className="preview" style={{ marginTop: 6 }}>
            <div className="preview-meta">先頭プレビュー</div>
            <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>
              {file.text.slice(0, 400)}
              {file.text.length > 400 ? '\n...' : ''}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

/** Shared widget letting the user pick which row is the header and where data
 *  actually starts.  Qualtrics CSVs typically need headerRow=0 + dataStart=3. */
function HeaderConfigBlock({
  rows,
  headerRowIdx,
  setHeaderRowIdx,
  dataStartIdx,
  setDataStartIdx,
}: {
  rows: string[][];
  headerRowIdx: number | null;
  setHeaderRowIdx: (i: number | null) => void;
  dataStartIdx: number;
  setDataStartIdx: (i: number) => void;
}) {
  const maxRows = Math.max(rows.length, 1);
  const previewIdx = headerRowIdx ?? -1;
  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        alignItems: 'center',
        flexWrap: 'wrap',
        padding: 8,
        background: 'var(--bg-elev-2)',
        border: '1px solid var(--border)',
        borderRadius: 4,
        marginBottom: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <label className="small">ヘッダー行:</label>
        <select
          value={previewIdx}
          onChange={(e) => {
            const v = Number(e.target.value);
            const next = v < 0 ? null : v;
            setHeaderRowIdx(next);
            // Auto-bump data start so it stays just after header by default
            if (next !== null && dataStartIdx <= next) setDataStartIdx(next + 1);
            if (next === null && dataStartIdx > 0) setDataStartIdx(0);
          }}
        >
          <option value={-1}>なし</option>
          {[0, 1, 2, 3, 4].filter((i) => i < maxRows).map((i) => (
            <option key={i} value={i}>
              {i + 1} 行目
            </option>
          ))}
        </select>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <label className="small">データ開始行:</label>
        <input
          type="number"
          value={dataStartIdx + 1}
          min={1}
          max={maxRows}
          onChange={(e) => {
            const v = Math.max(1, Math.min(maxRows, Number(e.target.value) || 1));
            setDataStartIdx(v - 1);
          }}
          style={{ width: 70 }}
        />
        <span className="muted small">行目から</span>
      </div>
      {rows[Math.max(0, dataStartIdx)] && (
        <div className="muted small" style={{ flex: 1, minWidth: 0 }}>
          先頭データ: 「
          {(rows[Math.max(0, dataStartIdx)]?.join(' | ') ?? '').slice(0, 60)}
          …」
        </div>
      )}
    </div>
  );
}

function ParseStep({
  file,
  parseMode,
  setParseMode,
  fixedBreaks,
  setFixedBreaks,
  sentenceDelims,
  setSentenceDelims,
  headerRowIdx,
  setHeaderRowIdx,
  dataStartIdx,
  setDataStartIdx,
  rows,
  speakerPrefixesText,
  setSpeakerPrefixesText,
  speakerPunctColon,
  setSpeakerPunctColon,
  speakerPunctColonFW,
  setSpeakerPunctColonFW,
  speakerPunctComma,
  setSpeakerPunctComma,
  speakerPunctCommaFW,
  setSpeakerPunctCommaFW,
  speakerAllowSpace,
  setSpeakerAllowSpace,
  speakerNoSeparator,
  setSpeakerNoSeparator,
  speakerContinue,
  setSpeakerContinue,
}: {
  file: ReadTextFileResult | null;
  parseMode: ParseMode;
  setParseMode: (m: ParseMode) => void;
  fixedBreaks: string;
  setFixedBreaks: (s: string) => void;
  sentenceDelims: string;
  setSentenceDelims: (s: string) => void;
  headerRowIdx: number | null;
  setHeaderRowIdx: (i: number | null) => void;
  dataStartIdx: number;
  setDataStartIdx: (i: number) => void;
  rows: string[][];
  speakerPrefixesText: string;
  setSpeakerPrefixesText: (s: string) => void;
  speakerPunctColon: boolean;
  setSpeakerPunctColon: (b: boolean) => void;
  speakerPunctColonFW: boolean;
  setSpeakerPunctColonFW: (b: boolean) => void;
  speakerPunctComma: boolean;
  setSpeakerPunctComma: (b: boolean) => void;
  speakerPunctCommaFW: boolean;
  setSpeakerPunctCommaFW: (b: boolean) => void;
  speakerAllowSpace: boolean;
  setSpeakerAllowSpace: (b: boolean) => void;
  speakerNoSeparator: boolean;
  setSpeakerNoSeparator: (b: boolean) => void;
  speakerContinue: boolean;
  setSpeakerContinue: (b: boolean) => void;
}) {
  const isTabular = file?.rows && file.rows.length > 0;
  return (
    <div>
      <div className="form-row">
        <label>区切り方法</label>
        <div className="radio-row" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
          {/* 2026-06-02: 「行で区切り」を最上位に．既定もこれ． */}
          <label>
            <input
              type="radio"
              name="parse-mode"
              checked={parseMode === 'line'}
              onChange={() => setParseMode('line')}
            />
            <strong>行で区切り (1 行 = 1 セグメント)</strong>
          </label>
          {isTabular && (
            <label>
              <input
                type="radio"
                name="parse-mode"
                checked={parseMode === 'tabular'}
                onChange={() => setParseMode('tabular')}
              />
              表形式そのまま (xlsx/csv の列構造を保持)
            </label>
          )}
          <label>
            <input
              type="radio"
              name="parse-mode"
              checked={parseMode === 'blank-line'}
              onChange={() => setParseMode('blank-line')}
            />
            空行で区切り (1 段落 = 1 セグメント)
          </label>
          <label>
            <input
              type="radio"
              name="parse-mode"
              checked={parseMode === 'sentence'}
              onChange={() => setParseMode('sentence')}
            />
            指定文字で区切り（例: 「。」「．」で 1 文 = 1 セグメント）
          </label>
          <label>
            <input
              type="radio"
              name="parse-mode"
              checked={parseMode === 'fixed-width'}
              onChange={() => setParseMode('fixed-width')}
            />
            固定長で区切り
          </label>
        </div>
      </div>

      {parseMode === 'sentence' && (
        <div className="form-row">
          <label>区切り文字（複数指定可・連続入力）</label>
          <input
            type="text"
            value={sentenceDelims}
            onChange={(e) => setSentenceDelims(e.target.value)}
            placeholder="。．"
            style={{ width: 200 }}
          />
          <span className="muted small" style={{ marginLeft: 8 }}>
            指定した文字の直後で分割（文字自体はセグメント末尾に残る）．例「。．！？」
          </span>
        </div>
      )}

      {parseMode === 'fixed-width' && (
        <div className="form-row">
          <label>区切り位置 (文字数，カンマ区切り)</label>
          <input
            type="text"
            value={fixedBreaks}
            onChange={(e) => setFixedBreaks(e.target.value)}
            placeholder="10,20,30"
            style={{ width: 200 }}
          />
          <span className="muted small" style={{ marginLeft: 8 }}>
            例「10,20」→ 0-10 / 10-20 / 20-末尾 の 3 列
          </span>
        </div>
      )}

      <HeaderConfigBlock
        rows={rows}
        headerRowIdx={headerRowIdx}
        setHeaderRowIdx={setHeaderRowIdx}
        dataStartIdx={dataStartIdx}
        setDataStartIdx={setDataStartIdx}
      />

      {parseMode !== 'tabular' && (
        <details
          style={{
            marginTop: 6,
            marginBottom: 6,
            padding: 8,
            background: 'var(--bg-elev-2)',
            border: '1px solid var(--border)',
            borderRadius: 4,
          }}
          open={speakerPrefixesText.length > 0}
        >
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
            発言者プレフィクス（任意．インタビュー文字起こし向け）
          </summary>
          <p className="muted small" style={{ marginTop: 6 }}>
            各行の冒頭にある発言者ラベル（例: <code>Q</code> / <code>A</code> / <code>司会</code>）
            を入力すると，原文セグメントの「話者」列に切り出されます．
            プレフィクスは 1 行 1 つ．末尾の区切り文字や空白は下のチェックで柔軟化できます．
          </p>
          {/* 2026-06-02: chip ベースのプレフィクス入力．
              入力欄に文字を打って Enter / カンマ / 半角空白で確定 → chip 化．
              chip の × で削除．内部表現は speakerPrefixesText (\n separated). */}
          <SpeakerPrefixChips
            value={speakerPrefixesText}
            onChange={setSpeakerPrefixesText}
          />
          <div className="muted small" style={{ marginTop: 2 }}>
            長いプレフィクスが優先（学生10 と 学生1 が両方あれば長い方を先に試す）．
          </div>
          <div className="form-row" style={{ flexWrap: 'wrap', gap: 12 }}>
            <span className="small">区切り文字（複数選択可）:</span>
            <label className="small">
              <input
                type="checkbox"
                checked={speakerPunctColon}
                onChange={(e) => setSpeakerPunctColon(e.target.checked)}
              />{' '}
              半角コロン <code>:</code>
            </label>
            <label className="small">
              <input
                type="checkbox"
                checked={speakerPunctColonFW}
                onChange={(e) => setSpeakerPunctColonFW(e.target.checked)}
              />{' '}
              全角コロン <code>：</code>
            </label>
            <label className="small">
              <input
                type="checkbox"
                checked={speakerPunctComma}
                onChange={(e) => setSpeakerPunctComma(e.target.checked)}
              />{' '}
              半角コンマ <code>,</code>
            </label>
            <label className="small">
              <input
                type="checkbox"
                checked={speakerPunctCommaFW}
                onChange={(e) => setSpeakerPunctCommaFW(e.target.checked)}
              />{' '}
              全角コンマ <code>，</code>
            </label>
          </div>
          <div className="form-row" style={{ flexWrap: 'wrap', gap: 12 }}>
            <label className="small">
              <input
                type="checkbox"
                checked={speakerNoSeparator}
                onChange={(e) => setSpeakerNoSeparator(e.target.checked)}
              />{' '}
              <strong>区切り文字なしでも抽出</strong>（例: <code>面接者では…</code> を「面接者」+「では…」に分割）
            </label>
            <label className="small">
              <input
                type="checkbox"
                checked={speakerAllowSpace}
                onChange={(e) => setSpeakerAllowSpace(e.target.checked)}
              />{' '}
              末尾の空白を許容（区切り文字なしでも空白で分離可）
            </label>
            <label className="small">
              <input
                type="checkbox"
                checked={speakerContinue}
                onChange={(e) => setSpeakerContinue(e.target.checked)}
              />{' '}
              区切れない行は直前の話者を引き継ぐ
            </label>
          </div>
        </details>
      )}

      <div className="preview" style={{ marginTop: 6 }}>
        <div className="preview-meta">
          解析結果: 行数 {rows.length} / 列数 {rows[0]?.length ?? 0}
        </div>
        <RowsTable rows={rows.slice(0, 5)} />
        {rows.length > 5 && (
          <div className="muted small" style={{ marginTop: 4 }}>
            …他 {rows.length - 5} 行
          </div>
        )}
      </div>
    </div>
  );
}

function PatternStep({
  pattern,
  setPattern,
  participants,
  participantId,
  setParticipantId,
  newCode,
  setNewCode,
  newName,
  setNewName,
  surveyAutoCardEachRow,
  setSurveyAutoCardEachRow,
}: {
  pattern: ImportPattern;
  setPattern: (p: ImportPattern) => void;
  participants: Participant[];
  participantId: string;
  setParticipantId: (id: string) => void;
  newCode: string;
  setNewCode: (s: string) => void;
  newName: string;
  setNewName: (s: string) => void;
  surveyAutoCardEachRow: boolean;
  setSurveyAutoCardEachRow: (b: boolean) => void;
}) {
  return (
    <div>
      <p className="muted small">
        このファイルが <strong>1 人へのインタビュー</strong>（話者列で発話者を区別）か，
        <strong> アンケート型</strong>（1 行ごとに別の協力者の回答）かを選んでください．
      </p>
      <div className="form-row">
        <label>パターン</label>
        <div className="radio-row" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
          <label>
            <input
              type="radio"
              name="pattern"
              checked={pattern === 'interview'}
              onChange={() => setPattern('interview')}
            />
            インタビュー型: 1 ファイル = 1 参加者 (話者列で発話者を区別)
          </label>
          <label>
            <input
              type="radio"
              name="pattern"
              checked={pattern === 'survey'}
              onChange={() => setPattern('survey')}
            />
            アンケート型: 1 行ごとに別の参加者 (協力者番号列で識別)
          </label>
        </div>
      </div>

      {pattern === 'interview' && (
        <>
          <div className="form-row">
            <label>参加者</label>
            <select
              value={participantId}
              onChange={(e) => setParticipantId(e.target.value)}
            >
              <option value="__new__">+ 新規参加者を作成</option>
              {participants.map((p) => (
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
                  placeholder="協力者 A (空欄ならコードと同じ)"
                />
              </div>
            </>
          )}
        </>
      )}

      {pattern === 'survey' && (
        <>
          <div className="muted small">
            参加者は列マッピングで指定する「参加者コード」列から自動的に作成されます．
            既存コードと一致する行は同じ参加者に追加紐付け．
            <br />
            参加者コード列を指定しない（または空欄の行がある）場合は <strong>P001 / P002 …</strong> と連番で自動付与されます．
          </div>
          <div className="form-row" style={{ marginTop: 8 }}>
            <label>
              <input
                type="checkbox"
                checked={surveyAutoCardEachRow}
                onChange={(e) => setSurveyAutoCardEachRow(e.target.checked)}
              />
              {' '}各セグメントを 1 枚ずつカード化する（本文 = セグメント全文，未分類に配置）
            </label>
          </div>
        </>
      )}
    </div>
  );
}

function ColumnsStep({
  pattern,
  columns,
  rows,
  headerRowIdx,
  setHeaderRowIdx,
  dataStartIdx,
  setDataStartIdx,
  onRoleChange,
  onLabelChange,
  onFilterChange,
  planErrors,
}: {
  pattern: ImportPattern;
  columns: ColumnSpec[];
  rows: string[][];
  headerRowIdx: number | null;
  setHeaderRowIdx: (i: number | null) => void;
  dataStartIdx: number;
  setDataStartIdx: (i: number) => void;
  onRoleChange: (idx: number, role: ColumnRole) => void;
  onLabelChange: (idx: number, label: string) => void;
  onFilterChange: (idx: number, filter: ColumnFilter | undefined) => void;
  planErrors: string[];
}) {
  const dataRows = rows.slice(Math.max(0, dataStartIdx));
  const [filter, setFilter] = useState<'all' | 'used'>(columns.length > 20 ? 'used' : 'all');
  const visibleColumns =
    filter === 'used' ? columns.filter((c) => c.role !== 'ignore') : columns;
  const usedCount = columns.filter((c) => c.role !== 'ignore').length;
  // 2026-06-02: 列フィルタを適用した結果，何行残るかを表示．
  const filteredRowCount = useMemo(() => {
    let n = 0;
    for (const row of dataRows) {
      let pass = true;
      for (const c of columns) {
        if (!c.filter) continue;
        if (!applyColumnFilter(row[c.index], c.filter)) {
          pass = false;
          break;
        }
      }
      if (pass) n++;
    }
    return n;
  }, [dataRows, columns]);
  const hasAnyFilter = columns.some((c) => !!c.filter);
  return (
    <div>
      <HeaderConfigBlock
        rows={rows}
        headerRowIdx={headerRowIdx}
        setHeaderRowIdx={setHeaderRowIdx}
        dataStartIdx={dataStartIdx}
        setDataStartIdx={setDataStartIdx}
      />
      <p className="muted small">
        各列に役割を割り当ててください．
        {pattern === 'survey' && '参加者コード列は任意（未指定なら P001 〜 自動連番）．'}
      </p>
      <details className="role-help" style={{ marginTop: 6, fontSize: 12 }}>
        <summary style={{ cursor: 'pointer', color: 'var(--text-muted)' }}>
          役割の説明（クリックで展開）
        </summary>
        <ul style={{ margin: '6px 0 0 18px', padding: 0, lineHeight: 1.6 }}>
          <li>
            <b>本文</b> — その列の値がセグメント（原文ビューアに表示される 1 行）になる．
            複数列を指定すると改行で連結される．
          </li>
          <li>
            <b>自動カード化</b> — 列の値を <u>1 行 1 枚</u> のカードとして自動生成する．
            例: 「Q1_研修前の印象」を自動カード化にすると，回答者ごとに Q1 の答えが
            個別のカードになり，後で KJ 法で分類できる．本文と兼用しないこと（本文＝原文，
            カード＝分析単位）．空欄の行はカードを作らない．
          </li>
          <li>
            <b>話者</b> — 各行の話し手．原文ビューアの右側に話者列として表示される．
          </li>
          <li>
            <b>参加者コード／参加者名</b> — 行単位で参加者を識別．列を指定しないと
            P001, P002 ... と自動連番で振られる．
          </li>
          <li>
            <b>カスタム</b> — セグメントの <code>customFields</code> に保存．取り込み後の
            一覧画面では非表示だが，後で参照できる．
          </li>
          <li>
            <b>無視</b> — この列は取り込まない．
          </li>
        </ul>
      </details>

      {columns.length > 10 && (
        <div
          style={{
            display: 'flex',
            gap: 6,
            alignItems: 'center',
            marginTop: 8,
            padding: 6,
            background: 'var(--bg-elev-2)',
            border: '1px solid var(--border)',
            borderRadius: 4,
          }}
        >
          <span className="muted small">
            全 {columns.length} 列 / 使用中 {usedCount} 列
          </span>
          <button
            type="button"
            onClick={() => setFilter(filter === 'all' ? 'used' : 'all')}
            style={{ marginLeft: 'auto' }}
          >
            {filter === 'all' ? '使用列のみ表示' : 'すべて表示'}
          </button>
        </div>
      )}

      {hasAnyFilter && (
        <div
          className="muted small"
          style={{
            marginTop: 6,
            padding: '4px 8px',
            background: 'var(--bg-elev-2)',
            border: '1px solid var(--border)',
            borderRadius: 4,
          }}
        >
          列フィルタ適用後: {filteredRowCount} / {dataRows.length} 行が取り込み対象
        </div>
      )}

      <table className="data-table" style={{ width: '100%', marginTop: 8 }}>
        <thead>
          <tr>
            <th style={{ width: 40 }}>#</th>
            <th style={{ width: 160 }}>列名</th>
            <th style={{ width: 180 }}>役割</th>
            <th style={{ width: 220 }}>行フィルタ</th>
            <th>サンプル値</th>
          </tr>
        </thead>
        <tbody>
          {visibleColumns.map((c) => {
            const i = c.index;
            const nonEmptyCount = dataRows.reduce(
              (n, r) => ((r[i] ?? '').trim().length > 0 ? n + 1 : n),
              0
            );
            const previewText = (() => {
              const samples = dataRows
                .map((r) => (r[i] ?? '').trim())
                .filter((s) => s.length > 0)
                .slice(0, 3)
                .map((s) => s.slice(0, 40));
              return samples.length > 0 ? samples.join(' / ') : '(空)';
            })();
            return (
              <tr key={i}>
                <td className="muted small">{i + 1}</td>
                <td>
                  <input
                    type="text"
                    value={c.label}
                    onChange={(e) => onLabelChange(i, e.target.value)}
                    style={{ width: '95%' }}
                  />
                </td>
                <td>
                  <select
                    value={c.role}
                    onChange={(e) => onRoleChange(i, e.target.value as ColumnRole)}
                    style={{ width: '100%' }}
                  >
                    {Object.entries(ROLE_LABELS).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                  {c.role === 'auto_card' && (
                    <div
                      className="role-effect"
                      style={{
                        marginTop: 4,
                        fontSize: 11,
                        color: 'var(--accent)',
                        fontWeight: 600,
                      }}
                      title={`データ行 ${dataRows.length} 行のうち，この列に値がある ${nonEmptyCount} 行から，それぞれ 1 枚ずつカードが自動生成されます．`}
                    >
                      → {nonEmptyCount} 枚カード生成
                    </div>
                  )}
                  {c.role === 'body' && (
                    <div
                      className="role-effect muted small"
                      style={{ marginTop: 4, fontSize: 11 }}
                      title="この列の値はセグメントの本文として原文ビューアに表示されます．"
                    >
                      → {nonEmptyCount} 行使用
                    </div>
                  )}
                </td>
                <td>
                  <ColumnFilterEditor
                    filter={c.filter}
                    onChange={(f) => onFilterChange(i, f)}
                  />
                </td>
                <td className="muted small">{previewText}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {filter === 'used' && visibleColumns.length === 0 && (
        <div className="muted small" style={{ marginTop: 8 }}>
          まだ使用列が指定されていません．「すべて表示」で全列を表示できます．
        </div>
      )}

      {planErrors.length > 0 && (
        <div className="error" style={{ marginTop: 8 }}>
          {planErrors.map((e, i) => (
            <div key={i}>- {e}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function CommentStep({
  comments,
  mode,
  setMode,
  authorHandling,
  setAuthorHandling,
  authorRemap,
  setAuthorRemap,
}: {
  comments: { id: string; author?: string; text: string; commentedText?: string }[];
  mode: CommentMode;
  setMode: (m: CommentMode) => void;
  authorHandling: CommentAuthorHandling;
  setAuthorHandling: (h: CommentAuthorHandling) => void;
  authorRemap: Record<string, string>;
  setAuthorRemap: (m: Record<string, string>) => void;
}) {
  const withRange = comments.filter((c) => (c.commentedText ?? '').trim().length > 0).length;
  const authorsFound = Array.from(
    new Set(comments.map((c) => c.author).filter((a): a is string => !!a))
  );
  const resolvedTagFor = (author: string): string => {
    const v = authorRemap[author]?.trim();
    return v && v.length > 0 ? v : author;
  };
  const previewBody = (c: { author?: string; text: string }) => {
    if (!c.author) return c.text;
    if (authorHandling === 'include') return `[${c.author}] ${c.text}`;
    if (authorHandling === 'remove') return c.text;
    return c.text; // 'tag' — body is plain, author appears as tag
  };
  const updateRemap = (author: string, value: string) => {
    setAuthorRemap({ ...authorRemap, [author]: value });
  };
  return (
    <div>
      <p className="muted small">
        Word ドキュメントに {comments.length} 件のコメントが見つかりました
        {withRange > 0 && `（うち ${withRange} 件は本文との紐付き範囲を取得できました）`}．
        どう取り込むかを選んでください．
      </p>
      <div className="form-row">
        <label>取り込み方法</label>
        <div className="radio-row" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
          <label>
            <input
              type="radio"
              name="comment-mode"
              checked={mode === 'cards'}
              onChange={() => setMode('cards')}
            />
            <strong>カードとして取り込む（推奨）</strong>: コメントを未分類カードとし，紐付く本文範囲のセグメントへ自動でリンク．紐付きが取れない場合はリンクなし
          </label>
          <label>
            <input
              type="radio"
              name="comment-mode"
              checked={mode === 'segments'}
              onChange={() => setMode('segments')}
            />
            セグメントとして取り込む: 「{'<元ファイル名>'} (コメント)」というファイル名で別系列のセグメントを作成
          </label>
          <label>
            <input
              type="radio"
              name="comment-mode"
              checked={mode === 'ignore'}
              onChange={() => setMode('ignore')}
            />
            含めない
          </label>
        </div>
      </div>
      <div className="form-row" style={{ marginTop: 8 }}>
        <label>コメント者の扱い</label>
        <div className="radio-row" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
          <label>
            <input
              type="radio"
              name="comment-author"
              checked={authorHandling === 'tag'}
              onChange={() => setAuthorHandling('tag')}
            />
            <strong>タグにする（推奨）</strong>: 本文には含めず，
            {mode === 'cards' ? 'カードのタグ' : 'セグメントのカスタム列「コメント者」'}
            として保持
          </label>
          <label>
            <input
              type="radio"
              name="comment-author"
              checked={authorHandling === 'include'}
              onChange={() => setAuthorHandling('include')}
            />
            本文に含める: 「[コメント者] 本文」形式で先頭に付与
          </label>
          <label>
            <input
              type="radio"
              name="comment-author"
              checked={authorHandling === 'remove'}
              onChange={() => setAuthorHandling('remove')}
            />
            除去する: コメント者情報を破棄
          </label>
        </div>
        {authorHandling === 'tag' && authorsFound.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div className="muted small" style={{ marginBottom: 4 }}>
              検出されたコメント者と{mode === 'cards' ? 'タグ名' : 'コメント者 customField 値'}の対応（空欄なら原名のまま）
            </div>
            <table className="data-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>検出された名前</th>
                  <th style={{ width: 200 }}>
                    {mode === 'cards' ? 'タグ名' : 'コメント者の値'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {authorsFound.map((author) => (
                  <tr key={author}>
                    <td style={{ fontSize: 12 }}>{author}</td>
                    <td>
                      <input
                        type="text"
                        value={authorRemap[author] ?? ''}
                        onChange={(e) => updateRemap(author, e.target.value)}
                        placeholder={`例: ${shortNameSuggestion(author)}`}
                        style={{ width: '95%' }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {authorHandling !== 'tag' && authorsFound.length > 0 && (
          <div className="muted small" style={{ marginTop: 4 }}>
            検出されたコメント者: {authorsFound.join(' / ')}
          </div>
        )}
      </div>

      <div className="preview" style={{ marginTop: 6 }}>
        <div className="preview-meta">プレビュー（先頭 5 件．取り込み時の本文）</div>
        <ol className="preview-list" style={{ paddingLeft: 18 }}>
          {comments.slice(0, 5).map((c) => (
            <li key={c.id} style={{ marginBottom: 4 }}>
              {previewBody(c).slice(0, 100)}
              {authorHandling === 'tag' && c.author && (
                <span
                  className="muted small"
                  style={{ marginLeft: 6, padding: '0 6px', border: '1px solid var(--border)', borderRadius: 8 }}
                >
                  {mode === 'cards' ? `タグ: ${resolvedTagFor(c.author)}` : `コメント者: ${resolvedTagFor(c.author)}`}
                </span>
              )}
              {c.commentedText && (
                <div className="muted small" style={{ paddingLeft: 12 }}>
                  本文範囲: 「{c.commentedText.slice(0, 50)}
                  {c.commentedText.length > 50 ? '…' : ''}」
                </div>
              )}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/** Best-effort 2-letter suggestion: pull the first ASCII letters from inside
 *  parentheses (e.g. "安田 裕子(yyr10067)" → "yy"), else first 2 chars. */
function shortNameSuggestion(author: string): string {
  const paren = /[（(]([^)）]+)[)）]/.exec(author);
  if (paren) {
    const ascii = paren[1].match(/[A-Za-z]+/);
    if (ascii) return ascii[0].slice(0, 2).toLowerCase();
  }
  return author.replace(/\s+/g, '').slice(0, 2);
}

function ConfirmStep({
  pattern,
  rows,
  dataStartIdx,
  planErrors,
  buildPreview,
  file,
  commentCount,
  commentMode,
  commentAuthor,
  commentLinkPreview,
  participantSummary,
}: {
  pattern: ImportPattern;
  rows: string[][];
  dataStartIdx: number;
  planErrors: string[];
  buildPreview: ReturnType<typeof buildImport> | null;
  file: ReadTextFileResult | null;
  commentCount: number;
  commentMode: CommentMode;
  commentAuthor: CommentAuthorHandling;
  commentLinkPreview: {
    linked: number;
    total: number;
    withRange: number;
    withParagraph: number;
  } | null;
  participantSummary: string;
}) {
  const commentSummary = (() => {
    if (commentCount === 0) return '(コメントなし)';
    const base =
      commentMode === 'cards'
        ? `カード化 ${commentCount} 件`
        : commentMode === 'segments'
          ? `セグメント化 ${commentCount} 件`
          : '含めない';
    if (commentMode === 'ignore') return base;
    const authorPart =
      commentAuthor === 'tag'
        ? commentMode === 'cards'
          ? 'コメント者はタグ'
          : 'コメント者は customFields'
        : commentAuthor === 'include'
          ? 'コメント者は本文に含める'
          : 'コメント者は除去';
    return `${base} / ${authorPart}`;
  })();
  return (
    <div>
      <table className="data-table">
        <tbody>
          <tr>
            <th>ファイル</th>
            <td>{file?.fileName ?? '(未選択)'}</td>
          </tr>
          <tr>
            <th>パターン</th>
            <td>{pattern === 'interview' ? 'インタビュー型' : 'アンケート型'}</td>
          </tr>
          <tr>
            <th>参加者</th>
            <td>{participantSummary}</td>
          </tr>
          <tr>
            <th>取り込み対象行</th>
            <td>{Math.max(0, rows.length - Math.max(0, dataStartIdx))} 行</td>
          </tr>
          <tr>
            <th>新規セグメント</th>
            <td>{buildPreview?.segments.length ?? '?'} 件</td>
          </tr>
          <tr>
            <th>新規参加者</th>
            <td>{buildPreview?.newParticipants.length ?? 0} 名</td>
          </tr>
          <tr>
            <th>自動カード化</th>
            <td>{buildPreview?.cards.length ?? 0} 枚</td>
          </tr>
          <tr>
            <th>スキップ行</th>
            <td>{buildPreview?.skipped.length ?? 0} 行</td>
          </tr>
          <tr>
            <th>Word コメント</th>
            <td>{commentSummary}</td>
          </tr>
          {commentLinkPreview && (
            <>
              <tr>
                <th>原文への自動リンク</th>
                <td>
                  {commentLinkPreview.linked} / {commentLinkPreview.total} 件
                  {commentLinkPreview.linked < commentLinkPreview.total && (
                    <span className="muted small" style={{ marginLeft: 8 }}>
                      未リンク {commentLinkPreview.total - commentLinkPreview.linked} 件は
                      取り込み後にカードのリンク欄で手動指定できます
                    </span>
                  )}
                </td>
              </tr>
              <tr>
                <th>コメント範囲の解析</th>
                <td className="muted small">
                  範囲取得済 {commentLinkPreview.withRange} 件 / 段落取得済{' '}
                  {commentLinkPreview.withParagraph} 件
                  {commentLinkPreview.withRange === 0 && commentLinkPreview.withParagraph === 0 && (
                    <div style={{ color: 'var(--danger, #c33)', marginTop: 4 }}>
                      コメント範囲が一切取得できていません．
                      <br />
                      考えられる原因: (1) Electron の Main プロセスが古いコードで動いている (開発中なら dev server を一度完全に終了して `npm run dev` で再起動してください)．
                      (2) docx の内部構造が想定外（テーブル内・図形内・ヘッダーフッター内のコメント等）．
                    </div>
                  )}
                </td>
              </tr>
            </>
          )}
        </tbody>
      </table>

      {(buildPreview?.skipped.length ?? 0) > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary className="muted small">スキップした行の詳細</summary>
          <ul>
            {buildPreview!.skipped.slice(0, 20).map((s) => (
              <li key={s.rowIndex}>
                行 {s.rowIndex + 1}: {s.reason}
              </li>
            ))}
          </ul>
        </details>
      )}

      {planErrors.length > 0 && (
        <div className="error" style={{ marginTop: 8 }}>
          {planErrors.map((e, i) => (
            <div key={i}>- {e}</div>
          ))}
        </div>
      )}

      <p className="muted small" style={{ marginTop: 8 }}>
        「取り込む」を押すと 1 つの Undo にまとめて反映されます．
      </p>
    </div>
  );
}

/**
 * 2026-06-02: 列フィルタ編集 UI．種別を select で選び、必要なら値入力．
 * 「フィルタ無し」を選ぶと undefined にリセット．
 */
function ColumnFilterEditor({
  filter,
  onChange,
}: {
  filter: ColumnFilter | undefined;
  onChange: (f: ColumnFilter | undefined) => void;
}) {
  const kind = filter?.kind ?? 'none';
  const updateKind = (k: string) => {
    if (k === 'none') return onChange(undefined);
    if (k === 'non_empty' || k === 'empty') return onChange({ kind: k });
    if (k === 'equals' || k === 'not_equals' || k === 'contains' || k === 'not_contains') {
      return onChange({ kind: k, value: '' });
    }
    if (k === 'gte' || k === 'lte') return onChange({ kind: k, value: 0 });
    if (k === 'between') return onChange({ kind: 'between', min: 0, max: 1 });
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11 }}>
      <select
        value={kind}
        onChange={(e) => updateKind(e.target.value)}
        style={{ width: '100%' }}
      >
        <option value="none">— フィルタ無し —</option>
        <option value="non_empty">値あり</option>
        <option value="empty">空欄</option>
        <option value="equals">= 一致</option>
        <option value="not_equals">≠ 一致しない</option>
        <option value="contains">含む</option>
        <option value="not_contains">含まない</option>
        <option value="gte">≥ 以上 (数値)</option>
        <option value="lte">≤ 以下 (数値)</option>
        <option value="between">範囲 (数値 N≤x≤M)</option>
      </select>
      {filter && (filter.kind === 'equals' || filter.kind === 'not_equals' || filter.kind === 'contains' || filter.kind === 'not_contains') && (
        <>
          <input
            type="text"
            value={filter.value}
            onChange={(e) => onChange({ ...filter, value: e.target.value })}
            placeholder="比較値"
            style={{ width: '100%' }}
          />
          <label className="small" style={{ fontSize: 10 }}>
            <input
              type="checkbox"
              checked={!!filter.caseInsensitive}
              onChange={(e) => onChange({ ...filter, caseInsensitive: e.target.checked })}
            />{' '}
            大文字小文字を無視
          </label>
        </>
      )}
      {filter && (filter.kind === 'gte' || filter.kind === 'lte') && (
        <input
          type="number"
          value={Number.isFinite(filter.value) ? filter.value : 0}
          onChange={(e) => onChange({ ...filter, value: Number(e.target.value) })}
          placeholder="数値"
          style={{ width: '100%' }}
        />
      )}
      {filter && filter.kind === 'between' && (
        <div style={{ display: 'flex', gap: 4 }}>
          <input
            type="number"
            value={Number.isFinite(filter.min) ? filter.min : 0}
            onChange={(e) => onChange({ ...filter, min: Number(e.target.value) })}
            placeholder="最小"
            style={{ width: '50%' }}
          />
          <span style={{ alignSelf: 'center' }}>〜</span>
          <input
            type="number"
            value={Number.isFinite(filter.max) ? filter.max : 0}
            onChange={(e) => onChange({ ...filter, max: Number(e.target.value) })}
            placeholder="最大"
            style={{ width: '50%' }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * 2026-06-02: 発言者プレフィクスを chip 形式で入力させる小コンポーネント．
 * value/onChange は \n 区切り文字列で，外側の state は既存のまま使い回せる．
 */
function SpeakerPrefixChips({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const items = value
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const [draft, setDraft] = useState('');
  const commitDraft = () => {
    const t = draft.trim();
    if (t.length === 0) return;
    if (items.includes(t)) {
      setDraft('');
      return;
    }
    onChange([...items, t].join('\n'));
    setDraft('');
  };
  const remove = (s: string) => onChange(items.filter((x) => x !== s).join('\n'));
  return (
    <div className="form-row" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <label style={{ paddingTop: 4 }}>プレフィクス</label>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 4,
          padding: 4,
          border: '1px solid var(--border)',
          borderRadius: 4,
          background: 'var(--bg)',
          minHeight: 32,
          flex: 1,
          minWidth: 240,
        }}
      >
        {items.map((s) => (
          <span
            key={s}
            className="chip active"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 12 }}
          >
            {s}
            <button
              type="button"
              onClick={() => remove(s)}
              aria-label={`${s} を削除`}
              title="削除"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'inherit',
                cursor: 'pointer',
                padding: '0 2px',
                fontSize: 13,
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </span>
        ))}
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Enter' || e.key === ',' || e.key === '、') {
              e.preventDefault();
              commitDraft();
            } else if (e.key === 'Backspace' && draft.length === 0 && items.length > 0) {
              // 空欄で Backspace → 最後の chip を削除
              e.preventDefault();
              onChange(items.slice(0, -1).join('\n'));
            }
          }}
          onBlur={commitDraft}
          placeholder={items.length === 0 ? '例: Q  →Enter で確定' : '+ 追加'}
          style={{
            border: 'none',
            outline: 'none',
            background: 'transparent',
            flex: 1,
            minWidth: 80,
            fontSize: 12,
          }}
        />
      </div>
    </div>
  );
}

function RowsTable({ rows }: { rows: string[][] }) {
  if (rows.length === 0) return <div className="muted small">(空)</div>;
  return (
    <table className="data-table" style={{ width: '100%' }}>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (
              <td key={j} style={{ fontSize: 11 }}>
                {c.slice(0, 60)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function suggestNextCode(existing: Participant[]): string {
  let n = 1;
  const codes = new Set(existing.map((p) => p.code));
  while (codes.has(`P${String(n).padStart(2, '0')}`)) n++;
  return `P${String(n).padStart(2, '0')}`;
}

function participantSummary(
  pattern: ImportPattern,
  participantId: string,
  newCode: string,
  newName: string,
  existing: Participant[]
): string {
  if (pattern === 'survey') return '(コード列から自動)';
  if (participantId === '__new__') {
    return `新規: ${newCode}${newName ? ` (${newName})` : ''}`;
  }
  const p = existing.find((x) => x.id === participantId);
  return p ? `${p.code} — ${p.displayName}` : '(未指定)';
}

function splitToLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
}

function wrapLines(
  lines: string[],
  mode: ParseMode,
  fixedBreaks: string,
  sentenceDelims: string
): string[][] {
  const cleaned = lines.filter((l) => l.length > 0);
  if (mode === 'fixed-width') {
    const breaks = fixedBreaks
      .split(/[,\s]+/)
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
    return parseFixedWidthText(cleaned.join('\n'), breaks);
  }
  if (mode === 'sentence') {
    const sentences = splitBySentenceDelimiters(cleaned.join('\n'), sentenceDelims);
    return sentences.map((s) => [s]);
  }
  if (mode === 'blank-line') {
    const segs = splitTextIntoSegments(cleaned.join('\n'), 'blank-line');
    return segs.map((s) => [s]);
  }
  // line / tabular fallback
  return cleaned.map((l) => l.split('\t'));
}
