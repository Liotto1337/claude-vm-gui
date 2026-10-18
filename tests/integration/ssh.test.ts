import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { utils } from 'ssh2';
import { afterEach, describe, expect, it } from 'vitest';
import type { ConnectionState, HostKeyPrompt, PreflightEvent } from '../../src/shared/ipc';
import { SshConnection } from '../../src/main/ssh';
import { hasTestKey, tempKnownHosts, testConfig } from './helpers';

const open: SshConnection[] = [];
afterEach(() => {
  for (const c of open.splice(0)) c.close();
});

function make(knownHostsPath: string, answer = true, cfg = testConfig()) {
  const prompts: HostKeyPrompt[] = [];
  const preflight: PreflightEvent[] = [];
  const conn = new SshConnection(cfg, {
    knownHostsPath,
    askHostKey: async (p) => {
      prompts.push(p);
      return answer;
    },
    onPreflight: (e) => preflight.push(e),
  });
  open.push(conn);
  return { conn, prompts, preflight };
}

describe.skipIf(!hasTestKey)('SshConnection', () => {
  it('неизвестный ключ хоста: спрашивает, запоминает, выполняет команды', async () => {
    const kh = tempKnownHosts();
    const { conn, prompts, preflight } = make(kh);
    expect(await conn.connect()).toEqual({ ok: true, data: undefined });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchObject({ host: '127.0.0.1', port: 22, kind: 'unknown' });
    expect(prompts[0].fingerprint).toMatch(/^SHA256:/);
    expect(readFileSync(kh, 'utf8')).toMatch(/^127\.0\.0\.1 ssh-/);
    expect(preflight.map((e) => `${e.step}:${e.status}`)).toContain('ssh:ok');
    expect(await conn.exec('echo hi')).toEqual({ code: 0, stdout: 'hi\n', stderr: '' });
    expect(await conn.exec('cat', { stdin: 'из stdin' })).toMatchObject({ stdout: 'из stdin' });
    expect((await conn.exec('exit 3')).code).toBe(3);

    // Второе подключение с тем же known_hosts — без вопроса
    const second = make(kh);
    expect((await second.conn.connect()).ok).toBe(true);
    expect(second.prompts).toHaveLength(0);
  });

  it('человек долго сверяет отпечаток (>15 с) — подключение не обрывается', async () => {
    const kh = tempKnownHosts();
    const conn = new SshConnection(testConfig(), {
      knownHostsPath: kh,
      askHostKey: () => new Promise((r) => setTimeout(() => r(true), 17_000)),
    });
    open.push(conn);
    expect(await conn.connect()).toEqual({ ok: true, data: undefined });
    expect(readFileSync(kh, 'utf8')).toMatch(/^127\.0\.0\.1 ssh-/);
  }, 40_000);

  it('known_hosts не записать — подключается без зависания', async () => {
    const { conn, prompts } = make('/dev/null/known_hosts');
    const t = Date.now();
    expect((await conn.connect()).ok).toBe(true);
    expect(prompts).toHaveLength(1);
    expect(Date.now() - t).toBeLessThan(10_000);
  });

  it('в known_hosts только ключ RSA — сервер не может подсунуть другой тип', async () => {
    const kh = tempKnownHosts();
    writeFileSync(kh, readFileSync('tests/fixtures/kh_rsa'));
    const { conn, prompts } = make(kh);
    expect((await conn.connect()).ok).toBe(true);
    expect(prompts).toHaveLength(0);
  });

  it('отказ доверять ключу — HOSTKEY_REJECTED', async () => {
    const { conn } = make(tempKnownHosts(), false);
    const r = await conn.connect();
    expect(r.ok === false && r.error.code).toBe('HOSTKEY_REJECTED');
  });

  it('подменённый ключ хоста — HOSTKEY_MISMATCH без вопроса', async () => {
    const kh = tempKnownHosts();
    const fake = utils.generateKeyPairSync('ed25519').public.split(' ').slice(0, 2).join(' ');
    writeFileSync(kh, `127.0.0.1 ${fake}\n`);
    const { conn, prompts } = make(kh);
    const r = await conn.connect();
    expect(r.ok === false && r.error.code).toBe('HOSTKEY_MISMATCH');
    expect(r.ok === false && r.error.message).toMatch(/SHA256:/);
    expect(prompts).toHaveLength(0);
  });

  it('чужой ключ пользователя — AUTH_FAILED', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cvg-key-'));
    writeFileSync(join(dir, 'k'), utils.generateKeyPairSync('ed25519').private);
    const { conn } = make(tempKnownHosts(), true, testConfig({ keyPath: join(dir, 'k') }));
    const prev = process.env.SSH_AUTH_SOCK;
    delete process.env.SSH_AUTH_SOCK;
    const r = await conn.connect();
    if (prev) process.env.SSH_AUTH_SOCK = prev;
    expect(r.ok === false && r.error.code).toBe('AUTH_FAILED');
  });

  it('закрытый порт — TCP_UNREACHABLE', async () => {
    const { conn } = make(tempKnownHosts(), true, testConfig({ port: 1 }));
    const r = await conn.connect();
    expect(r.ok === false && r.error.code).toBe('TCP_UNREACHABLE');
  });

  it('обрыв соединения — переподключается сам', async () => {
    const { conn } = make(tempKnownHosts());
    expect((await conn.connect()).ok).toBe(true);
    const states: ConnectionState[] = [];
    conn.on('state', (s: ConnectionState) => states.push(s));
    const back = new Promise<void>((res) => conn.once('reconnected', () => res()));
    (conn as unknown as { client: { end(): void } }).client.end();
    await back;
    expect(states[0]).toMatchObject({ state: 'reconnecting', attempt: 1 });
    expect(states.at(-1)).toMatchObject({ state: 'connected' });
    expect((await conn.exec('echo again')).stdout).toBe('again\n');
  });

  it('close() не переподключается', async () => {
    const { conn } = make(tempKnownHosts());
    expect((await conn.connect()).ok).toBe(true);
    const states: ConnectionState[] = [];
    conn.on('state', (s: ConnectionState) => states.push(s));
    conn.close();
    await new Promise((r) => setTimeout(r, 1500));
    expect(states.map((s) => s.state)).toEqual(['idle']);
  });
});
