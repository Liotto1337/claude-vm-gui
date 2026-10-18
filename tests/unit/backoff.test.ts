import { expect, it } from 'vitest';
import { backoffDelay } from '../../src/shared/backoff';

it('паузы переподключения 1, 2, 5, 10, 30, 30… с', () => {
  expect([1, 2, 3, 4, 5, 6, 50].map(backoffDelay)).toEqual([1000, 2000, 5000, 10000, 30000, 30000, 30000]);
});
