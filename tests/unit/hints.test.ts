import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUILTIN_COMMANDS, detectTrigger, filterHints, parseInitialize } from '../../src/shared/hints';

describe('detectTrigger', () => {
  it('/ в начале', () => expect(detectTrigger('/mo', 3)).toEqual({ kind: 'slash', query: 'mo', start: 0 }));
  it('/ с пробелом до каретки — уже аргумент', () => expect(detectTrigger('/model so', 9)).toBeNull());
  it('@ после пробела', () => expect(detectTrigger('смотри @sr', 10)).toEqual({ kind: 'file', query: 'sr', start: 7 }));
  it('@ в начале второй строки', () => expect(detectTrigger('a\n@x', 4)).toEqual({ kind: 'file', query: 'x', start: 2 }));
  it('/ не в начале', () => expect(detectTrigger('a/b', 3)).toBeNull());
  it('email не триггер', () => expect(detectTrigger('email@x', 7)).toBeNull());
  it('каретка до триггера', () => expect(detectTrigger('ab @cd', 2)).toBeNull());
});

describe('filterHints', () => {
  const items = ['compact', 'model', 'memory', 'mcp', 'clear', 'superpowers:brainstorming'];
  it('префикс раньше подстроки, без учёта регистра', () =>
    expect(filterHints(items, 'M', (s) => s)).toEqual(['model', 'memory', 'mcp', 'compact', 'superpowers:brainstorming']));
  it('лимит', () => expect(filterHints(items, '', (s) => s, 2)).toEqual(['compact', 'model']));
  it('подстрока', () => expect(filterHints(items, 'brain', (s) => s)).toEqual(['superpowers:brainstorming']));
});

describe('parseInitialize', () => {
  const json = JSON.parse(readFileSync('tests/fixtures/initialize.json', 'utf8'));
  const hints = parseInitialize(json);
  it('берёт команды claude с описаниями', () => {
    const model = hints.commands.find((c) => c.name === 'model');
    expect(model).toMatchObject({ source: 'claude' });
    expect(model?.description.length).toBeGreaterThan(5);
  });
  it('добавляет встроенные команды, которых нет в ответе', () => {
    expect(hints.commands.find((c) => c.name === 'resume')?.source).toBe('builtin');
    expect(hints.commands.find((c) => c.name === 'memory')?.source).toBe('builtin');
  });
  it('не дублирует имена', () => {
    const names = hints.commands.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });
  it('модели с уровнями effort', () => {
    expect(hints.models.find((m) => m.value === 'opus')?.efforts).toContain('high');
  });
  it('мусор на входе — пустой ответ без падения', () => expect(parseInitialize({ x: 1 })).toEqual({ commands: BUILTIN_COMMANDS, models: [] }));
});
