import type { MenuKey, MenuOption, ParsedMenu, ScreenState } from './ipc';

// Разбор экрана Claude Code (tmux capture-pane). Форматы — по снимкам 2.1.303 в tests/fixtures/screens.

// Подсказки внизу меню Claude Code: запрос разрешения, «доверять папке?», выбор варианта, онбординг.
// Обычное поле ввода показывает «? for shortcuts», а во время работы — «esc to interrupt».
export const DIALOG_FOOTER = /Enter to confirm|Esc to cancel|Enter to select|Esc to exit|Press Enter to continue/i;

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

/**
 * Строка с подсказкой меню или -1. Подсказка должна быть среди трёх последних непустых строк,
 * и ниже неё (или вокруг неё) не должно быть поля ввода: иначе это текст ответа или набранное сообщение.
 */
export function menuFooterIndex(plain: string): number {
  const lines = plain.split('\n').map((l) => l.replace(/\s+$/, ''));
  const tail = lines.map((l, i) => [l, i] as const).filter(([l]) => l.trim() !== '').slice(-3);
  const footer = [...tail].reverse().find(([l]) => DIALOG_FOOTER.test(l));
  if (!footer) return reviewEnd(lines);
  const box = inputBox(lines);
  return box && box[1] > footer[1] ? -1 : footer[1];
}

const REVIEW = /^Ready to submit your answers\?$/;
const NUMBERED = /^\s*(?:❯\s*)?\d+\.\s/;

/**
 * «Review your answers» AskUserQuestion рисуется без подсказки внизу: после «Ready to submit your answers?»
 * до конца экрана — только варианты. Тогда «подсказка» — за последней строкой (lines.length), иначе -1.
 */
function reviewEnd(lines: string[]): number {
  const filled = lines.map((l, i) => [l, i] as const).filter(([l]) => l.trim() !== '');
  const at = filled.findIndex(([l]) => REVIEW.test(l.trim()));
  if (at < 0) return -1;
  const after = filled.slice(at + 1);
  return after.length >= 2 && after.every(([l]) => NUMBERED.test(l)) ? lines.length : -1;
}

/**
 * Открыто ли меню Claude Code (тогда Enter выбрал бы пункт по умолчанию). Нарочно шире parseMenu:
 * меню незнакомого вида тоже блокирует отправку.
 */
export function dialogOpen(paneText: string): boolean {
  return menuFooterIndex(stripAnsi(paneText)) >= 0;
}

const CHECKBOX = /^\s*(?:❯\s*)?\d+\.\s+\[[ ✔]\]\s/;
const TABS = /^←\s+(.+?)\s+→$/;
const AXIS = /^[◐◑◒◓◔◕●○]\s+(.+?)\s+←\/→ to adjust$/;
const MAX_TRAILING = 3; // строк между вариантами и подсказкой («… +2 models», «● High effort …»)

/** Меню Claude Code внизу экрана или null. */
export function parseMenu(plain: string): ParsedMenu | null {
  const lines = plain.split('\n').map((l) => l.replace(/\s+$/, ''));
  let f = menuFooterIndex(plain);
  if (f < 0) return null;
  // Множественный выбор: «Submit» — строка без номера под вариантами (с курсором — «❯    Submit»); разбираем без неё
  const multi = lines.slice(0, f).some((l) => CHECKBOX.test(l));
  let submit: { after: number; selected: boolean } | null = null;
  if (multi)
    for (let i = f - 1; i >= 0; i--)
      if (/^\s*(?:❯\s*)?Submit$/.test(lines[i])) {
        submit = { after: -1, selected: lines[i].includes('❯') };
        lines.splice(i, 1);
        f--;
        break;
      }
  let s = -1;
  for (let i = f - 1; i >= 0; i--)
    if (/^\s*❯\s/.test(lines[i])) {
      s = i;
      break;
    }
  // Курсор на «Submit»: колонки берём по последнему варианту с чекбоксом («❯ » — два символа перед номером)
  let c: number;
  let labelCol: number;
  if (s < 0 && submit?.selected) {
    for (let i = f - 1; i >= 0 && s < 0; i--) if (CHECKBOX.test(lines[i])) s = i;
    if (s < 0) return null;
    labelCol = indentOf(lines[s]);
    c = labelCol - 2;
  } else {
    if (s < 0) return null;
    c = lines[s].indexOf('❯');
    labelCol = c + 1 + (lines[s].slice(c + 1).length - lines[s].slice(c + 1).trimStart().length);
  }

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
    const box = /^\[([ ✔])\]\s+(.*)$/.exec(num ? num[2] : text);
    const body = box ? box[2] : num ? num[2] : text;
    const [label, ...rest] = body.split(/\s{2,}/);
    const o: MenuOption = { n: num ? Number(num[1]) : null, label: label.trim(), description: rest.join(' ').trim(), selected: l[c] === '❯' };
    if (box) {
      o.checked = box[1] === '✔';
      if (submit) submit.after = options.length;
    }
    if (/^Type something\.?$/.test(o.label)) o.input = true;
    options.push(o);
  }
  if (submit) options.splice(submit.after + 1, 0, { n: null, label: 'Submit', description: '', selected: submit.selected, submit: true });
  let trailing = 0;
  let axis: ParsedMenu['axis'] = null;
  for (; i < f; i++) {
    const l = lines[i].trim();
    if (l !== '' && !isRule(l, '─╌▔')) {
      const ax = AXIS.exec(l);
      if (ax) axis = { label: /effort/i.test(ax[1]) ? 'effort' : '', value: ax[1] };
      else notes.push(l);
      trailing++;
    }
  }
  // Меньше двух вариантов или много строк между вариантами и подсказкой — «❯» нашёлся не в меню
  if (options.length < 2 || trailing > MAX_TRAILING) return null;

  // Шапка: от ближайшей сплошной линии до вариантов; строки между пунктирами «╌» — код
  let top = start - 1;
  while (top >= 0 && !isBoundary(lines[top])) top--;
  const head: { text: string; code: boolean }[] = [];
  let inCode = false;
  for (let j = top + 1; j < start; j++) {
    const l = lines[j].trim();
    if (isRule(l, '╌')) {
      inCode = !inCode;
      continue;
    }
    if (l !== '') head.push({ text: l, code: inCode });
  }
  // Вкладки вопросов AskUserQuestion: ☐ — без ответа, ☒ — отвечен; текущий — первый без ответа
  let tabs: ParsedMenu['tabs'] = null;
  const tabLine = head.length ? TABS.exec(head[0].text) : null;
  if (tabLine) {
    const raw = tabLine[1].split(/\s{2,}/).filter((t) => !/^✔\s*Submit$/.test(t));
    const open = raw.findIndex((t) => t.startsWith('☐'));
    tabs = { labels: raw.map((t) => t.replace(/^[☐☒✔]\s*/, '')), current: open >= 0 ? open : raw.length - 1 };
    head.shift();
  }
  const [title = { text: '' }, ...rest] = head;
  const ctx = rest.slice(0, 6);
  return {
    title: title.text, context: ctx.map((c) => c.text), code: ctx.map((c) => c.code), options, notes, hint: lines[f]?.trim() ?? null,
    kind: multi ? 'multi' : 'single', tabs, axis,
  };
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

/** Стрелки от варианта под курсором до варианта index (без Enter). */
export const moveKeysFor = (menu: ParsedMenu, index: number): MenuKey[] => {
  const sel = Math.max(0, menu.options.findIndex((o) => o.selected));
  const delta = index - sel;
  return Array<MenuKey>(Math.abs(delta)).fill(delta > 0 ? 'down' : 'up');
};

/** Множественный выбор: отметить или снять вариант index — стрелки до него и пробел. */
export const toggleKeysFor = (menu: ParsedMenu, index: number): MenuKey[] => (menu.options[index] ? [...moveKeysFor(menu, index), 'space'] : []);

/** Множественный выбор: «Готово» — стрелки до «Submit» и Enter (дальше Claude Code показывает «Review your answers»). */
export function submitKeysFor(menu: ParsedMenu): MenuKey[] {
  const i = menu.options.findIndex((o) => o.submit);
  return i < 0 ? [] : [...moveKeysFor(menu, i), 'enter'];
}

/** То же меню, что на экране: заголовок, команда/путь, подписи вариантов, текущий вопрос (отметки и курсор не в счёт). */
export const menuSignature = (m: ParsedMenu): string =>
  JSON.stringify([m.title, m.context, m.options.map((o) => o.label), m.tabs?.current ?? null]);

/** Выбор в карточке меню, собранный локально: курсор, желаемые отметки (множественный), свой ответ. */
export interface MenuChoice {
  cursor: number;
  checked: boolean[];
  own: string;
}

/** Выбор, как он сейчас на экране Claude Code. */
export const menuChoiceFrom = (menu: ParsedMenu): MenuChoice => ({
  cursor: Math.max(0, menu.options.findIndex((o) => o.selected)),
  checked: menu.options.map((o) => !!o.checked),
  own: '',
});

/**
 * Клавиши от экрана к выбору одной пачкой. Одиночный: цифра варианта (без своего ответа) или стрелки и Enter.
 * Множественный: от курсора на экране — стрелки и пробел у каждого варианта, чья отметка отличается, затем Submit и Enter.
 * Свой ответ: keys — до ввода текста, ownText — текст, after — после него.
 */
export function answerKeysFor(menu: ParsedMenu, choice: MenuChoice): { keys: MenuKey[]; ownText: string | null; after: MenuKey[] } {
  const own = choice.own.trim();
  let pos = Math.max(0, menu.options.findIndex((o) => o.selected));
  const keys: MenuKey[] = [];
  const after: MenuKey[] = [];
  let ownText: string | null = null;
  const out = () => (ownText === null ? keys : after);
  const go = (i: number) => {
    const d = i - pos;
    for (let k = 0; k < Math.abs(d); k++) out().push(d > 0 ? 'down' : 'up');
    pos = i;
  };
  if (menu.kind !== 'multi') {
    const opt = menu.options[choice.cursor];
    if (!opt) return { keys, ownText, after };
    if (opt.input && own) {
      go(choice.cursor);
      ownText = own;
    } else if (opt.n !== null && opt.n >= 1 && opt.n <= 9) return { keys: [String(opt.n) as MenuKey], ownText: null, after: [] };
    else go(choice.cursor);
    out().push('enter');
    return { keys, ownText, after };
  }
  menu.options.forEach((o, i) => {
    if (o.submit) return;
    if (o.input && own) {
      go(i);
      ownText = own;
    } else if (o.checked !== undefined && !!choice.checked[i] !== !!o.checked) {
      go(i);
      out().push('space');
    }
  });
  const submit = menu.options.findIndex((o) => o.submit);
  if (submit >= 0) {
    go(submit);
    out().push('enter');
  }
  return { keys, ownText, after };
}

/** Клавиши для выбора варианта index: цифра, если у варианта есть номер, иначе стрелки от выбранного и Enter. */
export function menuKeysFor(menu: ParsedMenu, index: number): MenuKey[] {
  const opt = menu.options[index];
  if (!opt) return [];
  if (opt.n !== null && opt.n >= 1 && opt.n <= 9) return [String(opt.n) as MenuKey];
  return [...moveKeysFor(menu, index), 'enter'];
}
