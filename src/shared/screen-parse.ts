import type { MenuKey, MenuOption, ParsedMenu, ScreenState } from './ipc';
import { DIALOG_FOOTER } from './dialog';

// Разбор экрана Claude Code (tmux capture-pane). Форматы — по снимкам 2.1.303 в tests/fixtures/screens.

const ESC_SEQ = /\x1b(?:\[([0-9;:?]*)([@-~])|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g;

/** Убирает управляющие последовательности. `dropDim` — заодно выбрасывает текст с атрибутом dim (серые подсказки). */
export function stripAnsi(s: string, opts: { dropDim?: boolean } = {}): string {
  if (!opts.dropDim) return s.replace(ESC_SEQ, '');
  let out = '';
  let dim = false;
  let last = 0;
  for (const m of s.matchAll(ESC_SEQ)) {
    if (!dim) out += s.slice(last, m.index);
    last = m.index + m[0].length;
    if (m[2] !== 'm') continue;
    const params = (m[1] ?? '').split(/[;:]/).map((p) => (p === '' ? 0 : Number(p)));
    for (const p of params) {
      if (p === 2) dim = true;
      else if (p === 0 || p === 22) dim = false;
    }
  }
  if (!dim) out += s.slice(last);
  return out;
}

const isRule = (line: string, chars: string) => new RegExp(`^[${chars}]{10,}$`).test(line.trim());
/** Граница блока: сплошная линия поля ввода или меню (`─`, `▔`). Пунктир `╌` внутри меню границей не считается. */
const isBoundary = (line: string) => isRule(line, '─') || isRule(line, '▔');
const PROMPT = /^\s*❯[\s ]?/;

/** Индексы верхней и нижней линии последнего поля ввода (`❯` сразу под верхней линией). */
function inputBox(lines: string[]): [number, number] | null {
  for (let j = lines.length - 1; j > 0; j--) {
    if (!isRule(lines[j], '─')) continue;
    for (let i = j - 1; i >= 0; i--) {
      if (!isRule(lines[i], '─')) continue;
      return PROMPT.test(lines[i + 1] ?? '') && /^❯/.test(lines[i + 1].trimStart()) ? [i, j] : null;
    }
    return null;
  }
  return null;
}

/** Текст поля ввода Claude Code; `''` — поле пустое (серая подсказка не считается); `null` — поля на экране нет. */
export function inputText(screen: string): string | null {
  // Поле ищем по всему тексту (во время работы серым нарисован и сам «❯»), а содержимое берём без серого
  const raw = screen.split('\n');
  const box = inputBox(raw.map((l) => stripAnsi(l)));
  if (!box) return null;
  const body = raw.slice(box[0] + 1, box[1]).map((l) => stripAnsi(l, { dropDim: true }));
  const text = [body[0].replace(PROMPT, ''), ...body.slice(1).map((l) => l.replace(/^ {2}/, ''))]
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n');
  return text.trim();
}

const SPINNER = /^\s*[·✢✳✶✻✽✺*]\s+(.+)$/;

/** Строка статуса, пока Claude работает («esc to interrupt» внизу); иначе null. */
export function parseStatus(plain: string): string | null {
  const lines = plain.split('\n');
  const box = inputBox(lines);
  const footer = box ? lines.slice(box[1] + 1).join('\n') : lines.slice(-4).join('\n');
  const above = box ? lines.slice(0, box[0]) : lines;
  if (!/esc to interrupt/i.test(footer) && !above.some((l) => SPINNER.test(l) && /esc to interrupt/i.test(l))) return null;
  for (let i = above.length - 1; i >= 0; i--) {
    const m = SPINNER.exec(above[i]);
    if (!m) continue;
    return m[1]
      .replace(/\s*·\s*esc to interrupt/i, '')
      .replace(/\(\s*esc to interrupt\s*\)/i, '')
      .replace(/\s+\)/, ')')
      .trim();
  }
  return null;
}

const indentOf = (l: string) => l.length - l.trimStart().length;

/** Меню Claude Code внизу экрана или null. */
export function parseMenu(plain: string): ParsedMenu | null {
  const lines = plain.split('\n').map((l) => l.replace(/\s+$/, ''));
  const nonEmpty = lines.map((l, i) => [l, i] as const).filter(([l]) => l.trim() !== '');
  const tail = nonEmpty.slice(-12);
  const footer = [...tail].reverse().find(([l]) => DIALOG_FOOTER.test(l));
  if (!footer) return null;
  const f = footer[1];
  let s = -1;
  for (let i = f - 1; i >= 0; i--)
    if (/^\s*❯\s/.test(lines[i])) {
      s = i;
      break;
    }
  if (s < 0) return null;
  const c = lines[s].indexOf('❯');
  const labelCol = c + 1 + (lines[s].slice(c + 1).length - lines[s].slice(c + 1).trimStart().length);

  type Kind = 'option' | 'cont' | 'rule' | 'other';
  const kindOf = (l: string): Kind => {
    if (l.trim() === '') return 'other';
    if (isRule(l, '─╌')) return 'rule';
    const ind = indentOf(l);
    if (ind > labelCol) return 'cont';
    const marker = l[c];
    if ((marker === '❯' || marker === '↓' || marker === '↑' || marker === ' ') && l.slice(0, c).trim() === '' && indentOf(l.slice(c + 1)) + c + 1 === labelCol)
      return 'option';
    if (ind === labelCol) return 'option';
    return 'other';
  };

  let start = s;
  while (start > 0) {
    const k = kindOf(lines[start - 1]);
    if (k === 'option' || k === 'cont') start--;
    else break;
  }
  const options: MenuOption[] = [];
  const notes: string[] = [];
  let i = start;
  for (; i < f; i++) {
    const l = lines[i];
    const k = kindOf(l);
    if (k === 'rule') continue;
    if (k === 'other') break;
    const text = l.slice(k === 'option' ? labelCol : 0).trim();
    if (k === 'cont') {
      if (text.startsWith('…') || options.length === 0) notes.push(text);
      else {
        const o = options[options.length - 1];
        o.description = o.description ? `${o.description} ${text}` : text;
      }
      continue;
    }
    const num = /^(\d+)\.\s+(.*)$/.exec(text);
    const body = num ? num[2] : text;
    const [label, ...rest] = body.split(/\s{2,}/);
    options.push({ n: num ? Number(num[1]) : null, label: label.trim(), description: rest.join(' ').trim(), selected: l[c] === '❯' });
  }
  for (; i < f; i++) {
    const l = lines[i].trim();
    if (l !== '' && !isRule(l, '─╌▔')) notes.push(l);
  }
  if (options.length === 0) return null;

  const head: string[] = [];
  for (let j = start - 1; j >= 0; j--) {
    if (isBoundary(lines[j])) break;
    const l = lines[j].trim();
    if (l !== '' && !isRule(l, '╌')) head.unshift(l);
  }
  const [title = '', ...context] = head;
  return { title, context: context.slice(0, 6), options, notes, hint: lines[f].trim() };
}

/** Что сейчас на экране claude. `no-claude` решает вызывающий (по процессу в панели). */
export function classifyScreen(screen: string): ScreenState {
  const plain = stripAnsi(screen);
  const menu = parseMenu(plain);
  if (menu) return { kind: 'menu', menu };
  const input = inputText(screen);
  if (input !== null) return { kind: 'prompt', status: parseStatus(plain), input };
  return { kind: 'unknown' };
}

/** Клавиши для выбора варианта index: цифра, если у варианта есть номер, иначе стрелки от выбранного и Enter. */
export function menuKeysFor(menu: ParsedMenu, index: number): MenuKey[] {
  const opt = menu.options[index];
  if (!opt) return [];
  if (opt.n !== null && opt.n >= 1 && opt.n <= 9) return [String(opt.n) as MenuKey];
  const sel = Math.max(0, menu.options.findIndex((o) => o.selected));
  const delta = index - sel;
  return [...Array<MenuKey>(Math.abs(delta)).fill(delta > 0 ? 'down' : 'up'), 'enter'];
}
