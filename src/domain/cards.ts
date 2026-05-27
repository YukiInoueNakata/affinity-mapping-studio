import type {
  Card,
  CardPlacement,
  CardPosition,
  CardSourceLink,
  GroupMembership,
  Participant,
  ProjectData,
  SourceSegment,
} from '@shared/types/domain';
import { formatCardCode, newId } from './ids.js';

export const PLACEMENT_LABELS: Record<CardPlacement, string> = {
  canvas: 'キャンバス',
  unclassified: '未分類',
  pending: '分類留保',
};

export function effectivePlacement(card: { placement?: CardPlacement }): CardPlacement {
  return card.placement ?? 'canvas';
}

export function getCardsByPlacement(
  data: ProjectData,
  placement: CardPlacement
): Card[] {
  return data.cards.filter((c) => effectivePlacement(c) === placement);
}

export function nextCardSerial(data: ProjectData, participantId: string): number {
  let max = 0;
  for (const c of data.cards) {
    if (c.participantId === participantId && c.serialNumber > max) max = c.serialNumber;
  }
  return max + 1;
}

export function nextCardPositionForParticipant(
  data: ProjectData,
  participantId: string
): { x: number; y: number } {
  const cardsOfP = data.cards.filter((c) => c.participantId === participantId);
  const count = cardsOfP.length;
  const baseX = 80;
  const baseY = 80;
  const step = 28;
  return { x: baseX + (count % 12) * step, y: baseY + Math.floor(count / 12) * step };
}

export interface SourceRangeInput {
  segment: SourceSegment;
  startOffset: number;
  endOffset: number;
  selectedText: string;
}

export interface CreateCardInput {
  participant: Participant;
  ranges: SourceRangeInput[];
  now: string;
}

export interface CreateCardOutput {
  card: Card;
  links: CardSourceLink[];
  position: CardPosition;
}

export interface MergeCardsInput {
  cardIds: string[];
  now: string;
}

export interface MergeCardsOutput {
  newCard: Card;
  newLinks: CardSourceLink[];
  newPosition: CardPosition;
  newMembership: GroupMembership | null;
  oldCards: Card[];
  oldLinks: CardSourceLink[];
  oldPositions: CardPosition[];
  oldMemberships: GroupMembership[];
}

export class MergeError extends Error {}

export function buildMergedCard(data: ProjectData, input: MergeCardsInput): MergeCardsOutput {
  const ids = input.cardIds;
  if (ids.length < 2) {
    throw new MergeError('結合するには 2 枚以上のカードを選択してください');
  }
  const oldCards = data.cards.filter((c) => ids.includes(c.id));
  if (oldCards.length !== ids.length) {
    throw new MergeError('選択されたカードの一部が見つかりませんでした');
  }
  const participantIds = new Set(oldCards.map((c) => c.participantId));
  if (participantIds.size > 1) {
    throw new MergeError(
      '異なる参加者のカードは結合できません (まず同じ参加者のカードを選択してください)'
    );
  }
  const participantId = oldCards[0].participantId;
  const participant = data.participants.find((p) => p.id === participantId);
  if (!participant) {
    throw new MergeError('参加者情報が見つかりませんでした');
  }
  const sortedOld = oldCards.slice().sort((a, b) => a.serialNumber - b.serialNumber);
  const body = sortedOld
    .map((c) => c.body.trim())
    .filter((s) => s.length > 0)
    .join('');
  const oldLinks = data.card_source_links.filter((l) => ids.includes(l.cardId));
  const oldPositions = data.card_positions.filter((p) => ids.includes(p.cardId));
  const oldMemberships = data.group_memberships.filter((m) => ids.includes(m.cardId));
  const groupSet = new Set(oldMemberships.map((m) => m.groupId));
  const sharedGroupId = groupSet.size === 1 ? Array.from(groupSet)[0] : null;
  const serial = nextCardSerial(data, participantId);
  const code = formatCardCode(participant.code, serial);
  const newCardId = newId();
  const newCard: Card = {
    id: newCardId,
    participantId,
    code,
    serialNumber: serial,
    body,
    status: 'active',
    placement: 'canvas',
    createdAt: input.now,
    updatedAt: input.now,
  };
  const newLinks: CardSourceLink[] = oldLinks.map((l) => ({
    id: newId(),
    cardId: newCardId,
    segmentId: l.segmentId,
    startOffset: l.startOffset,
    endOffset: l.endOffset,
    selectedTextSnapshot: l.selectedTextSnapshot,
    createdAt: input.now,
  }));
  const avgX = oldPositions.length > 0
    ? oldPositions.reduce((a, p) => a + p.x, 0) / oldPositions.length
    : nextCardPositionForParticipant(data, participantId).x;
  const avgY = oldPositions.length > 0
    ? oldPositions.reduce((a, p) => a + p.y, 0) / oldPositions.length
    : nextCardPositionForParticipant(data, participantId).y;
  const newPosition: CardPosition = { cardId: newCardId, x: avgX, y: avgY };
  const newMembership: GroupMembership | null = sharedGroupId
    ? { id: newId(), cardId: newCardId, groupId: sharedGroupId, createdAt: input.now }
    : null;
  return {
    newCard,
    newLinks,
    newPosition,
    newMembership,
    oldCards,
    oldLinks,
    oldPositions,
    oldMemberships,
  };
}

export interface SplitCardInput {
  cardId: string;
  bodyParts: string[];
  now: string;
}

export interface SplitCardOutput {
  oldCard: Card;
  oldLinks: CardSourceLink[];
  oldPosition: CardPosition | null;
  oldMembership: GroupMembership | null;
  newCards: Card[];
  newLinks: CardSourceLink[];
  newPositions: CardPosition[];
  newMemberships: GroupMembership[];
}

export class SplitError extends Error {}

export function buildSplitCards(data: ProjectData, input: SplitCardInput): SplitCardOutput {
  const oldCard = data.cards.find((c) => c.id === input.cardId);
  if (!oldCard) throw new SplitError('カードが見つかりません');
  const trimmedParts = input.bodyParts.map((p) => p.trim()).filter((p) => p.length > 0);
  if (trimmedParts.length < 2) {
    throw new SplitError('分割後のカードが 2 枚以上になるよう本文を区切ってください');
  }
  const participant = data.participants.find((p) => p.id === oldCard.participantId);
  if (!participant) throw new SplitError('参加者情報が見つかりません');

  const oldLinks = data.card_source_links.filter((l) => l.cardId === oldCard.id);
  const oldPosition = data.card_positions.find((p) => p.cardId === oldCard.id) ?? null;
  const oldMembership =
    data.group_memberships.find((m) => m.cardId === oldCard.id) ?? null;
  const basePos = oldPosition ?? {
    cardId: oldCard.id,
    ...nextCardPositionForParticipant(data, oldCard.participantId),
  };
  const baseSerial = nextCardSerial(data, oldCard.participantId);

  const newCards: Card[] = [];
  const newLinks: CardSourceLink[] = [];
  const newPositions: CardPosition[] = [];
  const newMemberships: GroupMembership[] = [];
  for (let i = 0; i < trimmedParts.length; i++) {
    const cardId = newId();
    const serial = baseSerial + i;
    newCards.push({
      id: cardId,
      participantId: oldCard.participantId,
      code: formatCardCode(participant.code, serial),
      serialNumber: serial,
      body: trimmedParts[i],
      status: 'active',
      placement: oldCard.placement ?? 'canvas',
      createdAt: input.now,
      updatedAt: input.now,
    });
    for (const l of oldLinks) {
      newLinks.push({
        id: newId(),
        cardId,
        segmentId: l.segmentId,
        startOffset: l.startOffset,
        endOffset: l.endOffset,
        selectedTextSnapshot: l.selectedTextSnapshot,
        createdAt: input.now,
      });
    }
    newPositions.push({
      cardId,
      x: basePos.x + i * 28,
      y: basePos.y + i * 28,
    });
    if (oldMembership) {
      newMemberships.push({
        id: newId(),
        cardId,
        groupId: oldMembership.groupId,
        createdAt: input.now,
      });
    }
  }

  return {
    oldCard,
    oldLinks,
    oldPosition,
    oldMembership,
    newCards,
    newLinks,
    newPositions,
    newMemberships,
  };
}

// ---------------------------------------------------------------------------
// Free card support (no source segment).
//
// Used for fieldwork-style notes where the researcher writes cards directly
// without linking them to an imported source.  Backed by a well-known pseudo-
// participant with code "F" / displayName "(自由メモ)" so existing card-ID
// generation, participant filtering, and 未分類 placement all keep working
// unchanged — no schema-level change needed.
// ---------------------------------------------------------------------------

export const FREE_PARTICIPANT_CODE = 'F';
export const FREE_PARTICIPANT_NAME = '(自由メモ)';

/** Locate the existing "free notes" participant in this project (by well-known
 *  code), or fabricate a new one to be inserted by the caller.  The `isNew`
 *  flag signals whether the participant still needs to be added to
 *  data.participants. */
export function getOrCreateFreeParticipant(
  data: ProjectData,
  now: string
): { participant: Participant; isNew: boolean } {
  const existing = data.participants.find((p) => p.code === FREE_PARTICIPANT_CODE);
  if (existing) return { participant: existing, isNew: false };
  const participant: Participant = {
    id: newId(),
    code: FREE_PARTICIPANT_CODE,
    displayName: FREE_PARTICIPANT_NAME,
    createdAt: now,
  };
  return { participant, isNew: true };
}

export interface BuildFreeCardInput {
  text: string;
  /** Omit to use the (auto-created) "(自由メモ)" pseudo-participant. */
  participantId?: string;
  now: string;
}

export interface BuildFreeCardOutput {
  card: Card;
  position: CardPosition;
  /** Non-null when a brand new pseudo-participant needs to be appended to
   *  data.participants by the command/store layer. */
  newParticipant: Participant | null;
}

export function buildFreeCard(
  data: ProjectData,
  input: BuildFreeCardInput
): BuildFreeCardOutput {
  const text = input.text.trim();
  if (text.length === 0) {
    throw new Error('カード本文を入力してください');
  }
  let participant: Participant | undefined;
  let newParticipant: Participant | null = null;
  if (input.participantId) {
    participant = data.participants.find((p) => p.id === input.participantId);
    if (!participant) throw new Error('指定された参加者が見つかりません');
  } else {
    const r = getOrCreateFreeParticipant(data, input.now);
    participant = r.participant;
    if (r.isNew) newParticipant = r.participant;
  }
  const serial = nextCardSerial(data, participant.id);
  const code = formatCardCode(participant.code, serial);
  const cardId = newId();
  const card: Card = {
    id: cardId,
    participantId: participant.id,
    code,
    serialNumber: serial,
    body: text,
    status: 'active',
    placement: 'unclassified',
    createdAt: input.now,
    updatedAt: input.now,
  };
  const pos = nextCardPositionForParticipant(data, participant.id);
  const position: CardPosition = { cardId, x: pos.x, y: pos.y };
  return { card, position, newParticipant };
}

export function buildCard(data: ProjectData, input: CreateCardInput): CreateCardOutput {
  if (input.ranges.length === 0) {
    throw new Error('buildCard requires at least one source range');
  }
  const serial = nextCardSerial(data, input.participant.id);
  const code = formatCardCode(input.participant.code, serial);
  const cardId = newId();
  const body = input.ranges.map((r) => r.selectedText).join('\n');
  const card: Card = {
    id: cardId,
    participantId: input.participant.id,
    code,
    serialNumber: serial,
    body,
    status: 'active',
    placement: 'unclassified',
    createdAt: input.now,
    updatedAt: input.now,
  };
  const links: CardSourceLink[] = input.ranges.map((r) => ({
    id: newId(),
    cardId,
    segmentId: r.segment.id,
    startOffset: r.startOffset,
    endOffset: r.endOffset,
    selectedTextSnapshot: r.selectedText,
    createdAt: input.now,
  }));
  const pos = nextCardPositionForParticipant(data, input.participant.id);
  const position: CardPosition = { cardId, x: pos.x, y: pos.y };
  return { card, links, position };
}
