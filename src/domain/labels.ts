import type {
  Label,
  TextRevision,
  TextRevisionFieldName,
} from '@shared/types/domain';
import { newId } from './ids.js';

export function makeTextRevision(
  targetId: string,
  fieldName: TextRevisionFieldName,
  beforeText: string,
  afterText: string,
  now: string
): TextRevision {
  return {
    id: newId(),
    targetType: 'label',
    targetId,
    fieldName,
    beforeText,
    afterText,
    timestamp: now,
  };
}

export function applyLabelFieldChange(
  label: Label,
  field: TextRevisionFieldName,
  value: string,
  now: string
): Label {
  return { ...label, [field]: value, updatedAt: now };
}
