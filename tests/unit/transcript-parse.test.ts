import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ChatItem } from '../../src/shared/ipc';
import { newParseState, parseTranscriptLines, unwrapPasted } from '../../src/shared/transcript-parse';

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
  it('user: текст и картинки из журнала (данные блока image)', () => {
    expect(users()[0]).toMatchObject({ text: 'привет', images: [], files: [] });
    expect(users()[1]).toMatchObject({ text: 'посмотри', images: [{ mediaType: 'image/png', data: 'iVBORw0KGgo=' }], files: [] });
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
  it('длинная строка без пробелов разбирается быстро (без квадратичного перебора)', () => {
    const line = JSON.stringify({ type: 'user', uuid: 'big', message: { role: 'user', content: 'B'.repeat(300_000) } });
    const t = Date.now();
    parseAll([line]);
    expect(Date.now() - t).toBeLessThan(500);
  });
  it('путь к файлу из uploads среди текста — вложение', () => {
    const line = JSON.stringify({ type: 'user', uuid: 'p', message: { role: 'user', content: 'глянь /root/.cache/claude-vm-gui/uploads/1-a.png пожалуйста' } });
    expect(parseAll([line]).changed[0]).toMatchObject({ text: 'глянь пожалуйста', images: [], files: ['/root/.cache/claude-vm-gui/uploads/1-a.png'] });
  });
  it('несколько вложений по порядку, текст без путей', () => {
    const txt = '/home/u/.cache/claude-vm-gui/uploads/20261022-130509-a1b2c3-a.txt';
    const png = '/home/u/.cache/claude-vm-gui/uploads/20261021-215724-609469.png';
    const line = JSON.stringify({ type: 'user', uuid: 'f', message: { role: 'user', content: `см. ${txt} и картинку ${png}` } });
    expect(parseAll([line]).changed[0]).toMatchObject({ text: 'см. и картинку', files: [txt, png] });
  });
  it('блок image без base64 — картинка без данных', () => {
    const line = JSON.stringify({ type: 'user', uuid: 'i', message: { role: 'user', content: [{ type: 'text', text: '[Image #1]' }, { type: 'image', source: { type: 'url', url: 'x' } }] } });
    expect(parseAll([line]).changed[0]).toMatchObject({ text: '', images: [{ mediaType: '', data: '' }] });
  });
});

describe('сводка сжатия и pasted_content', () => {
  const parse = (lines: string[]) => parseTranscriptLines(lines, newParseState());
  it('сводка сжатия контекста в ленту не попадает', () => {
    const line = JSON.stringify({
      type: 'user', isCompactSummary: true, isVisibleInTranscriptOnly: true, uuid: 'u1',
      message: { role: 'user', content: 'This session is being continued from a previous conversation…' },
    });
    expect(parse([line]).changed).toEqual([]);
  });
  it('unwrapPasted: пара тегов с id и без, несколько вставок', () => {
    expect(unwrapPasted('до\n<pasted_content id="c1">\na\nb\n</pasted_content id="c1">\nпосле')).toBe('до\na\nb\nпосле');
    expect(unwrapPasted('<pasted_content>\nx\n</pasted_content>')).toBe('x');
    expect(unwrapPasted('<pasted_content id="1">\na\n</pasted_content id="1"> и <pasted_content id="2">\nb\n</pasted_content id="2">')).toBe('a и b');
  });
  it('unwrapPasted: непарные и разные id не трогаются', () => {
    expect(unwrapPasted('a </pasted_content id="z"> b')).toBe('a </pasted_content id="z"> b');
    expect(unwrapPasted('<pasted_content id="a">\nx\n</pasted_content id="b">')).toBe('<pasted_content id="a">\nx\n</pasted_content id="b">');
  });
  it('сообщение с обёрнутой вставкой — только текст вставки', () => {
    const str = JSON.stringify({ type: 'user', uuid: 's', message: { role: 'user', content: '<pasted_content id="c1">\na\nb\n</pasted_content id="c1">' } });
    const blk = JSON.stringify({ type: 'user', uuid: 'b', message: { role: 'user', content: [{ type: 'text', text: '<pasted_content id="c2">\nc\nd\n</pasted_content id="c2">' }] } });
    expect(parse([str, blk]).changed).toMatchObject([{ kind: 'user', text: 'a\nb' }, { kind: 'user', text: 'c\nd' }]);
  });
});

describe('служебные уведомления фоновых задач', () => {
  const parse = (lines: string[]) => parseTranscriptLines(lines, newParseState());
  it('<task-notification> в ленту не попадает (и по origin, и по тексту)', () => {
    const text = '<task-notification>\n<task-id>b1</task-id>\n<summary>Monitor event</summary>\n</task-notification>';
    const byOrigin = JSON.stringify({ type: 'user', uuid: 'n1', origin: { kind: 'task-notification', producer: 'session-task' }, message: { role: 'user', content: text } });
    const byText = JSON.stringify({ type: 'user', uuid: 'n2', message: { role: 'user', content: [{ type: 'text', text }] } });
    expect(parse([byOrigin, byText]).changed).toEqual([]);
  });
});

describe('субагенты и подгрузка ранней части', () => {
  const j = (o: object) => JSON.stringify(o);
  const task = (uuid: string, id: string, prompt: string) =>
    j({ type: 'assistant', uuid, message: { content: [{ type: 'tool_use', id, name: 'Task', input: { description: prompt, prompt } }] } });
  const sideUser = (uuid: string, text: string, parentUuid: string | null = null) =>
    j({ type: 'user', uuid, parentUuid, isSidechain: true, message: { content: text } });
  const sideTool = (uuid: string, parentUuid: string, id: string, pattern: string) =>
    j({ type: 'assistant', uuid, parentUuid, isSidechain: true, message: { content: [{ type: 'tool_use', id, name: 'Grep', input: { pattern } }] } });
  const children = (st: ReturnType<typeof newParseState>, id: string) => (st.items.get(id) as Tool).children.map((c) => (c.kind === 'tool' ? c.summary : c.kind));

  it('ранняя часть журнала не перехватывает действия живого субагента', () => {
    const st = newParseState();
    parseTranscriptLines([task('a2', 'toolu_live', 'живой')], st);
    // «Показать раньше»: в ранней части — свой, давно завершённый Task
    parseTranscriptLines([task('a1', 'toolu_old', 'старый')], st, true);
    parseTranscriptLines([sideTool('s1', 'x', 'toolu_g', 'после')], st);
    expect(children(st, 'toolu_live')).toEqual(['после']);
    expect(children(st, 'toolu_old')).toEqual([]);
  });

  it('параллельные Task: действия по цепочке parentUuid попадают к своему', () => {
    const st = newParseState();
    parseTranscriptLines([
      task('a1', 'toolu_A', 'искать A'),
      task('a2', 'toolu_B', 'искать B'),
      sideUser('sa0', 'искать A'),
      sideUser('sb0', 'искать B'),
      sideTool('sa1', 'sa0', 'toolu_ga', 'A1'),
      sideTool('sb1', 'sb0', 'toolu_gb', 'B1'),
      sideTool('sa2', 'sa1', 'toolu_ga2', 'A2'),
    ], st);
    expect(children(st, 'toolu_A')).toEqual(['A1', 'A2']);
    expect(children(st, 'toolu_B')).toEqual(['B1']);
  });

  it('запасные id записей без uuid не совпадают после подгрузки ранней части', () => {
    const st = newParseState();
    const noUuid = (text: string) => j({ type: 'user', message: { content: text } });
    const live = parseTranscriptLines([noUuid('позже')], st).changed;
    const early = parseTranscriptLines([noUuid('раньше')], st, true).changed;
    expect(live[0].id).not.toBe(early[0].id);
    expect([...st.items.values()].map((i) => (i.kind === 'user' ? i.text : ''))).toEqual(['позже', 'раньше']);
  });
});

describe('контекст сессии', () => {
  const CONTEXT_OUT = readFileSync(join(__dirname, '../fixtures/context-2.1.310.txt'), 'utf8');
  const answer = (uuid: string, used: { r: number; w?: number }, model = 'claude-sonnet-5-5') =>
    JSON.stringify({
      type: 'assistant', uuid, timestamp: '2026-10-24T12:00:00.000Z',
      message: { model, content: [{ type: 'text', text: `ответ ${uuid}` }], usage: { input_tokens: 10, cache_read_input_tokens: used.r, cache_creation_input_tokens: used.w ?? 0, output_tokens: 3 } },
    });
  const contextCmd = JSON.stringify({ type: 'user', uuid: 'c1', message: { content: '<command-name>/context</command-name>\n<command-message>context</command-message>\n<command-args></command-args>' } });
  const contextOut = (uuid = 'c2', at = '2026-10-24T12:32:00.000Z') =>
    JSON.stringify({ type: 'system', subtype: 'local_command', uuid, timestamp: at, content: `<local-command-stdout>${CONTEXT_OUT}</local-command-stdout>` });

  it('«занято» и модель — по последнему ответу', () => {
    const st = newParseState();
    parseTranscriptLines([answer('a1', { r: 990 })], st);
    expect(st.context).toMatchObject({ used: 1000, model: 'claude-sonnet-5-5' });
    parseTranscriptLines([answer('a2', { r: 1990 })], st);
    expect(st.context.used).toBe(2000);
  });

  it('/context и его вывод — не в ленте, замер в состоянии', () => {
    const st = newParseState();
    parseTranscriptLines([answer('a1', { r: 990 })], st);
    const r = parseTranscriptLines([contextCmd, contextOut()], st);
    expect(r.changed).toEqual([]);
    expect(st.items.has('c1') || st.items.has('c2')).toBe(false);
    expect(st.context.snapshot?.window).toBe(1_000_000);
    expect(st.context.snapshotAt).toBe(Date.parse('2026-10-24T12:32:00.000Z'));
    expect(st.context.snapshotModel).toBe('claude-sonnet-5-5');
  });

  it('вывод /context без своей команды рядом тоже распознаётся и скрывается', () => {
    const st = newParseState();
    const r = parseTranscriptLines([answer('a1', { r: 990 }), contextOut('c9')], st);
    expect(r.changed.map((i) => i.id)).toEqual(['a1:0']);
    expect(st.context.snapshot).not.toBeNull();
  });

  it('сводка сжатия сбрасывает «занято», замер остаётся', () => {
    const st = newParseState();
    parseTranscriptLines([answer('a1', { r: 990 }), contextOut()], st);
    parseTranscriptLines([JSON.stringify({ type: 'user', uuid: 's1', isCompactSummary: true, message: { content: 'This session is being continued…' } })], st);
    expect(st.context.used).toBeNull();
    expect(st.context.snapshot).not.toBeNull();
  });

  it('ранняя часть журнала не подменяет свежие цифры', () => {
    const st = newParseState();
    parseTranscriptLines([answer('a5', { r: 4990 })], st);
    const before = { ...st.context };
    parseTranscriptLines([answer('a0', { r: 90 }, 'claude-opus-5-5'), contextOut('c0', '2026-10-01T00:00:00.000Z')], st, true);
    expect(st.context).toEqual(before);
  });

  it('/compact — обычная строка пользователя', () => {
    const st = newParseState();
    const r = parseTranscriptLines([JSON.stringify({ type: 'user', uuid: 'k1', message: { content: '<command-name>/compact</command-name>\n<command-args>сохрани план</command-args>' } })], st);
    expect(r.changed).toMatchObject([{ kind: 'user', text: '/compact сохрани план' }]);
  });
});
