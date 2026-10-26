import { rmSync } from 'node:fs';

type Rm = (path: string, opts: { recursive: true; force: true; maxRetries: number }) => void;

/**
 * Удалить папку и не упасть: на Windows антивирус ненадолго держит свежие файлы (EBUSY, EPERM), а выход
 * приложения из-за этого не должен показывать ошибку main. Не удалилось — удалится при следующем запуске.
 */
export function removeQuietly(path: string, rm: Rm = rmSync): void {
  try {
    rm(path, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // следующая попытка — при запуске
  }
}
