import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SshConnection } from '../../src/main/ssh';
import { readTail, TranscriptService } from '../../src/main/transcript';
import type { ChatEvent } from '../../src/shared/ipc';
import { hasTestKey, tempKnownHosts, testConfig } from './helpers';

const FIXTURE = readFileSync(join(__dirname, '../fixtures/transcript.jsonl'), 'utf8');
const user = (uuid: string, text: string) => `${JSON.stringify({ type: 'user', uuid, message: { role: 'user', content: text } })}\n`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!hasTestKey)('журнал Claude Code по SSH', () => {
  let conn: SshConnection;
  const dir = mkdtempSync(join(tmpdir(), 'cvg-tr-'));

  beforeAll(async () => {
    conn = new SshConnection(testConfig(), { knownHostsPath: tempKnownHosts(), askHostKey: async () => true });
    expect((await conn.connect()).ok).toBe(true);
  });
  afterAll(() => conn.close());

  const collect = (svc: TranscriptService) => {
    const events: Omit<ChatEvent, 'session'>[] = [];
    const unavailable: string[] = [];
    svc.on('items', (e) => events.push(e));
    svc.on('unavailable', (r) => unavailable.push(r));
    return { events, unavailable };
  };

  it('follow отдаёт хвост, дописанная строка приходит событием', async () => {
    const path = join(dir, 'a.jsonl');
    writeFileSync(path, FIXTURE);
    const svc = new TranscriptService(conn);
    const { events } = collect(svc);
    await svc.follow(path);
    expect(events[0]).toMatchObject({ reset: true, prepend: false, hasEarlier: false });
    expect(events[0].items.length).toBe(14);
    appendFileSync(path, user('new-1', 'ещё сообщение'));
    await expect.poll(() => events.length, { timeout: 5000 }).toBeGreaterThan(1);
    expect(events[1]).toMatchObject({ reset: false, items: [{ kind: 'user', text: 'ещё сообщение' }] });
    svc.stop();
  });

  it('вывод /context без новых элементов ленты всё равно приходит событием с замером', async () => {
    const path = join(dir, 'ctx.jsonl');
    writeFileSync(path, FIXTURE);
    const svc = new TranscriptService(conn);
    const { events } = collect(svc);
    await svc.follow(path);
    const out = readFileSync(join(__dirname, '../fixtures/context-2.1.310.txt'), 'utf8');
    appendFileSync(path, `${JSON.stringify({ type: 'system', subtype: 'local_command', uuid: 'ctx-1', timestamp: '2026-10-24T12:00:00.000Z', content: `<local-command-stdout>${out}</local-command-stdout>` })}\n`);
    await expect.poll(() => events.length, { timeout: 5000 }).toBeGreaterThan(1);
    expect(events[1].items).toEqual([]);
    expect(events[1].context.snapshot?.window).toBe(1_000_000);
    svc.stop();
  });

  it('строка, дописанная по частям, собирается целиком', async () => {
    const path = join(dir, 'parts.jsonl');
    writeFileSync(path, '');
    const svc = new TranscriptService(conn);
    const { events } = collect(svc);
    await svc.follow(path);
    const line = user('p-1', 'кусками');
    appendFileSync(path, line.slice(0, 20));
    await sleep(700);
    appendFileSync(path, line.slice(20));
    await expect.poll(() => events.flatMap((e) => e.items).some((i) => i.kind === 'user' && i.text === 'кусками'), { timeout: 5000 }).toBe(true);
    svc.stop();
  });

  it('readTail отбрасывает обрезанную первую строку', async () => {
    const path = join(dir, 'big.jsonl');
    const lines = Array.from({ length: 30_000 }, (_, i) => user(`u${i}`, `сообщение номер ${i} ${'x'.repeat(60)}`)).join('');
    writeFileSync(path, lines);
    const t = await readTail(conn, path, 1_572_864);
    expect(t.size).toBe(Buffer.byteLength(lines));
    expect(t.start).toBeGreaterThan(0);
    for (const l of t.lines) expect(() => JSON.parse(l)).not.toThrow();
    // start указывает ровно на начало первой целой строки
    expect(readFileSync(path).subarray(t.start, t.start + 9).toString()).toBe('{"type":"');
  });

  it('loadEarlier даёт prepend: true и доходит до начала', async () => {
    const path = join(dir, 'early.jsonl');
    writeFileSync(path, Array.from({ length: 4000 }, (_, i) => user(`e${i}`, `n${i} ${'y'.repeat(400)}`)).join(''));
    const svc = new TranscriptService(conn, { tailBytes: 600_000 });
    const { events } = collect(svc);
    await svc.follow(path);
    expect(events[0].hasEarlier).toBe(true);
    let guard = 0;
    while (events[events.length - 1].hasEarlier && guard++ < 10) expect((await svc.loadEarlier()).ok).toBe(true);
    const earlier = events.filter((e) => e.prepend);
    expect(earlier.length).toBeGreaterThan(0);
    const all = new Set(events.flatMap((e) => e.items.map((i) => i.id)));
    expect(all.size).toBe(4000);
    svc.stop();
  });

  it('последняя строка длиннее окна (картинка base64) — сообщение всё равно показано', async () => {
    const path = join(dir, 'huge-last.jsonl');
    const huge = JSON.stringify({ type: 'user', uuid: 'img', message: { role: 'user', content: [
      { type: 'text', text: 'вот картинка' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'A'.repeat(2_000_000) } },
    ] } });
    writeFileSync(path, `${user('u0', 'до картинки')}${huge}\n`);
    const svc = new TranscriptService(conn);
    const { events } = collect(svc);
    await svc.follow(path);
    expect(events[0].items.map((i) => (i.kind === 'user' ? i.text : ''))).toEqual(['до картинки', 'вот картинка']);
    svc.stop();
  });

  it('гигантская строка в ранней части не блокирует «Показать раньше»', async () => {
    const path = join(dir, 'huge-early.jsonl');
    const huge = user('big', 'B'.repeat(800_000));
    writeFileSync(path, `${user('first', 'самое первое')}${huge}${Array.from({ length: 50 }, (_, i) => user(`t${i}`, `хвост ${i}`)).join('')}`);
    const svc = new TranscriptService(conn, { tailBytes: 300_000 });
    const { events } = collect(svc);
    await svc.follow(path);
    let guard = 0;
    while (events[events.length - 1].hasEarlier && guard++ < 10) await svc.loadEarlier();
    expect(events[events.length - 1].hasEarlier).toBe(false);
    const texts = events.flatMap((e) => e.items).map((i) => (i.kind === 'user' ? i.text : ''));
    expect(texts).toContain('самое первое');
    svc.stop();
  });

  it('файла ещё нет (новая сессия) — пустая лента, затем записи по мере появления', async () => {
    const path = join(dir, 'later.jsonl');
    const svc = new TranscriptService(conn);
    const { events, unavailable } = collect(svc);
    await svc.follow(path);
    expect(unavailable).toEqual([]);
    expect(events[0]).toMatchObject({ reset: true, items: [], hasEarlier: false });
    await sleep(500);
    writeFileSync(path, user('first', 'первое сообщение'));
    await expect.poll(() => events.flatMap((e) => e.items).some((i) => i.kind === 'user' && i.text === 'первое сообщение'), { timeout: 8000 }).toBe(true);
    svc.stop();
  });

  it('20 битых строк подряд → unavailable', async () => {
    const path = join(dir, 'bad.jsonl');
    writeFileSync(path, '{bad\n'.repeat(25));
    const svc = new TranscriptService(conn);
    const { unavailable } = collect(svc);
    await svc.follow(path);
    expect(unavailable).toEqual(['Не удалось прочитать переписку']);
    svc.stop();
  });

  it('после stop на ВМ не остаётся tail', async () => {
    const path = join(dir, 'stop.jsonl');
    writeFileSync(path, FIXTURE);
    const svc = new TranscriptService(conn);
    await svc.follow(path);
    await sleep(300);
    expect(execSync(`pgrep -fc -- "[t]ail -c .*${path}" || true`).toString().trim()).not.toBe('0');
    svc.stop();
    await expect.poll(() => execSync(`pgrep -fc -- "[t]ail -c .*${path}" || true`).toString().trim(), { timeout: 5000 }).toBe('0');
  });
});
