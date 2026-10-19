import type { ChatItem } from '@shared/ipc';

// «Печать» ответа и временные пузыри отправленных сообщений — чистые функции для ленты.

const MIN_CPS = 120; // короткие ответы — примерно со скоростью чтения
const MAX_MS = 1500; // длинные — успевают за полторы секунды

/** Скорость «печати», символов в секунду. */
export const typingSpeed = (len: number): number => Math.max(MIN_CPS, Math.ceil(len / (MAX_MS / 1000)));

/** Сколько символов ответа длиной len показано через ms после начала. */
export function revealCount(len: number, ms: number): number {
  if (ms <= 0) return 0;
  return Math.min(len, Math.floor((ms / 1000) * typingSpeed(len)));
}

/** Сообщение, показанное до записи в журнал: sending — отправляется, sent — Claude Code его принял. */
export interface Pending {
  id: string;
  text: string;
  images: number;
  state: 'sending' | 'sent';
  /** id элементов ленты на момент отправки: запись журнала ищется среди новых */
  seen: Set<string>;
  /** когда стало sent (мс) */
  at: number;
}

const SENT_TTL_MS = 20_000;
// «!pwd» в поле и «! pwd» в журнале (bash-режим) — одно и то же сообщение
const norm = (s: string) => s.replace(/^\s*!\s*/, '! ').replace(/\s+/g, ' ').trim();

/**
 * Убирает временные пузыри, у которых появилась запись в журнале (новый user с тем же текстом и числом картинок).
 * Запись, забравшая пузырь, становится «виденной» для остальных — на следующих вызовах она второй пузырь не заберёт.
 * Доставленный пузырь без записи уходит через 20 с; пока Claude работает (busy), отсчёт стоит:
 * сообщение может ждать в очереди Claude Code.
 */
export function claimPending(pending: Pending[], items: ChatItem[], now: number, busy = false): Pending[] {
  const claimed: string[] = [];
  const left = pending.filter((p) => {
    const match = items.find(
      (i) => i.kind === 'user' && !p.seen.has(i.id) && !claimed.includes(i.id) && i.images === p.images && norm(i.text) === norm(p.text),
    );
    if (match) {
      claimed.push(match.id);
      return false;
    }
    return busy || !(p.state === 'sent' && now - p.at > SENT_TTL_MS);
  });
  if (claimed.length === 0 && !busy) return left;
  return left.map((p) => ({
    ...p,
    seen: claimed.length ? new Set([...p.seen, ...claimed]) : p.seen,
    at: busy && p.state === 'sent' ? now : p.at,
  }));
}
