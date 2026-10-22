import { describe, expect, it } from 'vitest';
import { newerVersion, parseRelease } from '../../src/shared/version';

describe('newerVersion', () => {
  it('сравнивает три числа, «v» в теге не мешает', () => {
    expect(newerVersion('v0.3.1', '0.3.0')).toBe(true);
    expect(newerVersion('0.3.0', '0.3.0')).toBe(false);
    expect(newerVersion('0.10.0', '0.9.9')).toBe(true);
    expect(newerVersion('v0.2.9', '0.3.0')).toBe(false);
    expect(newerVersion('1.0.0', '0.99.99')).toBe(true);
  });
  it('неразборчивая версия — не новее', () => {
    expect(newerVersion('latest', '0.3.0')).toBe(false);
    expect(newerVersion('0.3', '0.2.0')).toBe(false);
    expect(newerVersion('0.4.0-beta.1', '0.3.0')).toBe(false);
    expect(newerVersion('0.4.0', 'dev')).toBe(false);
  });
});

describe('parseRelease', () => {
  const url = 'https://github.com/Liotto1337/claude-vm-gui/releases/tag/v0.3.1';
  it('версия и ссылка на страницу релиза', () =>
    expect(parseRelease({ tag_name: 'v0.3.1', html_url: url })).toEqual({ version: '0.3.1', url }));
  it('чужая или не https ссылка, нет полей — null', () => {
    expect(parseRelease({ tag_name: 'v0.3.1', html_url: 'https://evil.example/Liotto1337' })).toBeNull();
    expect(parseRelease({ tag_name: 'v0.3.1', html_url: 'http://github.com/Liotto1337/claude-vm-gui' })).toBeNull();
    expect(parseRelease({ tag_name: 'v0.3.1', html_url: 'https://github.com/Liotto1337.evil/x' })).toBeNull();
    expect(parseRelease({ html_url: url })).toBeNull();
    expect(parseRelease(null)).toBeNull();
    expect(parseRelease('строка')).toBeNull();
  });
});
