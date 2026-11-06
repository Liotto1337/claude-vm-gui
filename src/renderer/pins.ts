import type { ChatItem } from '@shared/ipc';

/** Закреплённое сообщение: text — начало текста на момент закрепления (панель работает и когда сообщение не загружено). */
export interface Pin { id: string; text: string; at: number }

const PREVIEW = 60;

/** Закрепляются сообщения пользователя и ответы Claude; инструменты, размышления и заметки — нет. */
export function pinnable(item: ChatItem): item is Extract<ChatItem, { kind: 'user' | 'assistant' }> {
  return item.kind === 'user' || item.kind === 'assistant';
}

/** Текст для панели: одна строка; сообщение без текста — по вложению. */
export function pinText(item: Extract<ChatItem, { kind: 'user' | 'assistant' }>): string {
  const text = item.text.replace(/\s+/g, ' ').trim();
  if (text) return text.slice(0, 200);
  if (item.kind === 'user' && item.images.length) return 'Изображение';
  return 'Файл';
}

/** Первые n символов; длиннее — с многоточием в конце (итого n). */
export function preview(text: string, n = PREVIEW): string {
  return text.length <= n ? text : `${text.slice(0, n - 1).trimEnd()}…`;
}

/** Закрепить или открепить (если уже закреплено). */
export function togglePin(list: Pin[], item: { id: string; text: string }, now: number): Pin[] {
  return list.some((p) => p.id === item.id) ? list.filter((p) => p.id !== item.id) : [...list, { id: item.id, text: item.text, at: now }];
}

/** Порядок как в ленте; не загруженные (из ранней части журнала) идут раньше всех — по времени закрепления. */
export function orderPins(list: Pin[], itemIds: string[]): Pin[] {
  const pos = new Map(itemIds.map((id, i) => [id, i]));
  const known = list.filter((p) => pos.has(p.id)).sort((a, b) => pos.get(a.id)! - pos.get(b.id)!);
  const early = list.filter((p) => !pos.has(p.id)).sort((a, b) => a.at - b.at);
  return [...early, ...known];
}

/** Какое закреплённое показывать после перехода к active: предыдущее, по кругу; неизвестное — последнее. */
export function stepActive(ordered: Pin[], active: string | null): string | null {
  if (ordered.length === 0) return null;
  const i = ordered.findIndex((p) => p.id === active);
  return ordered[i < 0 ? ordered.length - 1 : (i - 1 + ordered.length) % ordered.length].id;
}

/** Когда лента загружена целиком, закрепления несуществующих сообщений (сессию пересоздали) убираются. Без изменений — тот же массив. */
export function dropMissing(list: Pin[], itemIds: string[], hasEarlier: boolean): Pin[] {
  if (hasEarlier) return list;
  const ids = new Set(itemIds);
  const kept = list.filter((p) => ids.has(p.id));
  return kept.length === list.length ? list : kept;
}

const key = (host: string, session: string) => `cvg:pins:${host}:${session}`;

/** Закрепления сессии из localStorage; хранилище недоступно или испорчено — пусто. */
export function loadPins(host: string, session: string): Pin[] {
  try {
    const v = JSON.parse(localStorage.getItem(key(host, session)) ?? '[]') as unknown;
    return Array.isArray(v) ? (v as Pin[]).filter((p) => p && typeof p.id === 'string' && typeof p.text === 'string' && typeof p.at === 'number') : [];
  } catch {
    return [];
  }
}

export function savePins(host: string, session: string, list: Pin[]): void {
  try {
    localStorage.setItem(key(host, session), JSON.stringify(list));
  } catch {
    // нет хранилища — закрепления живут до перезапуска
  }
}
