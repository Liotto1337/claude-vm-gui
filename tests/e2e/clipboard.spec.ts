import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { hasTestKey, launchApp, TEST_KEY, trustedKnownHosts, withConfig } from './helpers';

test.skip(!hasTestKey, 'нет тестового ключа');

const name = `cvg-test-clip-${Date.now() % 100000}`;
test.afterAll(() => {
  try {
    execFileSync('tmux', ['kill-session', '-t', `=${name}`]);
  } catch {
    // сессия уже закрыта
  }
});

test('скопированное в tmux и выделение с Shift попадают в буфер обмена', async () => {
  const userData = withConfig({ host: '127.0.0.1', port: 22, username: 'root', keyPath: TEST_KEY, theme: 'light' });
  const { app, page } = await launchApp({ CVG_USER_DATA: userData, CVG_KNOWN_HOSTS: trustedKnownHosts() });
  const clipboard = () => app.evaluate(({ clipboard }) => clipboard.readText());
  try {
    await expect(page.getByRole('navigation', { name: 'Сессии' })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Новая сессия' }).click();
    const dialog = page.getByRole('dialog', { name: 'Новая сессия' });
    await dialog.getByLabel('Имя сессии tmux').fill(name);
    await dialog.getByLabel('Сразу запустить claude').uncheck();
    await dialog.getByRole('button', { name: 'Создать' }).click();
    await expect(page.getByText('в сессии bash')).toBeVisible({ timeout: 20_000 });

    // Как Claude Code: копирует изнутри панели через tmux load-buffer -w, tmux отдаёт текст терминалу через OSC 52
    await app.evaluate(({ clipboard }) => clipboard.writeText('старое'));
    await page.locator('.xterm').click();
    await page.keyboard.type("printf 'Привет из tmux' | tmux load-buffer -w -\n");
    await expect.poll(clipboard).toBe('Привет из tmux');

    // Как Claude Code: отслеживание всех движений мыши (1003) — xterm.js снимал выделение при первом движении
    await page.keyboard.type("printf '\\e[?1003h\\e[?1006h'; clear; echo SELECT-ME-42\n");
    await expect(page.locator('.xterm-rows')).toContainText('SELECT-ME-42');
    await expect
      .poll(() => execFileSync('tmux', ['display', '-p', '-t', `=${name}:`, '#{mouse_all_flag}'], { encoding: 'utf8' }).trim())
      .toBe('1');

    const box = (await page.locator('.xterm-screen').boundingBox())!;
    const rowH = box.height / Number(await page.evaluate(() => document.querySelectorAll('.xterm-rows > div').length));
    const y = box.y + rowH / 2;
    await page.keyboard.down('Shift');
    await page.mouse.move(box.x + 1, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, y, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });

    await page.keyboard.press('Control+C');
    await expect.poll(clipboard).toBe('SELECT-ME-42');
  } finally {
    await app.close();
  }
});
