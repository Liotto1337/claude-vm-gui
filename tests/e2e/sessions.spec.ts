import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { hasTestKey, launchApp, TEST_KEY, tempKnownHostsPath, trustedKnownHosts, withConfig } from './helpers';

test.skip(!hasTestKey, 'нет тестового ключа');

const tmuxNames = () => {
  try {
    return execFileSync('tmux', ['ls', '-F', '#{session_name}'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch {
    return [];
  }
};
const killTestSessions = () => {
  for (const n of tmuxNames()) if (n.startsWith('cvg-test-ui')) execFileSync('tmux', ['kill-session', '-t', `=${n}`]);
};
const userSessionsBefore = tmuxNames().filter((n) => !n.startsWith('cvg-test-'));

test.afterEach(killTestSessions);
test.afterAll(() => expect(tmuxNames().filter((n) => !n.startsWith('cvg-test-'))).toEqual(userSessionsBefore));

async function start() {
  const userData = withConfig({ host: '127.0.0.1', port: 22, username: 'root', keyPath: TEST_KEY, theme: 'light' });
  const launched = await launchApp({ CVG_USER_DATA: userData, CVG_KNOWN_HOSTS: trustedKnownHosts() });
  await expect(launched.page.getByRole('navigation', { name: 'Сессии' })).toBeVisible({ timeout: 20_000 });
  return launched;
}

async function createSession(page: Page, name: string, startClaude = false) {
  await page.getByRole('button', { name: 'Новая сессия' }).click();
  const dialog = page.getByRole('dialog', { name: 'Новая сессия' });
  await dialog.getByLabel('Имя сессии tmux').fill(name);
  if (!startClaude) await dialog.getByLabel('Сразу запустить claude').uncheck();
  await dialog.getByRole('button', { name: 'Создать' }).click();
  await expect(dialog).toBeHidden();
}

test('новая сессия появляется, открывается, терминал работает', async () => {
  const { app, page } = await start();
  try {
    const name = `cvg-test-ui-${Date.now() % 100000}`;
    await page.getByRole('button', { name: 'Новая сессия' }).click();
    const dialog = page.getByRole('dialog', { name: 'Новая сессия' });
    await expect(dialog.getByLabel('Сразу запустить claude')).toBeChecked();
    await dialog.getByLabel('Имя сессии tmux').fill('bad name');
    await expect(dialog.getByRole('button', { name: 'Создать' })).toBeDisabled();
    await expect(dialog.getByText('Латиница, цифры, точка, дефис и подчёркивание')).toBeVisible();
    // Подсказки папок с ВМ
    await dialog.getByLabel('Рабочая папка на ВМ').fill('/ro');
    await expect(dialog.getByRole('option', { name: '/root' })).toBeVisible();
    await dialog.getByRole('option', { name: '/root' }).click();
    await expect(dialog.getByLabel('Рабочая папка на ВМ')).toHaveValue('/root');
    await dialog.getByRole('button', { name: 'Отмена' }).click();

    await createSession(page, name);
    const item = page.getByRole('navigation', { name: 'Сессии' }).getByRole('button', { name: new RegExp(name) });
    await expect(item).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { name })).toBeVisible();
    await expect(page.getByText('в сессии bash')).toBeVisible();

    await page.locator('.xterm').click();
    await page.keyboard.type('echo cvg-$((6*7))');
    await page.keyboard.press('Enter');
    await expect(page.locator('.xterm-rows')).toContainText('cvg-42');
  } finally {
    await app.close();
  }
});

test('«Завершить сессию» с подтверждением', async () => {
  const { app, page } = await start();
  try {
    const name = `cvg-test-ui-kill-${Date.now() % 100000}`;
    await createSession(page, name);
    await page.getByRole('button', { name: 'Завершить сессию' }).click();
    const confirm = page.getByRole('dialog', { name: `Завершить сессию ${name}?` });
    await confirm.getByRole('button', { name: 'Завершить' }).click();
    await expect(page.getByRole('navigation', { name: 'Сессии' }).getByRole('button', { name: new RegExp(name) })).toHaveCount(0);
    expect(tmuxNames()).not.toContain(name);
    await expect(page.getByText('Выберите сессию слева или создайте новую')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('сессию закрыли из cmd — «Сессия завершена»', async () => {
  const { app, page } = await start();
  try {
    const name = `cvg-test-ui-ext-${Date.now() % 100000}`;
    await createSession(page, name);
    await expect(page.locator('.xterm')).toBeVisible();
    execFileSync('tmux', ['kill-session', '-t', `=${name}`]);
    await expect(page.getByText('Сессия завершена')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('navigation', { name: 'Сессии' }).getByRole('button', { name: new RegExp(name) })).toHaveCount(0, { timeout: 10_000 });
  } finally {
    await app.close();
  }
});

test('метка «открыта в cmd», когда к сессии подключён ещё кто-то', async () => {
  const { app, page } = await start();
  let other: ChildProcess | null = null;
  try {
    const name = `cvg-test-ui-cmd-${Date.now() % 100000}`;
    execFileSync('tmux', ['new-session', '-d', '-s', name]);
    other = spawn('script', ['-qfc', `tmux attach -t =${name}`, '/dev/null'], { stdio: 'ignore' });
    const item = page.getByRole('navigation', { name: 'Сессии' }).getByRole('button', { name: new RegExp(name) });
    await expect(item).toContainText('открыта в cmd', { timeout: 10_000 });
    // Открыли сами — второй клиент всё ещё есть, метка остаётся
    await item.click();
    await expect(item).toContainText('открыта в cmd', { timeout: 10_000 });
    other.kill();
    other = null;
    await expect(item).not.toContainText('открыта в cmd', { timeout: 10_000 });
  } finally {
    other?.kill();
    await app.close();
  }
});

test('известный ключ сервера — без вопроса', async () => {
  const userData = withConfig({ host: '127.0.0.1', port: 22, username: 'root', keyPath: TEST_KEY, theme: 'dark' });
  const { app, page } = await launchApp({ CVG_USER_DATA: userData, CVG_KNOWN_HOSTS: trustedKnownHosts() });
  try {
    await expect(page.getByRole('navigation', { name: 'Сессии' })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(tempKnownHostsPath()).toBeTruthy();
  } finally {
    await app.close();
  }
});
