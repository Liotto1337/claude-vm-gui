import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dialogOpen } from '../../src/shared/dialog';
import { classifyScreen, inputText, menuKeysFor, parseMenu, parseStatus, stripAnsi, submitKeysFor, toggleKeysFor } from '../../src/shared/screen-parse';

// Снимки настоящего Claude Code 2.1.303 (scripts/dev/capture-screen.sh)
const fx = (n: string) => readFileSync(join(__dirname, '../fixtures/screens', `${n}.ans`), 'utf8');
const plain = (n: string) => stripAnsi(fx(n));

describe('stripAnsi', () => {
  it('убирает CSI и OSC', () => expect(stripAnsi('\x1b[31ma\x1b[0m\x1b]0;t\x07b')).toBe('ab'));
  it('dropDim убирает тусклый текст', () => expect(stripAnsi('x\x1b[2mtip\x1b[0my', { dropDim: true })).toBe('xy'));
  it('dropDim: сброс через 22 и составные параметры', () =>
    expect(stripAnsi('a\x1b[2;37mb\x1b[22mc', { dropDim: true })).toBe('ac'));
});

describe('inputText', () => {
  it('пустое поле с серой подсказкой', () => expect(inputText(fx('prompt-empty'))).toBe(''));
  it('набранный текст', () => expect(inputText(fx('prompt-text'))).toBe('привет'));
  it('картинка ждёт Enter', () => expect(inputText(fx('image-pending'))).toBe('[Image #1]посмотри картинку'));
  it('поле во время работы', () => expect(inputText(fx('busy'))).toBe(''));
  it('меню без поля — null', () => expect(inputText(fx('trust'))).toBeNull());
  it('запрос разрешения — null', () => expect(inputText(fx('permission-bash'))).toBeNull());
  it('многострочный текст склеивается без отступа', () => {
    const rule = '─'.repeat(40);
    expect(inputText(`${rule}\n❯ первая\n  вторая\n${rule}\n`)).toBe('первая\nвторая');
  });
});

describe('parseMenu', () => {
  it('доверие папке — варианты без номеров', () =>
    expect(parseMenu(plain('trust'))).toMatchObject({
      title: 'Accessing workspace:',
      hint: 'Enter to confirm · Esc to cancel',
      options: [
        { n: null, label: 'No, exit', selected: true },
        { n: null, label: 'Yes, I trust this folder', selected: false },
      ],
    }));
  it('доверие папке: контекст — текст, не код', () => expect(parseMenu(plain('trust'))!.code.every((c) => !c)).toBe(true));
  it('после ↓ выбран второй вариант', () =>
    expect(parseMenu(plain('trust-yes'))!.options.map((o) => o.selected)).toEqual([false, true]));
  it('/model — номера, описания, notes', () => {
    const m = parseMenu(plain('model'))!;
    expect(m.title).toBe('Select model');
    expect(m.options.slice(0, 2).map((o) => [o.n, o.label, o.selected])).toEqual([
      [1, 'Default (recommended)', false],
      [2, 'Opus ✔', true],
    ]);
    expect(m.options[1].description).toContain('~2× usage vs Sonnet');
    expect(m.options[2]).toMatchObject({ n: 3, label: 'Fable' });
    expect(m.notes.some((n) => n.includes('+2 models'))).toBe(true);
    expect(m.axis?.value).toBe('High effort');
  });
  it('запрос Bash: команда в контексте, 4 варианта', () => {
    const m = parseMenu(plain('permission-bash'))!;
    expect(m.title).toBe('Bash command');
    expect(m.context.join('\n')).toContain('touch /tmp/project');
    expect(m.context.join('\n')).not.toMatch(/╌/);
    // Строки между пунктирами — код (команда), остальное — текст
    expect(m.context.filter((_, i) => m.code[i])).toEqual(['touch /tmp/project']);
    expect(m.options.map((o) => o.n)).toEqual([1, 2, 3, 4]);
    expect(m.hint).toBe('Esc to cancel · Tab to amend');
  });
  it('запрос на создание файла: перенос варианта в описание', () => {
    const m = parseMenu(plain('permission-write'))!;
    expect(m.title).toBe('Create file');
    expect(m.options).toHaveLength(3);
    expect(m.options[1].description).toContain('commands) for this session');
  });
  it('AskUserQuestion: вопрос, описания вариантов, вариант после линии', () => {
    const m = parseMenu(plain('ask'))!;
    expect(m.context).toContain('Какой цвет кнопки?');
    expect(m.options.map((o) => o.label)).toEqual(['Глина', 'Чёрный', 'Белый', 'Type something.', 'Chat about this']);
    expect(m.options[0].description).toBe('фирменный');
  });
  it('обычное поле — null', () => expect(parseMenu(plain('prompt-text'))).toBeNull());
  it('/config — null', () => expect(parseMenu(plain('config'))).toBeNull());
});

describe('parseStatus', () => {
  it('спиннер во время работы', () => expect(parseStatus(plain('busy'))).toBe('Vibing…'));
  it('строка «готово» после ответа — не статус', () => expect(parseStatus(plain('prompt-empty'))).toBeNull());
  it('скобки с esc to interrupt убираются', () => {
    const rule = '─'.repeat(40);
    expect(parseStatus(`✻ Думаю… (12s · esc to interrupt)\n${rule}\n❯ \n${rule}\n  esc to interrupt`)).toBe('Думаю… (12s)');
  });
});

describe('classifyScreen', () => {
  it('меню', () => expect(classifyScreen(fx('ask')).kind).toBe('menu'));
  it('поле ввода', () => expect(classifyScreen(fx('prompt-text'))).toMatchObject({ kind: 'prompt', input: 'привет', status: null }));
  it('работа', () => expect(classifyScreen(fx('busy'))).toMatchObject({ kind: 'prompt', status: 'Vibing…' }));
  it('незнакомый экран — unknown', () => expect(classifyScreen(fx('config')).kind).toBe('unknown'));
  it('пустой экран — unknown', () => expect(classifyScreen('').kind).toBe('unknown'));
});

describe('menuKeysFor', () => {
  it('без номера — стрелки и Enter', () => expect(menuKeysFor(parseMenu(plain('trust'))!, 1)).toEqual(['down', 'enter']));
  it('вверх от выбранного', () => expect(menuKeysFor(parseMenu(plain('trust-yes'))!, 0)).toEqual(['up', 'enter']));
  it('с номером — цифра', () => expect(menuKeysFor(parseMenu(plain('model'))!, 0)).toEqual(['1']));
});

// «Злые» экраны (ревью 0.2): подсказка меню в тексте ответа или в поле ввода, меню без «❯»
describe('ложное меню', () => {
  const rule = '─'.repeat(40);
  const answerMentionsFooter = [
    '❯ как устроен разбор меню?',
    '● В конце меню Claude Code пишет «Enter to confirm · Esc to cancel».',
    '  Так приложение понимает, что меню открыто.',
    rule, '❯ ', rule, '  ? for shortcuts',
  ].join('\n');
  const typedFooter = [rule, '❯ что значит Esc to cancel', rule, '  ? for shortcuts'].join('\n');
  const menuWithoutMarker = [
    '❯ привет', '● готово', rule, ' Bash command', ' rm -rf build', ' Do you want to proceed?', '   1. Yes', '   2. No', ' Esc to cancel',
  ].join('\n');

  it('подсказка в тексте ответа, ниже обычное поле — prompt, не меню', () => {
    expect(classifyScreen(answerMentionsFooter).kind).toBe('prompt');
    expect(dialogOpen(answerMentionsFooter)).toBe(false);
  });
  it('«Esc to cancel» набрано в поле — prompt, не меню', () => {
    expect(classifyScreen(typedFooter)).toMatchObject({ kind: 'prompt', input: 'что значит Esc to cancel' });
    expect(dialogOpen(typedFooter)).toBe(false);
  });
  it('меню без «❯» — unknown (терминал), но отправка блокируется', () => {
    expect(classifyScreen(menuWithoutMarker).kind).toBe('unknown');
    expect(dialogOpen(menuWithoutMarker)).toBe(true);
  });
  it('настоящие меню по-прежнему распознаются', () => {
    for (const f of ['trust', 'model', 'permission-bash', 'permission-write', 'ask']) {
      expect(classifyScreen(fx(f)).kind).toBe('menu');
      expect(dialogOpen(fx(f))).toBe(true);
    }
  });
  it('один вариант — не меню', () => expect(parseMenu([rule, ' Вопрос', ' ❯ 1. Да', ' Esc to cancel'].join('\n'))).toBeNull());
});

// Снимки Claude Code 2.1.308 (scripts/dev/capture-screen.sh, фейковый API): в множественном выборе отметку ставят
// и пробел, и Enter («[ ]» → «[✔]»); «Submit» — строка без номера под вариантами, Enter на ней открывает
// «Review your answers» (без строки подсказки внизу); вкладки вопросов — «←  ☐ Цвет  ☐ Размер  ✔ Submit  →»
// (☐ — без ответа, ☒ — отвечен); «Type something.» — свой ответ: набранный текст встаёт прямо на место подписи;
// /model — ось effort «◐ Medium effort (default) ←/→ to adjust».
describe('меню Claude Code 2.1.308: множественный выбор, вкладки, свой ответ, effort', () => {
  const pm = (n: string) => parseMenu(stripAnsi(fx(n)))!;
  it('множественный выбор: чекбоксы, «Submit» — отдельный пункт, свой ответ', () => {
    const m = pm('ask-multi');
    expect(m.kind).toBe('multi');
    expect(m.title).toBe('Какие цвета взять?');
    expect(m.options.map((o) => o.label)).toEqual(['Глина', 'Чёрный', 'Белый', 'Type something', 'Submit', 'Chat about this']);
    expect(m.options.map((o) => o.checked)).toEqual([false, false, false, false, undefined, undefined]);
    expect(m.options.map((o) => !!o.input)).toEqual([false, false, false, true, false, false]);
    expect(m.options.map((o) => !!o.submit)).toEqual([false, false, false, false, true, false]);
    expect(m.options.findIndex((o) => o.selected)).toBe(0);
    expect(m.tabs).toEqual({ labels: ['Цвета'], current: 0 });
  });
  it('отмеченные варианты и курсор', () => {
    const m = pm('ask-multi-checked');
    expect(m.options.slice(0, 4).map((o) => o.checked)).toEqual([true, true, false, false]);
    expect(m.options.findIndex((o) => o.selected)).toBe(1);
  });
  it('клавиши: отметка — стрелки и пробел, «Готово» — стрелки до Submit и Enter', () => {
    expect(toggleKeysFor(pm('ask-multi'), 2)).toEqual(['down', 'down', 'space']);
    expect(submitKeysFor(pm('ask-multi'))).toEqual(['down', 'down', 'down', 'down', 'enter']);
    expect(submitKeysFor(pm('ask-multi-checked'))).toEqual(['down', 'down', 'down', 'enter']);
  });
  it('два вопроса: вкладки и текущий вопрос', () => {
    const a = pm('ask-two');
    expect(a.kind).toBe('single');
    expect(a.tabs).toEqual({ labels: ['Цвет', 'Размер'], current: 0 });
    expect(a.title).toBe('Какой цвет кнопки?');
    expect(a.options.find((o) => o.input)?.label).toBe('Type something.');
    const b = pm('ask-two-second');
    expect(b.tabs).toEqual({ labels: ['Цвет', 'Размер'], current: 1 });
    expect(b.title).toBe('Какой размер?');
  });
  it('«Review your answers» без подсказки внизу — тоже меню', () => {
    const r = pm('ask-review');
    expect(r.title).toBe('Review your answers');
    expect(r.options.map((o) => o.label)).toEqual(['Submit answers', 'Cancel']);
    expect(dialogOpen(fx('ask-review'))).toBe(true);
    expect(classifyScreen(fx('ask-review')).kind).toBe('menu');
  });
  it('/model: ось effort отдельно от заметок', () => {
    const m = pm('model-effort');
    expect(m.axis).toEqual({ label: 'effort', value: 'Medium effort (default)' });
    expect(m.notes).toEqual([]);
    expect(pm('model-effort-high').axis?.value).toBe('High effort');
    expect(pm('model').axis?.value).toBe('High effort');
    expect(pm('model').notes).toEqual(['… +2 models']);
  });
  it('прежние меню — один выбор, без вкладок и оси', () => {
    for (const n of ['permission-bash', 'permission-write', 'trust']) {
      const m = pm(n);
      expect([m.kind, m.tabs, m.axis]).toEqual(['single', null, null]);
    }
  });
});
