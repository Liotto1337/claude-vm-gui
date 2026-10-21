import { describe, expect, it } from 'vitest';
import { plural } from '../../src/shared/plural';

describe('plural', () => {
  const cores = (n: number) => plural(n, 'ядро', 'ядра', 'ядер');
  it('1, 21, 101 — «ядро»', () => expect([1, 21, 101].map(cores)).toEqual(['ядро', 'ядро', 'ядро']));
  it('2–4, 22–24 — «ядра»', () => expect([2, 4, 22, 24].map(cores)).toEqual(['ядра', 'ядра', 'ядра', 'ядра']));
  it('5–20, 25, 111–114 — «ядер»', () =>
    expect([5, 11, 12, 14, 20, 25, 111, 112, 114].map(cores)).toEqual(Array(9).fill('ядер')));
  it('0 — «ядер»', () => expect(cores(0)).toBe('ядер'));
});
