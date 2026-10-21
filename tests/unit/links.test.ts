import { describe, expect, it } from 'vitest';
import { externalUrl } from '../../src/shared/links';

describe('externalUrl', () => {
  it('http и https — да, нормализованные', () => {
    expect(externalUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(externalUrl('HTTP://Example.com')).toBe('http://example.com/');
  });
  it('другие схемы — нет', () => {
    for (const u of ['file:///etc/passwd', 'javascript:alert(1)', 'ms-settings:', 'vscode://x', 'smb://host/share']) expect(externalUrl(u)).toBeNull();
  });
  it('мусор и не строки — нет', () => {
    for (const u of ['', 'https://', 'http//x', ' https://x', 42, null, { toString: () => 'https://x' }]) expect(externalUrl(u)).toBeNull();
  });
  it('без логина и пароля в адресе', () => expect(externalUrl('https://user:pw@example.com/')).toBeNull());
});
