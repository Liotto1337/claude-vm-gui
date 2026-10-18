import { expect, test } from '@playwright/test';
import { launchApp, withConfig } from './helpers';

// Запускается в GitHub Actions на windows-latest (и здесь, на Linux): приложение стартует,
// а вывод настоящего системного ping (cp866 на русской Windows) разбирается.
test('смоук: настройки без конфига, ping и TCP на живой системе', async () => {
  const first = await launchApp();
  try {
    await expect(first.page.getByRole('dialog', { name: 'Настройки подключения' })).toBeVisible();
  } finally {
    await first.app.close();
  }

  const userData = withConfig({ host: '127.0.0.1', port: 1, username: 'root', keyPath: '~/.ssh/id_ed25519', theme: 'system' });
  const { app, page } = await launchApp({ CVG_USER_DATA: userData });
  try {
    await expect(page.getByText(/2 из 2 ответов, в среднем \d+ мс/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Не удалось соединиться за 5 с. Проверьте интернет и что ВМ включена')).toBeVisible({ timeout: 20_000 });
  } finally {
    await app.close();
  }
});
