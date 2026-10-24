import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { hasTestKey, launchApp, TEST_KEY, trustedKnownHosts, withConfig } from './helpers';

test.skip(!hasTestKey, 'нет тестового ключа');

test('расход Claude внизу сайдбара: токены за сегодня из журналов, лимиты 5 ч и недели', async () => {
  const claudeDir = mkdtempSync(join(tmpdir(), 'cvg-cd-usage-'));
  mkdirSync(join(claudeDir, 'projects/p'), { recursive: true });
  const rec = (id: string, out: number) =>
    JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(), message: { id, usage: { input_tokens: 1000, output_tokens: out, cache_creation_input_tokens: 0, cache_read_input_tokens: 10_000 } } });
  writeFileSync(join(claudeDir, 'projects/p/s.jsonl'), `${rec('msg_1', 500)}\n${rec('msg_2', 1500)}\n`);
  const userData = withConfig({ host: '127.0.0.1', port: 22, username: 'root', keyPath: TEST_KEY, theme: 'light' });
  const { app, page } = await launchApp({ CVG_USER_DATA: userData, CVG_KNOWN_HOSTS: trustedKnownHosts(), CVG_CLAUDE_DIR: claudeDir, CVG_TEST_HOOKS: '1' });
  try {
    const box = page.getByRole('region', { name: 'Расход Claude' });
    // 2 × (1000 + 10 000) + 500 + 1500 = 24 000
    await expect(box.getByText('Сегодня: 24k токенов')).toBeVisible({ timeout: 30_000 });
    // Без подписки (нет .credentials.json) — только токены
    await expect(box.getByRole('progressbar')).toHaveCount(0);
    const now = Date.now();
    await app.evaluate((_e, u) => (globalThis as unknown as { __cvg: { emitUsage(u: unknown): void } }).__cvg.emitUsage(u), {
      t: now,
      limits: { fiveHour: { pct: 28, resetsAt: new Date(now + 3600_000).toISOString() }, week: { pct: 91, resetsAt: new Date(now + 4 * 86400_000).toISOString() } },
      tokens: { input: 0, output: 0, cacheWrite: 0, cacheRead: 2_100_000 },
      error: null,
    });
    await expect(box.getByRole('progressbar', { name: '5 часов' })).toHaveAttribute('aria-valuenow', '28');
    await expect(box.getByRole('progressbar', { name: 'Неделя' })).toHaveAttribute('aria-valuenow', '91');
    await expect(box.getByRole('progressbar', { name: 'Неделя' })).toHaveClass(/bar-danger/);
    await expect(box).toContainText('28 % · сброс в ');
    await expect(box.getByText('Сегодня: 2.1M токенов')).toBeVisible();
  } finally {
    await app.close();
  }
});
