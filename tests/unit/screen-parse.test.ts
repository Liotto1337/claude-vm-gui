import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyScreen, inputText, menuKeysFor, parseMenu, parseStatus, stripAnsi } from '../../src/shared/screen-parse';

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
    expect(m.notes.some((n) => n.includes('High effort'))).toBe(true);
  });
  it('запрос Bash: команда в контексте, 4 варианта', () => {
    const m = parseMenu(plain('permission-bash'))!;
    expect(m.title).toBe('Bash command');
    expect(m.context.join('\n')).toContain('touch /tmp/project');
    expect(m.context.join('\n')).not.toMatch(/╌/);
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
