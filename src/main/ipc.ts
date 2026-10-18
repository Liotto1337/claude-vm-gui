import { app, ipcMain, nativeTheme, type BrowserWindow } from 'electron';
import { fail, type Result, type VmConfig } from '@shared/ipc';
import { loadConfig, saveConfig } from './config';

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

  registerBase(): void {
    this.handle('config:get', () => this.config());
    this.handle('config:save', (c: VmConfig): Result<void> => saveConfig(this.paths.userDataDir, c));
    this.handle('platform:theme', () => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light'));
    nativeTheme.on('updated', () => this.emit('platform:themeChange', nativeTheme.shouldUseDarkColors ? 'dark' : 'light'));

    // Заглушки до подключения сервисов (задачи 5–7)
    const notConnected = () => fail('NOT_CONNECTED', 'Нет подключения к ВМ');
    for (const ch of [
      'connection:connect', 'tmux:list', 'tmux:create', 'tmux:kill', 'tmux:startClaude', 'term:open', 'term:send',
      'term:setModel', 'term:setEffort', 'hints:get', 'hints:files', 'hints:dirs', 'upload:image',
    ]) this.handle(ch, notConnected);
    this.handle('connection:disconnect', () => undefined);
  }
}

export function repoDirForDev(): string | undefined {
  return app.isPackaged ? undefined : app.getAppPath();
}
