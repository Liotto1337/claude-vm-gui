import type { ChatEvent, ChatItem, ScreenState } from '@shared/ipc';

/**
 * Что показывать в основной колонке: ленту или терминал.
 * Терминал — когда claude не запущен, на экране незнакомое (полноэкранные /config и т. п.),
 * журнал не читается или пользователь сам выбрал «Терминал».
 */
export function viewMode(input: {
  claudeRunning: boolean;
  screen: ScreenState | null;
  unavailable: boolean;
  override: 'terminal' | null;
}): 'chat' | 'terminal' {
  if (!input.claudeRunning || input.override === 'terminal' || input.unavailable) return 'terminal';
  if (input.screen && (input.screen.kind === 'no-claude' || input.screen.kind === 'unknown')) return 'terminal';
  return 'chat';
}

/** Событие журнала → список ленты: reset заменяет, prepend добавляет раннюю часть, иначе обновление по id. */
export function mergeItems(prev: ChatItem[], e: ChatEvent): ChatItem[] {
  if (e.reset) return e.items;
  const incoming = new Map(e.items.map((i) => [i.id, i]));
  const updated = prev.map((i) => incoming.get(i.id) ?? i);
  const known = new Set(prev.map((i) => i.id));
  const fresh = e.items.filter((i) => !known.has(i.id));
  return e.prepend ? [...fresh, ...updated] : [...updated, ...fresh];
}
