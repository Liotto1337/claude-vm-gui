import { app, BrowserWindow, safeStorage, session, shell } from 'electron';
import { join } from 'node:path';
import { AppController } from './controller';
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
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] } });
  });
  const hub = new IpcHub({ userDataDir: app.getPath('userData'), repoDir: repoDirForDev() });
  hub.registerBase();
  const controller = new AppController(hub);
  controller.register();
  hub.attach(createWindow());
  app.on('before-quit', () => controller.disconnect());
  if (process.env.CVG_TEST_HOOKS === '1') {
    (globalThis as unknown as { __cvg: object }).__cvg = { dropConnection: () => controller.simulateDrop() };
    // E2E на Linux без хранилища ключей: шифрование «для вида», чтобы проверить сохранение пароля
    if (process.platform === 'linux') safeStorage.setUsePlainTextEncryption(true);
  }
});

app.on('window-all-closed', () => app.quit());
