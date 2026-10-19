import { app, clipboard, ipcMain, nativeTheme, safeStorage, type BrowserWindow } from 'electron';
import type { Result, VmConfig } from '@shared/ipc';
import { loadConfig, loadPassword, saveConfig, type SecretBox } from './config';

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

  constructor(private readonly paths: { userDataDir: string; repoDir?: string }) {}

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
    return loadConfig(this.paths);
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
