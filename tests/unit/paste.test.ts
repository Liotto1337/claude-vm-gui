import { describe, expect, it } from 'vitest';
import { bracketedPaste, slashCommand } from '../../src/shared/paste';

describe('bracketedPaste', () => {
  it('оборачивает текст, вырезает ESC, добавляет пути картинок и Enter', () => {
    expect(bracketedPaste('a\nb\x1b[31m', ['/root/.cache/claude-vm-gui/uploads/1.png'])).toBe(
      '\x1b[200~a\nb[31m /root/.cache/claude-vm-gui/uploads/1.png\x1b[201~\r',
    );
  });
  it('нельзя закрыть вставку изнутри текста', () =>
    expect(bracketedPaste('x\x1b[201~; rm -rf ~\r', [])).toBe('\x1b[200~x[201~; rm -rf ~\n\x1b[201~\r'));
  it('только картинки', () => expect(bracketedPaste('  ', ['/p.png'])).toBe('\x1b[200~/p.png\x1b[201~\r'));
  it('Windows-переносы становятся \\n', () => expect(bracketedPaste('a\r\nb', [])).toBe('\x1b[200~a\nb\x1b[201~\r'));
  it('пустое сообщение без картинок — ошибка', () => expect(() => bracketedPaste(' \n', [])).toThrow());
});

describe('slashCommand', () => {
  it('model', () => expect(slashCommand('model', 'sonnet')).toBe('/model sonnet\r'));
  it('полное имя модели с [1m]', () => expect(slashCommand('model', 'claude-opus-5-5[1m]')).toBe('/model claude-opus-5-5[1m]\r'));
  it('effort', () => expect(slashCommand('effort', 'low')).toBe('/effort low\r'));
  it('инъекция — ошибка', () => expect(() => slashCommand('effort', 'x; rm')).toThrow());
});
