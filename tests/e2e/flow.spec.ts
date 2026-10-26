import { execFileSync } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { hasTestKey, launchApp, TEST_KEY, trustedKnownHosts, withConfig } from './helpers';

test.skip(!hasTestKey, 'нет тестового ключа');

const UPLOADS = join(homedir(), '.cache/claude-vm-gui/uploads');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const name = `cvg-test-flow-${Date.now() % 100000}`;
const pane = () => execFileSync('tmux', ['capture-pane', '-p', '-J', '-t', `=${name}:`], { encoding: 'utf8' });
const uploads = () => {
  try {
    return readdirSync(UPLOADS);
  } catch {
    return [];
  }
};
const before = uploads();

test.afterAll(() => {
  try {
    execFileSync('tmux', ['kill-session', '-t', `=${name}`]);
  } catch {
    // уже завершена в сценарии
  }
  for (const f of uploads()) if (!before.includes(f)) rmSync(join(UPLOADS, f));
});

test('сквозной сценарий: сессия, подсказки, картинка, отправка, обрыв связи, завершение', async () => {
  const userData = withConfig({ host: '127.0.0.1', port: 22, username: 'root', keyPath: TEST_KEY, theme: 'light' });
  const { app, page } = await launchApp({
    CVG_USER_DATA: userData, CVG_KNOWN_HOSTS: trustedKnownHosts(), CVG_FAKE_CLAUDE: '1', CVG_TEST_HOOKS: '1',
  });
  try {
    const nav = page.getByRole('navigation', { name: 'Сессии' });
    await expect(nav).toBeVisible({ timeout: 20_000 });

    // Новая сессия, в ней cat вместо claude
    await page.getByRole('button', { name: 'Новая сессия' }).click();
    const dialog = page.getByRole('dialog', { name: 'Новая сессия' });
    await dialog.getByLabel('Имя сессии tmux').fill(name);
    await dialog.getByLabel('Сразу запустить claude').uncheck();
    await dialog.getByRole('button', { name: 'Создать' }).click();
    await page.locator('.xterm').click();
    await page.keyboard.type('cat');
    await page.keyboard.press('Enter');
    await expect(page.getByText('claude не запущен')).toBeHidden({ timeout: 15_000 });

    // Подсказки
    const box = page.getByLabel('Сообщение для Claude');
    await box.fill('/mo');
    await expect(page.getByRole('listbox', { name: 'Подсказки' }).getByRole('option').first()).toContainText('/model', { timeout: 30_000 });
    await box.press('Escape');
    await expect(page.getByRole('listbox', { name: 'Подсказки' })).toBeHidden();

    // Картинка и отправка
    await app.evaluate(async ({ clipboard, ClipboardItem }, b64) => {
      const png = new Blob([Buffer.from(b64, 'base64')], { type: 'image/png' });
      await (clipboard as unknown as { write(items: unknown[]): Promise<void> }).write([new ClipboardItem({ 'image/png': png })]);
    }, PNG.toString('base64'));
    await box.fill('');
    await box.focus();
    await page.keyboard.press('Control+V');
    await expect(page.getByText('загружено')).toBeVisible({ timeout: 15_000 });
    await box.type('сквозной тест');
    await box.press('Enter');
    await expect.poll(pane).toContain('сквозной тест /root/.cache/claude-vm-gui/uploads/');

    // Модель и effort
    await page.getByRole('button', { name: /^Модель/ }).click();
    await page.getByRole('menuitemradio', { name: /^Sonnet/ }).first().click();
    await page.getByRole('button', { name: /^Effort/ }).click();
    await page.getByRole('dialog', { name: 'Effort' }).getByRole('slider', { name: 'Effort' }).fill('0');
    await expect.poll(pane).toContain('/effort low');
    expect(pane()).toContain('/model sonnet');

    // Обрыв связи: плашка, переподключение, терминал снова работает
    await app.evaluate(() => (globalThis as unknown as { __cvg: { dropConnection(): void } }).__cvg.dropConnection());
    await expect(page.getByText('Связь потеряна. Переподключаюсь…')).toBeVisible();
    await expect(page.getByText('Связь потеряна. Переподключаюсь…')).toBeHidden({ timeout: 15_000 });
    await page.locator('.xterm').click();
    await page.keyboard.type('after-reconnect');
    await page.keyboard.press('Enter');
    // Ввод после переподключения доходит до сессии; переносы строк не важны (tmux мог на миг сменить ширину окна)
    await expect.poll(() => pane().replace(/\s+/g, '')).toMatch(/after-reconnect.*after-reconnect/);

    // Завершение
    await page.getByRole('button', { name: 'Завершить сессию' }).click();
    await page.getByRole('dialog', { name: `Завершить сессию ${name}?` }).getByRole('button', { name: 'Завершить' }).click();
    await expect(nav.getByRole('button', { name: new RegExp(name) })).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('отдельный сервер tmux (CVG_TMUX_SOCKET) не показывает обычные сессии', async () => {
  const socket = `cvg-test-sock-${Date.now() % 100000}`;
  execFileSync('tmux', ['-L', socket, 'new-session', '-d', '-s', 'demo-only']);
  const userData = withConfig({ host: '127.0.0.1', port: 22, username: 'root', keyPath: TEST_KEY, theme: 'light' });
  const { app, page } = await launchApp({ CVG_USER_DATA: userData, CVG_KNOWN_HOSTS: trustedKnownHosts(), CVG_TMUX_SOCKET: socket });
  try {
    const nav = page.getByRole('navigation', { name: 'Сессии' });
    await expect(nav.getByRole('button', { name: /demo-only/ })).toBeVisible({ timeout: 20_000 });
    await expect(nav.locator('.session-item')).toHaveCount(1);
  } finally {
    await app.close();
    execFileSync('tmux', ['-L', socket, 'kill-server']);
  }
});

test('демо-адрес вместо настоящего (CVG_DEMO_HOST)', async () => {
  const userData = withConfig({ host: '127.0.0.1', port: 1, username: 'root', keyPath: TEST_KEY, theme: 'light' });
  const { app, page } = await launchApp({ CVG_USER_DATA: userData, CVG_DEMO_HOST: '203.0.113.10' });
  try {
    await expect(page.getByText('root@203.0.113.10:1')).toBeVisible();
    await expect(page.getByText('127.0.0.1')).toHaveCount(0);
  } finally {
    await app.close();
  }
});
