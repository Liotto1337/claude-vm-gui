import { app, clipboard, ipcMain, nativeTheme, safeStorage, shell, type BrowserWindow } from 'electron';
import type { Result, SidebarLayout, VmConfig } from '@shared/ipc';
import { externalUrl } from '@shared/links';
import { loadConfig, loadPassword, saveConfig, type SecretBox } from './config';
import { LayoutStore } from './layout-store';

/** Пароль шифруется средствами ОС (DPAPI на Windows). */
const safeBox: SecretBox = {
  available: () => safeStorage.isEncryptionAvailable(),
  encrypt: (s) => safeStorage.encryptString(s),
  decrypt: (b) => safeStorage.decryptString(b),
};

type Handler = (...args: never[]) => unknown;

/** Связка window.api ↔ сервисы main. Каналы: «группа:метод», события: «группа:событие». */
export class IpcHub {
  private win: BrowserWindow | null = null;
  readonly layouts: LayoutStore;

  constructor(private readonly paths: { userDataDir: string; repoDir?: string }) {
    this.layouts = new LayoutStore(paths.userDataDir);
  }

  attach(win: BrowserWindow): void {
    this.win = win;
  }

  emit(channel: string, payload: unknown): void {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(channel, payload);
  }

  handle(channel: string, fn: Handler): void {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, (_e, ...args) => (fn as (...a: unknown[]) => unknown)(...args));
  }

  listen(channel: string, fn: Handler): void {
    ipcMain.removeAllListeners(channel);
    ipcMain.on(channel, (_e, ...args) => (fn as (...a: unknown[]) => unknown)(...args));
  }

  config(): VmConfig | null {
    return loadConfig(this.paths, safeBox);
  }

  /** Сохранённый пароль — только для SSH в главном процессе, в интерфейс не уходит. */
  password(): string | undefined {
    return loadPassword(this.paths.userDataDir, safeBox) ?? undefined;
  }

  registerBase(): void {
    this.handle('config:get', () => this.config());
    this.handle('config:save', (c: VmConfig, password?: string | null): Result<void> =>
      saveConfig(this.paths.userDataDir, c, typeof password === 'string' || password === null ? password : undefined, safeBox),
    );
    // Ссылки из ленты — только http(s), в браузере; в E2E (CVG_TEST_HOOKS) только запоминаются
    this.listen('links:open', (raw: unknown) => {
      const url = externalUrl(raw);
      if (!url) return;
      if (process.env.CVG_TEST_HOOKS === '1') {
        const g = globalThis as unknown as { __cvg?: Record<string, unknown> };
        g.__cvg = Object.assign(g.__cvg ?? {}, { lastLink: url });
      } else void shell.openExternal(url);
    });
    // Раскладка сайдбара — отдельно для каждой ВМ
    this.handle('layout:get', () => this.layouts.get(this.config()?.host ?? ''));
    this.handle('layout:save', (l: SidebarLayout) => this.layouts.save(this.config()?.host ?? '', l));
    this.handle('platform:theme', () => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light'));
    nativeTheme.on('updated', () => this.emit('platform:themeChange', nativeTheme.shouldUseDarkColors ? 'dark' : 'light'));
    // Буфер обмена Windows через main: navigator.clipboard в renderer не пишет, пока окно не в фокусе
    this.handle('clipboard:read', () => clipboard.readText());
    this.listen('clipboard:write', (text: string) => {
      if (typeof text === 'string' && text) clipboard.writeText(text);
    });
  }
}

export function repoDirForDev(): string | undefined {
  // В тестах (своя папка настроек) vm.config.json из репозитория не читаем
  return app.isPackaged || process.env.CVG_USER_DATA ? undefined : app.getAppPath();
}
