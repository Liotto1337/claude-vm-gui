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

describe('cdPrefix с созданием папки', () => {
  it('использует один и тот же путь для mkdir и cd', () => {
    expect(cdPrefix("~/Проекты/a 'b'", { create: true })).toBe(
      `mkdir -p -- "$HOME"/${shellQuote("Проекты/a 'b'")} && cd "$HOME"/${shellQuote("Проекты/a 'b'")}`,
    );
  });
  it('принимает относительный путь, начинающийся с дефиса', () => {
    expect(cdPrefix('-проект/тест', { create: true })).toBe(
      "mkdir -p -- './-проект/тест' && cd './-проект/тест'",
    );
  });
  it.each(['', '  ', '~'])('переходит в домашнюю папку при %j', (dir) => {
    expect(cdPrefix(dir, { create: true })).toBe('cd "$HOME"');
  });
});

describe('validateSessionName', () => {
  it.each(['claude-game', 'a', 'v1_2-x', 'A'.repeat(64)])('принимает %s', (n) => expect(validateSessionName(n)).toBe(true));
  // Точку tmux молча заменяет на «_» (my.proj → my_proj), поэтому её не принимаем
  it.each(['', 'a;rm', 'two words', 'имя', 'a:b', 'site.ru', 'A'.repeat(65), '-x\n'])('отклоняет %j', (n) =>
    expect(validateSessionName(n)).toBe(false));
});
