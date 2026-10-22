import type { HintCommand, Hints, ModelInfo } from './ipc';

export interface Trigger {
  kind: 'slash' | 'file';
  query: string;
  start: number;
}

/** Нужна ли подсказка у каретки: «/команда» в начале поля или «@файл» после пробела. */
export function detectTrigger(text: string, caret: number): Trigger | null {
  const before = text.slice(0, caret);
  if (before.startsWith('/') && !/\s/.test(before)) return { kind: 'slash', query: before.slice(1), start: 0 };
  const at = before.lastIndexOf('@');
  if (at === -1) return null;
  const query = before.slice(at + 1);
  if (/\s/.test(query)) return null;
  if (at > 0 && !/\s/.test(before[at - 1])) return null;
  return { kind: 'file', query, start: at };
}

/** Сначала совпадения по началу, потом по подстроке; регистр не важен. */
export function filterHints<T>(items: T[], query: string, key: (t: T) => string, limit = 8): T[] {
  const q = query.toLowerCase();
  const prefix: T[] = [];
  const inner: T[] = [];
  for (const item of items) {
    const k = key(item).toLowerCase();
    if (k.startsWith(q)) prefix.push(item);
    else if (k.includes(q)) inner.push(item);
  }
  return [...prefix, ...inner].slice(0, limit);
}

const builtin = (name: string, description: string, argumentHint = ''): HintCommand => ({
  name,
  description,
  argumentHint,
  source: 'builtin',
});

/** Команды консольного Claude Code, которых нет в ответе initialize. */
export const BUILTIN_COMMANDS: HintCommand[] = [
  builtin('resume', 'Продолжить прошлую беседу', '[id]'),
  builtin('exit', 'Выйти из Claude Code'),
  builtin('help', 'Справка по командам'),
  builtin('clear', 'Очистить историю беседы'),
  builtin('status', 'Версия, модель, аккаунт и подключения'),
  builtin('cost', 'Расход токенов в этой сессии'),
  builtin('login', 'Войти в аккаунт Anthropic'),
  builtin('logout', 'Выйти из аккаунта Anthropic'),
  builtin('permissions', 'Разрешения на инструменты'),
  builtin('memory', 'Редактировать файлы памяти CLAUDE.md'),
  builtin('doctor', 'Проверить установку Claude Code'),
  builtin('bug', 'Сообщить об ошибке'),
  // С Claude Code 2.1.306 initialize отдаёт только скиллы и команды плагинов
  builtin('model', 'Сменить модель', '[модель]'),
  builtin('effort', 'Уровень усилий модели', '[уровень]'),
  builtin('compact', 'Сжать историю беседы', '[инструкции]'),
  builtin('context', 'Заполнение контекста'),
  builtin('config', 'Настройки Claude Code'),
  builtin('init', 'Создать CLAUDE.md для проекта'),
  builtin('agents', 'Субагенты'),
  builtin('mcp', 'Серверы MCP'),
  builtin('add-dir', 'Добавить рабочую папку', '<путь>'),
  builtin('rewind', 'Откатить беседу и код'),
  builtin('export', 'Экспорт беседы', '[файл]'),
];

interface RawCommand { name?: unknown; description?: unknown; argumentHint?: unknown }
interface RawModel { value?: unknown; displayName?: unknown; description?: unknown; supportedEffortLevels?: unknown }

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Разбор control_response на запрос initialize (stream-json Claude Code). */
export function parseInitialize(json: unknown): Hints {
  const r = (json as { response?: { response?: { commands?: unknown; models?: unknown } } })?.response?.response;
  const rawCommands = Array.isArray(r?.commands) ? (r.commands as RawCommand[]) : [];
  const rawModels = Array.isArray(r?.models) ? (r.models as RawModel[]) : [];

  const commands: HintCommand[] = rawCommands
    .filter((c) => str(c.name) !== '' && !str(c.name).startsWith('__'))
    .map((c) => ({ name: str(c.name), description: str(c.description), argumentHint: str(c.argumentHint), source: 'claude' as const }));
  const seen = new Set(commands.map((c) => c.name));
  for (const b of BUILTIN_COMMANDS) if (!seen.has(b.name)) commands.push(b);

  const models: ModelInfo[] = rawModels
    .filter((m) => str(m.value) !== '')
    .map((m) => ({
      value: str(m.value),
      displayName: str(m.displayName) || str(m.value),
      description: str(m.description),
      efforts: Array.isArray(m.supportedEffortLevels) ? m.supportedEffortLevels.filter((e): e is string => typeof e === 'string') : [],
    }));
  return { commands, models };
}
