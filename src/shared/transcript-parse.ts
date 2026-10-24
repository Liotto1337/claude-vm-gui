import { UPLOAD_DIR_MARK } from './upload-name';
import type { ChatImage, ChatItem, SessionContext } from './ipc';
import { parseContextOutput, usedFromAssistant } from './context-parse';
import { stripAnsi } from './screen-parse';

// Разбор журнала Claude Code (~/.claude/projects/…/<sessionId>.jsonl) в элементы ленты.
// Формат внутренний и без гарантий: неизвестное пропускается, битые строки считаются.

type Tool = Extract<ChatItem, { kind: 'tool' }>;
type Block = {
  type?: string; text?: string; thinking?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: unknown; is_error?: boolean;
  source?: { type?: string; media_type?: string; data?: string };
};

/** Картинка из блока image (Claude Code кладёт туда отправленную картинку вместо пути к файлу). */
const imageOf = (b: Block): ChatImage =>
  b.source?.type === 'base64' && typeof b.source.data === 'string' && typeof b.source.media_type === 'string'
    ? { mediaType: b.source.media_type, data: b.source.data }
    : { mediaType: '', data: '' };

export interface ParseState {
  /** Элементы верхнего уровня по id */
  items: Map<string, ChatItem>;
  /** id вызова инструмента → id элемента верхнего уровня, где он лежит (для субагентов — их Task) */
  toolOwner: Map<string, string>;
  /** Результаты, пришедшие раньше вызова (подгрузка ранней части журнала) */
  orphanResults: Map<string, { text: string; error: boolean }>;
  /** Последний Task/Agent: к нему крепятся действия субагента, если цепочка parentUuid не нашла свой */
  activeTask: string | null;
  /** Незавершённые Task/Agent: текст задания → id (первое сообщение субагента — это задание) */
  taskPrompts: Map<string, string>;
  /** uuid записи субагента → id его Task */
  sideOwner: Map<string, string>;
  /** Битых строк подряд */
  badStreak: number;
  /** Контекст сессии (только по живой части журнала) */
  context: SessionContext;
  /** Была команда /context — следующий вывод локальной команды её (скрывается при любом формате) */
  awaitContextOut: boolean;
}

export const newParseState = (): ParseState => ({
  items: new Map(), toolOwner: new Map(), orphanResults: new Map(), activeTask: null, taskPrompts: new Map(), sideOwner: new Map(), badStreak: 0,
  context: { used: null, usedAt: null, model: null, snapshot: null, snapshotAt: null, snapshotModel: null },
  awaitContextOut: false,
});

const MAX_RESULT_LINES = 200;
const MAX_RESULT_CHARS = 20_000;
const MAX_INPUT = 4000;
/**
 * Пути к файлам из uploads убираются из текста и возвращаются списком (вложения сообщения). Разбор по словам,
 * без регулярки с \S* — на длинных строках без пробелов (base64) она уходила в квадратичный перебор.
 */
function stripUploads(text: string): { text: string; files: string[] } {
  if (!text.includes(UPLOAD_DIR_MARK)) return { text, files: [] };
  const files: string[] = [];
  const kept = text.split(/(\s+)/).filter((tok) => {
    const at = tok.indexOf(UPLOAD_DIR_MARK);
    const hit = at >= 0 && tok.length > at + UPLOAD_DIR_MARK.length;
    if (hit) files.push(tok);
    return !hit;
  });
  return { text: kept.join('').replace(/[ \t]{2,}/g, ' '), files };
}

const PASTED_OPEN = '<pasted_content';

/**
 * Claude Code пишет многострочную вставку обёрнутой: `<pasted_content id="c1">\n…\n</pasted_content id="c1">`
 * (бывает и без id). Пара тегов с одинаковым атрибутом заменяется содержимым; непарные теги остаются как есть.
 * Поиск через indexOf — без регулярки по всему (возможно, огромному) тексту.
 */
export function unwrapPasted(text: string): string {
  if (!text.includes(PASTED_OPEN)) return text;
  let out = '';
  let pos = 0;
  for (;;) {
    const open = text.indexOf(PASTED_OPEN, pos);
    if (open < 0) break;
    const end = text.indexOf('>', open);
    const attr = end < 0 ? null : text.slice(open + PASTED_OPEN.length, end);
    if (attr === null || !/^(?: id="[^"]*")?$/.test(attr)) {
      out += text.slice(pos, open + 1);
      pos = open + 1;
      continue;
    }
    const closeTag = `</pasted_content${attr}>`;
    const close = text.indexOf(closeTag, end + 1);
    if (close < 0) {
      out += text.slice(pos, end + 1);
      pos = end + 1;
      continue;
    }
    let inner = text.slice(end + 1, close);
    if (inner.startsWith('\n')) inner = inner.slice(1);
    if (inner.endsWith('\n')) inner = inner.slice(0, -1);
    out += text.slice(pos, open) + inner;
    pos = close + closeTag.length;
  }
  return out + text.slice(pos);
}

function clipResult(text: string): string {
  const lines = text.split('\n');
  let out = lines.length > MAX_RESULT_LINES ? `${lines.slice(0, MAX_RESULT_LINES).join('\n')}\n… ещё ${lines.length - MAX_RESULT_LINES} строк` : text;
  if (out.length > MAX_RESULT_CHARS) out = `${out.slice(0, MAX_RESULT_CHARS)}\n…`;
  return out;
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return (content as Block[])
    .map((b) => (b.type === 'text' ? (b.text ?? '') : b.type === 'image' ? '[картинка]' : ''))
    .filter(Boolean)
    .join('\n');
}

/** Короткое описание вызова: команда, путь, шаблон… */
function summarize(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof i[k] === 'string' ? (i[k] as string) : '');
  const pick =
    name === 'Bash' ? str('command')
    : ['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(name) ? str('file_path') || str('notebook_path')
    : name === 'Grep' || name === 'Glob' ? str('pattern')
    : name === 'Task' || name === 'Agent' ? str('description')
    : name === 'WebFetch' ? str('url')
    : name === 'WebSearch' ? str('query')
    : name === 'TodoWrite' && Array.isArray(i.todos) ? `${i.todos.length} задач`
    : name === 'AskUserQuestion' && Array.isArray(i.questions) ? String((i.questions[0] as { question?: string })?.question ?? '')
    : (Object.values(i).find((v) => typeof v === 'string') as string | undefined) ?? '';
  return pick.split('\n')[0].trim();
}

function inputText(input: unknown): string {
  const s = JSON.stringify(input ?? {}, null, 2);
  return s.length > MAX_INPUT ? `${s.slice(0, MAX_INPUT)}…` : s;
}

const tag = (s: string, name: string) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(s)?.[1] ?? null;

/** Служебные строки Claude Code (слеш-команды, ! bash) → элемент ленты; null — обычный текст. */
function special(id: string, text: string): ChatItem | null | 'skip' {
  const cmd = tag(text, 'command-name');
  if (cmd !== null) {
    // /context — данные идут в панель «Контекст», не в ленту
    if (cmd.trim() === '/context') return 'skip';
    const args = (tag(text, 'command-args') ?? '').trim();
    return { kind: 'user', id, text: `${cmd.trim()}${args ? ` ${args}` : ''}`, images: [], files: [] };
  }
  const out = tag(text, 'local-command-stdout');
  if (out !== null) return out.trim() ? { kind: 'note', id, text: stripAnsi(out).trim() } : 'skip';
  const bash = tag(text, 'bash-input');
  if (bash !== null) return { kind: 'user', id, text: `! ${bash.trim()}`, images: [], files: [] };
  const stdout = tag(text, 'bash-stdout');
  if (stdout !== null) {
    const err = tag(text, 'bash-stderr') ?? '';
    const all = stripAnsi(`${stdout}${err ? `\n${err}` : ''}`).trim();
    return all ? { kind: 'note', id, text: clipResult(all) } : 'skip';
  }
  if (/^\[Request interrupted by user/.test(text.trim())) return { kind: 'note', id, text: 'Остановлено пользователем' };
  if (/^<(local-command-caveat|system-reminder|task-notification)>/.test(text.trim())) return 'skip';
  return null;
}

/**
 * Разбирает строки журнала. Возвращает изменённые элементы верхнего уровня в порядке появления
 * (новые и дополненные — например, вызов получил результат) и число битых строк.
 * earlier — ранняя часть журнала («Показать раньше»): её Task не становится текущим для живых записей.
 */
export function parseTranscriptLines(lines: string[], st: ParseState, earlier = false): { changed: ChatItem[]; bad: number } {
  const live = st.activeTask;
  const context = st.context;
  const awaiting = st.awaitContextOut;
  if (earlier) st.activeTask = null;
  try {
    return parseLines(lines, st);
  } finally {
    if (earlier) {
      st.activeTask = live;
      st.context = context;
      st.awaitContextOut = awaiting;
    }
  }
}

function parseLines(lines: string[], st: ParseState): { changed: ChatItem[]; bad: number } {
  const changed = new Map<string, ChatItem>();
  let bad = 0;
  const put = (item: ChatItem) => {
    st.items.set(item.id, item);
    changed.delete(item.id);
    changed.set(item.id, item);
  };
  const touch = (id: string) => {
    const it = st.items.get(id);
    if (it && !changed.has(id)) changed.set(id, it);
  };

  const timeOf = (rec: Record<string, unknown>) => {
    const t = typeof rec.timestamp === 'string' ? Date.parse(rec.timestamp) : NaN;
    return Number.isFinite(t) ? t : Date.now();
  };
  /**
   * /context и его вывод — замер для панели «Контекст», не в ленту. Вывод узнаётся по команде перед ним
   * (любой формат, любой тип записи) или по заголовку «Context Usage». true — запись поглощена.
   */
  const contextRecord = (text: string, rec: Record<string, unknown>): boolean => {
    const cmd = tag(text, 'command-name');
    if (cmd !== null) {
      st.awaitContextOut = cmd.trim() === '/context';
      return st.awaitContextOut;
    }
    const out = tag(text, 'local-command-stdout');
    if (out === null || !(st.awaitContextOut || out.includes('Context Usage'))) return false;
    st.awaitContextOut = false;
    const snapshot = parseContextOutput(out);
    if (snapshot) st.context = { ...st.context, snapshot, snapshotAt: timeOf(rec), snapshotModel: snapshot.model ?? st.context.model };
    return true;
  };

  // Task субагента: по цепочке parentUuid, иначе — последний запущенный
  const ownerOf = (rec: Record<string, unknown>): Tool | undefined => {
    const uuid = typeof rec.uuid === 'string' ? rec.uuid : null;
    const parent = typeof rec.parentUuid === 'string' ? st.sideOwner.get(rec.parentUuid) : undefined;
    const id = parent ?? st.activeTask;
    if (uuid && id) st.sideOwner.set(uuid, id);
    return id ? (st.items.get(id) as Tool | undefined) : undefined;
  };

  const addTool = (b: Block, owner: Tool | undefined) => {
    if (!b.id || !b.name) return;
    const orphan = st.orphanResults.get(b.id);
    st.orphanResults.delete(b.id);
    const t: Tool = {
      kind: 'tool', id: b.id, name: b.name, summary: summarize(b.name, b.input), input: inputText(b.input),
      status: orphan ? (orphan.error ? 'error' : 'ok') : 'running', result: orphan ? orphan.text : null, children: [],
    };
    if (owner) {
      owner.children = [...owner.children, t];
      st.toolOwner.set(b.id, owner.id);
      touch(owner.id);
    } else {
      st.toolOwner.set(b.id, b.id);
      put(t);
      if (b.name === 'Task' || b.name === 'Agent') {
        st.activeTask = b.id;
        const prompt = (b.input as { prompt?: unknown } | undefined)?.prompt;
        if (typeof prompt === 'string') st.taskPrompts.set(prompt.trim(), b.id);
      }
    }
  };

  const addResult = (b: Block) => {
    if (!b.tool_use_id) return;
    const text = clipResult(resultText(b.content));
    const error = b.is_error === true;
    const ownerId = st.toolOwner.get(b.tool_use_id);
    if (!ownerId) return void st.orphanResults.set(b.tool_use_id, { text, error });
    const owner = st.items.get(ownerId) as Tool | undefined;
    if (!owner) return;
    if (ownerId === b.tool_use_id) {
      owner.status = error ? 'error' : 'ok';
      owner.result = text;
      if (st.activeTask === owner.id) st.activeTask = null;
      for (const [p, id] of st.taskPrompts) if (id === owner.id) st.taskPrompts.delete(p);
    } else {
      owner.children = owner.children.map((c) =>
        c.kind === 'tool' && c.id === b.tool_use_id ? { ...c, status: error ? 'error' : 'ok', result: text } : c,
      );
    }
    touch(ownerId);
  };

  for (const line of lines) {
    if (line.trim() === '') continue;
    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(line) as Record<string, unknown>;
      if (!rec || typeof rec !== 'object') throw new Error('not an object');
    } catch {
      bad++;
      st.badStreak++;
      continue;
    }
    st.badStreak = 0;
    const id = typeof rec.uuid === 'string' ? rec.uuid : `l${st.items.size}-${changed.size}`;
    const sidechain = rec.isSidechain === true;

    if (rec.type === 'system' && rec.subtype === 'local_command' && typeof rec.content === 'string') {
      if (contextRecord(rec.content, rec)) continue;
      const sp = special(id, rec.content);
      if (sp && sp !== 'skip') put(sp);
      continue;
    }
    if (rec.type !== 'user' && rec.type !== 'assistant') continue;
    if (rec.isMeta === true) continue;
    // Сводка сжатия контекста («This session is being continued…») и прочее только для журнала — не реплики
    if (rec.isCompactSummary === true || rec.isVisibleInTranscriptOnly === true) {
      // после сжатия сколько занято — неизвестно до следующего ответа
      if (rec.isCompactSummary === true) st.context = { ...st.context, used: null, usedAt: timeOf(rec) };
      continue;
    }
    // Уведомления фоновых задач Claude Code (<task-notification>) — служебные, не реплики
    if ((rec.origin as { kind?: unknown } | undefined)?.kind === 'task-notification') continue;
    const msg = rec.message as { content?: unknown } | undefined;
    const content = msg?.content;

    if (rec.type === 'user') {
      if (typeof content === 'string') {
        if (sidechain) {
          // задание субагенту — видно в строке Task; по нему находим, чей это субагент
          const task = st.taskPrompts.get(content.trim());
          if (task && typeof rec.uuid === 'string') st.sideOwner.set(rec.uuid, task);
          else ownerOf(rec);
          continue;
        }
        if (contextRecord(content, rec)) continue;
        const sp = special(id, content);
        if (sp === 'skip') continue;
        if (sp) {
          put(sp);
          continue;
        }
        const u = stripUploads(unwrapPasted(content));
        put({ kind: 'user', id, text: u.text.trim(), images: [], files: u.files });
        continue;
      }
      if (!Array.isArray(content)) continue;
      const blocks = content as Block[];
      for (const b of blocks) if (b.type === 'tool_result') addResult(b);
      if (sidechain) {
        ownerOf(rec);
        continue;
      }
      const texts = blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '');
      const images = blocks.filter((b) => b.type === 'image').map(imageOf);
      if (texts.length === 0 && images.length === 0) continue;
      const joined = texts.join('\n');
      if (contextRecord(joined, rec)) continue;
      const sp = special(id, joined);
      if (sp === 'skip') continue;
      if (sp) {
        put(sp);
        continue;
      }
      const u = stripUploads(unwrapPasted(joined).replace(/\[Image #\d+\]\s*/g, ''));
      put({ kind: 'user', id, text: u.text.trim(), images, files: u.files });
      continue;
    }

    // assistant
    const used = usedFromAssistant(rec);
    if (used) st.context = { ...st.context, ...used, usedAt: timeOf(rec) };
    if (!Array.isArray(content)) continue;
    const owner = sidechain ? ownerOf(rec) : undefined;
    (content as Block[]).forEach((b, i) => {
      if (b.type === 'tool_use') return addTool(b, owner);
      if (sidechain) {
        if (b.type === 'text' && b.text?.trim()) {
          if (owner) {
            owner.children = [...owner.children, { kind: 'assistant', id: `${id}:${i}`, text: b.text }];
            touch(owner.id);
          }
        }
        return;
      }
      if (b.type === 'text' && b.text?.trim()) put({ kind: 'assistant', id: `${id}:${i}`, text: b.text });
      else if (b.type === 'thinking' || b.type === 'redacted_thinking') put({ kind: 'thinking', id: `${id}:${i}` });
    });
  }
  return { changed: [...changed.values()], bad };
}
