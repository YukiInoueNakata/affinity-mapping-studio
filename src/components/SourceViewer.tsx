import { useEffect, useMemo, useRef, useState } from 'react';
import { useProjectStore } from '../stores/projectStore.js';
import {
  buildCard,
  buildFreeCard,
  FREE_PARTICIPANT_CODE,
  FREE_PARTICIPANT_NAME,
  type SourceRangeInput,
} from '../domain/cards.js';
import {
  makeCreateCardCommand,
  makeCreateCardsCommand,
  makeCreateFreeCardCommand,
  makeDeleteCardCommand,
  makeDeleteFileCommand,
  makeDeleteSegmentCommand,
  makeDeleteSegmentsBulkCommand,
  makeEditCardBodyCommand,
  makeEditSegmentCommand,
  makeInsertSegmentCommand,
  makeMergeCardsCommand,
  makeSetCardPlacementCommand,
  makeSetSegmentSpeakerCommand,
  makeSplitCardCommand,
  type BatchedCardCreate,
} from '../stores/commands.js';
import { buildMergedCard, buildSplitCards, MergeError, SplitError } from '../domain/cards.js';
import { CardSplitDialog } from './CardSplitDialog.js';
import {
  buildEditedSegment,
  buildInsertedSegment,
  getVisibleSegments,
  SegmentEditError,
} from '../domain/segments.js';
import type { Card, ProjectData } from '@shared/types/domain';
import { effectivePlacement, PLACEMENT_LABELS } from '../domain/cards.js';
import { useKeyboardScroll } from '../hooks/useKeyboardScroll.js';

type EditMode =
  | { kind: 'none' }
  | { kind: 'edit'; segmentId: string; draft: string }
  | {
      kind: 'add';
      afterSegmentId: string | null;
      participantId: string;
      sourceFile: string;
      draft: string;
    };

interface RangeSelection {
  segmentId: string;
  start: number;
  end: number;
  text: string;
}

interface SourceSelectionState {
  ranges: RangeSelection[];
}

export function SourceViewer() {
  const project = useProjectStore((s) => s.project);
  const applyCommand = useProjectStore((s) => s.applyCommand);
  const selectedParticipantId = useProjectStore((s) => s.selectedParticipantId);
  const selectedSegmentId = useProjectStore((s) => s.selectedSegmentId);
  const selectCard = useProjectStore((s) => s.selectCard);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lastClickedSegmentIdxRef = useRef<number>(-1);
  const kbScroll = useKeyboardScroll();
  const [selection, setSelection] = useState<SourceSelectionState | null>(null);
  const [editMode, setEditMode] = useState<EditMode>({ kind: 'none' });
  const [cardContext, setCardContext] = useState<{
    x: number;
    y: number;
    cardId: string;
  } | null>(null);
  const [splitCardId, setSplitCardId] = useState<string | null>(null);
  const [mergeBuffer, setMergeBuffer] = useState<string[]>([]);
  const [defaultExpanded, setDefaultExpanded] = useState(false);

  // フリーカード (原文紐付け無し) ダイアログの state
  const [freeCardOpen, setFreeCardOpen] = useState(false);
  const [freeCardBody, setFreeCardBody] = useState('');
  const [freeCardParticipantId, setFreeCardParticipantId] = useState<string>('');
  const [freeCardError, setFreeCardError] = useState<string | null>(null);

  // SourceViewer-local view state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchActiveIndex, setSearchActiveIndex] = useState(0);
  const [filterMode, setFilterMode] = useState<'all' | 'no_cards' | 'has_cards'>('all');
  const [filterFile, setFilterFile] = useState<string | null>(null);
  const [readMode, setReadMode] = useState<'detail' | 'continuous'>('detail');
  const [displayConfig, setDisplayConfig] = useState({
    fontSize: 14,
    lineHeight: 1.7,
    segmentGap: 8,
  });
  const [displayPopupOpen, setDisplayPopupOpen] = useState(false);
  const [segmentOverrides, setSegmentOverrides] = useState<Map<string, boolean>>(
    new Map()
  );
  const [expandedOverrides, setExpandedOverrides] = useState<Map<string, boolean>>(
    new Map()
  );
  const [checkedSegmentIds, setCheckedSegmentIds] = useState<Set<string>>(
    new Set()
  );
  const [speakerEditFor, setSpeakerEditFor] = useState<string | null>(null);
  const [speakerEditDraft, setSpeakerEditDraft] = useState<string>('');

  const isCardExpanded = (cardId: string, segmentId: string) => {
    if (expandedOverrides.has(cardId)) return expandedOverrides.get(cardId)!;
    if (segmentOverrides.has(segmentId)) return segmentOverrides.get(segmentId)!;
    return defaultExpanded;
  };

  const isSegmentExpanded = (segmentId: string) =>
    segmentOverrides.has(segmentId)
      ? segmentOverrides.get(segmentId)!
      : defaultExpanded;

  const toggleCardExpanded = (cardId: string, segmentId: string) => {
    setExpandedOverrides((prev) => {
      const next = new Map(prev);
      const current = next.has(cardId)
        ? next.get(cardId)!
        : segmentOverrides.has(segmentId)
          ? segmentOverrides.get(segmentId)!
          : defaultExpanded;
      next.set(cardId, !current);
      return next;
    });
  };

  const toggleSegmentExpanded = (segmentId: string, cardsInSeg: Card[]) => {
    const current = isSegmentExpanded(segmentId);
    setSegmentOverrides((prev) => {
      const next = new Map(prev);
      next.set(segmentId, !current);
      return next;
    });
    setExpandedOverrides((prev) => {
      const next = new Map(prev);
      for (const c of cardsInSeg) next.delete(c.id);
      return next;
    });
  };

  const toggleAllExpanded = () => {
    setDefaultExpanded((prev) => !prev);
    setSegmentOverrides(new Map());
    setExpandedOverrides(new Map());
  };

  const segments = useMemo(() => {
    if (!project) return [];
    const visible = getVisibleSegments(project.data);
    visible.sort((a, b) => {
      if (a.participantId !== b.participantId) {
        return a.participantId.localeCompare(b.participantId);
      }
      if (a.sourceFile !== b.sourceFile) {
        return a.sourceFile.localeCompare(b.sourceFile);
      }
      return a.order - b.order;
    });
    if (selectedParticipantId) {
      return visible.filter((s) => s.participantId === selectedParticipantId);
    }
    return visible;
  }, [project, selectedParticipantId]);

  const sourceFiles = useMemo(() => {
    if (!project) return [];
    const set = new Set<string>();
    for (const s of project.data.source_segments) {
      if (!s.deletedAt) set.add(s.sourceFile);
    }
    return Array.from(set).sort();
  }, [project]);

  const segmentCardsMap = useMemo(() => {
    const map = new Map<string, Card[]>();
    if (!project) return map;
    const cardById = new Map(project.data.cards.map((c) => [c.id, c]));
    for (const l of project.data.card_source_links) {
      const card = cardById.get(l.cardId);
      if (!card) continue;
      const arr = map.get(l.segmentId) ?? [];
      if (!arr.find((c) => c.id === card.id)) arr.push(card);
      map.set(l.segmentId, arr);
    }
    return map;
  }, [project]);

  // Apply file + has_cards filter on top of segments (which already has participant filter)
  const displaySegments = useMemo(() => {
    return segments.filter((s) => {
      if (filterFile && s.sourceFile !== filterFile) return false;
      if (filterMode === 'no_cards') {
        const cs = segmentCardsMap.get(s.id);
        return !cs || cs.length === 0;
      }
      if (filterMode === 'has_cards') {
        const cs = segmentCardsMap.get(s.id);
        return cs && cs.length > 0;
      }
      return true;
    });
  }, [segments, segmentCardsMap, filterMode, filterFile]);

  // Find all match positions of searchQuery in displaySegments (for jump navigation)
  const searchMatches = useMemo(() => {
    if (!searchQuery.trim()) return [] as Array<{ segmentId: string; index: number }>;
    const out: Array<{ segmentId: string; index: number }> = [];
    const q = searchQuery;
    const lower = q.toLowerCase();
    for (const s of displaySegments) {
      const text = s.text.toLowerCase();
      let pos = 0;
      while (true) {
        const idx = text.indexOf(lower, pos);
        if (idx < 0) break;
        out.push({ segmentId: s.id, index: idx });
        pos = idx + lower.length;
      }
    }
    return out;
  }, [searchQuery, displaySegments]);

  // Clamp the active match index when the result set changes
  useEffect(() => {
    if (searchMatches.length === 0) {
      setSearchActiveIndex(0);
      return;
    }
    if (searchActiveIndex >= searchMatches.length) setSearchActiveIndex(0);
  }, [searchMatches.length, searchActiveIndex]);

  // Scroll to active match when navigated
  useEffect(() => {
    if (searchMatches.length === 0) return;
    const m = searchMatches[searchActiveIndex];
    if (!m || !containerRef.current) return;
    const el = containerRef.current.querySelector<HTMLElement>(
      `[data-segment-id="${m.segmentId}"]`
    );
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [searchActiveIndex, searchMatches]);

  const linkedRanges = useMemo(() => {
    if (!project) return new Map<string, Array<{ start: number; end: number; cardId: string }>>();
    const map = new Map<string, Array<{ start: number; end: number; cardId: string }>>();
    for (const l of project.data.card_source_links) {
      const arr = map.get(l.segmentId) ?? [];
      arr.push({ start: l.startOffset, end: l.endOffset, cardId: l.cardId });
      map.set(l.segmentId, arr);
    }
    return map;
  }, [project]);

  function handleMouseUp(e: React.MouseEvent<HTMLDivElement>) {
    if (e.ctrlKey || e.metaKey || e.shiftKey) return;
    const target = e.target as HTMLElement | null;
    if (target && target.closest('.source-viewer-toolbar')) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      setSelection(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const container = containerRef.current;
    if (!container) {
      setSelection(null);
      return;
    }

    const segmentEls = Array.from(
      container.querySelectorAll<HTMLElement>('[data-segment-id]')
    );
    const startSegEl = findEnclosingSegment(range.startContainer, segmentEls);
    const endSegEl = findEnclosingSegment(range.endContainer, segmentEls);

    let startIdx = startSegEl ? segmentEls.indexOf(startSegEl) : -1;
    let endIdx = endSegEl ? segmentEls.indexOf(endSegEl) : -1;

    // Fall back to nearest segment based on DOM ordering for boundaries that
    // landed outside any segment (triple-click sometimes extends past the <p>).
    if (startIdx < 0) startIdx = nearestSegmentIndex(range.startContainer, segmentEls, 'start');
    if (endIdx < 0) endIdx = nearestSegmentIndex(range.endContainer, segmentEls, 'end');

    if (startIdx < 0 || endIdx < 0) {
      setSelection(null);
      return;
    }

    const minIdx = Math.min(startIdx, endIdx);
    const maxIdx = Math.max(startIdx, endIdx);

    const ranges: RangeSelection[] = [];
    for (let i = minIdx; i <= maxIdx; i++) {
      const segEl = segmentEls[i];
      const segmentId = segEl.dataset.segmentId!;
      const segText = segEl.textContent ?? '';
      const segLen = segText.length;
      if (segLen === 0) continue;

      let s: number;
      let e: number;
      const isStart = i === startIdx && startSegEl === segEl;
      const isEnd = i === endIdx && endSegEl === segEl;
      if (isStart) {
        s = clampOffset(getOffsetWithin(segEl, range.startContainer, range.startOffset), segLen);
      } else {
        s = 0;
      }
      if (isEnd) {
        e = clampOffset(getOffsetWithin(segEl, range.endContainer, range.endOffset), segLen);
      } else {
        e = segLen;
      }
      if (e > s) {
        ranges.push({ segmentId, start: s, end: e, text: segText.slice(s, e) });
      }
    }

    if (ranges.length === 0) {
      setSelection(null);
      return;
    }
    setSelection({ ranges });
  }

  function collectRangeInputs(): { rangeInputs: SourceRangeInput[]; participantId: string } | null {
    if (!project || !selection) return null;
    const rangeInputs: SourceRangeInput[] = [];
    let participantId: string | null = null;
    for (const r of selection.ranges) {
      const segment = project.data.source_segments.find((s) => s.id === r.segmentId);
      if (!segment) continue;
      if (participantId && segment.participantId !== participantId) {
        alert('複数参加者の範囲をまたぐカード化は未対応です。同一参加者の範囲を選び直してください。');
        return null;
      }
      participantId = segment.participantId;
      rangeInputs.push({
        segment,
        startOffset: r.start,
        endOffset: r.end,
        selectedText: r.text,
      });
    }
    if (rangeInputs.length === 0 || !participantId) return null;
    return { rangeInputs, participantId };
  }

  function handleCardize() {
    if (!project) return;
    const collected = collectRangeInputs();
    if (!collected) return;
    const participant = project.data.participants.find((p) => p.id === collected.participantId);
    if (!participant) return;

    const out = buildCard(project.data, {
      participant,
      ranges: collected.rangeInputs,
      now: new Date().toISOString(),
    });
    applyCommand(makeCreateCardCommand(out.card, out.links, out.position));
    selectCard(out.card.id);
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  }

  function openFreeCardDialog() {
    setFreeCardBody('');
    setFreeCardParticipantId(''); // 既定: 自由メモ
    setFreeCardError(null);
    setFreeCardOpen(true);
  }

  function submitFreeCard() {
    if (!project) return;
    try {
      const out = buildFreeCard(project.data, {
        text: freeCardBody,
        participantId: freeCardParticipantId || undefined,
        now: new Date().toISOString(),
      });
      applyCommand(makeCreateFreeCardCommand(out.card, out.position, out.newParticipant));
      selectCard(out.card.id);
      setFreeCardOpen(false);
    } catch (e) {
      setFreeCardError((e as Error).message);
    }
  }

  function handleCardizePerSegment() {
    if (!project) return;
    const collected = collectRangeInputs();
    if (!collected) return;
    const participant = project.data.participants.find((p) => p.id === collected.participantId);
    if (!participant) return;
    const now = new Date().toISOString();

    const items: BatchedCardCreate[] = [];
    let pseudo: ProjectData = project.data;
    for (const r of collected.rangeInputs) {
      const out = buildCard(pseudo, { participant, ranges: [r], now });
      items.push({ card: out.card, links: out.links, position: out.position });
      pseudo = {
        ...pseudo,
        cards: [...pseudo.cards, out.card],
        card_source_links: [...pseudo.card_source_links, ...out.links],
        card_positions: [...pseudo.card_positions, out.position],
      };
    }
    applyCommand(makeCreateCardsCommand(items));
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  }

  const selectionTotalLen = selection?.ranges.reduce((n, r) => n + (r.end - r.start), 0) ?? 0;
  const selectionSegmentCount = selection?.ranges.length ?? 0;
  const selectedSegmentIds = useMemo(
    () => new Set(selection?.ranges.map((r) => r.segmentId) ?? []),
    [selection]
  );

  function handleSegmentClick(e: React.MouseEvent<HTMLDivElement>, segmentIdx: number) {
    if (!(e.ctrlKey || e.metaKey || e.shiftKey)) {
      lastClickedSegmentIdxRef.current = segmentIdx;
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    window.getSelection()?.removeAllRanges();

    const segment = segments[segmentIdx];
    if (!segment) return;

    if (e.shiftKey && lastClickedSegmentIdxRef.current >= 0) {
      const from = Math.min(lastClickedSegmentIdxRef.current, segmentIdx);
      const to = Math.max(lastClickedSegmentIdxRef.current, segmentIdx);
      const next: RangeSelection[] = [];
      for (let i = from; i <= to; i++) {
        const s = segments[i];
        next.push({ segmentId: s.id, start: 0, end: s.text.length, text: s.text });
      }
      setSelection({ ranges: next });
    } else {
      const existing = selection?.ranges ?? [];
      const idx = existing.findIndex((r) => r.segmentId === segment.id);
      if (idx >= 0) {
        const next = existing.slice(0, idx).concat(existing.slice(idx + 1));
        setSelection(next.length > 0 ? { ranges: next } : null);
      } else {
        const next = [
          ...existing,
          { segmentId: segment.id, start: 0, end: segment.text.length, text: segment.text },
        ];
        setSelection({ ranges: next });
      }
    }
    lastClickedSegmentIdxRef.current = segmentIdx;
  }

  function handleClearSelection() {
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  }

  function startEdit(segmentId: string, currentText: string) {
    setEditMode({ kind: 'edit', segmentId, draft: currentText });
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  }

  function startAddAfter(segmentId: string) {
    if (!project) return;
    const seg = project.data.source_segments.find((s) => s.id === segmentId);
    if (!seg) return;
    setEditMode({
      kind: 'add',
      afterSegmentId: segmentId,
      participantId: seg.participantId,
      sourceFile: seg.sourceFile,
      draft: '',
    });
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  }

  function cancelEditMode() {
    setEditMode({ kind: 'none' });
  }

  function commitEditMode() {
    if (!project) return;
    if (editMode.kind === 'edit') {
      try {
        const out = buildEditedSegment(project.data, {
          segmentId: editMode.segmentId,
          newText: editMode.draft,
          now: new Date().toISOString(),
        });
        applyCommand(makeEditSegmentCommand(out.oldSegment, out.newSegment));
      } catch (e) {
        if (e instanceof SegmentEditError) alert(e.message);
        else throw e;
        return;
      }
    } else if (editMode.kind === 'add') {
      try {
        const seg = buildInsertedSegment(project.data, {
          participantId: editMode.participantId,
          sourceFile: editMode.sourceFile,
          afterSegmentId: editMode.afterSegmentId,
          text: editMode.draft,
          now: new Date().toISOString(),
        });
        applyCommand(makeInsertSegmentCommand(seg));
      } catch (e) {
        if (e instanceof SegmentEditError) alert(e.message);
        else throw e;
        return;
      }
    }
    setEditMode({ kind: 'none' });
  }

  function cardChangePlacement(cardId: string, target: 'unclassified' | 'pending' | 'canvas') {
    if (!project) return;
    const card = project.data.cards.find((c) => c.id === cardId);
    if (!card) return;
    const pos = project.data.card_positions.find((p) => p.cardId === cardId);
    applyCommand(
      makeSetCardPlacementCommand(
        cardId,
        {
          placement: card.placement ?? 'canvas',
          position: pos ? { x: pos.x, y: pos.y } : null,
          updatedAt: card.updatedAt,
        },
        { placement: target, now: new Date().toISOString() }
      )
    );
    setCardContext(null);
  }

  function handleDeleteCard(cardId: string) {
    if (!project) return;
    const card = project.data.cards.find((c) => c.id === cardId);
    if (!card) return;
    if (!confirm(`カード ${card.code} を削除しますか？ (Undo で復元できます)`)) return;
    const links = project.data.card_source_links.filter((l) => l.cardId === cardId);
    const pos = project.data.card_positions.find((p) => p.cardId === cardId) ?? null;
    applyCommand(makeDeleteCardCommand(card, links, pos));
    setCardContext(null);
  }

  function toggleMergeCandidate(cardId: string) {
    setMergeBuffer((prev) =>
      prev.includes(cardId) ? prev.filter((id) => id !== cardId) : [...prev, cardId]
    );
    setCardContext(null);
  }

  function clearMergeBuffer() {
    setMergeBuffer([]);
  }

  function handleConfirmMerge() {
    if (!project) return;
    if (mergeBuffer.length < 2) return;
    const oldCards = project.data.cards.filter((c) => mergeBuffer.includes(c.id));
    const participantIds = new Set(oldCards.map((c) => c.participantId));
    if (participantIds.size > 1) {
      alert('異なる参加者のカードは結合できません');
      return;
    }
    const codes = oldCards
      .slice()
      .sort((a, b) => a.serialNumber - b.serialNumber)
      .map((c) => c.code)
      .join(', ');
    if (
      !confirm(
        `${oldCards.length} 枚のカード (${codes}) を 1 枚に結合しますか？\n(Undo で復元できます)`
      )
    ) {
      return;
    }
    try {
      const out = buildMergedCard(project.data, {
        cardIds: mergeBuffer,
        now: new Date().toISOString(),
      });
      applyCommand(makeMergeCardsCommand(out));
      selectCard(out.newCard.id);
      setMergeBuffer([]);
    } catch (e) {
      if (e instanceof MergeError) {
        alert(e.message);
      } else {
        throw e;
      }
    }
  }

  // Prune merge buffer when cards are removed (e.g., after merge / delete / undo)
  useEffect(() => {
    if (!project || mergeBuffer.length === 0) return;
    const valid = new Set(project.data.cards.map((c) => c.id));
    const cleaned = mergeBuffer.filter((id) => valid.has(id));
    if (cleaned.length !== mergeBuffer.length) setMergeBuffer(cleaned);
  }, [project, mergeBuffer]);

  function handleConfirmSplit(parts: string[]) {
    if (!project || !splitCardId) return;
    try {
      const out = buildSplitCards(project.data, {
        cardId: splitCardId,
        bodyParts: parts,
        now: new Date().toISOString(),
      });
      applyCommand(makeSplitCardCommand(out));
      setSplitCardId(null);
      if (out.newCards.length > 0) selectCard(out.newCards[0].id);
    } catch (e) {
      if (e instanceof SplitError) alert(e.message);
      else throw e;
    }
  }

  useEffect(() => {
    if (!cardContext) return;
    const close = () => setCardContext(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [cardContext]);

  /**
   * Collect distinct speaker labels across all current segments, sorted by
   * frequency. Used to populate the speaker datalist for autocomplete.
   */
  const speakerSuggestions = useMemo(() => {
    if (!project) return [] as string[];
    const counts = new Map<string, number>();
    for (const s of project.data.source_segments) {
      const sp = s.speaker?.trim();
      if (!sp) continue;
      counts.set(sp, (counts.get(sp) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([s]) => s);
  }, [project]);

  function toggleSegmentSelection(segmentId: string) {
    setCheckedSegmentIds((prev) => {
      const next = new Set(prev);
      if (next.has(segmentId)) next.delete(segmentId);
      else next.add(segmentId);
      return next;
    });
  }

  function deleteSelectedSegments() {
    if (!project || checkedSegmentIds.size === 0) return;
    if (
      !confirm(
        `${checkedSegmentIds.size} 件のセグメントを削除しますか？ (Undo で復元できます)`
      )
    )
      return;
    const ids = Array.from(checkedSegmentIds);
    const prev: Record<string, string | null> = {};
    for (const s of project.data.source_segments) {
      if (checkedSegmentIds.has(s.id)) prev[s.id] = s.deletedAt;
    }
    applyCommand(
      makeDeleteSegmentsBulkCommand(ids, new Date().toISOString(), prev)
    );
    setCheckedSegmentIds(new Set());
  }

  function deleteFileSegments(fileName: string) {
    if (!project) return;
    const data = project.data;
    const targets = data.source_segments.filter(
      (s) => s.sourceFile === fileName && s.deletedAt === null
    );
    if (targets.length === 0) return;
    const targetIds = new Set(targets.map((s) => s.id));
    // (#1) このファイルにセグメントを持つ参加者のうち，削除後に「残る active
    // セグメント無し かつ カード無し」になる参加者を孤立として一緒に削除する.
    const fileParticipantIds = new Set(targets.map((s) => s.participantId));
    const orphaned = data.participants.filter((p) => {
      if (!fileParticipantIds.has(p.id)) return false;
      const hasOtherActiveSeg = data.source_segments.some(
        (s) => s.participantId === p.id && s.deletedAt === null && !targetIds.has(s.id)
      );
      if (hasOtherActiveSeg) return false;
      const hasCards = data.cards.some((c) => c.participantId === p.id);
      return !hasCards;
    });
    // カスケード削除: このファイルのセグメントを 1 つでも参照しているカードは
    // 連鎖削除（リンク・配置・グループ所属も併せて消す．Undo で復元される）．
    const cascadedCardIds = new Set(
      data.card_source_links
        .filter((l) => targetIds.has(l.segmentId))
        .map((l) => l.cardId)
    );
    const cascadedCards = data.cards.filter((c) => cascadedCardIds.has(c.id));
    const cascadedLinks = data.card_source_links.filter((l) => cascadedCardIds.has(l.cardId));
    const cascadedPositions = data.card_positions.filter((p) => cascadedCardIds.has(p.cardId));
    const cascadedMemberships = data.group_memberships.filter((m) => cascadedCardIds.has(m.cardId));
    const partNote =
      orphaned.length > 0 ? `\nカードの無い参加者 ${orphaned.length} 名も削除されます．` : '';
    const cardNote =
      cascadedCards.length > 0
        ? `\nこのファイル由来のセグメントを参照するカード ${cascadedCards.length} 枚も削除されます．`
        : '';
    if (
      !confirm(
        `ファイル「${fileName}」の ${targets.length} 件のセグメントをすべて削除しますか？${cardNote}${partNote}\n(Undo で復元できます)`
      )
    )
      return;
    const prev: Record<string, string | null> = {};
    for (const s of targets) prev[s.id] = s.deletedAt;
    applyCommand(
      makeDeleteFileCommand(
        targets.map((s) => s.id),
        new Date().toISOString(),
        prev,
        orphaned,
        cascadedCards,
        cascadedLinks,
        cascadedPositions,
        cascadedMemberships
      )
    );
  }

  function commitSpeaker(segmentId: string, next: string) {
    if (!project) return;
    const seg = project.data.source_segments.find((s) => s.id === segmentId);
    if (!seg) return;
    const cleaned = next.trim() || undefined;
    if ((seg.speaker ?? undefined) === cleaned) {
      setSpeakerEditFor(null);
      return;
    }
    applyCommand(makeSetSegmentSpeakerCommand(segmentId, seg.speaker, cleaned));
    setSpeakerEditFor(null);
  }

  function deleteSegment(segmentId: string) {
    if (!project) return;
    const linkedCardCount = project.data.card_source_links.filter(
      (l) => l.segmentId === segmentId
    ).length;
    const msg =
      linkedCardCount > 0
        ? `このセグメントを参照しているカードが ${linkedCardCount} 件あります．削除しても旧版データは保持されるためカードは壊れませんが，原文ビューアからは消えます．削除しますか？`
        : 'このセグメントを削除しますか？（Undo で復元できます）';
    if (!confirm(msg)) return;
    applyCommand(makeDeleteSegmentCommand(segmentId, new Date().toISOString()));
  }

  useEffect(() => {
    if (!selectedSegmentId || !containerRef.current) return;
    const el = containerRef.current.querySelector<HTMLElement>(
      `[data-segment-id="${selectedSegmentId}"]`
    );
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [selectedSegmentId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      window.getSelection()?.removeAllRanges();
      setSelection(null);
      lastClickedSegmentIdxRef.current = -1;
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!project) {
    return <div className="empty-state">プロジェクトがありません</div>;
  }
  if (segments.length === 0) {
    return <div className="empty-state">取り込まれたテキストがありません</div>;
  }

  const contextCard = cardContext
    ? project.data.cards.find((c) => c.id === cardContext.cardId)
    : null;

  return (
    <div className="source-viewer" ref={containerRef} onMouseUp={handleMouseUp}>
      <div className="source-viewer-toolbar">
        <button
          type="button"
          onClick={openFreeCardDialog}
          title="原文と紐付けずカードを 1 枚作る (フィールドノート等)"
        >
          + 新規カード
        </button>
        {selection ? (
          <>
            <button type="button" className="primary" onClick={handleCardize}>
              カード化 ({selectionTotalLen} 字
              {selectionSegmentCount > 1 ? ` / ${selectionSegmentCount} セグメント` : ''})
            </button>
            {selectionSegmentCount > 1 && (
              <button type="button" onClick={handleCardizePerSegment}>
                セグメントごとにカード化 ({selectionSegmentCount} 枚)
              </button>
            )}
            <button type="button" onClick={handleClearSelection}>
              選択解除
            </button>
          </>
        ) : (
          <span className="hint">
            ドラッグで範囲選択 / Ctrl+クリックで複数セグメント / Shift+クリックで範囲拡張
          </span>
        )}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {checkedSegmentIds.size > 0 && (
            <>
              <span className="muted small" style={{ alignSelf: 'center' }}>
                選択 {checkedSegmentIds.size} 件
              </span>
              <button
                type="button"
                className="danger"
                onClick={deleteSelectedSegments}
              >
                選択を削除
              </button>
              <button type="button" onClick={() => setCheckedSegmentIds(new Set())}>
                選択解除
              </button>
            </>
          )}
          <FileDeleteMenu
            files={Array.from(
              new Set(
                (project?.data.source_segments ?? [])
                  .filter((s) => s.deletedAt === null)
                  .map((s) => s.sourceFile)
              )
            )}
            onDeleteFile={deleteFileSegments}
          />
          <button
            type="button"
            onClick={toggleAllExpanded}
            title={defaultExpanded ? '全カードを縮小表示に' : '全カードを全文表示に'}
          >
            {defaultExpanded ? '全カード縮小' : '全カード展開'}
          </button>
        </span>
      </div>
      <datalist id="speaker-suggestions">
        {speakerSuggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <div
        className="source-viewer-toolbar"
        style={{ borderTop: 'none', paddingTop: 4 }}
      >
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="原文を検索..."
          style={{ width: 200 }}
        />
        {searchMatches.length > 0 && (
          <>
            <span className="muted small">
              {searchActiveIndex + 1} / {searchMatches.length}
            </span>
            <button
              type="button"
              className="segment-action-btn"
              onClick={() =>
                setSearchActiveIndex(
                  (searchActiveIndex - 1 + searchMatches.length) % searchMatches.length
                )
              }
            >
              ◀
            </button>
            <button
              type="button"
              className="segment-action-btn"
              onClick={() =>
                setSearchActiveIndex((searchActiveIndex + 1) % searchMatches.length)
              }
            >
              ▶
            </button>
          </>
        )}
        {searchQuery && searchMatches.length === 0 && (
          <span className="muted small">マッチなし</span>
        )}
        <span className="toolbar-spacer" />
        <span className="search-filter-row" style={{ marginBottom: 0 }}>
          <button
            type="button"
            className={`chip ${filterMode === 'all' ? 'active' : ''}`}
            onClick={() => setFilterMode('all')}
          >
            すべて
          </button>
          <button
            type="button"
            className={`chip ${filterMode === 'no_cards' ? 'active' : ''}`}
            onClick={() => setFilterMode('no_cards')}
          >
            未カード化のみ
          </button>
          <button
            type="button"
            className={`chip ${filterMode === 'has_cards' ? 'active' : ''}`}
            onClick={() => setFilterMode('has_cards')}
          >
            カード化済みのみ
          </button>
        </span>
        {sourceFiles.length > 1 && (
          <select
            value={filterFile ?? ''}
            onChange={(e) => setFilterFile(e.target.value || null)}
            style={{ width: 180 }}
          >
            <option value="">全ファイル</option>
            {sourceFiles.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        )}
        <span className="toolbar-spacer" />
        <div className="mode-switcher">
          <button
            type="button"
            className={`mode-btn ${readMode === 'detail' ? 'active' : ''}`}
            onClick={() => setReadMode('detail')}
            title="セグメント詳細（カード付き）"
          >
            詳細
          </button>
          <button
            type="button"
            className={`mode-btn ${readMode === 'continuous' ? 'active' : ''}`}
            onClick={() => setReadMode('continuous')}
            title="連続読み（カード非表示）"
          >
            連続読み
          </button>
        </div>
        <button
          type="button"
          onClick={() => setDisplayPopupOpen((v) => !v)}
          title="フォントサイズ・行間"
        >
          表示
        </button>
        {displayPopupOpen && (
          <div className="source-display-popup" onClick={(e) => e.stopPropagation()}>
            <label className="block-label">フォントサイズ ({displayConfig.fontSize}px)</label>
            <input
              type="range"
              min={10}
              max={22}
              value={displayConfig.fontSize}
              onChange={(e) =>
                setDisplayConfig((c) => ({ ...c, fontSize: Number(e.target.value) }))
              }
            />
            <label className="block-label">行間 ({displayConfig.lineHeight.toFixed(2)})</label>
            <input
              type="range"
              min={1.2}
              max={2.4}
              step={0.05}
              value={displayConfig.lineHeight}
              onChange={(e) =>
                setDisplayConfig((c) => ({ ...c, lineHeight: Number(e.target.value) }))
              }
            />
            <label className="block-label">セグメント間隔 ({displayConfig.segmentGap}px)</label>
            <input
              type="range"
              min={0}
              max={32}
              value={displayConfig.segmentGap}
              onChange={(e) =>
                setDisplayConfig((c) => ({ ...c, segmentGap: Number(e.target.value) }))
              }
            />
            <div className="right-actions" style={{ marginTop: 4 }}>
              <button
                type="button"
                className="segment-action-btn"
                onClick={() =>
                  setDisplayConfig({ fontSize: 14, lineHeight: 1.7, segmentGap: 8 })
                }
              >
                既定値
              </button>
              <button
                type="button"
                className="segment-action-btn"
                onClick={() => setDisplayPopupOpen(false)}
              >
                閉じる
              </button>
            </div>
          </div>
        )}
      </div>
      <div
        className={`source-viewer-list ${readMode === 'continuous' ? 'continuous-mode' : ''}`}
        {...kbScroll}
      >
        {displaySegments.length === 0 && segments.length > 0 && (
          <div className="muted" style={{ padding: 12 }}>
            フィルタ条件に合うセグメントはありません．フィルタを変更してください．
          </div>
        )}
        {displaySegments.map((seg, idx) => {
          const ranges = linkedRanges.get(seg.id) ?? [];
          const isHighlighted = selectedSegmentId === seg.id;
          const isMultiSelected = selectedSegmentIds.has(seg.id);
          const isEditing = editMode.kind === 'edit' && editMode.segmentId === seg.id;
          const showAddRowAfter =
            editMode.kind === 'add' && editMode.afterSegmentId === seg.id;
          const segCards = segmentCardsMap.get(seg.id) ?? [];
          const hasCards = segCards.length > 0;
          const segMatchCount = searchMatches.filter((m) => m.segmentId === seg.id).length;
          const isActiveSearchMatch =
            searchMatches.length > 0 &&
            searchMatches[searchActiveIndex]?.segmentId === seg.id;
          return (
            <div key={seg.id} style={{ marginBottom: displayConfig.segmentGap }}>
              <div
                className={`segment-row ${isHighlighted ? 'highlighted' : ''} ${
                  isMultiSelected ? 'selected-for-card' : ''
                } ${isEditing ? 'editing' : ''} ${
                  hasCards ? 'has-cards' : 'no-cards'
                } ${segMatchCount > 0 ? 'has-search-match' : ''} ${
                  isActiveSearchMatch ? 'active-search-match' : ''
                }`}
                onClick={(e) => {
                  if (isEditing) return;
                  handleSegmentClick(e, idx);
                }}
              >
                <div className="segment-row-main">
                  <div className="segment-meta">
                    <input
                      type="checkbox"
                      checked={checkedSegmentIds.has(seg.id)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleSegmentSelection(seg.id)}
                      title="一括削除用に選択"
                    />
                    <span className="segment-file">{seg.sourceFile}</span>
                    <span className="segment-order">#{idx + 1}</span>
                    <span className="segment-id muted small" title="セグメント ID (内部)">
                      {seg.id.slice(0, 8)}
                    </span>
                    <span
                      className={`segment-card-badge ${hasCards ? 'has' : 'none'}`}
                      title={hasCards ? `${segCards.length} 枚のカード` : 'まだカード化されていない'}
                    >
                      {hasCards ? `${segCards.length} 枚` : '未カード化'}
                    </span>
                    {!isEditing && (
                      <span
                        className="segment-actions"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          className="segment-action-btn"
                          onClick={() => startEdit(seg.id, seg.text)}
                          title="このセグメントの本文を編集（旧版は履歴として保持されます）"
                        >
                          編集
                        </button>
                        <button
                          type="button"
                          className="segment-action-btn"
                          onClick={() => deleteSegment(seg.id)}
                          title="このセグメントを削除"
                        >
                          削除
                        </button>
                        <button
                          type="button"
                          className="segment-action-btn"
                          onClick={() => startAddAfter(seg.id)}
                          title="このセグメントの直後に新規セグメントを追加"
                        >
                          + 直後に追加
                        </button>
                      </span>
                    )}
                  </div>
                  {isEditing && editMode.kind === 'edit' ? (
                    <div className="segment-edit-block">
                      <textarea
                        className="segment-edit-textarea"
                        value={editMode.draft}
                        onChange={(e) =>
                          setEditMode({ ...editMode, draft: e.target.value })
                        }
                        rows={Math.max(3, Math.min(12, editMode.draft.split('\n').length + 1))}
                        autoFocus
                      />
                      <div className="segment-edit-actions">
                        <button type="button" onClick={cancelEditMode}>
                          キャンセル
                        </button>
                        <button
                          type="button"
                          className="primary"
                          onClick={commitEditMode}
                        >
                          保存（新版を作成）
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="segment-body-grid">
                      <p
                        className="segment-text"
                        data-segment-id={seg.id}
                        style={{
                          fontSize: displayConfig.fontSize,
                          lineHeight: displayConfig.lineHeight,
                        }}
                      >
                        {renderWithSearchAndRanges(seg.text, ranges, searchQuery)}
                      </p>
                      <div
                        className="segment-speaker-col"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {speakerEditFor === seg.id ? (
                          <input
                            type="text"
                            value={speakerEditDraft}
                            autoFocus
                            list="speaker-suggestions"
                            onChange={(e) => setSpeakerEditDraft(e.target.value)}
                            onBlur={() => commitSpeaker(seg.id, speakerEditDraft)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitSpeaker(seg.id, speakerEditDraft);
                              else if (e.key === 'Escape') setSpeakerEditFor(null);
                            }}
                            placeholder="話者..."
                            className="segment-speaker-input"
                          />
                        ) : (
                          <button
                            type="button"
                            className={`segment-speaker-pill ${seg.speaker ? 'has-speaker' : 'no-speaker'}`}
                            onClick={() => {
                              setSpeakerEditDraft(seg.speaker ?? '');
                              setSpeakerEditFor(seg.id);
                            }}
                            title="クリックで話者を編集"
                          >
                            {seg.speaker || '(話者未設定)'}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                <div
                  className="segment-row-cards"
                  onClick={(e) => e.stopPropagation()}
                >
                  {hasCards && (
                    <div className="segment-cards-header">
                      <button
                        type="button"
                        className="segment-action-btn"
                        onClick={() => toggleSegmentExpanded(seg.id, segCards)}
                        title="このセグメントの全カードを展開／縮小"
                      >
                        {isSegmentExpanded(seg.id) ? '▼ 全文' : '▶ 縮小'}
                      </button>
                    </div>
                  )}
                  {hasCards ? (
                    segCards.map((card) => (
                      <SegmentMiniCard
                        key={card.id}
                        card={card}
                        expanded={isCardExpanded(card.id, seg.id)}
                        inMergeBuffer={mergeBuffer.includes(card.id)}
                        onClick={() => {
                          selectCard(card.id);
                          toggleCardExpanded(card.id, seg.id);
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          selectCard(card.id);
                          setCardContext({
                            x: e.clientX,
                            y: e.clientY,
                            cardId: card.id,
                          });
                        }}
                      />
                    ))
                  ) : (
                    <div className="segment-no-cards muted small">未カード化</div>
                  )}
                </div>
              </div>
              {showAddRowAfter && editMode.kind === 'add' && (
                <div className="segment-row segment-row-add">
                  <div className="segment-meta">
                    <span className="segment-file">{seg.sourceFile}</span>
                    <span className="segment-order muted">(新規セグメント)</span>
                  </div>
                  <div className="segment-edit-block">
                    <textarea
                      className="segment-edit-textarea"
                      value={editMode.draft}
                      onChange={(e) =>
                        setEditMode({ ...editMode, draft: e.target.value })
                      }
                      rows={4}
                      placeholder="新しいセグメントの本文を入力..."
                      autoFocus
                    />
                    <div className="segment-edit-actions">
                      <button type="button" onClick={cancelEditMode}>
                        キャンセル
                      </button>
                      <button
                        type="button"
                        className="primary"
                        onClick={commitEditMode}
                      >
                        追加
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {cardContext && contextCard && (
        <div
          className="card-context-menu"
          style={{ left: cardContext.x, top: cardContext.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => cardChangePlacement(cardContext.cardId, 'pending')}
          >
            保留に移す
          </button>
          <button
            type="button"
            onClick={() =>
              cardChangePlacement(cardContext.cardId, 'unclassified')
            }
          >
            未分類に戻す
          </button>
          <button
            type="button"
            onClick={() => cardChangePlacement(cardContext.cardId, 'canvas')}
          >
            キャンバスに置く
          </button>
          <div className="card-context-menu-sep" />
          <button
            type="button"
            onClick={() => {
              setSplitCardId(cardContext.cardId);
              setCardContext(null);
            }}
          >
            分割...
          </button>
          <button
            type="button"
            onClick={() => toggleMergeCandidate(cardContext.cardId)}
          >
            {mergeBuffer.includes(cardContext.cardId)
              ? '結合候補から外す'
              : `結合候補に追加 (現在 ${mergeBuffer.length} 枚)`}
          </button>
          <div className="card-context-menu-sep" />
          <button
            type="button"
            onClick={() => handleDeleteCard(cardContext.cardId)}
            className="danger"
          >
            カードを削除
          </button>
        </div>
      )}
      {mergeBuffer.length > 0 && (
        <div className="merge-action-bar">
          <span className="muted small">結合候補</span>
          <strong>{mergeBuffer.length} 枚</strong>
          <button
            type="button"
            className="primary"
            disabled={mergeBuffer.length < 2}
            onClick={handleConfirmMerge}
            title={
              mergeBuffer.length < 2
                ? 'もう 1 枚追加してください'
                : `${mergeBuffer.length} 枚を 1 枚に結合`
            }
          >
            結合 ({mergeBuffer.length} 枚 → 1 枚)
          </button>
          <button type="button" onClick={clearMergeBuffer}>
            クリア
          </button>
        </div>
      )}
      <CardSplitDialog
        open={splitCardId !== null}
        card={
          splitCardId
            ? project.data.cards.find((c) => c.id === splitCardId) ?? null
            : null
        }
        onClose={() => setSplitCardId(null)}
        onConfirm={handleConfirmSplit}
      />
      {freeCardOpen && (
        <div className="modal-backdrop" onClick={() => setFreeCardOpen(false)}>
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 520 }}
          >
            <header className="modal-header">
              <h2>新規カード (原文紐付け無し)</h2>
            </header>
            <div className="modal-body">
              <p className="muted small">
                フィールドノートなど，原文を伴わずにカードを 1 枚作ります．
                未分類カードとして配置されるので，後でキャンバスに移動できます．
              </p>
              <div className="form-row">
                <label>本文</label>
                <textarea
                  value={freeCardBody}
                  onChange={(e) => setFreeCardBody(e.target.value)}
                  rows={6}
                  autoFocus
                  placeholder="カードの本文を入力してください"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
              </div>
              <div className="form-row">
                <label>参加者</label>
                <select
                  value={freeCardParticipantId}
                  onChange={(e) => setFreeCardParticipantId(e.target.value)}
                  style={{ width: '100%' }}
                >
                  <option value="">
                    {FREE_PARTICIPANT_NAME} ({FREE_PARTICIPANT_CODE})
                  </option>
                  {(project?.data.participants ?? [])
                    .filter((p) => p.code !== FREE_PARTICIPANT_CODE)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.code}: {p.displayName}
                      </option>
                    ))}
                </select>
                <span className="muted small">
                  既定の「(自由メモ)」を選ぶと，フィールドノート用の専用参加者にカードが
                  作られます．特定の参加者を選べばその人のカードになります．
                </span>
              </div>
              {freeCardError && (
                <div className="error" style={{ marginTop: 8 }}>
                  {freeCardError}
                </div>
              )}
            </div>
            <footer className="modal-footer">
              <button type="button" onClick={() => setFreeCardOpen(false)}>
                キャンセル
              </button>
              <button
                type="button"
                className="primary"
                onClick={submitFreeCard}
                disabled={freeCardBody.trim().length === 0}
              >
                作成
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

function FileDeleteMenu({
  files,
  onDeleteFile,
}: {
  files: string[];
  onDeleteFile(file: string): void;
}) {
  const [open, setOpen] = useState(false);
  if (files.length === 0) return null;
  return (
    <span style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="ファイル単位でセグメントを削除"
      >
        ファイル削除 ▾
      </button>
      {open && (
        <div
          className="recent-files-menu"
          onMouseLeave={() => setOpen(false)}
          style={{ right: 0, left: 'auto', top: '100%' }}
        >
          <div className="recent-files-header muted small">削除対象のファイル</div>
          {files.map((f) => (
            <button
              key={f}
              type="button"
              className="recent-files-item"
              onClick={() => {
                onDeleteFile(f);
                setOpen(false);
              }}
            >
              <div className="recent-files-name">{f}</div>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

function SegmentMiniCard({
  card,
  expanded,
  inMergeBuffer,
  onClick,
  onContextMenu,
}: {
  card: Card;
  expanded: boolean;
  inMergeBuffer?: boolean;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const project = useProjectStore((s) => s.project);
  const applyCommand = useProjectStore((s) => s.applyCommand);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(card.body);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!editing) setDraft(card.body);
  }, [card.body, editing]);

  useEffect(() => {
    if (editing && taRef.current) {
      taRef.current.focus();
      taRef.current.select();
    }
  }, [editing]);

  const placement = effectivePlacement(card);

  const commit = () => {
    if (!project) {
      setEditing(false);
      return;
    }
    if (draft !== card.body) {
      applyCommand(
        makeEditCardBodyCommand(
          card.id,
          card.body,
          draft,
          new Date().toISOString(),
          card.updatedAt
        )
      );
    }
    setEditing(false);
  };

  return (
    <div
      className={`segment-mini-card placement-${placement} ${expanded ? 'expanded' : 'condensed'} ${editing ? 'editing' : ''} ${inMergeBuffer ? 'merge-buffer' : ''}`}
      title={`${card.code} (${PLACEMENT_LABELS[placement]}) — クリックで展開 / ダブルクリックで編集 / 右クリックで操作${inMergeBuffer ? ' / 結合候補に追加済' : ''}`}
      onClick={editing ? (e) => e.stopPropagation() : onClick}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (!editing) {
          setDraft(card.body);
          setEditing(true);
        }
      }}
      onContextMenu={editing ? undefined : onContextMenu}
    >
      <div className="segment-mini-card-code">{card.code}</div>
      {editing ? (
        <textarea
          ref={taRef}
          className="segment-mini-card-edit"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              setEditing(false);
              setDraft(card.body);
            } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              commit();
            }
          }}
          rows={Math.max(3, Math.min(8, draft.split('\n').length + 1))}
        />
      ) : (
        <div className="segment-mini-card-body">
          {card.body
            ? expanded
              ? card.body
              : card.body.slice(0, 80) + (card.body.length > 80 ? '…' : '')
            : '(本文なし)'}
        </div>
      )}
    </div>
  );
}

function findEnclosingSegment(
  node: Node | null,
  segmentEls: HTMLElement[]
): HTMLElement | null {
  let cur: Node | null = node;
  while (cur) {
    if (cur instanceof HTMLElement && cur.dataset.segmentId) return cur;
    cur = cur.parentNode;
  }
  // Maybe the node IS one of the segment elements
  if (node instanceof HTMLElement && segmentEls.includes(node)) return node;
  return null;
}

function nearestSegmentIndex(
  node: Node,
  segmentEls: HTMLElement[],
  bias: 'start' | 'end'
): number {
  for (let i = 0; i < segmentEls.length; i++) {
    const segEl = segmentEls[i];
    const pos = segEl.compareDocumentPosition(node);
    if (segEl.contains(node) || pos === 0) return i;
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) {
      // node is before segEl: pick previous (i-1) for end-bias, or i for start-bias
      return bias === 'start' ? i : Math.max(0, i - 1);
    }
  }
  return segmentEls.length - 1;
}

function clampOffset(offset: number, max: number): number {
  if (offset < 0) return 0;
  if (offset > max) return max;
  return offset;
}

function getOffsetWithin(
  segmentEl: HTMLElement,
  container: Node,
  offsetInContainer: number
): number {
  try {
    const r = document.createRange();
    r.setStart(segmentEl, 0);
    r.setEnd(container, offsetInContainer);
    return r.cloneContents().textContent?.length ?? 0;
  } catch {
    return 0;
  }
}

function renderWithRanges(
  text: string,
  ranges: Array<{ start: number; end: number; cardId: string }>
) {
  if (ranges.length === 0) return text;
  const sorted = ranges.slice().sort((a, b) => a.start - b.start);
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  sorted.forEach((r, i) => {
    if (r.start > cursor) parts.push(text.slice(cursor, r.start));
    parts.push(
      <span key={`r-${i}`} className="linked-range" title={`card: ${r.cardId}`}>
        {text.slice(r.start, r.end)}
      </span>
    );
    cursor = Math.max(cursor, r.end);
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

function renderWithSearchAndRanges(
  text: string,
  ranges: Array<{ start: number; end: number; cardId: string }>,
  searchQuery: string
): React.ReactNode {
  // Build a list of overlay regions: linked-range and search-match
  type Region = { start: number; end: number; kind: 'range' | 'match'; cardId?: string };
  const regions: Region[] = ranges.map((r) => ({
    start: r.start,
    end: r.end,
    kind: 'range',
    cardId: r.cardId,
  }));
  if (searchQuery.trim()) {
    const lower = text.toLowerCase();
    const q = searchQuery.toLowerCase();
    let pos = 0;
    while (true) {
      const i = lower.indexOf(q, pos);
      if (i < 0) break;
      regions.push({ start: i, end: i + q.length, kind: 'match' });
      pos = i + q.length;
    }
  }
  if (regions.length === 0) return text;
  // Sort by start; on tie, search match wins (rendered inside)
  regions.sort((a, b) => a.start - b.start || (a.kind === 'match' ? -1 : 1));
  // Render with simple overlay (no merging of overlaps — linked-range may wrap match span as plain text)
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  regions.forEach((r, i) => {
    if (r.start >= cursor) {
      if (r.start > cursor) parts.push(text.slice(cursor, r.start));
      const inner = text.slice(r.start, r.end);
      if (r.kind === 'range') {
        parts.push(
          <span key={`r-${i}`} className="linked-range" title={`card: ${r.cardId}`}>
            {inner}
          </span>
        );
      } else {
        parts.push(
          <mark key={`m-${i}`} className="search-match">
            {inner}
          </mark>
        );
      }
      cursor = r.end;
    }
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}
