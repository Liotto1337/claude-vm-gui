import { _electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface Launched { app: ElectronApplication; page: Page; userData: string }

/** Запускает собранное приложение (out/) с отдельной папкой настроек. */
export async function launchApp(env: Record<string, string> = {}): Promise<Launched> {
  const userData = env.CVG_USER_DATA ?? mkdtempSync(join(tmpdir(), 'cvg-e2e-'));
  const args = ['out/main/index.js'];
  // Под root Chromium без --no-sandbox не стартует; webPreferences.sandbox от этого не меняется
  if (process.platform === 'linux' && process.getuid?.() === 0) args.push('--no-sandbox');
  const app = await _electron.launch({
    args,
    env: { ...process.env, CVG_USER_DATA: userData, ...env } as Record<string, string>,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page, userData };
}
