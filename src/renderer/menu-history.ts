import type { MenuKey, ParsedMenu, ScreenState } from '@shared/ipc';

/** Итог ответа на меню Claude Code в ленте: after — id элемента журнала, после которого стояла карточка. */
export interface MenuAnswer { id: string; after: string | null; text: string; at: number }

const MAX = 50;
// Экран подтверждения AskUserQuestion: ответы уже записаны по каждому вопросу
const REVIEW = 'Review your answers';

/** «Вопрос → выбрано: …» (несколько — отмеченные через запятую; ответ цифрой — вариант с этим номером) или «Вопрос → отменено», если последней была Esc. */
export function answerOf(menu: ParsedMenu, lastKey: MenuKey | null): string {
  const title = menu.title || 'Claude Code спрашивал';
  if (lastKey === 'esc') return `${title} → отменено`;
  // Цифра выбирает вариант сразу — курсор на экране так и остаётся на прежнем
  const digit = lastKey !== null && /^[1-9]$/.test(lastKey) ? Number(lastKey) : null;
  const picked = (
    menu.kind === 'multi' ? menu.options.filter((o) => o.checked)
    : digit !== null && menu.options.some((o) => o.n === digit) ? menu.options.filter((o) => o.n === digit)
    : menu.options.filter((o) => o.selected)
  ).map((o) => o.label);
  return `${title} → выбрано: ${picked.join(', ') || '—'}`;
}

/**
 * Новый экран сессии → список итогов. Итог пишется, когда меню сменилось полем ввода или другим меню
 * (следующий вопрос) — по последнему экрану с меню: курсор, отметки. Незнакомый экран итога не даёт.
 * Без изменений возвращается тот же массив.
 */
export function nextAnswers(
  prev: ScreenState | null, next: ScreenState, anchor: string | null, lastKey: MenuKey | null, list: MenuAnswer[], now: number,
): MenuAnswer[] {
  if (prev?.kind !== 'menu' || prev.menu.title === REVIEW) return list;
  if (next.kind === 'menu' ? next.menu.title === prev.menu.title : next.kind !== 'prompt') return list;
  return [...list, { id: `answer-${now}`, after: anchor, text: answerOf(prev.menu, lastKey), at: now }].slice(-MAX);
}

const key = (host: string, session: string) => `cvg:answers:${host}:${session}`;

/** Итоги сессии из localStorage; хранилище недоступно или испорчено — пусто. */
export function loadAnswers(host: string, session: string): MenuAnswer[] {
  try {
    const v = JSON.parse(localStorage.getItem(key(host, session)) ?? '[]') as unknown;
    return Array.isArray(v) ? (v as MenuAnswer[]).filter((a) => a && typeof a.text === 'string' && typeof a.id === 'string') : [];
  } catch {
    return [];
  }
}

export function saveAnswers(host: string, session: string, list: MenuAnswer[]): void {
  try {
    localStorage.setItem(key(host, session), JSON.stringify(list));
  } catch {
    // нет хранилища — итоги живут до перезапуска
  }
}
