import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SshConnection } from '../../src/main/ssh';
import { oauthTokenCommand, parseUsage, usageCommand } from '../../src/shared/usage';
import { hasTestKey, tempKnownHosts, testConfig } from './helpers';

describe.skipIf(!hasTestKey)('расход Claude: команда на ВМ', () => {
  let conn: SshConnection;
  const dir = mkdtempSync(join(tmpdir(), 'cvg-usage-'));
  const rec = (id: string, ts: string, u: Record<string, number>) =>
    JSON.stringify({ type: 'assistant', timestamp: ts, message: { id, role: 'assistant', usage: u, content: [] } });

  beforeAll(async () => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 30).toISOString();
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12).toISOString();
    mkdirSync(join(dir, 'projects/p'), { recursive: true });
    writeFileSync(
      join(dir, 'projects/p/s.jsonl'),
      [
        // Один ответ — две записи (по блоку), у поздней вырос output: считается один раз, с большим output
        rec('msg_a', today, { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000 }),
        rec('msg_a', today, { input_tokens: 10, output_tokens: 25, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000 }),
        rec('msg_b', today, { input_tokens: 1, output_tokens: 2, cache_creation_input_tokens: 3, cache_read_input_tokens: 4 }),
        // Вчерашний ответ в сегодняшнем файле — не считается
        rec('msg_old', yesterday, { input_tokens: 999, output_tokens: 999, cache_creation_input_tokens: 999, cache_read_input_tokens: 999 }),
        JSON.stringify({ type: 'user', timestamp: today, message: { role: 'user', content: 'без usage' } }),
      ].join('\n') + '\n',
    );
    // Журнал вчерашней сессии (файл не менялся сегодня) — не читается вовсе
    writeFileSync(join(dir, 'projects/p/old.jsonl'), `${rec('msg_x', today, { input_tokens: 7, output_tokens: 7, cache_creation_input_tokens: 7, cache_read_input_tokens: 7 })}\n`);
    const y = new Date(Date.now() - 2 * 86400_000);
    utimesSync(join(dir, 'projects/p/old.jsonl'), y, y);
    conn = new SshConnection(testConfig(), { knownHostsPath: tempKnownHosts(), askHostKey: async () => true });
    expect((await conn.connect()).ok).toBe(true);
  });
  afterAll(() => {
    conn.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('токены за сегодня — по ответам без повторов; без .credentials.json лимитов нет', async () => {
    const r = await conn.exec(usageCommand(dir), { timeoutMs: 20_000 });
    const s = parseUsage(r.stdout, 1);
    expect(s.tokens).toEqual({ input: 11, output: 27, cacheWrite: 103, cacheRead: 1004 });
    expect(s.limits).toBeNull();
  });

  it('токен подписки — только из claudeAiOauth, не токен MCP-сервера; файл в одну строку и с переносами', async () => {
    const one = JSON.stringify({
      claudeAiOauth: { accessToken: 'sk-ant-oat01-MAIN', refreshToken: 'r', scopes: ['user:inference', 'user:profile'], subscriptionType: 'pro' },
      mcpOAuth: { 'linear|ab': { serverName: 'linear', accessToken: 'LINEAR-TOKEN' } },
    });
    writeFileSync(join(dir, '.credentials.json'), one);
    expect((await conn.exec(`${oauthTokenCommand(dir)}; printf %s "$t"`)).stdout).toBe('sk-ant-oat01-MAIN');
    writeFileSync(join(dir, '.credentials.json'), JSON.stringify(JSON.parse(one), null, 2));
    expect((await conn.exec(`${oauthTokenCommand(dir)}; printf %s "$t"`)).stdout).toBe('sk-ant-oat01-MAIN');
    writeFileSync(join(dir, '.credentials.json'), JSON.stringify({ mcpOAuth: { x: { accessToken: 'ONLY-MCP' } } }));
    expect((await conn.exec(`${oauthTokenCommand(dir)}; printf %s "$t"`)).stdout).toBe('');
    rmSync(join(dir, '.credentials.json'));
  });
});
