import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import type { SshConnection } from '../../src/main/ssh';
import { TerminalService } from '../../src/main/terminal';
import type { TmuxService } from '../../src/main/tmux';

// Клавиши карточки меню: каждая сначала проверяет, что в панели claude (exec), потом пишется.
// Проверки идут параллельно и завершаются в разном порядке — запись должна идти в порядке нажатия.
function fakeConn(delays: number[]) {
  const writes: string[] = [];
  const stream = Object.assign(new EventEmitter(), {
    stderr: new EventEmitter(),
    write: (d: string) => void writes.push(d),
    setWindow: () => {},
    close: () => {},
  });
  let n = 0;
  const conn = Object.assign(new EventEmitter(), {
    connected: true,
    openPty: async () => stream,
    exec: async () => {
      await new Promise((r) => setTimeout(r, delays[n++ % delays.length]));
      return { code: 0, stdout: 'claude\t1\n__cvg_sep__\nclaude\n__cvg_sep__\n', stderr: '' };
    },
  });
  return { conn: conn as unknown as SshConnection, writes };
}

describe('TerminalService.key', () => {
  it('клавиши пишутся в порядке нажатия, даже если проверки завершились наоборот', async () => {
    const { conn, writes } = fakeConn([120, 5]);
    const term = new TerminalService(conn, {} as TmuxService);
    expect((await term.open('s', 80, 24)).ok).toBe(true);
    const [a, b] = await Promise.all([term.key('down'), term.key('enter')]);
    expect(a.ok && b.ok).toBe(true);
    expect(writes).toEqual(['\x1b[B', '\r']);
  });
});

describe('TerminalService.typeText', () => {
  it('свой ответ: текст буквально, управляющие символы вырезаны, без Enter, после клавиш очереди', async () => {
    const { conn, writes } = fakeConn([60, 5]);
    const term = new TerminalService(conn, {} as TmuxService);
    expect((await term.open('s', 80, 24)).ok).toBe(true);
    const [a, b] = await Promise.all([term.key('down'), term.typeText('мой\x1b[B ответ\r')]);
    expect(a.ok && b.ok).toBe(true);
    expect(writes).toEqual(['\x1b[B', 'мой [B ответ ']);
  });
});

describe('TerminalService.open', () => {
  it('устаревший open (ответ пришёл после более нового) не делает свою сессию текущей', async () => {
    const stream = () => Object.assign(new EventEmitter(), { stderr: new EventEmitter(), write: () => {}, setWindow: () => {}, close: () => {} });
    const waits = [80, 5];
    let n = 0;
    const conn = Object.assign(new EventEmitter(), {
      connected: true,
      openPty: async () => {
        await new Promise((r) => setTimeout(r, waits[n++]));
        return stream();
      },
    });
    const term = new TerminalService(conn as unknown as SshConnection, {} as TmuxService);
    const [old, cur] = await Promise.all([term.open('old', 80, 24), term.open('cur', 80, 24)]);
    expect(old.ok && cur.ok).toBe(true);
    expect(term.current).toBe('cur');
  });
});

describe('TerminalService: ввод сессии A не уходит в B после быстрого переключения', () => {
  // Каждый open — свой канал; проверка «пишется ли» (exec) занимает время, за которое пользователь выбирает другую сессию
  function twoSessions() {
    const writes: string[] = [];
    let opened = 0;
    const conn = Object.assign(new EventEmitter(), {
      connected: true,
      openPty: async (cmd: string) => {
        const name = /=([\w-]+)/.exec(cmd)?.[1] ?? `#${++opened}`;
        return Object.assign(new EventEmitter(), {
          stderr: new EventEmitter(),
          write: (d: string) => void writes.push(`${name}:${d}`),
          setWindow: () => {},
          close: () => {},
        });
      },
      exec: async () => {
        await new Promise((r) => setTimeout(r, 40));
        return { code: 0, stdout: 'claude\t1\n__cvg_sep__\nclaude\n__cvg_sep__\n', stderr: '' };
      },
    });
    const term = new TerminalService(conn as unknown as SshConnection, {} as TmuxService);
    return { term, writes };
  }

  it('клавиши карточки меню сессии a после open(b) — NO_SESSION, в b ничего', async () => {
    const { term, writes } = twoSessions();
    expect((await term.open('a', 80, 24)).ok).toBe(true);
    const keys = Promise.all([term.key('down', 'a'), term.key('enter', 'a')]);
    setTimeout(() => void term.open('b', 80, 24), 10);
    const [k1, k2] = await keys;
    expect(writes.filter((w) => w.startsWith('b:'))).toEqual([]);
    expect([k1.ok, k2.ok]).toEqual([false, false]);
  });

  it('свой ответ сессии a после open(b) — в b не печатается', async () => {
    const { term, writes } = twoSessions();
    await term.open('a', 80, 24);
    const typed = term.typeText('да', 'a');
    setTimeout(() => void term.open('b', 80, 24), 10);
    expect((await typed).ok).toBe(false);
    expect(writes.filter((w) => w.startsWith('b:'))).toEqual([]);
  });

  it('отправка из сессии a, пока выбирают b — NO_SESSION, ни вставки, ни Enter в b', async () => {
    const { term, writes } = twoSessions();
    await term.open('a', 80, 24);
    const sent = term.send('rm -rf build', [], 'a');
    setTimeout(() => void term.open('b', 80, 24), 10);
    expect(await sent).toMatchObject({ ok: false, error: { code: 'NO_SESSION' } });
    expect(writes.filter((w) => w.startsWith('b:'))).toEqual([]);
  });

  it('клавиша для только что выбранной сессии b ждёт её подключения и уходит в b', async () => {
    const { term, writes } = twoSessions();
    await term.open('a', 80, 24);
    const opening = term.open('b', 80, 24);
    const k = await term.key('down', 'b');
    await opening;
    expect(k.ok).toBe(true);
    expect(writes).toEqual(['b:\x1b[B']);
  });
});
