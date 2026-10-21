/** Режим поля пароля в настройках: 'saved' — сохранён и не меняется, 'edit' — вводится новый, 'deleted' — удалить. */
export type PasswordMode = 'saved' | 'edit' | 'deleted';

/**
 * Что сохранить вместо пароля: undefined — не трогать, null — удалить, строка — новый.
 * Нерасшифрованный пароль (другая учётная запись Windows) с пустым полем удаляется: войти им всё равно нельзя,
 * а оставшись, он навсегда держал бы предупреждение и считался бы заменой ключа.
 */
export function passwordToSave(mode: PasswordMode, password: string, unreadable: boolean): string | null | undefined {
  if (mode === 'saved') return undefined;
  if (password !== '') return password;
  return mode === 'deleted' || unreadable ? null : undefined;
}
