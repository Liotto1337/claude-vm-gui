import { app, BrowserWindow, safeStorage, session, shell } from 'electron';
import { join } from 'node:path';
import { AppController } from './controller';
import { cleanTemp } from './outbox';
import { startUpdates } from './updates';
import { IpcHub, repoDirForDev } from './ipc';

const CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:";

// Тесты задают отдельную папку настроек, чтобы не трогать настоящую
if (process.env.CVG_USER_DATA) app.setPath('userData', process.env.CVG_USER_DATA);

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Claude VM',
    backgroundColor: '#FAF9F5',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  win.once('ready-to-show', () => win.show());
  // Никаких переходов и новых окон: внешние https-ссылки открываются в браузере
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  // CVG_DEMO_HOST — показывать этот адрес вместо настоящего (скриншоты для документации)
  const query: Record<string, string> = process.env.CVG_DEMO_HOST ? { demoHost: process.env.CVG_DEMO_HOST } : {};
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}?${new URLSearchParams(query)}`);
  else void win.loadFile(join(__dirname, '../renderer/index.html'), { query });
  return win;
}

app.whenReady().then(() => {
  cleanTemp();
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] } });
  });
  const hub = new IpcHub({ userDataDir: app.getPath('userData'), repoDir: repoDirForDev() });
  hub.registerBase();
  const controller = new AppController(hub);
  controller.register();
  const win = createWindow();
  hub.attach(win);
  // Вернулись в окно (с телефона или из другой программы) — tmux подстраивает окно под этот экран
  win.on('focus', () => controller.activate());
  win.on('restore', () => controller.activate());
  win.on('show', () => controller.activate());
  const updates = startUpdates(hub, app.getPath('userData'));
  app.on('before-quit', () => {
    hub.layouts.flush();
    updates.stop();
    controller.disconnect();
    cleanTemp();
  });
  if (process.env.CVG_TEST_HOOKS === '1') {
    const g = globalThis as unknown as { __cvg?: object };
    g.__cvg = Object.assign(g.__cvg ?? {}, {
      dropConnection: () => controller.simulateDrop(),
      // Лимиты подписки в E2E не запросить (нужен настоящий токен) — замер подставляется
      emitUsage: (u: unknown) => hub.emit('usage:sample', u),
    });
    // E2E на Linux без хранилища ключей: шифрование «для вида», чтобы проверить сохранение пароля
    if (process.platform === 'linux') safeStorage.setUsePlainTextEncryption(true);
  }
});

app.on('window-all-closed', () => app.quit());
