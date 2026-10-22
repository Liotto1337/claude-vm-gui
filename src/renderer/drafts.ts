import { useSyncExternalStore } from 'react';
import type { Attachment } from './attachments';

/** Черновик поля ввода сессии: живёт, пока поле скрыто (режим «Терминал») и пока идёт отправка. */
export interface Draft { text: string; attachments: Attachment[] }

const EMPTY: Draft = { text: '', attachments: [] };
const drafts = new Map<string, Draft>();
const listeners = new Map<string, Set<() => void>>();

export const getDraft = (session: string): Draft => drafts.get(session) ?? EMPTY;

export function setDraft(session: string, d: Draft): void {
  drafts.set(session, d);
  for (const l of listeners.get(session) ?? []) l();
}

export const updateDraft = (session: string, fn: (d: Draft) => Draft): void => setDraft(session, fn(getDraft(session)));

/**
 * Отправка не удалась: текст и вложения возвращаются в поле. Если там уже набрано новое —
 * неотправленное встаёт перед ним через пустую строку, вложения не дублируются.
 */
export function restoreFailed(session: string, failed: Draft): void {
  updateDraft(session, (cur) => {
    if (cur.text.trim() === '' && cur.attachments.length === 0) return failed;
    const ids = new Set(failed.attachments.map((a) => a.id));
    return {
      text: cur.text.trim() === '' ? failed.text : `${failed.text}\n\n${cur.text}`,
      attachments: [...failed.attachments, ...cur.attachments.filter((a) => !ids.has(a.id))],
    };
  });
}

/** Черновик сессии с перерисовкой только этого поля (а не всего приложения) на каждое нажатие. */
export function useDraft(session: string): Draft {
  return useSyncExternalStore(
    (cb) => {
      const set = listeners.get(session) ?? new Set();
      set.add(cb);
      listeners.set(session, set);
      return () => set.delete(cb);
    },
    () => getDraft(session),
  );
}
