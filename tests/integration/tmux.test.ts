import { mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SshConnection } from '../../src/main/ssh';
import { TerminalService } from '../../src/main/terminal';
import { TmuxService } from '../../src/main/tmux';
import type { ExitReason } from '../../src/shared/ipc';
import { hasTestKey, tempKnownHosts, testConfig, testSessionName } from './helpers';

const ODD_DIR = join(homedir(), "cvg test 'q'");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
