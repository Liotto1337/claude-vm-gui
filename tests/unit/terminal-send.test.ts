import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import type { SshConnection } from '../../src/main/ssh';
import { TerminalService } from '../../src/main/terminal';
import type { TmuxService } from '../../src/main/tmux';

// Отправка: вставка → ждём, пока поле устоится → Enter → проверяем, что сообщение принято.
// Поле ввода задаётся функцией от числа нажатых Enter; null — поля нет (открылось меню).
const RULE = '─'.repeat(40);
const toScreen = (field: string | null) =>
  field === null ? 'история\n Хотите продолжить?\n' : `история\n${RULE}\n❯ ${field}\n${RULE}\n  ? for shortcuts\n`;
const FAST = { pollMs: 5, settleMaxMs: 200, confirmMs: 120, fallbackMs: 10 };

function setup(field: (enters: number) => string | null) {
  const writes: string[] = [];
  const stream = Object.assign(new EventEmitter(), {
    stderr: new EventEmitter(),
    write: (d: string) => void writes.push(d),
    setWindow: () => {},
    close: () => {},
  });
  const conn = Object.assign(new EventEmitter(), {
    connected: true,
    openPty: async () => stream,
    exec: async () => ({ code: 0, stdout: `claude\t1\n__cvg_sep__\nclaude\n__cvg_sep__\n${toScreen(field(0))}`, stderr: '' }),
  });
  const enters = () => writes.filter((w) => w === '\r').length;
  const term = new TerminalService(conn as unknown as SshConnection, {} as TmuxService, {
    probe: async () => toScreen(field(enters())),
    timings: FAST,
  });
  return { term, enters };
}

describe('TerminalService.send: принято ли сообщение', () => {
  it('поздняя отрисовка вставки (путь стал [Image #1]) — не «принято», Enter повторяется', async () => {
    const { term, enters } = setup((n) => (n === 0 ? '/u/1.png посмотри' : n === 1 ? '[Image #1] посмотри' : ''));
    expect((await term.open('s', 80, 24)).ok).toBe(true);
    const r = await term.send('посмотри', ['/u/1.png']);
    expect(r.ok).toBe(true);
    expect(enters()).toBe(2);
  });

  it('поле опустело после Enter — принято с первого раза', async () => {
    const { term, enters } = setup((n) => (n === 0 ? 'привет' : ''));
    await term.open('s', 80, 24);
    expect((await term.send('привет', [])).ok).toBe(true);
    expect(enters()).toBe(1);
  });

  it('вставка не дошла (поле пустое) — ошибка, Enter не нажимается', async () => {
    const { term, enters } = setup(() => '');
    await term.open('s', 80, 24);
    const r = await term.send('привет', []);
    expect(r.ok).toBe(false);
    expect(enters()).toBe(0);
  });

  it('после Enter открылось меню (поля нет) — принято', async () => {
    const { term, enters } = setup((n) => (n === 0 ? 'сделай' : null));
    await term.open('s', 80, 24);
    expect((await term.send('сделай', [])).ok).toBe(true);
    expect(enters()).toBe(1);
  });

  it('поле сначала пустое, потом перестало распознаваться (bash-режим «!») — не «вставка потерялась», Enter нажимается', async () => {
    let polls = 0;
    const { term, enters } = setup(() => (polls++ < 2 ? '' : null));
    await term.open('s', 80, 24);
    const r = await term.send('!ls', []);
    expect(r.ok).toBe(true);
    expect(enters()).toBe(1);
  });

  it('медленная вставка: поле пустое дольше ожидания, потом текст появился — Enter нажимается', async () => {
    const t0 = Date.now();
    const { term, enters } = setup((n) => (n > 0 ? '' : Date.now() - t0 > FAST.settleMaxMs + 5 ? 'привет' : ''));
    await term.open('s', 80, 24);
    const r = await term.send('привет', []);
    expect(r.ok).toBe(true);
    expect(enters()).toBe(1);
  });
});

describe('TerminalService.send сразу после выбора сессии', () => {
  it('терминал ещё подключается — отправка ждёт подключения, а не отвечает «Сессия не открыта»', async () => {
    const { term, enters, release } = (() => {
      const s = setup((n) => (n === 0 ? 'привет' : ''));
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const conn = (term0: TerminalService) => (term0 as unknown as { conn: { openPty: () => Promise<unknown> } }).conn;
      const orig = conn(s.term).openPty;
      conn(s.term).openPty = async () => {
        await gate;
        return orig();
      };
      return { ...s, release };
    })();
    const opened = term.open('s', 80, 24);
    const sent = term.send('привет', []);
    setTimeout(release, 30);
    expect((await opened).ok).toBe(true);
    expect(await sent).toEqual({ ok: true, data: undefined });
    expect(enters()).toBe(1);
  });
});
