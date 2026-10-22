import { app, net } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { UpdateChecker } from '@shared/update-checker';
import type { IpcHub } from './ipc';

const REPO = 'Liotto1337/claude-vm-gui';
declare const __APP_VERSION__: string;

/** Проверка релизов GitHub; скрытая крестиком версия — в updates.json папки настроек. */
export function startUpdates(hub: IpcHub, userDataDir: string): UpdateChecker {
  // E2E подменяет адрес локальным сервером; в упакованном приложении — только GitHub
  const override = !app.isPackaged ? process.env.CVG_UPDATE_URL : undefined;
  const fetchJson = async (url: string) => {
    const r = await net.fetch(override ?? url, { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  };
  const file = join(userDataDir, 'updates.json');
  const checker = new UpdateChecker(REPO, __APP_VERSION__, fetchJson);
  checker.on('available', (u) => hub.emit('updates:available', u));
  hub.handle('updates:get', () => checker.latest);
  hub.handle('updates:dismissed', () => {
    try {
      const v = (JSON.parse(readFileSync(file, 'utf8')) as { dismissed?: unknown }).dismissed;
      return typeof v === 'string' ? v : null;
    } catch {
      return null;
    }
  });
  hub.handle('updates:dismiss', (version: string) => {
    if (typeof version === 'string') writeFileSync(file, JSON.stringify({ dismissed: version }));
  });
  checker.start();
  return checker;
}
