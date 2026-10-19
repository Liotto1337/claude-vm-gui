import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { hasTestKey, launchApp, TEST_KEY, trustedKnownHosts, withConfig, type Launched } from './helpers';

// Фейковый claude на отдельном сервере tmux; журнал — синтетическая фикстура (CVG_FAKE_SEED)
const FAKE = join(__dirname, '../fixtures/fake-claude.mjs');
const FIXTURE = join(__dirname, '../fixtures/transcript.jsonl');
let SOCK = '';
let claudeDir = '';
const tmux = (...args: string[]) => execFileSync('tmux', ['-L', SOCK, ...args], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();

test.skip(!hasTestKey, 'нет тестового ключа');

test.beforeEach(() => {
  SOCK = `cvg-test-chat-${Math.random().toString(16).slice(2, 8)}`;
  claudeDir = mkdtempSync(join(tmpdir(), 'cvg-cd-'));
  const seed = join(claudeDir, 'seed.jsonl');
  const link = JSON.stringify({ type: 'assistant', uuid: 'link', message: { content: [{ type: 'text', text: 'Подробнее: [сайт](https://example.com/doc)' }] } });
  writeFileSync(seed, `${readFileSync(FIXTURE, 'utf8')}${link}\n`);
  tmux('new-session', '-d', '-s', 'cvg-test-claude', '-x', '120', '-y', '40', `CVG_CLAUDE_DIR=${claudeDir} CVG_FAKE_SEED=${seed} node ${FAKE}`);
  tmux('new-session', '-d', '-s', 'cvg-test-shell');
});
test.afterEach(() => {
  try {
    tmux('kill-server');
  } catch {}
});

async function open(session = 'cvg-test-claude'): Promise<Launched> {
  const userData = withConfig({ host: '127.0.0.1', port: 22, username: 'root', keyPath: TEST_KEY, theme: 'light' });
  const l = await launchApp({
    CVG_USER_DATA: userData, CVG_KNOWN_HOSTS: trustedKnownHosts(), CVG_TMUX_SOCKET: SOCK, CVG_CLAUDE_DIR: claudeDir, CVG_TEST_HOOKS: '1',
  });
  const nav = l.page.getByRole('navigation', { name: 'Сессии' });
  await expect(nav).toBeVisible({ timeout: 20_000 });
  await nav.getByRole('button', { name: new RegExp(`^${session}\\b`) }).click();
  return l;
}
const feed = (page: Page) => page.getByRole('region', { name: 'Переписка' });
const composer = (page: Page) => page.getByRole('textbox', { name: 'Сообщение для Claude' });

test('при claude показывается лента, терминал скрыт', async () => {
  const { app, page } = await open();
  try {
    await expect(feed(page)).toBeVisible({ timeout: 15_000 });
    await expect(feed(page).getByText('привет', { exact: true })).toBeVisible();
    await expect(feed(page).getByText('Сейчас посмотрю.')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Терминал' })).toBeHidden();
  } finally {
    await app.close();
  }
});

test('инструмент раскрывается по клику', async () => {
  const { app, page } = await open();
  try {
    const row = feed(page).getByRole('button', { name: /Bash.*ls -la/ });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toHaveAttribute('aria-expanded', 'false');
    await row.click();
    await expect(row).toHaveAttribute('aria-expanded', 'true');
    await expect(feed(page).getByText(/total 8/)).toBeVisible();
  } finally {
    await app.close();
  }
});

test('отправка из поля ввода появляется в ленте', async () => {
  const { app, page } = await open();
  try {
    await expect(feed(page)).toBeVisible({ timeout: 15_000 });
    await composer(page).fill('новое сообщение');
    await composer(page).press('Enter');
    await expect(feed(page).getByText('новое сообщение', { exact: true })).toBeVisible({ timeout: 10_000 });
  } finally {
    await app.close();
  }
});

test('меню: карточка, стрелка вниз и Enter выбирают вариант', async () => {
  const { app, page } = await open();
  try {
    await expect(feed(page)).toBeVisible({ timeout: 15_000 });
    await composer(page).fill('menu');
    await composer(page).press('Enter');
    const card = page.getByRole('group', { name: 'Выбор' });
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.getByRole('option', { name: /Да и не спрашивать/ })).toBeVisible();
    await expect(composer(page)).toBeDisabled();
    await page.keyboard.press('ArrowDown');
    await expect(card.getByRole('option', { name: /Да и не спрашивать/ })).toHaveAttribute('aria-selected', 'true', { timeout: 5000 });
    await page.keyboard.press('Enter');
    await expect(card).toBeHidden({ timeout: 5000 });
    await expect(feed(page).getByText('выбран 2')).toBeVisible({ timeout: 10_000 });
  } finally {
    await app.close();
  }
});

test('меню: клик по варианту', async () => {
  const { app, page } = await open();
  try {
    await expect(feed(page)).toBeVisible({ timeout: 15_000 });
    await composer(page).fill('menu');
    await composer(page).press('Enter');
    const card = page.getByRole('group', { name: 'Выбор' });
    await card.getByRole('option', { name: /Нет/ }).click({ timeout: 10_000 });
    await expect(feed(page).getByText('выбран 3')).toBeVisible({ timeout: 10_000 });
  } finally {
    await app.close();
  }
});

test('переключатель «Терминал» показывает xterm', async () => {
  const { app, page } = await open();
  try {
    await expect(feed(page)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Терминал', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Терминал' })).toBeVisible();
    await expect(feed(page)).toBeHidden();
    await page.getByRole('button', { name: 'Лента', exact: true }).click();
    await expect(feed(page)).toBeVisible();
  } finally {
    await app.close();
  }
});

test('без claude — терминал и нет переключателя', async () => {
  const { app, page } = await open('cvg-test-shell');
  try {
    await expect(page.getByRole('region', { name: 'Терминал' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Лента', exact: true })).toHaveCount(0);
    await expect(feed(page)).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('ссылка из ответа открывается через links.open, а не в окне', async () => {
  const { app, page } = await open();
  try {
    await feed(page).getByRole('link', { name: 'сайт' }).click({ timeout: 15_000 });
    await expect
      .poll(() => app.evaluate(() => (globalThis as unknown as { __cvg: { lastLink?: string } }).__cvg.lastLink))
      .toBe('https://example.com/doc');
    await expect(feed(page)).toBeVisible();
  } finally {
    await app.close();
  }
});
