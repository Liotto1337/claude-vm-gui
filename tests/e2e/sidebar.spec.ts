import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { hasTestKey, launchApp, TEST_KEY, trustedKnownHosts, withConfig, type Launched } from './helpers';

// Отдельный сервер tmux (CVG_TMUX_SOCKET): в списке только тестовые сессии, настоящие не мешают и не трогаются
let SOCK = '';
const tmux = (...args: string[]) => execFileSync('tmux', ['-L', SOCK, ...args], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
const NAMES = ['cvg-test-a', 'cvg-test-b', 'cvg-test-c', 'cvg-test-d'];

test.skip(!hasTestKey, 'нет тестового ключа');

let userData: string;
let knownHosts: string;

test.beforeEach(() => {
  // Свой сервер tmux на каждый тест — без гонок с остановкой предыдущего
  SOCK = `cvg-test-sb-${Math.random().toString(16).slice(2, 8)}`;
  for (const n of NAMES) tmux('new-session', '-d', '-s', n);
  userData = withConfig({ host: '127.0.0.1', port: 22, username: 'root', keyPath: TEST_KEY, theme: 'light' });
  knownHosts = trustedKnownHosts();
});

test.afterEach(() => {
  try {
    tmux('kill-server');
  } catch {}
});

async function open(): Promise<Launched> {
  const l = await launchApp({ CVG_USER_DATA: userData, CVG_KNOWN_HOSTS: knownHosts, CVG_TMUX_SOCKET: SOCK });
  await expect(nav(l.page)).toBeVisible({ timeout: 20_000 });
  await expect(item(l.page, NAMES[0])).toBeVisible();
  return l;
}
const nav = (page: Page) => page.getByRole('navigation', { name: 'Сессии' });
const item = (page: Page, name: string) => nav(page).getByRole('button', { name: new RegExp(`^${name}\\b`) });
// Строки других страниц тоже в DOM (скрыты) — только видимые
const order = (page: Page) => nav(page).locator('.session-name:visible').allTextContents();
const menuItem = (page: Page, name: string) => page.getByRole('menuitem', { name });

test('закрепить через ПКМ: булавка и место наверху', async () => {
  const { app, page } = await open();
  try {
    await item(page, 'cvg-test-d').click({ button: 'right' });
    await menuItem(page, 'Закрепить').click();
    await expect.poll(() => order(page)).toEqual(['cvg-test-d', 'cvg-test-a', 'cvg-test-b', 'cvg-test-c']);
    await expect(item(page, 'cvg-test-d').getByRole('img', { name: 'Закреплена' })).toBeVisible();
    await expect(nav(page).getByText('Закреплённые')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('новая группа из меню, сворачивание и счётчик', async () => {
  const { app, page } = await open();
  try {
    await item(page, 'cvg-test-b').click({ button: 'right' });
    await menuItem(page, 'Переместить в группу').click();
    await menuItem(page, 'Новая группа…').click();
    const dialog = page.getByRole('dialog', { name: 'Новая группа' });
    await dialog.getByLabel('Название группы').fill('Работа');
    await dialog.getByRole('button', { name: 'Создать' }).click();
    const header = nav(page).getByRole('button', { name: /^Группа Работа/ });
    await expect(header).toHaveAttribute('aria-expanded', 'true');
    await expect(header).toContainText('1');
    await header.click();
    await expect(header).toHaveAttribute('aria-expanded', 'false');
    await expect(item(page, 'cvg-test-b')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('перетаскивание меняет порядок и переживает перезапуск', async () => {
  let l = await open();
  try {
    await item(l.page, 'cvg-test-c').dragTo(item(l.page, 'cvg-test-a'), { targetPosition: { x: 20, y: 4 } });
    await expect.poll(() => order(l.page)).toEqual(['cvg-test-c', 'cvg-test-a', 'cvg-test-b', 'cvg-test-d']);
  } finally {
    await l.app.close();
  }
  l = await open();
  try {
    await expect.poll(() => order(l.page)).toEqual(['cvg-test-c', 'cvg-test-a', 'cvg-test-b', 'cvg-test-d']);
  } finally {
    await l.app.close();
  }
});

test('закреплённую нельзя перетащить ниже незакреплённых', async () => {
  const { app, page } = await open();
  try {
    await item(page, 'cvg-test-a').click({ button: 'right' });
    await menuItem(page, 'Закрепить').click();
    await item(page, 'cvg-test-a').dragTo(item(page, 'cvg-test-d'), { targetPosition: { x: 20, y: 40 } });
    await expect.poll(() => order(page)).toEqual(['cvg-test-a', 'cvg-test-b', 'cvg-test-c', 'cvg-test-d']);
  } finally {
    await app.close();
  }
});

test('удаление группы оставляет сессии', async () => {
  const { app, page } = await open();
  try {
    await item(page, 'cvg-test-c').click({ button: 'right' });
    await menuItem(page, 'Переместить в группу').click();
    await menuItem(page, 'Новая группа…').click();
    await page.getByRole('dialog', { name: 'Новая группа' }).getByLabel('Название группы').fill('Игры');
    await page.getByRole('dialog', { name: 'Новая группа' }).getByRole('button', { name: 'Создать' }).click();
    await nav(page).getByRole('button', { name: /^Группа Игры/ }).click({ button: 'right' });
    await menuItem(page, 'Удалить группу').click();
    await page.getByRole('dialog', { name: 'Удалить группу Игры?' }).getByRole('button', { name: 'Удалить' }).click();
    await expect(nav(page).getByRole('button', { name: /^Группа Игры/ })).toHaveCount(0);
    await expect.poll(async () => (await order(page)).sort()).toEqual([...NAMES].sort());
  } finally {
    await app.close();
  }
});

test('страницы: маленькое окно → пейджер, переход на страницу 2', async () => {
  for (let i = 0; i < 10; i++) tmux('new-session', '-d', '-s', `cvg-test-z${i}`);
  const { app, page } = await open();
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 600));
    await expect(nav(page).getByText(/^1 \/ \d$/)).toBeVisible();
    const first = await order(page);
    await nav(page).getByRole('button', { name: 'Следующая страница' }).click();
    await expect(nav(page).getByText(/^2 \/ \d$/)).toBeVisible();
    const second = await order(page);
    expect(second.length).toBeGreaterThan(0);
    expect(second.some((n) => first.includes(n))).toBe(false);
  } finally {
    await app.close();
  }
});

test('Alt+↓ переставляет сессию в фокусе', async () => {
  const { app, page } = await open();
  try {
    await item(page, 'cvg-test-a').focus();
    await page.keyboard.press('Alt+ArrowDown');
    await expect.poll(() => order(page)).toEqual(['cvg-test-b', 'cvg-test-a', 'cvg-test-c', 'cvg-test-d']);
    await expect(item(page, 'cvg-test-a')).toBeFocused();
  } finally {
    await app.close();
  }
});

test('Shift+F10 открывает меню сессии, Esc закрывает', async () => {
  const { app, page } = await open();
  try {
    await item(page, 'cvg-test-b').focus();
    await page.keyboard.press('Shift+F10');
    await expect(page.getByRole('menu', { name: 'Действия с сессией cvg-test-b' })).toBeVisible();
    await expect(menuItem(page, 'Закрепить')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('раскладка переживает два перезапуска без изменений', async () => {
  let l = await open();
  try {
    await item(l.page, 'cvg-test-d').click({ button: 'right' });
    await menuItem(l.page, 'Закрепить').click();
    await expect.poll(() => order(l.page)).toEqual(['cvg-test-d', 'cvg-test-a', 'cvg-test-b', 'cvg-test-c']);
  } finally {
    await l.app.close();
  }
  for (let i = 0; i < 2; i++) {
    l = await open();
    try {
      await expect.poll(() => order(l.page)).toEqual(['cvg-test-d', 'cvg-test-a', 'cvg-test-b', 'cvg-test-c']);
      await l.page.waitForTimeout(1500);
    } finally {
      await l.app.close();
    }
  }
});

test('новая сессия из меню группы попадает в группу', async () => {
  const { app, page } = await open();
  try {
    await item(page, 'cvg-test-a').click({ button: 'right' });
    await menuItem(page, 'Переместить в группу').click();
    await menuItem(page, 'Новая группа…').click();
    await page.getByRole('dialog', { name: 'Новая группа' }).getByLabel('Название группы').fill('Работа');
    await page.getByRole('dialog', { name: 'Новая группа' }).getByRole('button', { name: 'Создать' }).click();
    await nav(page).getByRole('button', { name: /^Группа Работа/ }).click({ button: 'right' });
    await menuItem(page, 'Новая сессия…').click();
    const dialog = page.getByRole('dialog', { name: 'Новая сессия' });
    await dialog.getByLabel('Имя сессии tmux').fill('cvg-test-ing');
    await dialog.getByLabel('Сразу запустить claude').uncheck();
    await dialog.getByRole('button', { name: 'Создать' }).click();
    await expect(nav(page).locator('li.in-group', { hasText: 'cvg-test-ing' })).toBeVisible({ timeout: 10_000 });
    await expect(nav(page).getByRole('button', { name: /^Группа Работа/ })).toContainText('2');
  } finally {
    await app.close();
  }
});

test('ПКМ по пустому месту списка: новая группа', async () => {
  const { app, page } = await open();
  try {
    const box = nav(page).locator('.session-box');
    const b = (await box.boundingBox())!;
    await box.click({ button: 'right', position: { x: b.width / 2, y: b.height - 20 } });
    await expect(page.getByRole('menu', { name: 'Список сессий' })).toBeVisible();
    await expect(menuItem(page, 'Новая сессия…')).toBeVisible();
    await menuItem(page, 'Новая группа…').click();
    await page.getByRole('dialog', { name: 'Новая группа' }).getByLabel('Название группы').fill('Пустая');
    await page.getByRole('dialog', { name: 'Новая группа' }).getByRole('button', { name: 'Создать' }).click();
    await expect(nav(page).getByRole('button', { name: /^Группа Пустая, сессий: 0/ })).toBeVisible();
  } finally {
    await app.close();
  }
});

test('новая сессия в свёрнутую группу: группа разворачивается, сессию видно', async () => {
  const { app, page } = await open();
  try {
    await item(page, 'cvg-test-a').click({ button: 'right' });
    await menuItem(page, 'Переместить в группу').click();
    await menuItem(page, 'Новая группа…').click();
    await page.getByRole('dialog', { name: 'Новая группа' }).getByLabel('Название группы').fill('Свёрнутая');
    await page.getByRole('dialog', { name: 'Новая группа' }).getByRole('button', { name: 'Создать' }).click();
    const group = nav(page).getByRole('button', { name: /^Группа Свёрнутая/ });
    await group.click({ button: 'right' });
    await menuItem(page, 'Свернуть').click();
    await expect(group).toHaveAttribute('aria-expanded', 'false');
    await group.click({ button: 'right' });
    await menuItem(page, 'Новая сессия…').click();
    const dialog = page.getByRole('dialog', { name: 'Новая сессия' });
    await dialog.getByLabel('Имя сессии tmux').fill('cvg-test-fold');
    await dialog.getByLabel('Сразу запустить claude').uncheck();
    await dialog.getByRole('button', { name: 'Создать' }).click();
    await expect(group).toHaveAttribute('aria-expanded', 'true', { timeout: 10_000 });
    await expect(nav(page).locator('li.in-group', { hasText: 'cvg-test-fold' })).toBeVisible();
  } finally {
    await app.close();
  }
});

test('ПКМ по затемнённому фону диалога не открывает меню списка', async () => {
  const { app, page } = await open();
  try {
    const box = nav(page).locator('.session-box');
    const b = (await box.boundingBox())!;
    await box.click({ button: 'right', position: { x: b.width / 2, y: b.height - 20 } });
    await menuItem(page, 'Новая группа…').click();
    await expect(page.getByRole('dialog', { name: 'Новая группа' })).toBeVisible();
    await page.mouse.click(8, 8, { button: 'right' });
    await expect(page.getByRole('menu', { name: 'Список сессий' })).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Новая группа' })).toBeVisible();
  } finally {
    await app.close();
  }
});

test('меню пустого места с клавиатуры: Tab до списка и Shift+F10', async () => {
  const { app, page } = await open();
  try {
    const box = nav(page).locator('.session-box');
    for (let i = 0; i < 30; i++) {
      if (await box.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press('Tab');
    }
    await expect(box).toBeFocused();
    await page.keyboard.press('Shift+F10');
    await expect(page.getByRole('menu', { name: 'Список сессий' })).toBeVisible();
    await expect(menuItem(page, 'Новая группа…')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('перетаскивание с перелистыванием: отпустили мимо строк — линии вставки не остаётся', async () => {
  for (let i = 0; i < 10; i++) tmux('new-session', '-d', '-s', `cvg-test-z${i}`);
  const { app, page } = await open();
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 600));
    await expect(nav(page).getByText(/^1 \/ \d$/)).toBeVisible();
    const src = nav(page).locator('.session-item:visible').first();
    const s = (await src.boundingBox())!;
    await page.mouse.move(s.x + 20, s.y + 10);
    await page.mouse.down();
    await page.mouse.move(s.x + 30, s.y + 20, { steps: 5 });
    const next = (await nav(page).getByRole('button', { name: 'Следующая страница' }).boundingBox())!;
    await page.mouse.move(next.x + next.width / 2, next.y + next.height / 2, { steps: 10 });
    await expect(nav(page).getByText(/^2 \/ \d$/)).toBeVisible({ timeout: 3000 });
    const row = (await nav(page).locator('.session-item:visible').first().boundingBox())!;
    await page.mouse.move(row.x + 20, row.y + 4, { steps: 10 });
    await expect(nav(page).locator('.drop-before, .drop-after')).toHaveCount(1);
    const label = (await nav(page).getByText(/^2 \/ \d$/).boundingBox())!;
    await page.mouse.move(label.x + 2, label.y + 2, { steps: 10 });
    await page.mouse.up();
    await expect(nav(page).locator('.drop-before, .drop-after')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('перетаскивание на другую страницу переносит сессию', async () => {
  for (let i = 0; i < 10; i++) tmux('new-session', '-d', '-s', `cvg-test-z${i}`);
  const { app, page } = await open();
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 600));
    await expect(nav(page).getByText(/^1 \/ \d$/)).toBeVisible();
    const name = (await order(page))[0];
    const s = (await nav(page).locator('.session-item:visible').first().boundingBox())!;
    await page.mouse.move(s.x + 20, s.y + 10);
    await page.mouse.down();
    await page.mouse.move(s.x + 30, s.y + 20, { steps: 5 });
    const next = (await nav(page).getByRole('button', { name: 'Следующая страница' }).boundingBox())!;
    await page.mouse.move(next.x + next.width / 2, next.y + next.height / 2, { steps: 10 });
    await expect(nav(page).getByText(/^2 \/ \d$/)).toBeVisible({ timeout: 3000 });
    const row = (await nav(page).locator('.session-item:visible').nth(1).boundingBox())!;
    await page.mouse.move(row.x + 20, row.y + 40, { steps: 10 });
    await page.mouse.up();
    await expect(nav(page).locator('.drop-before, .drop-after')).toHaveCount(0);
    await expect.poll(() => order(page)).toContain(name);
  } finally {
    await app.close();
  }
});

test('«q у р» не обрезаются в строке сессии', async () => {
  // Высота строки текста не зависит от шрифта (normal у Segoe UI и Roboto выше, чем у шрифтов Linux),
  // хвосты букв помещаются в строку (≥ 1,3 кегля), всё вместе — в строку сессии
  execFileSync('mkdir', ['-p', '/tmp/qypдру']);
  tmux('new-session', '-d', '-s', 'cvg-test-qyp', '-c', '/tmp/qypдру');
  const { app, page } = await open();
  try {
    const row = item(page, 'cvg-test-qyp');
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row.locator('.session-cwd')).toContainText('qyp');
    const m = await row.evaluate((el) => {
      const cs = getComputedStyle(el);
      const inner = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      const parts = Array.from(el.querySelectorAll<HTMLElement>('.session-name, .session-cwd')).map((p) => {
        const s = getComputedStyle(p);
        return { lh: s.lineHeight, font: parseFloat(s.fontSize) };
      });
      return { inner, gap: parseFloat(cs.rowGap) || 0, parts };
    });
    let need = m.gap * (m.parts.length - 1);
    for (const p of m.parts) {
      expect(p.lh).not.toBe('normal');
      expect(parseFloat(p.lh)).toBeGreaterThanOrEqual(1.3 * p.font - 0.01);
      need += parseFloat(p.lh);
    }
    expect(need).toBeLessThanOrEqual(m.inner + 0.5);
  } finally {
    await app.close();
  }
});
