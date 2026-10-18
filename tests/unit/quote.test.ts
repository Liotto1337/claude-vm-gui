import { describe, expect, it } from 'vitest';
import { cdPrefix, shellQuote, validateSessionName } from '../../src/shared/quote';

describe('shellQuote', () => {
  it('экранирует одинарную кавычку', () => expect(shellQuote("it's")).toBe("'it'\\''s'"));
  it('не раскрывает $() и обратные кавычки', () => expect(shellQuote('$(rm -rf ~)`x`')).toBe("'$(rm -rf ~)`x`'"));
});

describe('cdPrefix', () => {
  it('раскрывает ~ через $HOME и экранирует остальное', () =>
    expect(cdPrefix('~/Проекты/a b')).toBe(`cd "$HOME"/'Проекты/a b'`));
  it('одна ~ — домашняя папка', () => expect(cdPrefix('~')).toBe('cd "$HOME"'));
  it('пусто — домашняя папка', () => expect(cdPrefix('  ')).toBe('cd "$HOME"'));
  it('абсолютный путь с кавычкой', () => expect(cdPrefix("/srv/it's")).toBe("cd '/srv/it'\\''s'"));
  it('~user не раскрывается как домашняя папка', () => expect(cdPrefix('~root/x')).toBe("cd '~root/x'"));
});

describe('validateSessionName', () => {
  it.each(['claude-game', 'a', 'v1.2_x', 'A'.repeat(64)])('принимает %s', (n) => expect(validateSessionName(n)).toBe(true));
  it.each(['', 'a;rm', 'two words', 'имя', 'a:b', 'A'.repeat(65), '-x\n'])('отклоняет %j', (n) =>
    expect(validateSessionName(n)).toBe(false));
});
