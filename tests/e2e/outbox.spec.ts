/// <reference lib="dom" />
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { hasTestKey, launchApp, TEST_KEY, trustedKnownHosts, withConfig, type Launched } from './helpers';

// Файлы, которые Claude сделал для пользователя: outbox → карточки под ответом
const FAKE = join(__dirname, '../fixtures/fake-claude.mjs');
const OUTBOX = join(homedir(), '.cache/claude-vm-gui/outbox');
let SOCK = '';
let claudeDir = '';
let saveDir = '';
let TAG = '';
const tmux = (...args: string[]) => execFileSync('tmux', ['-L', SOCK, ...args], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
const file = (name: string) => join(OUTBOX, `${TAG}-${name}`);

test.skip(!hasTestKey, 'нет тестового ключа');

test.beforeEach(() => {
  SOCK = `cvg-test-out-${Math.random().toString(16).slice(2, 8)}`;
  TAG = `cvg-test-${Math.random().toString(16).slice(2, 8)}`;
  claudeDir = mkdtempSync(join(tmpdir(), 'cvg-cd-out-'));
  saveDir = mkdtempSync(join(tmpdir(), 'cvg-save-'));
  tmux('new-session', '-d', '-s', 'cvg-out', '-x', '120', '-y', '40', `CVG_CLAUDE_DIR=${claudeDir} CVG_FAKE_OUTBOX_TAG=${TAG} node ${FAKE}`);
});
test.afterEach(() => {
  try {
    tmux('kill-server');
  } catch {}
  for (const n of ['shot.png', 'report.html', 'notes.txt', 'bundle.zip']) rmSync(file(n), { force: true });
  rmSync(saveDir, { recursive: true, force: true });
});

async function open(): Promise<Launched> {
  const userData = withConfig({ host: '127.0.0.1', port: 22, username: 'root', keyPath: TEST_KEY, theme: 'light' });
  const l = await launchApp({
    CVG_USER_DATA: userData, CVG_KNOWN_HOSTS: trustedKnownHosts(), CVG_TMUX_SOCKET: SOCK, CVG_CLAUDE_DIR: claudeDir,
    CVG_TEST_HOOKS: '1', CVG_TEST_SAVE_DIR: saveDir,
  });
  const nav = l.page.getByRole('navigation', { name: 'Сессии' });
  await expect(nav).toBeVisible({ timeout: 20_000 });
  await nav.getByRole('button', { name: /^cvg-out\b/ }).click();
  return l;
}
async function ask(page: Page) {
  const box = page.getByRole('textbox', { name: 'Сообщение для Claude' });
  await box.fill('outbox');
  await box.press('Enter');
}
const card = (page: Page, name: string) => page.getByRole('group', { name: `${TAG}-${name}` });

test('файлы outbox под ответом: картинка, текст, HTML в браузере, «Сохранить»', async () => {
  const { app, page } = await open();
  try {
    await ask(page);
    const feed = page.getByRole('region', { name: 'Переписка' });
    await expect(card(page, 'shot.png').getByRole('img', { name: `${TAG}-shot.png` })).toBeVisible({ timeout: 15_000 });
    // текст ответа не меняется: пути остаются
    await expect(feed).toContainText(`${OUTBOX}/${TAG}-bundle.zip`);
    // текст раскрывается
    await card(page, 'notes.txt').getByRole('button', { name: new RegExp(`${TAG}-notes.txt`) }).click();
    await expect(card(page, 'notes.txt')).toContainText('Заметки: всё готово');
    // HTML и архив — имя и размер
    await expect(card(page, 'report.html')).toContainText('Б');
    await expect(card(page, 'bundle.zip')).toContainText('2 МБ');

    await card(page, 'bundle.zip').getByRole('button', { name: 'Сохранить' }).click();
    await expect(card(page, 'bundle.zip')).toContainText('Сохранено', { timeout: 15_000 });
    expect(readFileSync(join(saveDir, `${TAG}-bundle.zip`)).equals(readFileSync(file('bundle.zip')))).toBe(true);
    await card(page, 'bundle.zip').getByRole('button', { name: 'Показать в папке' }).click();
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { __cvg?: { lastRevealed?: string } }).__cvg?.lastRevealed)).toBe(join(saveDir, `${TAG}-bundle.zip`));

    await card(page, 'report.html').getByRole('button', { name: 'Открыть в браузере' }).click();
    const opened = await expect
      .poll(() => app.evaluate(() => (globalThis as unknown as { __cvg?: { lastOpened?: string } }).__cvg?.lastOpened ?? null), { timeout: 10_000 })
      .not.toBeNull()
      .then(() => app.evaluate(() => (globalThis as unknown as { __cvg: { lastOpened: string } }).__cvg.lastOpened));
    expect(opened.endsWith(`${TAG}-report.html`)).toBe(true);
    expect(existsSync(opened) && readFileSync(opened).equals(readFileSync(file('report.html')))).toBe(true);
  } finally {
    await app.close();
  }
});

test('файл удалён с ВМ — карточка говорит об этом', async () => {
  let l = await open();
  try {
    await ask(l.page);
    await expect(card(l.page, 'notes.txt')).toBeVisible({ timeout: 15_000 });
  } finally {
    await l.app.close();
  }
  rmSync(file('notes.txt'));
  l = await open();
  try {
    await expect(card(l.page, 'notes.txt')).toContainText(/файл удалён с ВМ/i, { timeout: 15_000 });
  } finally {
    await l.app.close();
  }
});

test('«Открыть в браузере» открывает только HTML — и при прямом вызове из страницы', async () => {
  const { app, page } = await open();
  try {
    await ask(page);
    await expect(card(page, 'bundle.zip')).toBeVisible({ timeout: 15_000 });
    const r = await page.evaluate((p) => (window as unknown as { api: { outbox: { openHtml(p: string): Promise<unknown> } } }).api.outbox.openHtml(p), file('bundle.zip'));
    expect(r).toMatchObject({ ok: false, error: { code: 'BAD_PATH' } });
    expect(await app.evaluate(() => (globalThis as unknown as { __cvg?: { lastOpened?: string } }).__cvg?.lastOpened ?? null)).toBeNull();
  } finally {
    await app.close();
  }
});
