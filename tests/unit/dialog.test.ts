import { describe, expect, it } from 'vitest';
import { dialogOpen } from '../../src/shared/dialog';

const screen = (...tail: string[]) => ['● Готово.', '', ...tail].join('\n');

describe('dialogOpen', () => {
  it.each([
    'Enter to confirm · Esc to cancel',
    'Esc to cancel',
    'Enter to select · ↑/↓ to navigate · Esc to exit',
    'Press Enter to continue…',
  ])('меню Claude Code: %s', (footer) => expect(dialogOpen(screen(' ❯ 1. Yes', '   2. No', '', footer))).toBe(true));

  it('обычное поле ввода — не меню', () =>
    expect(dialogOpen(screen('╭────╮', '│ >  │', '╰────╯', '  ? for shortcuts'))).toBe(false));
  it('идёт работа — не меню', () => expect(dialogOpen(screen('✻ Думаю… (12s · esc to interrupt)'))).toBe(false));
  it('подсказка давно уехала вверх — не считается', () =>
    expect(dialogOpen(['Esc to cancel', ...Array.from({ length: 20 }, (_, i) => `строка ${i}`)].join('\n'))).toBe(false));
});
