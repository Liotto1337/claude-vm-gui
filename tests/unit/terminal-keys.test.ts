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
