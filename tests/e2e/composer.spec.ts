import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { hasTestKey, launchApp, TEST_KEY, trustedKnownHosts, withConfig } from './helpers';

test.skip(!hasTestKey, 'нет тестового ключа');

const UPLOADS = join(homedir(), '.cache/claude-vm-gui/uploads');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const pane = (name: string) => execFileSync('tmux', ['capture-pane', '-p', '-J', '-t', `=${name}:`], { encoding: 'utf8' });
const uploads = () => {
  try {
    return readdirSync(UPLOADS);
  } catch {
    return [];
  }
};

let repo = '';
let name = '';
let uploadsBefore: string[] = [];

test.beforeEach(() => {
  repo = mkdtempSync(join(homedir(), 'cvg-test-composer-'));
  writeFileSync(join(repo, 'package.json'), '{}');
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'src/app.ts'), '');
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['add', '.'], { cwd: repo });
  name = `cvg-test-ui-comp-${Date.now() % 100000}`;
  uploadsBefore = uploads();
});

test.afterEach(() => {
  try {
    execFileSync('tmux', ['kill-session', '-t', `=${name}`]);
  } catch {
    // сессия уже закрыта
  }
  rmSync(repo, { recursive: true, force: true });
  for (const f of uploads()) if (!uploadsBefore.includes(f)) rmSync(join(UPLOADS, f));
});

async function openWith(sessionCmd: string[], env: Record<string, string> = {}) {
  execFileSync('tmux', ['new-session', '-d', '-s', name, '-c', repo, ...sessionCmd]);
  const userData = withConfig({ host: '127.0.0.1', port: 22, username: 'root', keyPath: TEST_KEY, theme: 'light' });
  const launched = await launchApp({ CVG_USER_DATA: userData, CVG_KNOWN_HOSTS: trustedKnownHosts(), ...env });
  const { page } = launched;
  await page.getByRole('navigation', { name: 'Сессии' }).getByRole('button', { name: new RegExp(name) }).click({ timeout: 20_000 });
  await expect(page.getByRole('heading', { name })).toBeVisible();
  return launched;
}

test('подсказки, картинка, отправка, модель и effort', async () => {
  const { app, page } = await openWith(['cat'], { CVG_FAKE_CLAUDE: '1' });
  try {
    const box = page.getByLabel('Сообщение для Claude');
    // «/» — команды
    await box.fill('/mo');
    const hints = page.getByRole('listbox', { name: 'Подсказки' });
    await expect(hints.getByRole('option').first()).toContainText('/model', { timeout: 30_000 });
    await box.press('Tab');
    await expect(box).toHaveValue('/model ');
    await expect(hints).toBeHidden();

    // «@» — файлы рабочей папки
    await box.fill('смотри @pa');
    await expect(hints.getByRole('option', { name: /package\.json/ })).toBeVisible();
    await box.press('Enter');
    await expect(box).toHaveValue('смотри @package.json ');

    // Картинка из буфера обмена
    // Electron 44: асинхронный буфер обмена с ClipboardItem
    await app.evaluate(async ({ clipboard, ClipboardItem }, b64) => {
      const png = new Blob([Buffer.from(b64, 'base64')], { type: 'image/png' });
      await (clipboard as unknown as { write(items: unknown[]): Promise<void> }).write([new ClipboardItem({ 'image/png': png })]);
    }, PNG.toString('base64'));
    await box.fill('');
    await box.focus();
    await page.keyboard.press('Control+V');
    await expect(page.getByText('загружено')).toBeVisible({ timeout: 15_000 });
    const added = uploads().filter((f) => !uploadsBefore.includes(f));
    expect(added).toHaveLength(1);

    // Отправка: две строки + путь картинки
    await box.type('привет');
    await box.press('Shift+Enter');
    await box.type('мир');
    await box.press('Enter');
    await expect(box).toHaveValue('');
    await expect(page.getByText('загружено')).toBeHidden();
    await expect.poll(() => pane(name)).toContain('привет');
    expect(pane(name)).toContain(`мир ${join(UPLOADS, added[0])}`);

    // Модель и effort
    await page.getByRole('button', { name: /^Модель/ }).click();
    await page.getByRole('menuitemradio', { name: /^Sonnet/ }).first().click();
    await expect.poll(() => pane(name)).toContain('/model sonnet');
    await expect(page.getByRole('button', { name: /^Модель/ })).toContainText('Sonnet');
    await page.getByRole('button', { name: /^Effort/ }).click();
    await page.getByRole('menuitemradio', { name: 'low' }).click();
    await expect.poll(() => pane(name)).toContain('/effort low');
    await expect(page.getByRole('button', { name: /^Effort/ })).toContainText('low');
  } finally {
    await app.close();
  }
});

test('claude не запущен — плашка и кнопка «Запустить claude»', async () => {
  const { app, page } = await openWith([]);
  try {
    await expect(page.getByText('claude не запущен')).toBeVisible();
    // Вместо настоящего claude — функция оболочки
    execFileSync('tmux', ['send-keys', '-t', `=${name}:`, 'claude() { echo fake-claude-started; }', 'Enter']);
    await page.getByRole('button', { name: 'Запустить claude' }).click();
    await expect.poll(() => pane(name)).toContain('fake-claude-started');
  } finally {
    await app.close();
  }
});

test('открыто меню Claude Code — сообщение не уходит, видна подсказка', async () => {
  const { app, page } = await openWith(['sh', '-c', "printf ' ❯ 1. Yes\\n   2. No\\n Esc to cancel\\n'; exec cat"], { CVG_FAKE_CLAUDE: '1' });
  try {
    const box = page.getByLabel('Сообщение для Claude');
    await box.fill('не отправлять');
    await box.press('Enter');
    await expect(page.getByRole('alert')).toContainText('Ответьте прямо в терминале');
    await expect(box).toHaveValue('не отправлять');
    expect(pane(name)).not.toContain('не отправлять');
  } finally {
    await app.close();
  }
});

test('отправка недоступна, пока поле пустое', async () => {
  const { app, page } = await openWith(['cat'], { CVG_FAKE_CLAUDE: '1' });
  try {
    await expect(page.getByRole('button', { name: 'Отправить' })).toBeDisabled();
    await page.getByLabel('Сообщение для Claude').fill('x');
    await expect(page.getByRole('button', { name: 'Отправить' })).toBeEnabled();
  } finally {
    await app.close();
  }
});
