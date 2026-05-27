import { v4 as uuidv4 } from 'uuid';

export function newId(): string {
  return uuidv4();
}

export function formatCardCode(participantCode: string, serial: number): string {
  const n = String(serial).padStart(3, '0');
  return `${participantCode}-${n}`;
}

const CODE_RE = /^[A-Za-z][A-Za-z0-9]{0,9}$/;

export function isValidParticipantCode(code: string): boolean {
  return CODE_RE.test(code);
}
