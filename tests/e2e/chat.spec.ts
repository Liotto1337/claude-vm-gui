/// <reference lib="dom" />
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
  // claude без файла сессии (sessions/<pid>.json не пишется) — журнал не найти
  tmux('new-session', '-d', '-s', 'cvg-test-nofile', '-x', '120', '-y', '40', `node ${FAKE}`);
});
test.afterEach(() => {
  try {
    tmux('kill-server');
  } catch {}
});

async function open(session = 'cvg-test-claude', theme = 'light'): Promise<Launched> {
  const userData = withConfig({ host: '127.0.0.1', port: 22, username: 'root', keyPath: TEST_KEY, theme });
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

test('карточка меню не меняет размер терминала (claude не перерисовывает меню)', async () => {
  const { app, page } = await open();
  try {
    await expect(feed(page)).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1000);
    const size = () => tmux('display', '-p', '-t', '=cvg-test-claude:', '#{pane_width}x#{pane_height}').trim();
    const before = size();
    await composer(page).fill('menu');
    await composer(page).press('Enter');
    await expect(page.getByRole('group', { name: 'Выбор' })).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(800);
    expect(size()).toBe(before);
  } finally {
    await app.close();
  }
});

test('отправленное сообщение сразу в ленте (темнее), потом обычное и одно', async () => {
  const { app, page } = await open();
  try {
    await expect(feed(page)).toBeVisible({ timeout: 15_000 });
    await composer(page).fill('сразу видно');
    await composer(page).press('Enter');
    await expect(feed(page).locator('.bubble.is-sending', { hasText: 'сразу видно' })).toBeVisible({ timeout: 400 });
    await expect.poll(() => feed(page).locator('.bubble', { hasText: 'сразу видно' }).count(), { timeout: 10_000 }).toBe(1);
    await expect(feed(page).locator('.bubble.is-sending')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('новый ответ «печатается» посимвольно, а история — сразу', async () => {
  const { app, page } = await open();
  try {
    await expect(feed(page).getByText('Сейчас посмотрю.')).toBeVisible({ timeout: 15_000 });
    await composer(page).fill('long');
    await composer(page).press('Enter');
    const answer = feed(page).locator('.md', { hasText: 'Длинный ответ' });
    await expect(answer).toBeVisible({ timeout: 10_000 });
    const lengths: number[] = [];
    for (let i = 0; i < 12; i++) {
      lengths.push(((await answer.textContent()) ?? '').length);
      await page.waitForTimeout(100);
    }
    await expect(answer).toContainText('Конец ответа.', { timeout: 5000 });
    const full = ((await answer.textContent()) ?? '').length;
    expect(lengths.some((n) => n > 0 && n < full)).toBe(true);
  } finally {
    await app.close();
  }
});

test('в тёмной теме отправляемый пузырь заметно отличается от обычного', async () => {
  const { app, page } = await open('cvg-test-claude', 'dark');
  try {
    await expect(feed(page).locator('.bubble').first()).toBeVisible({ timeout: 15_000 });
    // rgb(58, 58, 55) или color(srgb 0.19 0.19 0.18) после color-mix — в 0–255
    const rgb = (s: string) => {
      const v = (s.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
      return s.startsWith('color(') ? v.map((x) => Math.round(x * 255)) : v;
    };
    const normal = rgb(await feed(page).locator('.bubble').first().evaluate((e) => getComputedStyle(e).backgroundColor));
    await composer(page).fill('тёмная тема');
    await composer(page).press('Enter');
    const sending = feed(page).locator('.bubble.is-sending');
    await expect(sending).toBeVisible({ timeout: 400 });
    const dim = rgb(await sending.evaluate((e) => getComputedStyle(e).backgroundColor));
    const diff = normal.reduce((a, v, i) => a + Math.abs(v - dim[i]), 0);
    expect(diff).toBeGreaterThan(30);
  } finally {
    await app.close();
  }
});

test('пока Claude работает — анимированная звёздочка', async () => {
  const { app, page } = await open();
  try {
    await expect(feed(page)).toBeVisible({ timeout: 15_000 });
    await composer(page).fill('busy');
    await composer(page).press('Enter');
    const star = feed(page).locator('.spinner');
    await expect(star).toBeVisible({ timeout: 10_000 });
    const glyphs = new Set<string>();
    for (let i = 0; i < 8; i++) {
      glyphs.add((await star.textContent()) ?? '');
      await page.waitForTimeout(100);
    }
    expect(glyphs.size).toBeGreaterThan(1);
  } finally {
    await app.close();
  }
});

test('кнопка «Завершить сессию» — цвета опасного действия, как в меню', async () => {
  const { app, page } = await open();
  try {
    await expect(page.getByRole('button', { name: 'Завершить сессию' })).toHaveCSS('color', 'rgb(181, 51, 51)', { timeout: 15_000 });
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

test('claude запущен, но сессия не найдена — терминал и плашка, а не пустая лента', async () => {
  const { app, page } = await open('cvg-test-nofile');
  try {
    await expect(page.getByText('Не удалось прочитать переписку — показан терминал')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('region', { name: 'Терминал' })).toBeVisible();
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

// Расстояние от низа ленты, px
const fromBottom = (page: Page) => feed(page).evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
async function scrollable(l: Launched) {
  await l.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 560));
  await expect(feed(l.page).getByText('Сейчас посмотрю.')).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => feed(l.page).evaluate((el) => el.scrollHeight > el.clientHeight + 200)).toBe(true);
}

test('ответ, дописанный во время «печати», допечатывается до конца', async () => {
  const { app, page } = await open();
  try {
    await expect(feed(page).getByText('Сейчас посмотрю.')).toBeVisible({ timeout: 15_000 });
    await composer(page).fill('grow');
    await composer(page).press('Enter');
    await expect(feed(page).locator('.md', { hasText: 'Начало растущего ответа' })).toContainText('Хвост растущего ответа.', { timeout: 6000 });
  } finally {
    await app.close();
  }
});

test('отправка прокручивает ленту вниз, даже если она была прокручена вверх', async () => {
  const l = await open();
  try {
    await scrollable(l);
    await feed(l.page).evaluate((el) => (el.scrollTop = 0));
    await expect.poll(() => fromBottom(l.page)).toBeGreaterThan(200);
    await composer(l.page).fill('вниз');
    await composer(l.page).press('Enter');
    await expect.poll(() => fromBottom(l.page), { timeout: 2000 }).toBeLessThan(5);
  } finally {
    await l.app.close();
  }
});

test('колесо вверх во время «печати» не возвращает ленту вниз', async () => {
  const l = await open();
  try {
    await scrollable(l);
    await composer(l.page).fill('long');
    await composer(l.page).press('Enter');
    await expect(feed(l.page).locator('.md', { hasText: 'Длинный ответ' })).toBeVisible({ timeout: 10_000 });
    const b = (await feed(l.page).boundingBox())!;
    await l.page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await l.page.mouse.wheel(0, -30);
    await expect(feed(l.page).locator('.md', { hasText: 'Длинный ответ' })).toContainText('Конец ответа.', { timeout: 5000 });
    await l.page.waitForTimeout(300);
    expect(await fromBottom(l.page)).toBeGreaterThan(20);
  } finally {
    await l.app.close();
  }
});

test('после ответа в карточке меню фокус возвращается в поле ввода', async () => {
  const { app, page } = await open();
  try {
    await expect(feed(page)).toBeVisible({ timeout: 15_000 });
    await composer(page).fill('menu');
    await composer(page).press('Enter');
    const card = page.getByRole('group', { name: 'Выбор' });
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(card).toBeHidden({ timeout: 5000 });
    await expect(composer(page)).toBeFocused({ timeout: 3000 });
  } finally {
    await app.close();
  }
});

test('claude запустили из терминала: лента вместо терминала, ввод — в поле, а не в скрытый терминал', async () => {
  const { app, page } = await open('cvg-test-shell');
  try {
    const term = page.getByRole('region', { name: 'Терминал' });
    await expect(term).toBeVisible({ timeout: 15_000 });
    await term.click();
    await page.keyboard.type(`CVG_CLAUDE_DIR=${claudeDir} node ${FAKE}`);
    await page.keyboard.press('Enter');
    await expect(feed(page)).toBeVisible({ timeout: 15_000 });
    await expect(composer(page)).toBeFocused({ timeout: 3000 });
    await page.keyboard.type('печатаю');
    await expect(composer(page)).toHaveValue('печатаю');
  } finally {
    await app.close();
  }
});
