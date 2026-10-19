import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ChatItem } from '../../src/shared/ipc';
import { newParseState, parseTranscriptLines } from '../../src/shared/transcript-parse';

// Синтетический журнал в форме настоящего (Claude Code 2.1.303)
const LINES = readFileSync(join(__dirname, '../fixtures/transcript.jsonl'), 'utf8').split('\n').filter(Boolean);
const parseAll = (lines = LINES) => {
  const st = newParseState();
  const r = parseTranscriptLines(lines, st);
  return { ...r, st };
};
const items = () => parseAll().changed;
type Tool = Extract<ChatItem, { kind: 'tool' }>;
const tool = (name: string, list = items()) => list.find((i): i is Tool => i.kind === 'tool' && i.name === name)!;
const users = () => items().filter((i): i is Extract<ChatItem, { kind: 'user' }> => i.kind === 'user');

describe('parseTranscriptLines', () => {
  it('порядок элементов как в журнале', () =>
    expect(items().map((i) => i.kind)).toEqual([
      'user', 'user', 'user', 'note', 'thinking', 'assistant', 'tool', 'tool', 'tool', 'note', 'tool', 'assistant', 'user', 'note',
    ]));
  it('user: текст и картинки чипами', () => {
    expect(users()[0]).toMatchObject({ text: 'привет', images: 0 });
    expect(users()[1]).toMatchObject({ text: 'посмотри', images: 1 });
  });
  it('slash-команда как user «/model sonnet», вывод — note без ANSI', () => {
    expect(users()[2].text).toBe('/model sonnet');
    expect(items()[3]).toMatchObject({ kind: 'note', text: 'Set model to Sonnet' });
  });
  it('isMeta и служебные записи пропускаются', () => expect(JSON.stringify(items())).not.toContain('Base directory'));
  it('tool_use + tool_result → ok с результатом', () =>
    expect(tool('Bash')).toMatchObject({ status: 'ok', summary: 'ls -la', result: expect.stringContaining('total 8') }));
  it('is_error → status error', () => expect(tool('Read')).toMatchObject({ status: 'error', summary: '/home/user/site/index.html', result: 'File does not exist.' }));
  it('результат-массив склеивается', () => expect(tool('Task').result).toBe('Нашёл 2 файла'));
  it('sidechain вложен в Task', () => {
    const t = tool('Task');
    expect(t.summary).toBe('Найти файлы');
    expect(t.children).toHaveLength(1);
    expect(t.children[0]).toMatchObject({ kind: 'tool', name: 'Grep', summary: 'TODO', status: 'ok', result: 'a.ts:1' });
  });
  it('битая строка считается в bad и не роняет разбор', () => expect(parseAll().bad).toBe(1));
  it('прерывание → note', () => expect(items()[9]).toMatchObject({ kind: 'note', text: 'Остановлено пользователем' }));
  it('длинный результат обрезан до 200 строк с пометкой', () => {
    const r = items().filter((i): i is Tool => i.kind === 'tool' && i.summary === 'seq 300')[0].result!;
    expect(r.split('\n')).toHaveLength(201);
    expect(r).toMatch(/ещё 100 строк$/);
  });
  it('вызов без результата — running', () => {
    const r = parseAll(LINES.slice(0, 8)).changed;
    expect(tool('Bash', r).status).toBe('running');
  });
  it('результат в следующей порции обновляет тот же элемент', () => {
    const st = newParseState();
    parseTranscriptLines(LINES.slice(0, 8), st);
    const next = parseTranscriptLines(LINES.slice(8, 9), st).changed;
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ kind: 'tool', id: 'toolu_1', status: 'ok' });
  });
  it('результат раньше вызова (подгрузка ранней части) — склеивается', () => {
    const st = newParseState();
    parseTranscriptLines(LINES.slice(8, 9), st);
    const earlier = parseTranscriptLines(LINES.slice(0, 8), st).changed;
    expect(tool('Bash', earlier)).toMatchObject({ status: 'ok', result: expect.stringContaining('total 8') });
  });
  it('bash-режим: команда как user «! pwd», вывод — note', () => {
    const all = items();
    expect(all[12]).toMatchObject({ kind: 'user', text: '! pwd' });
    expect(all[13]).toMatchObject({ kind: 'note', text: '/home/user/site' });
  });
  it('20 битых строк подряд — badStreak', () => {
    const st = newParseState();
    parseTranscriptLines(Array(20).fill('{bad'), st);
    expect(st.badStreak).toBe(20);
    parseTranscriptLines([LINES[0]], st);
    expect(st.badStreak).toBe(0);
  });
  it('ввод инструмента — JSON до 4000 символов', () => {
    const big = JSON.stringify({ type: 'assistant', uuid: 'z', message: { content: [{ type: 'tool_use', id: 't', name: 'Write', input: { file_path: '/a', content: 'x'.repeat(10000) } }] } });
    const t = parseAll([big]).changed[0] as Tool;
    expect(t.summary).toBe('/a');
    expect(t.input.length).toBeLessThanOrEqual(4001);
  });
});
