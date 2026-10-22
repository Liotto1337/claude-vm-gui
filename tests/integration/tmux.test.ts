import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SshConnection } from '../../src/main/ssh';
import { TerminalService } from '../../src/main/terminal';
import { TmuxService } from '../../src/main/tmux';
import type { ExitReason } from '../../src/shared/ipc';
import { hasTestKey, tempKnownHosts, testConfig, testSessionName } from './helpers';

// Процесс cat в тестовых сессиях считается claude (как CVG_FAKE_CLAUDE в E2E)
process.env.CVG_FAKE_CLAUDE = '1';

const ODD_DIR = join(homedir(), "cvg test 'q'");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Второе «устройство»: tmux attach в своём PTY 80×30 (как телефон рядом с окном Windows)
const OTHER_CLIENT = `
import os, pty, fcntl, termios, struct, sys, select
pid, fd = pty.fork()
if pid == 0:
    os.environ['TERM'] = 'xterm-256color'
    os.execvp('tmux', ['tmux', 'attach', '-t', '=' + sys.argv[1]])
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 30, 80, 0, 0))
while True:
    r, _, _ = select.select([fd], [], [], 1)
    if r:
        try: os.read(fd, 65536)
        except OSError: break
`;

describe.skipIf(!hasTestKey)('tmux и терминал', () => {
  let conn: SshConnection;
  let tmux: TmuxService;
  const created: string[] = [];
  let userSessionsBefore: string[] = [];

  const capture = async (name: string) => (await conn.exec(`tmux capture-pane -p -t '=${name}:'`)).stdout;
  const waitFor = async (fn: () => Promise<boolean>, ms = 5000) => {
    for (const t = Date.now(); Date.now() - t < ms; await sleep(100)) if (await fn()) return true;
    return false;
  };
  const newSession = async (tag: string, dir = '~') => {
    const name = testSessionName(tag);
    created.push(name);
    expect(await tmux.create(name, dir, false)).toEqual({ ok: true, data: undefined });
    return name;
  };

  beforeAll(async () => {
    mkdirSync(ODD_DIR, { recursive: true });
    conn = new SshConnection(testConfig(), { knownHostsPath: tempKnownHosts(), askHostKey: async () => true });
    expect((await conn.connect()).ok).toBe(true);
    tmux = new TmuxService(conn);
    const r = await tmux.list();
    userSessionsBefore = r.ok ? r.data.map((s) => s.name).filter((n) => !n.startsWith('cvg-test-')) : [];
  });

  afterEach(async () => {
    for (const n of created.splice(0)) await conn.exec(`tmux kill-session -t '=${n}' 2>/dev/null`);
  });

  afterAll(async () => {
    const r = await tmux.list();
    // Сессии пользователя на месте, тестовых не осталось
    expect(r.ok && r.data.map((s) => s.name).filter((n) => !n.startsWith('cvg-test-'))).toEqual(userSessionsBefore);
    expect(r.ok && r.data.filter((s) => s.name.startsWith('cvg-test-'))).toEqual([]);
    conn.close();
    rmSync(ODD_DIR, { recursive: true, force: true });
  });

  it('создаёт сессию в папке с пробелом и кавычкой', async () => {
    const name = await newSession('dir', "~/cvg test 'q'");
    const r = await tmux.list();
    expect(r.ok && r.data.find((s) => s.name === name)).toMatchObject({ cwd: ODD_DIR, claudeRunning: false });
  });

  it('повтор имени — SESSION_EXISTS, плохое имя — BAD_NAME, нет папки — BAD_DIR', async () => {
    const name = await newSession('dup');
    expect(await tmux.create(name, '~', false)).toMatchObject({ ok: false, error: { code: 'SESSION_EXISTS' } });
    expect(await tmux.create('bad;name', '~', false)).toMatchObject({ ok: false, error: { code: 'BAD_NAME' } });
    expect(await tmux.create(testSessionName('nodir'), '~/нет-такой-папки-cvg', false)).toMatchObject({
      ok: false, error: { code: 'BAD_DIR' },
    });
  });

  it('kill по точному имени не задевает сессию с похожим именем', async () => {
    const name = await newSession('exact');
    const longer = `${name}-x`;
    created.push(longer);
    expect((await tmux.create(longer, '~', false)).ok).toBe(true);
    expect(await tmux.kill(name)).toEqual({ ok: true, data: undefined });
    const r = await tmux.list();
    const names = r.ok ? r.data.map((s) => s.name) : [];
    expect(names).not.toContain(name);
    expect(names).toContain(longer);
    expect(await tmux.kill(name)).toMatchObject({ ok: false, error: { code: 'NO_SESSION' } });
  });

  it('терминал: ввод, вывод, отправка сообщений и команд', async () => {
    const name = await newSession('term');
    const term = new TerminalService(conn, tmux);
    let out = '';
    term.on('data', (d: string) => (out += d));
    expect(await term.open(name, 100, 30)).toEqual({ ok: true, data: undefined });
    term.write('echo cvg-$((40+2))\r');
    expect(await waitFor(async () => out.includes('cvg-42'))).toBe(true);

    term.write('cat\r');
    await sleep(300);
    expect((await term.send('строка 1\nстрока 2', ['/tmp/x.png'])).ok).toBe(true);
    expect(await term.setModel('sonnet')).toEqual({ ok: true, data: undefined });
    expect(await term.setEffort('low')).toEqual({ ok: true, data: undefined });
    expect(await term.setEffort('x; rm')).toMatchObject({ ok: false });
    expect(
      await waitFor(async () => {
        const pane = await capture(name);
        return ['строка 1', 'строка 2 /tmp/x.png', '/model sonnet', '/effort low'].every((s) => pane.includes(s));
      }),
    ).toBe(true);
    term.close();
  });

  it('activate: окно tmux принимает размер этого клиента, а не другого устройства', async () => {
    const name = await newSession('act');
    const term = new TerminalService(conn, tmux);
    expect((await term.open(name, 200, 50)).ok).toBe(true);
    const width = async () => (await conn.exec(`tmux list-windows -t '=${name}' -F '#{window_width}'`)).stdout.trim();
    expect(await waitFor(async () => (await width()) === '200')).toBe(true);
    const other = spawn('python3', ['-I', '-c', OTHER_CLIENT, name], { stdio: 'ignore' });
    try {
      expect(await waitFor(async () => (await width()) === '80')).toBe(true);
      const write = vi.spyOn((term as unknown as { stream: { write(d: string): void } }).stream, 'write');
      term.activate();
      term.activate();
      expect(write.mock.calls).toEqual([['\x1b[I']]);
      expect(await waitFor(async () => (await width()) === '200', 2000)).toBe(true);
    } finally {
      other.kill();
      term.close();
    }
  });

  it('внешний kill-session открытой сессии — exit("killed")', async () => {
    const name = await newSession('killed');
    const term = new TerminalService(conn, tmux);
    const exits: ExitReason[] = [];
    term.on('exit', (r: ExitReason) => exits.push(r));
    expect((await term.open(name, 80, 24)).ok).toBe(true);
    await conn.exec(`tmux kill-session -t '=${name}'`);
    expect(await waitFor(async () => exits.length > 0)).toBe(true);
    expect(exits).toEqual(['killed']);
    expect((await term.send('x', [])).ok).toBe(false);
  });

  it('открыто меню Claude Code — отправка и /model блокируются, в терминал ничего не уходит', async () => {
    const name = testSessionName('prompt');
    created.push(name);
    await conn.exec(
      `tmux new-session -d -s ${name} "printf '\\n Do you want to proceed?\\n ❯ 1. Yes\\n   2. No\\n\\n Esc to cancel\\n'; cat"`,
    );
    const term = new TerminalService(conn, tmux);
    expect((await term.open(name, 100, 30)).ok).toBe(true);
    await sleep(300);
    expect(await term.send('опасный текст', [])).toMatchObject({ ok: false, error: { code: 'PROMPT_OPEN' } });
    expect(await term.setModel('sonnet')).toMatchObject({ ok: false, error: { code: 'PROMPT_OPEN' } });
    expect(await term.setEffort('low')).toMatchObject({ ok: false, error: { code: 'PROMPT_OPEN' } });
    await sleep(300);
    const pane = await capture(name);
    expect(pane).not.toContain('опасный текст');
    expect(pane).not.toContain('/model');
    term.close();
  });

  it('в сессии bash, а не claude — текст не уходит в shell (NO_CLAUDE)', async () => {
    const name = await newSession('bash');
    const term = new TerminalService(conn, tmux);
    expect((await term.open(name, 100, 30)).ok).toBe(true);
    await sleep(300);
    expect(await term.send('echo PWNED-$((40+2))', [])).toMatchObject({ ok: false, error: { code: 'NO_CLAUDE' } });
    expect(await term.setModel('sonnet')).toMatchObject({ ok: false, error: { code: 'NO_CLAUDE' } });
    await sleep(500);
    const pane = await capture(name);
    expect(pane).not.toContain('PWNED');
    expect(pane).not.toContain('/model');
    term.close();
  });

  it('два быстрых open подряд — остаётся один канал, к последней сессии', async () => {
    const a = await newSession('race-a');
    const b = await newSession('race-b');
    const term = new TerminalService(conn, tmux);
    const [ra, rb] = await Promise.all([term.open(a, 80, 24), term.open(b, 80, 24)]);
    expect(ra.ok && rb.ok).toBe(true);
    await sleep(700);
    const r = await tmux.list();
    const attached = (n: string) => (r.ok ? r.data.find((s) => s.name === n)?.attachedClients : -1);
    expect(attached(a)).toBe(0);
    expect(attached(b)).toBe(1);
    expect(term.current).toBe(b);
    term.close();
  });

  it('после обрыва SSH терминал сам возвращается в ту же сессию', async () => {
    const name = await newSession('reattach');
    const own = new SshConnection(testConfig(), { knownHostsPath: tempKnownHosts(), askHostKey: async () => true });
    expect((await own.connect()).ok).toBe(true);
    const term = new TerminalService(own, new TmuxService(own));
    const exits: ExitReason[] = [];
    term.on('exit', (r: ExitReason) => exits.push(r));
    expect((await term.open(name, 80, 24)).ok).toBe(true);
    const back = new Promise<void>((res) => own.once('reconnected', () => res()));
    (own as unknown as { client: { end(): void } }).client.end();
    await back;
    expect(await waitFor(async () => {
      term.write('echo re-$((1+1))\r');
      await sleep(300);
      return (await capture(name)).includes('re-2');
    })).toBe(true);
    expect(exits).toEqual(['connection-lost']);
    term.close();
    own.close();
  });

  it('startClaude набирает claude в сессии', async () => {
    const name = await newSession('start');
    // Подменяем claude функцией оболочки, чтобы не запускать настоящий
    await conn.exec(`tmux send-keys -t '=${name}:' 'claude() { echo fake-claude-started; }' Enter`);
    expect(await tmux.startClaude(name)).toEqual({ ok: true, data: undefined });
    expect(await waitFor(async () => (await capture(name)).includes('fake-claude-started'))).toBe(true);
  });

  it('опрос списка сообщает об изменениях', async () => {
    const seen: string[][] = [];
    const stop = tmux.startPolling((s) => seen.push(s.map((x) => x.name)), 300);
    await sleep(500);
    const name = await newSession('poll');
    expect(await waitFor(async () => seen.some((names) => names.includes(name)))).toBe(true);
    stop();
  });
});
