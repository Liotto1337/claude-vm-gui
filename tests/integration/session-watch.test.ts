import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SessionWatcher } from '../../src/main/session-watch';
import { SshConnection } from '../../src/main/ssh';
import { TerminalService } from '../../src/main/terminal';
import { TmuxService } from '../../src/main/tmux';
import type { ScreenState } from '../../src/shared/ipc';
import type { ClaudeSessionInfo } from '../../src/shared/claude-session';
import { hasTestKey, tempKnownHosts, testConfig, testSessionName } from './helpers';

const FAKE = join(__dirname, '../fixtures/fake-claude.mjs');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!hasTestKey)('наблюдение за сессией', () => {
  let conn: SshConnection;
  let tmux: TmuxService;
  const created: string[] = [];
  const claudeDir = mkdtempSync(join(tmpdir(), 'cvg-cd-'));

  beforeAll(async () => {
    conn = new SshConnection(testConfig(), { knownHostsPath: tempKnownHosts(), askHostKey: async () => true });
    expect((await conn.connect()).ok).toBe(true);
    tmux = new TmuxService(conn);
  });
  afterAll(async () => {
    delete process.env.CVG_CLAUDE_CMD;
    for (const n of created) await tmux.kill(n);
    conn.close();
  });

  const watch = async (tag: string, withClaude: boolean) => {
    const name = testSessionName(tag);
    created.push(name);
    process.env.CVG_CLAUDE_CMD = `CVG_CLAUDE_DIR=${claudeDir} node ${FAKE}`;
    expect((await tmux.create(name, '~', withClaude)).ok).toBe(true);
    const w = new SessionWatcher(conn, { claudeDir, intervalMs: 200 });
    const screens: { state: ScreenState; busy: boolean }[] = [];
    const claude: (ClaudeSessionInfo | null)[] = [];
    w.on('screen', (e) => screens.push(e));
    w.on('claude', (c) => claude.push(c));
    w.start(name);
    return { name, w, screens, claude, last: () => screens[screens.length - 1] };
  };

  it('поле ввода → prompt, связка с sessions/<pid>.json', async () => {
    const { w, last, claude } = await watch('sw-prompt', true);
    await expect.poll(() => last()?.state.kind, { timeout: 8000 }).toBe('prompt');
    await expect.poll(() => claude[claude.length - 1]?.sessionId, { timeout: 8000 }).toMatch(/^[0-9a-f-]{36}$/);
    w.stop();
  });

  it('меню и занятость; клавиши уходят в claude', async () => {
    const { name, w, last } = await watch('sw-menu', true);
    await expect.poll(() => last()?.state.kind, { timeout: 8000 }).toBe('prompt');
    const term = new TerminalService(conn, tmux);
    expect((await term.open(name, 100, 30)).ok).toBe(true);
    expect((await term.send('menu', [])).ok).toBe(true);
    await expect.poll(() => last()?.state.kind, { timeout: 5000 }).toBe('menu');
    const menu = last().state as Extract<ScreenState, { kind: 'menu' }>;
    expect(menu.menu.options.map((o) => o.label)).toEqual(['Да', 'Да и не спрашивать', 'Нет']);
    expect((await term.key('down')).ok).toBe(true);
    await expect.poll(() => (last().state as typeof menu).menu?.options[1].selected, { timeout: 3000 }).toBe(true);
    expect((await term.key('enter')).ok).toBe(true);
    await expect.poll(() => last()?.state.kind, { timeout: 3000 }).toBe('prompt');
    expect((await term.send('busy', [])).ok).toBe(true);
    await expect.poll(() => last()?.busy, { timeout: 3000 }).toBe(true);
    await expect.poll(() => last()?.busy, { timeout: 6000 }).toBe(false);
    term.close();
    w.stop();
  });

  it('в сессии bash → no-claude, клавиши не отправляются', async () => {
    const { name, w, last, claude } = await watch('sw-bash', false);
    await expect.poll(() => last()?.state.kind, { timeout: 8000 }).toBe('no-claude');
    await sleep(1200);
    expect(claude.every((c) => c === null)).toBe(true);
    const term = new TerminalService(conn, tmux);
    expect((await term.open(name, 100, 30)).ok).toBe(true);
    expect(await term.key('enter')).toMatchObject({ ok: false, error: { code: 'NO_CLAUDE' } });
    term.close();
    w.stop();
  });

  it('после stop событий нет', async () => {
    const { w, screens } = await watch('sw-stop', true);
    await expect.poll(() => screens.length, { timeout: 8000 }).toBeGreaterThan(0);
    w.stop();
    const n = screens.length;
    await sleep(800);
    expect(screens.length).toBe(n);
  });
});
