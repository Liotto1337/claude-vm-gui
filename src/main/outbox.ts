import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, dialog, shell } from 'electron';

// Файлы outbox на этом компьютере: куда сохранить, где открыть HTML. В E2E (CVG_TEST_HOOKS) открытие
// и «Показать в папке» только запоминаются, диалог сохранения заменяет папка CVG_TEST_SAVE_DIR.

const tempRoot = () => join(app.getPath('temp'), 'claude-vm-gui');
const remember = (key: string, value: string) => {
  const g = globalThis as unknown as { __cvg?: Record<string, unknown> };
  g.__cvg = Object.assign(g.__cvg ?? {}, { [key]: value });
};
const testing = () => process.env.CVG_TEST_HOOKS === '1';

/** Куда сохранить файл: диалог «Сохранить как» в «Загрузках»; null — отменили. */
export async function chooseSaveDest(name: string): Promise<string | null> {
  const testDir = process.env.CVG_TEST_SAVE_DIR;
  if (testing() && testDir) return join(testDir, name);
  const opts = { defaultPath: join(app.getPath('downloads'), name) };
  const win = BrowserWindow.getFocusedWindow();
  const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
  return r.canceled || !r.filePath ? null : r.filePath;
}

/** Временный путь для страницы, которую откроет браузер (своя папка на каждое открытие — имена не сталкиваются). */
export function tempDest(name: string): string {
  const dir = join(tempRoot(), randomUUID());
  mkdirSync(dir, { recursive: true });
  return join(dir, name);
}

export async function openLocal(path: string): Promise<string> {
  if (testing()) return remember('lastOpened', path), '';
  return shell.openPath(path);
}

export function revealLocal(path: string): void {
  if (testing()) return remember('lastRevealed', path);
  shell.showItemInFolder(path);
}

/** Временные страницы удаляются при выходе. */
export function cleanTemp(): void {
  rmSync(tempRoot(), { recursive: true, force: true });
}
