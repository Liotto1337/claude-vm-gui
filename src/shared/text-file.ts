// Какие вложения показывать текстом в ленте.

export const TEXT_PREVIEW_BYTES = 256 * 1024;

const TEXT_EXT = new Set(
  'txt md json yaml yml toml ini csv tsv log xml html css js jsx ts tsx py rb go rs java kt c h cpp hpp cs sh bash zsh ps1 sql env conf cfg'.split(' '),
);

/** Текстовый по расширению; файл без расширения (Makefile, .env) — тоже. */
export function isTextName(name: string): boolean {
  const base = name.slice(name.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return true;
  return TEXT_EXT.has(base.slice(dot + 1).toLowerCase());
}

/** Нулевой байт в первых 8 КБ — двоичные данные, текстом не показываем. */
export const looksBinary = (head: Uint8Array): boolean => head.subarray(0, 8192).includes(0);
