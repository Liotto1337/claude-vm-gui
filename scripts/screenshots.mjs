// Скриншоты для README. Запуск на ВМ с тестовым ключом:
//   npm run build && xvfb-run -a -s "-screen 0 1920x1080x24" node scripts/screenshots.mjs
// Сессии — на отдельном сервере tmux (CVG_TMUX_SOCKET), адрес ВМ подменён (CVG_DEMO_HOST),
// поэтому настоящие сессии и адрес в картинки не попадают.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron } from '@playwright/test';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'docs/screenshots');
const SOCKET = 'cvg-demo';
const KEY = join(homedir(), '.ssh/cvg_test_ed25519');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const tmux = (...args) => execFileSync('tmux', ['-L', SOCKET, ...args]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function setupDemo() {
  try {
    tmux('kill-server');
  } catch {
    // сервера не было
  }
  tmux('new-session', '-d', '-s', 'claude-gui', '-x', '120', '-y', '30', '-c', ROOT);
  tmux('send-keys', '-t', '=claude-gui:', 'clear; git log --oneline | head -12; cat', 'Enter');
  tmux('new-session', '-d', '-s', 'claude-site', '-c', '/tmp', 'cat');
  tmux('new-session', '-d', '-s', 'notes', '-c', homedir());
}

async function launch(cfg, extraEnv = {}) {
  const userData = mkdtempSync(join(tmpdir(), 'cvg-shots-'));
  writeFileSync(join(userData, 'config.json'), JSON.stringify(cfg));
  const kh = join(userData, 'known_hosts');
  writeFileSync(kh, execFileSync('ssh-keyscan', ['-t', 'ed25519', '127.0.0.1'], { stdio: ['ignore', 'pipe', 'ignore'] }));
  const app = await _electron.launch({
    args: ['out/main/index.js', ...(process.getuid?.() === 0 ? ['--no-sandbox'] : [])],
    cwd: ROOT,
    env: {
      ...process.env,
      CVG_USER_DATA: userData,
      CVG_KNOWN_HOSTS: kh,
      CVG_TMUX_SOCKET: SOCKET,
      CVG_DEMO_HOST: '203.0.113.10',
      CVG_FAKE_CLAUDE: '1',
      ...extraEnv,
    },
  });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 800));
  return { app, page };
}

const base = { host: '127.0.0.1', port: 22, username: 'root', keyPath: KEY };
const shot = (page, name) => page.screenshot({ path: join(OUT, name) });

async function mainScreens(theme) {
  const { app, page } = await launch({ ...base, theme });
  const nav = page.getByRole('navigation', { name: 'Сессии' });
  await nav.getByRole('button', { name: /claude-gui/ }).click({ timeout: 20_000 });
  await sleep(1500);
  const box = page.getByLabel('Сообщение для Claude');
  if (theme === 'light') {
    await box.fill('/m');
    await page.getByRole('listbox', { name: 'Подсказки' }).waitFor({ timeout: 30_000 });
    await sleep(300);
    await shot(page, '01-main-light.png');
    await box.fill('');
    await page.getByRole('button', { name: /^Модель/ }).click();
    await sleep(300);
    await shot(page, '05-model-menu.png');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Новая сессия' }).click();
    await page.getByLabel('Имя сессии tmux').fill('claude-docs');
    await sleep(300);
    await shot(page, '04-new-session.png');
  } else {
    await app.evaluate(async ({ clipboard, ClipboardItem }, b64) => {
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([Buffer.from(b64, 'base64')], { type: 'image/png' }) })]);
    }, PNG.toString('base64'));
    await box.focus();
    await page.keyboard.press('Control+V');
    await page.getByText('загружено').waitFor({ timeout: 15_000 });
    await box.type('Посмотри скриншот и @pack');
    await page.getByRole('listbox', { name: 'Подсказки' }).waitFor();
    await sleep(300);
    await shot(page, '03-main-dark.png');
  }
  await app.close();
}

async function connectScreen() {
  const { app, page } = await launch({ ...base, port: 1, theme: 'light' });
  await page.getByRole('button', { name: 'Повторить' }).waitFor({ timeout: 20_000 });
  await sleep(300);
  await shot(page, '02-connect.png');
  await app.close();
}

mkdirSync(OUT, { recursive: true });
setupDemo();
try {
  await mainScreens('light');
  await mainScreens('dark');
  await connectScreen();
  console.log(`Скриншоты сохранены в ${OUT}`);
} finally {
  tmux('kill-server');
  // Загруженную демо-картинку убираем
  execFileSync('sh', ['-c', 'find "$HOME/.cache/claude-vm-gui/uploads" -type f -mmin -10 -size -1024c -delete 2>/dev/null; true']);
}
