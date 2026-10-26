import { describe, expect, it } from 'vitest';
import { removeQuietly } from '../../src/main/temp-clean';

describe('removeQuietly', () => {
  it('ошибка удаления (файл занят антивирусом) не выходит наружу', () => {
    const rm = () => {
      throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
    };
    expect(() => removeQuietly('/tmp/x', rm)).not.toThrow();
  });
  it('удаляет с повторами', () => {
    const calls: unknown[] = [];
    removeQuietly('/tmp/x', (p, o) => calls.push([p, o]));
    expect(calls).toEqual([['/tmp/x', { recursive: true, force: true, maxRetries: 3 }]]);
  });
});
