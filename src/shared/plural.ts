/** Русское склонение после числа: 1 сессия, 2 сессии, 5 сессий (21 — «сессия», 11–14 — «сессий»). */
export function plural(n: number, one: string, few: string, many: string): string {
  const n10 = n % 10;
  const n100 = n % 100;
  return n10 === 1 && n100 !== 11 ? one : n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14) ? few : many;
}
