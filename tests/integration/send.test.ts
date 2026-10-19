import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SshConnection } from '../../src/main/ssh';
import { TerminalService, type SendTimings } from '../../src/main/terminal';
import { TmuxService } from '../../src/main/tmux';
import { hasTestKey, tempKnownHosts, testConfig, testSessionName } from './helpers';

// Фейковый claude теряет Enter, пришедший во время обработки вставки (как настоящий, если Enter склеен с концом вставки)
const FAKE = join(__dirname, '../fixtures/fake-claude.mjs');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const RULE = '─'.repeat(60);
const FIELD_WITH_TEXT = `${RULE}\n❯ застряло\n${RULE}\n`;
const FAST: SendTimings = { pollMs: 10, settleMaxMs: 300, confirmMs: 100, fallbackMs: 10 };

describe.skipIf(!hasTestKey)('отправка одним Enter', () => {
  let conn: SshConnection;
  let tmux: TmuxService;
  const created: string[] = [];

  const screenOf = async (name: string) => (await conn.exec(`tmux capture-pane -p -t '=${name}:'`)).stdout;
  const count = (hay: string, needle: string) => hay.split(needle).length - 1;

  /** Сессия с фейковым claude и открытый терминал. */
  const start = async (tag: string, env = '', opts?: ConstructorParameters<typeof TerminalService>[2]) => {
    const name = testSessionName(tag);
    created.push(name);
    process.env.CVG_CLAUDE_CMD = `${env} node ${FAKE}`.trim();
    expect((await tmux.create(name, '~', true)).ok).toBe(true);
    const term = new TerminalService(conn, tmux, opts);
    expect((await term.open(name, 100, 30)).ok).toBe(true);
    await expect.poll(() => screenOf(name), { timeout: 8000 }).toContain('enter×0');
    return { name, term };
  };

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

  it('вставка картинки уходит одним вызовом', async () => {
    const { name, term } = await start('send-img');
    expect(await term.send('посмотри', ['/tmp/x.png'])).toEqual({ ok: true, data: undefined });
    await expect.poll(() => screenOf(name), { timeout: 3000 }).toContain('› [Image #1]посмотри');
    term.close();
  });

  it('длинный многострочный текст уходит одним вызовом', async () => {
    const { name, term } = await start('send-long');
    const text = Array.from({ length: 40 }, (_, i) => `строка ${i}`).join('\n');
    expect((await term.send(text, [])).ok).toBe(true);
    await expect.poll(() => screenOf(name), { timeout: 3000 }).toContain('› строка 0');
    term.close();
  });

  it('медленное принятие — без повтора', async () => {
    const { name, term } = await start('send-slow', 'CVG_FAKE_SLOW_ACCEPT=1');
    expect((await term.send('медленно', [])).ok).toBe(true);
    await expect.poll(() => screenOf(name), { timeout: 3000 }).toContain('› медленно');
    await sleep(500);
    const s = await screenOf(name);
    expect(count(s, '› медленно')).toBe(1);
    expect(s).toContain('enter×1');
    term.close();
  });

  it('после Enter появилось меню — повтора нет, меню не тронуто', async () => {
    const { name, term } = await start('send-menu');
    expect((await term.send('menu', [])).ok).toBe(true);
    await sleep(300);
    const s = await screenOf(name);
    expect(s).toContain('Enter to confirm');
    expect(s).not.toContain('выбран');
    term.close();
  });

  it('Enter не принят — SEND_NOT_CONFIRMED', async () => {
    const { term } = await start('send-stuck', '', { probe: async () => FIELD_WITH_TEXT, timings: FAST });
    const r = await term.send('что-то', []);
    expect(r).toMatchObject({ ok: false, error: { code: 'SEND_NOT_CONFIRMED' } });
    term.close();
  });

  it('поле не распознано — старый путь с паузой', async () => {
    const { name, term } = await start('send-blind', '', { probe: async () => null });
    expect((await term.send('вслепую', [])).ok).toBe(true);
    await expect.poll(() => screenOf(name), { timeout: 3000 }).toContain('› вслепую');
    expect(await screenOf(name)).toContain('enter×1');
    term.close();
  });
});
