import { describe, expect, it } from 'vitest';
import { passwordToSave } from '../../src/renderer/settings-password';

// undefined — не трогать сохранённый пароль, null — удалить, строка — сохранить новый
describe('passwordToSave', () => {
  it('сохранён и не меняется — не трогать', () => expect(passwordToSave('saved', '', false)).toBeUndefined());
  it('новый пароль — сохранить', () => expect(passwordToSave('edit', 'pw', false)).toBe('pw'));
  it('поле пустое — не трогать (нечего менять)', () => expect(passwordToSave('edit', '', false)).toBeUndefined());
  it('«Удалить пароль» — удалить', () => expect(passwordToSave('deleted', '', false)).toBeNull());
  it('нерасшифрованный и поле пустое — удалить: им всё равно не войти', () => expect(passwordToSave('edit', '', true)).toBeNull());
  it('нерасшифрованный и введён новый — сохранить новый', () => expect(passwordToSave('edit', 'pw', true)).toBe('pw'));
});
