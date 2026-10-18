import { _electron, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export const TEST_KEY = join(homedir(), '.ssh', 'cvg_test_ed25519');
export const hasTestKey = existsSync(TEST_KEY);

/** Папка настроек приложения с готовым config.json. */
export function withConfig(cfg: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'cvg-e2e-'));
  writeFileSync(join(dir, 'config.json'), JSON.stringify(cfg));
  return dir;
}

export const tempKnownHostsPath = () => join(mkdtempSync(join(tmpdir(), 'cvg-kh-')), 'known_hosts');

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
