import { describe, expect, it } from 'vitest';
import { isTextName, looksBinary, TEXT_PREVIEW_BYTES } from '../../src/shared/text-file';

describe('текстовые файлы', () => {
  it('по расширению и файлы без расширения', () => {
    for (const n of ['a.ts', 'b.MD', 'c.json', 'd.log', 'e.yaml', 'f.ps1', 'Makefile', '.env', 'x.tar.txt']) expect(isTextName(n)).toBe(true);
    for (const n of ['a.pdf', 'b.zip', 'c.png', 'd.exe', 'e.docx']) expect(isTextName(n)).toBe(false);
  });
  it('нулевой байт в начале — двоичный', () => {
    expect(looksBinary(new Uint8Array([0x50, 0x00]))).toBe(true);
    expect(looksBinary(new TextEncoder().encode('привет'))).toBe(false);
    const late = new Uint8Array(9000).fill(0x41);
    late[8500] = 0;
    expect(looksBinary(late)).toBe(false);
  });
  it('превью — 256 КБ', () => expect(TEXT_PREVIEW_BYTES).toBe(256 * 1024));
});
