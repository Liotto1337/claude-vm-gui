import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { Server, utils } from 'ssh2';
import { SshConnection } from '../../src/main/ssh';
import { tempKnownHosts, testConfig } from './helpers';

// Тестовый SSH-сервер прямо в тесте: системный sshd и учётные записи не трогаем
const PASSWORD = 'p@ss';
type Method = 'password' | 'keyboard-interactive' | 'publickey';

function startServer(allow: Method[]): Promise<{ port: number; close: () => void }> {
  const hostKey = utils.generateKeyPairSync('ed25519');
  const server = new Server({ hostKeys: [hostKey.private] }, (client) => {
    client.on('error', () => {});
    client.on('authentication', (ctx) => {
      if (ctx.method === 'password' && allow.includes('password')) return ctx.password === PASSWORD ? ctx.accept() : ctx.reject(allow);
      if (ctx.method === 'keyboard-interactive' && allow.includes('keyboard-interactive')) {
        ctx.prompt([{ prompt: 'Password: ', echo: false }], (answers) => (answers[0] === PASSWORD ? ctx.accept() : ctx.reject(allow)));
        return;
      }
      ctx.reject(allow);
    });
    client.on('ready', () => {});
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ port: (server.address() as AddressInfo).port, close: () => server.close() })),
  );
}

describe('вход по паролю', () => {
  const opened: { conn?: SshConnection; close: () => void }[] = [];
  afterEach(() => {
    for (const o of opened.splice(0)) {
      o.conn?.close();
      o.close();
    }
  });

  const connect = async (allow: Method[], password: string | undefined, keyPath = '/nonexistent/key') => {
    const srv = await startServer(allow);
    const conn = new SshConnection(testConfig({ port: srv.port, keyPath }), {
      knownHostsPath: tempKnownHosts(),
      askHostKey: async () => true,
      password,
    });
    opened.push({ conn, close: srv.close });
    return conn.connect();
  };

  it('вход по паролю', async () => expect(await connect(['password'], PASSWORD)).toEqual({ ok: true, data: undefined }));

  it('вход через keyboard-interactive', async () =>
    expect(await connect(['keyboard-interactive'], PASSWORD)).toEqual({ ok: true, data: undefined }));

  it('неверный пароль — AUTH_FAILED «ни ключ, ни пароль»', async () =>
    expect(await connect(['password', 'publickey'], 'wrong')).toMatchObject({
      ok: false, error: { code: 'AUTH_FAILED', message: expect.stringContaining('ни ключ, ни пароль') },
    }));

  it('пароль выключен на сервере', async () =>
    expect(await connect(['publickey'], PASSWORD)).toMatchObject({
      ok: false, error: { code: 'AUTH_FAILED', message: expect.stringContaining('выключен вход по паролю') },
    }));

  it('нечитаемый ключ при пароле — не ошибка', async () =>
    expect(await connect(['password'], PASSWORD, '/nonexistent/key')).toEqual({ ok: true, data: undefined }));

  it('пароль не попадает в сообщение об ошибке', async () => {
    const r = await connect(['password'], 'секретный-пароль');
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain('секретный-пароль');
  });

  it('без пароля и без ключа — прежняя ошибка про ключ', async () =>
    expect(await connect(['password'], undefined)).toMatchObject({ ok: false, error: { code: 'AUTH_FAILED' } }));
});
