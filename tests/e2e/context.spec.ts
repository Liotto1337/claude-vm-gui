/// <reference lib="dom" />
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { hasTestKey, launchApp, TEST_KEY, trustedKnownHosts, withConfig, type Launched } from './helpers';

// Контекст сессии: значок в шапке, панель с разбивкой из /context, «Сжать сессию» → /compact
const FAKE = join(__dirname, '../fixtures/fake-claude.mjs');
let SOCK = '';
let claudeDir = '';
let otherCwd = '';
const tmux = (...args: string[]) => execFileSync('tmux', ['-L', SOCK, ...args], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();

test.skip(!hasTestKey, 'нет тестового ключа');

test.beforeEach(() => {
  SOCK = `cvg-test-ctx-${Math.random().toString(16).slice(2, 8)}`;
  claudeDir = mkdtempSync(join(tmpdir(), 'cvg-cd-ctx-'));
  otherCwd = mkdtempSync(join(tmpdir(), 'cvg-ctx-b-'));
  const seed = join(claudeDir, 'seed.jsonl');
  const answer = JSON.stringify({
    type: 'assistant', uuid: 'a1', timestamp: new Date().toISOString(),
    message: { model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'Готово.' }], usage: { input_tokens: 1000, cache_read_input_tokens: 820_000, cache_creation_input_tokens: 11_250, output_tokens: 50 } },
  });
  writeFileSync(seed, `${answer}\n`);
  tmux('new-session', '-d', '-s', 'cvg-ctx-a', '-x', '120', '-y', '40', `CVG_CLAUDE_DIR=${claudeDir} CVG_FAKE_SEED=${seed} node ${FAKE}`);
  tmux('new-session', '-d', '-s', 'cvg-ctx-b', '-c', otherCwd, '-x', '120', '-y', '40', `CVG_CLAUDE_DIR=${claudeDir} CVG_FAKE_SEED=${seed} node ${FAKE}`);
});
test.afterEach(() => {
  try {
    tmux('kill-server');
  } catch {}
});

/** Сколько раз команда ушла в журналы сессий из каталога cwd (по слагу каталога, как у Claude Code) */
function commands(name: string, cwd?: string): number {
  const root = join(claudeDir, 'projects');
  if (!existsSync(root)) return 0;
  let n = 0;
  for (const slug of readdirSync(root)) {
    if (cwd && slug !== cwd.replace(/[^A-Za-z0-9]/g, '-')) continue;
    for (const f of readdirSync(join(root, slug)))
      n += readFileSync(join(root, slug, f), 'utf8').split(`<command-name>${name}</command-name>`).length - 1;
  }
  return n;
}

async function open(session = 'cvg-ctx-a'): Promise<Launched> {
  const userData = withConfig({ host: '127.0.0.1', port: 22, username: 'root', keyPath: TEST_KEY, theme: 'light' });
  const l = await launchApp({ CVG_USER_DATA: userData, CVG_KNOWN_HOSTS: trustedKnownHosts(), CVG_TMUX_SOCKET: SOCK, CVG_CLAUDE_DIR: claudeDir, CVG_TEST_HOOKS: '1' });
  const nav = l.page.getByRole('navigation', { name: 'Сессии' });
  await expect(nav).toBeVisible({ timeout: 20_000 });
  await nav.getByRole('button', { name: new RegExp(`^${session}\\b`) }).click();
  return l;
}
const badge = (page: Page) => page.getByRole('button', { name: /^Контекст/ });
const panel = (page: Page) => page.getByRole('dialog', { name: 'Контекст' });

test('значок, панель с разбивкой из /context, /context не в ленте', async () => {
  const { app, page } = await open();
  try {
    await expect(badge(page)).toHaveText('Контекст 832.3k', { timeout: 15_000 });
    await badge(page).click();
    await expect(panel(page)).toBeVisible();
    await expect.poll(() => commands('/context'), { timeout: 10_000 }).toBe(1);
    await expect(badge(page)).toHaveText('Контекст 83 %', { timeout: 10_000 });
    await expect(badge(page)).toHaveClass(/context-warn/);
    await expect(panel(page)).toContainText('Использовано: 83 %');
    await expect(panel(page)).toContainText('832.3k / 1M');
    for (const name of ['System prompt', 'System tools', 'Skills', 'Messages', 'Free space', 'Autocompact buffer']) await expect(panel(page)).toContainText(name);
    await expect(panel(page)).toContainText('Токенов до автосжатия: 134.7k');
    await expect(panel(page).getByRole('listitem').filter({ hasText: 'Skills' })).toContainText('1.0 %');
    await expect(page.getByRole('region', { name: 'Переписка' })).not.toContainText('Context Usage');
    // повторное открытие в течение 10 с — без второго /context
    await badge(page).click();
    await expect(panel(page)).toBeHidden();
    await badge(page).click();
    await expect(panel(page)).toBeVisible();
    await page.waitForTimeout(1500);
    expect(commands('/context')).toBe(1);
  } finally {
    await app.close();
  }
});

test('«Сжать сессию»: диалог с пожеланиями → /compact в эту сессию', async () => {
  const { app, page } = await open();
  try {
    await expect(badge(page)).toHaveText('Контекст 832.3k', { timeout: 15_000 });
    await badge(page).click();
    await expect(badge(page)).toHaveText('Контекст 83 %', { timeout: 10_000 });
    await panel(page).getByRole('button', { name: 'Сжать сессию' }).click();
    const dialog = page.getByRole('dialog', { name: 'Сжать сессию?' });
    await expect(dialog).toContainText('История для Claude заменится краткой сводкой. Само сжатие тоже тратит токены.');
    await dialog.getByRole('textbox', { name: 'Что сохранить в сводке' }).fill('сохрани план');
    await dialog.getByRole('button', { name: 'Сжать' }).click();
    await expect.poll(() => commands('/compact'), { timeout: 10_000 }).toBe(1);
    await expect.poll(() => tmux('capture-pane', '-p', '-t', 'cvg-ctx-a'), { timeout: 10_000 }).toContain('› /compact сохрани план');
    // после сжатия ответа ещё нет: сколько занято — неизвестно, а не прежние 83 %
    await expect(badge(page)).toHaveText('Контекст —', { timeout: 10_000 });
    // свежий /context после сжатия (через 10 с) даёт число и без ответа
    await page.waitForTimeout(10_500);
    await badge(page).click();
    await expect.poll(() => commands('/context'), { timeout: 10_000 }).toBe(2);
    await expect(badge(page)).toHaveText('Контекст 2 %', { timeout: 10_000 });
  } finally {
    await app.close();
  }
});

test('/context, набранный в поле ввода, не висит пузырём в ленте', async () => {
  const { app, page } = await open();
  try {
    await expect(badge(page)).toHaveText('Контекст 832.3k', { timeout: 15_000 });
    await page.getByRole('textbox', { name: 'Сообщение для Claude' }).fill('/context');
    await page.getByRole('textbox', { name: 'Сообщение для Claude' }).press('Enter');
    await expect.poll(() => commands('/context'), { timeout: 10_000 }).toBe(1);
    await expect(badge(page)).toHaveText('Контекст 83 %', { timeout: 10_000 });
    await page.waitForTimeout(1000);
    await expect(page.getByRole('region', { name: 'Переписка' }).getByText('/context')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('пока Claude работает: кнопка неактивна, /context не уходит, прошлая разбивка с временем', async () => {
  const { app, page } = await open();
  try {
    await expect(badge(page)).toHaveText('Контекст 832.3k', { timeout: 15_000 });
    await badge(page).click();
    await expect(badge(page)).toHaveText('Контекст 83 %', { timeout: 10_000 });
    await badge(page).click();
    await page.getByRole('textbox', { name: 'Сообщение для Claude' }).fill('busy');
    await page.getByRole('button', { name: 'Отправить' }).click();
    await expect(page.getByRole('button', { name: 'Остановить · Esc' })).toBeVisible({ timeout: 10_000 });
    await badge(page).click();
    const compact = panel(page).getByRole('button', { name: 'Сжать сессию' });
    await expect(compact).toBeDisabled();
    await expect(compact).toHaveAttribute('title', 'Дождитесь окончания ответа');
    await expect(panel(page)).toContainText(/Разбивка на \d\d:\d\d/);
    expect(commands('/context')).toBe(1);
  } finally {
    await app.close();
  }
});

test('открыли панель и сразу переключились — /context не уходит в другую сессию', async () => {
  const { app, page } = await open();
  try {
    await expect(badge(page)).toHaveText('Контекст 832.3k', { timeout: 15_000 });
    await badge(page).click();
    await page.getByRole('navigation', { name: 'Сессии' }).getByRole('button', { name: /^cvg-ctx-b\b/ }).click();
    await page.waitForTimeout(4000);
    expect(commands('/context', otherCwd)).toBe(0);
  } finally {
    await app.close();
  }
});
