import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contextView, parseContextOutput, parseTokenCount, usedFromAssistant } from '../../src/shared/context-parse';

const FIXTURE = readFileSync(new URL('../fixtures/context-2.1.310.txt', import.meta.url), 'utf8');

describe('parseContextOutput', () => {
  it('настоящий вывод /context 2.1.310: итог, окно, буфер и категории по порядку', () => {
    const s = parseContextOutput(FIXTURE)!;
    expect(s.used).toBe(29_700);
    expect(s.window).toBe(1_000_000);
    expect(s.buffer).toBe(33_000);
    expect(s.categories.map((c) => [c.name, c.tokens, c.pct])).toEqual([
      ['System prompt', 2800, 0.3],
      ['System tools', 13_400, 1.3],
      ['MCP tools', 671, 0.1],
      ['MCP server instructions', 717, 0.1],
      ['Memory files', 764, 0.1],
      ['Skills', 9900, 1.0],
      ['Messages', 1300, 0.1],
      ['Free space', 937_400, 93.7],
      ['Autocompact buffer', 33_000, 3.3],
    ]);
    for (const c of s.categories) expect(c.color).not.toBeNull();
    expect(s.categories.find((c) => c.name === 'Skills')!.color).toBe('ansi:93');
    expect(s.categories.find((c) => c.name === 'Messages')!.color).toBe('ansi:35');
    expect(s.categories.find((c) => c.name === 'Free space')!.dim).toBe(true);
    expect(s.categories.find((c) => c.name === 'Messages')!.dim).toBe(false);
  });

  it('другой формат → null', () => {
    expect(parseContextOutput('что-то другое')).toBeNull();
    expect(parseContextOutput('')).toBeNull();
  });

  it('итог без категорий → снимок с пустыми категориями и буфером 0', () => {
    expect(parseContextOutput(' Context Usage\n  29.7k/1m tokens (3%)\n')).toEqual({ used: 29_700, window: 1_000_000, buffer: 0, categories: [] });
  });
});

describe('parseTokenCount', () => {
  it('k, m, без суффикса, мусор', () => {
    expect(parseTokenCount('29.7k')).toBe(29_700);
    expect(parseTokenCount('1M')).toBe(1_000_000);
    expect(parseTokenCount('671')).toBe(671);
    expect(parseTokenCount('abc')).toBeNull();
  });
});

describe('usedFromAssistant', () => {
  const rec = (extra: Record<string, unknown> = {}, msg: Record<string, unknown> = {}) => ({
    type: 'assistant',
    ...extra,
    message: { model: 'claude-sonnet-5-5', usage: { input_tokens: 10, cache_read_input_tokens: 800, cache_creation_input_tokens: 190, output_tokens: 5 }, ...msg },
  });
  it('вход + чтение кэша + запись в кэш', () => {
    expect(usedFromAssistant(rec())).toEqual({ used: 1000, model: 'claude-sonnet-5-5' });
  });
  it('субагент, <synthetic>, без usage → null', () => {
    expect(usedFromAssistant(rec({ isSidechain: true }))).toBeNull();
    expect(usedFromAssistant(rec({}, { model: '<synthetic>' }))).toBeNull();
    expect(usedFromAssistant(rec({}, { usage: undefined }))).toBeNull();
  });
});

describe('contextView', () => {
  const win = { window: 1_000_000, buffer: 33_000 };
  it('83 % — предупреждение, до автосжатия 134.7k', () => {
    expect(contextView(832_300, win)).toEqual({ used: 832_300, window: 1_000_000, pct: 83, toAutocompact: 134_700, level: 'warn' });
  });
  it('близко к автосжатию — опасно', () => {
    expect(contextView(950_000, win)).toMatchObject({ level: 'danger', toAutocompact: 17_000 });
  });
  it('без окна — без процента', () => {
    expect(contextView(29_700, null)).toEqual({ used: 29_700, window: null, pct: null, toAutocompact: null, level: 'ok' });
  });
  it('неизвестно сколько занято — всё null', () => {
    expect(contextView(null, win)).toEqual({ used: null, window: null, pct: null, toAutocompact: null, level: 'ok' });
  });
});
