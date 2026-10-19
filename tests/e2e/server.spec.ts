/// <reference lib="dom" />
import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { hasTestKey, launchApp, TEST_KEY, trustedKnownHosts, withConfig } from './helpers';

const SOCK = `cvg-test-srv-${Math.random().toString(16).slice(2, 8)}`;
test.skip(!hasTestKey, 'нет тестового ключа');
test.afterAll(() => {
  try {
    execFileSync('tmux', ['-L', SOCK, 'kill-server']);
  } catch {}
});

test('панель «Сервер»: разделы, график, Esc закрывает и возвращает фокус', async () => {
  execFileSync('tmux', ['-L', SOCK, 'new-session', '-d', '-s', 'cvg-test-srv']);
  const userData = withConfig({ host: '127.0.0.1', port: 22, username: 'root', keyPath: TEST_KEY, theme: 'light' });
  const { app, page } = await launchApp({ CVG_USER_DATA: userData, CVG_KNOWN_HOSTS: trustedKnownHosts(), CVG_TMUX_SOCKET: SOCK });
  try {
    const nav = page.getByRole('navigation', { name: 'Сессии' });
    await expect(nav).toBeVisible({ timeout: 20_000 });
    const button = nav.getByRole('button', { name: 'Сервер' });
    await button.click();
    const panel = page.getByRole('dialog', { name: 'Сервер' });
    await expect(panel).toBeVisible();
    for (const h of ['Процессор', 'Память', 'Диски', 'Сеть', 'Процессы']) await expect(panel.getByRole('heading', { name: h })).toBeVisible();
    await expect(panel.getByRole('progressbar', { name: 'Диск /', exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(panel.getByText('Ядро')).toBeVisible({ timeout: 15_000 });
    const chart = panel.getByRole('img', { name: /Загрузка процессора/ });
    await expect.poll(async () => Number(await chart.getAttribute('data-points')), { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
    // Таблица процессов с рамками у ячеек
    const cell = panel.locator('.procs td').first();
    await expect(cell).toBeVisible({ timeout: 15_000 });
    const border = await cell.evaluate((td) => {
      const cs = getComputedStyle(td);
      return [cs.borderTopStyle, cs.borderLeftStyle, cs.borderTopWidth];
    });
    expect(border.slice(0, 2)).toEqual(['solid', 'solid']);
    expect(border[2]).not.toBe('0px');
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(button).toBeFocused();
  } finally {
    await app.close();
  }
});
