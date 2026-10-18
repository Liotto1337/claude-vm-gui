import { expect, test } from '@playwright/test';
import { launchApp } from './helpers';

test('окно открывается с безопасными настройками', async () => {
  const { app, page } = await launchApp();
  try {
    await expect(page).toHaveTitle('Claude VM');
    const prefs = await app.evaluate(({ BrowserWindow }) => {
      // getLastWebPreferences есть в Electron, но не описан в типах
      const wc = BrowserWindow.getAllWindows()[0].webContents as unknown as { getLastWebPreferences(): Record<string, unknown> | null };
      const p = wc.getLastWebPreferences();
      return { contextIsolation: p?.contextIsolation, sandbox: p?.sandbox, nodeIntegration: p?.nodeIntegration };
    });
    expect(prefs).toEqual({ contextIsolation: true, sandbox: true, nodeIntegration: false });
    expect(await page.evaluate(() => typeof (globalThis as { require?: unknown }).require)).toBe('undefined');
    const opened = await page.evaluate(() => (globalThis as unknown as { open(u: string): unknown }).open('https://example.com') === null);
    expect(opened).toBe(true);
  } finally {
    await app.close();
  }
});
