import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import { hasTestKey, launchApp, TEST_KEY, trustedKnownHosts, withConfig } from './helpers';

// Вместо api.github.com — локальный сервер с ответом releases/latest (CVG_UPDATE_URL, только не в упакованном приложении)
test.skip(!hasTestKey, 'нет тестового ключа');

let server: Server;
let body = '';
let url = '';
test.beforeEach(async () => {
  server = createServer((_req, res) => res.writeHead(200, { 'content-type': 'application/json' }).end(body));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/latest`;
});
test.afterEach(() => new Promise<void>((r) => server.close(() => r())));

const RELEASE = 'https://github.com/Liotto1337/claude-vm-gui/releases/tag/v9.9.9';

async function open(userData: string) {
  const l = await launchApp({ CVG_USER_DATA: userData, CVG_KNOWN_HOSTS: trustedKnownHosts(), CVG_UPDATE_URL: url, CVG_TEST_HOOKS: '1' });
  await expect(l.page.getByRole('navigation', { name: 'Сессии' })).toBeVisible({ timeout: 20_000 });
  return l;
}

test('баннер «Доступно обновление»: ссылка на релиз, крестик скрывает эту версию', async () => {
  body = JSON.stringify({ tag_name: 'v9.9.9', html_url: RELEASE });
  const userData = withConfig({ host: '127.0.0.1', port: 22, username: 'root', keyPath: TEST_KEY, theme: 'light' });
  let l = await open(userData);
  try {
    const banner = l.page.getByRole('status').filter({ hasText: 'Доступно обновление 9.9.9' });
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await banner.getByRole('button', { name: /Доступно обновление/ }).click();
    await expect
      .poll(() => l.app.evaluate(() => (globalThis as unknown as { __cvg: { lastLink?: string } }).__cvg.lastLink))
      .toBe(RELEASE);
    await banner.getByRole('button', { name: 'Закрыть' }).click();
    await expect(banner).toBeHidden();
  } finally {
    await l.app.close();
  }
  // После перезапуска эта версия не показывается
  l = await open(userData);
  try {
    await l.page.waitForTimeout(7000);
    await expect(l.page.getByText('Доступно обновление')).toHaveCount(0);
  } finally {
    await l.app.close();
  }
});

test('последняя версия уже стоит — баннера нет', async () => {
  const pkg = (await import('../../package.json', { with: { type: 'json' } })).default as { version: string };
  body = JSON.stringify({ tag_name: `v${pkg.version}`, html_url: `https://github.com/Liotto1337/claude-vm-gui/releases/tag/v${pkg.version}` });
  const l = await open(withConfig({ host: '127.0.0.1', port: 22, username: 'root', keyPath: TEST_KEY, theme: 'light' }));
  try {
    await l.page.waitForTimeout(7000);
    await expect(l.page.getByText('Доступно обновление')).toHaveCount(0);
  } finally {
    await l.app.close();
  }
});
