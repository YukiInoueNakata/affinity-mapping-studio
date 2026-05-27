import type {
  GtaCategory,
  GtaCode,
  GtaCodeApplication,
  GtaCodeStatus,
  GtaCodeType,
  ProjectData,
} from '@shared/types/domain';
import { newId } from './ids.js';

export const GTA_CODE_TYPE_LABELS: Record<GtaCodeType, string> = {
  open: 'オープン',
  in_vivo: 'インビボ',
  focused: 'フォーカスト',
  axial: 'アキシャル',
  selective: '選択的',
  custom: 'カスタム',
};

export const GTA_CODE_STATUS_LABELS: Record<GtaCodeStatus, string> = {
  draft: '草案',
  active: '採用',
  reviewed: 'レビュー済',
  merged: '統合済',
  rejected: '却下',
  archived: 'アーカイブ',
};

export class GtaError extends Error {}

export function nextCodeName(data: ProjectData): string {
  const used = new Set(data.gta_codes.map((c) => c.name));
  let n = 1;
  while (used.has(`コード ${n}`)) n++;
  return `コード ${n}`;
}

export function buildGtaCode(input: {
  name?: string;
  definition?: string;
  codeType?: GtaCodeType;
  parentCodeId?: string;
  categoryId?: string;
  status?: GtaCodeStatus;
  now: string;
}): GtaCode {
  return {
    id: newId(),
    name: input.name ?? '',
    definition: input.definition,
    codeType: input.codeType ?? 'open',
    parentCodeId: input.parentCodeId,
    categoryId: input.categoryId,
    status: input.status ?? 'draft',
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function buildCodeApplication(input: {
  codeId: string;
  targetType: 'source_segment' | 'card' | 'selected_range';
  targetId: string;
  startOffset?: number;
  endOffset?: number;
  selectedTextSnapshot?: string;
  memo?: string;
  now: string;
}): GtaCodeApplication {
  return {
    id: newId(),
    codeId: input.codeId,
    targetType: input.targetType,
    targetId: input.targetId,
    startOffset: input.startOffset,
    endOffset: input.endOffset,
    selectedTextSnapshot: input.selectedTextSnapshot,
    memo: input.memo,
    createdAt: input.now,
  };
}

export function buildGtaCategory(input: {
  name: string;
  definition?: string;
  parentCategoryId?: string;
  isCoreCategory?: boolean;
  now: string;
}): GtaCategory {
  return {
    id: newId(),
    name: input.name.trim(),
    definition: input.definition,
    parentCategoryId: input.parentCategoryId,
    isCoreCategory: input.isCoreCategory,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function getCodesForCategory(
  data: ProjectData,
  categoryId: string | null
): GtaCode[] {
  if (categoryId === null) return data.gta_codes.filter((c) => !c.categoryId);
  return data.gta_codes.filter((c) => c.categoryId === categoryId);
}

export function getApplicationsForCode(
  data: ProjectData,
  codeId: string
): GtaCodeApplication[] {
  return data.gta_code_applications.filter((a) => a.codeId === codeId);
}

export function getApplicationsForCard(
  data: ProjectData,
  cardId: string
): GtaCodeApplication[] {
  return data.gta_code_applications.filter(
    (a) => a.targetType === 'card' && a.targetId === cardId
  );
}

export function getApplicationsForSegment(
  data: ProjectData,
  segmentId: string
): GtaCodeApplication[] {
  return data.gta_code_applications.filter(
    (a) => a.targetType === 'source_segment' && a.targetId === segmentId
  );
}

export interface BuildCodeFromKjLabelInput {
  groupId: string;
  codeType?: GtaCodeType;
  now: string;
}

/** Create a GTA code candidate from a KJ group label. */
export function buildCodeFromKjGroup(
  data: ProjectData,
  input: BuildCodeFromKjLabelInput
): GtaCode {
  const group = data.groups.find((g) => g.id === input.groupId);
  if (!group) throw new GtaError('グループが見つかりません');
  const label = data.labels.find((l) => l.groupId === input.groupId);
  const name = label?.text?.trim() || group.name;
  const definition = label?.basisMemo || label?.sharedMemo || '';
  return buildGtaCode({
    name,
    definition,
    codeType: input.codeType ?? 'open',
    now: input.now,
  });
}
