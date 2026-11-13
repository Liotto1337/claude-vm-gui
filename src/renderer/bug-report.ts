import type { AppState } from './state';
import { readDeviceInfo } from './bug-report-device';

declare const __APP_VERSION__: string;
declare const __BUG_REPORT_ORIGIN__: string;

export const REPORT_RECIPIENT = 'egorstep.0801@gmail.com';
export const IMAGE_TYPES = 'image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif';
export const MAX_IMAGES = 5;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export async function validateImages(files: File[]): Promise<void> {
  if (files.length > MAX_IMAGES || files.reduce((bytes, file) => bytes + file.size, 0) > MAX_IMAGE_BYTES) {
    throw new Error('Можно прикрепить до 5 изображений общим размером до 10 МБ.');
  }
  for (const file of files) {
    if (!IMAGE_TYPES.split(',').includes(file.type)) {
      throw new Error('Выберите изображение PNG, JPG, WebP, GIF, BMP или AVIF.');
    }
    try {
      const image = await createImageBitmap(file);
      const tooLarge = image.width * image.height > 20_000_000;
      image.close();
      if (tooLarge) throw new Error('image dimensions too large');
    } catch {
      throw new Error('Один из файлов повреждён или имеет слишком большое разрешение.');
    }
  }
}

async function readDiagnostics(state: AppState) {
  const reportedAt = new Date().toISOString();
  const device = await readDeviceInfo().catch(() => ({}));
  return {
    ...device,
    reportedAt,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    appVersion: __APP_VERSION__,
    locale: navigator.language,
    viewport: `${window.innerWidth}×${window.innerHeight}`,
    theme: state.theme,
    screen: state.view,
    connection: state.connection.state,
    connectionError: state.connectError?.code,
    connectionChecks: Object.fromEntries(Object.entries(state.preflight).map(([step, check]) => [step, check.status])),
    claudeVersion: state.systemInfo?.claudeVersion ?? undefined,
  };
}

function attachment(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.onerror = () => reject(new Error('Не удалось прочитать вложение. Выберите файл ещё раз.'));
    reader.readAsDataURL(file);
  });
}

export async function sendBugReport(
  title: string, description: string, files: File[], diagnosticState: AppState | null,
): Promise<void> {
  if (!__BUG_REPORT_ORIGIN__) throw new Error('Сервис отправки отчётов пока не настроен.');
  const diagnostics = diagnosticState ? await readDiagnostics(diagnosticState) : null;
  const images = await Promise.all(files.map(attachment));
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 40_000);
  const response = await fetch(`${__BUG_REPORT_ORIGIN__}/bug-reports`, {
    method: 'POST',
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, description, images, diagnostics }),
    signal: controller.signal,
  }).catch(() => {
    throw new Error('Сервис отправки недоступен. Проверьте интернет и попробуйте ещё раз.');
  }).finally(() => window.clearTimeout(timeout));
  if (response.status === 429) throw new Error('Слишком много отчётов. Попробуйте позже.');
  if (response.status === 400 || response.status === 413) {
    throw new Error('Сервис отклонил отчёт. Проверьте формат и размер вложений.');
  }
  if (response.status !== 204) throw new Error('Не удалось отправить отчёт. Попробуйте ещё раз.');
}
