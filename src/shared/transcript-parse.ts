import type { ChatItem } from './ipc';
import { stripAnsi } from './screen-parse';

// Разбор журнала Claude Code (~/.claude/projects/…/<sessionId>.jsonl) в элементы ленты.
// Формат внутренний и без гарантий: неизвестное пропускается, битые строки считаются.

type Tool = Extract<ChatItem, { kind: 'tool' }>;
type Block = { type?: string; text?: string; thinking?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: unknown; is_error?: boolean };

export interface ParseState {
  /** Элементы верхнего уровня по id */
  items: Map<string, ChatItem>;
  /** id вызова инструмента → id элемента верхнего уровня, где он лежит (для субагентов — их Task) */
  toolOwner: Map<string, string>;
  /** Результаты, пришедшие раньше вызова (подгрузка ранней части журнала) */
  orphanResults: Map<string, { text: string; error: boolean }>;
  /** Последний Task/Agent: к нему крепятся действия субагента */
  activeTask: string | null;
  /** Битых строк подряд */
  badStreak: number;
}

export const newParseState = (): ParseState => ({
  items: new Map(), toolOwner: new Map(), orphanResults: new Map(), activeTask: null, badStreak: 0,
});

const MAX_RESULT_LINES = 200;
const MAX_RESULT_CHARS = 20_000;
const MAX_INPUT = 4000;
const UPLOAD_PATH = /\S*\/claude-vm-gui\/uploads\/\S+\.(?:png|jpe?g|gif|webp)/g;

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
    const args = (tag(text, 'command-args') ?? '').trim();
    return { kind: 'user', id, text: `${cmd.trim()}${args ? ` ${args}` : ''}`, images: 0 };
  }
  const out = tag(text, 'local-command-stdout');
  if (out !== null) return out.trim() ? { kind: 'note', id, text: stripAnsi(out).trim() } : 'skip';
  const bash = tag(text, 'bash-input');
  if (bash !== null) return { kind: 'user', id, text: `! ${bash.trim()}`, images: 0 };
  const stdout = tag(text, 'bash-stdout');
  if (stdout !== null) {
    const err = tag(text, 'bash-stderr') ?? '';
    const all = stripAnsi(`${stdout}${err ? `\n${err}` : ''}`).trim();
    return all ? { kind: 'note', id, text: clipResult(all) } : 'skip';
  }
  if (/^\[Request interrupted by user/.test(text.trim())) return { kind: 'note', id, text: 'Остановлено пользователем' };
  if (/^<(local-command-caveat|system-reminder)>/.test(text.trim())) return 'skip';
  return null;
}

/**
 * Разбирает строки журнала. Возвращает изменённые элементы верхнего уровня в порядке появления
 * (новые и дополненные — например, вызов получил результат) и число битых строк.
 */
export function parseTranscriptLines(lines: string[], st: ParseState): { changed: ChatItem[]; bad: number } {
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

  const addTool = (b: Block, sidechain: boolean) => {
    if (!b.id || !b.name) return;
    const orphan = st.orphanResults.get(b.id);
    st.orphanResults.delete(b.id);
    const t: Tool = {
      kind: 'tool', id: b.id, name: b.name, summary: summarize(b.name, b.input), input: inputText(b.input),
      status: orphan ? (orphan.error ? 'error' : 'ok') : 'running', result: orphan ? orphan.text : null, children: [],
    };
    const owner = sidechain && st.activeTask ? (st.items.get(st.activeTask) as Tool | undefined) : undefined;
    if (owner) {
      owner.children = [...owner.children, t];
      st.toolOwner.set(b.id, owner.id);
      touch(owner.id);
    } else {
      st.toolOwner.set(b.id, b.id);
      put(t);
      if (b.name === 'Task' || b.name === 'Agent') st.activeTask = b.id;
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
      const sp = special(id, rec.content);
      if (sp && sp !== 'skip') put(sp);
      continue;
    }
    if (rec.type !== 'user' && rec.type !== 'assistant') continue;
    if (rec.isMeta === true) continue;
    const msg = rec.message as { content?: unknown } | undefined;
    const content = msg?.content;

    if (rec.type === 'user') {
      if (typeof content === 'string') {
        if (sidechain) continue; // задание субагенту — видно в строке Task
        const sp = special(id, content);
        if (sp === 'skip') continue;
        if (sp) {
          put(sp);
          continue;
        }
        const images = (content.match(UPLOAD_PATH) ?? []).length;
        put({ kind: 'user', id, text: content.replace(UPLOAD_PATH, '').trim(), images });
        continue;
      }
      if (!Array.isArray(content)) continue;
      const blocks = content as Block[];
      for (const b of blocks) if (b.type === 'tool_result') addResult(b);
      if (sidechain) continue;
      const texts = blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '');
      const images = blocks.filter((b) => b.type === 'image').length;
      if (texts.length === 0 && images === 0) continue;
      const joined = texts.join('\n');
      const sp = special(id, joined);
      if (sp === 'skip') continue;
      if (sp) {
        put(sp);
        continue;
      }
      const text = joined.replace(/\[Image #\d+\]\s*/g, '').replace(UPLOAD_PATH, '').trim();
      put({ kind: 'user', id, text, images: images + (joined.match(UPLOAD_PATH) ?? []).length });
      continue;
    }

    // assistant
    if (!Array.isArray(content)) continue;
    (content as Block[]).forEach((b, i) => {
      if (b.type === 'tool_use') return addTool(b, sidechain);
      if (sidechain) {
        if (b.type === 'text' && b.text?.trim() && st.activeTask) {
          const owner = st.items.get(st.activeTask) as Tool | undefined;
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
