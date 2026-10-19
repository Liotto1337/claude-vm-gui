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
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * Убирает временные пузыри, у которых появилась запись в журнале (новый user с тем же текстом и числом картинок;
 * каждая запись забирает не больше одного пузыря). Доставленный пузырь без записи уходит через 20 с.
 */
export function claimPending(pending: Pending[], items: ChatItem[], now: number): Pending[] {
  const claimed = new Set<string>();
  return pending.filter((p) => {
    const match = items.find(
      (i) => i.kind === 'user' && !p.seen.has(i.id) && !claimed.has(i.id) && i.images === p.images && norm(i.text) === norm(p.text),
    );
    if (match) {
      claimed.add(match.id);
      return false;
    }
    return !(p.state === 'sent' && now - p.at > SENT_TTL_MS);
  });
}
