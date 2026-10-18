const DELAYS = [1000, 2000, 5000, 10000, 30000];

/** Пауза перед попыткой переподключения номер attempt (с 1): 1, 2, 5, 10, затем 30 с. */
export function backoffDelay(attempt: number): number {
  return DELAYS[Math.min(Math.max(attempt, 1), DELAYS.length) - 1];
}
