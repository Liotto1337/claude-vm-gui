import { describe, expect, it } from 'vitest';
import { displayName, isImageName, outboxPaths, remoteName } from '../../src/shared/upload-name';

const D = new Date(2026, 9, 22, 13, 5, 9);

describe('remoteName', () => {
  it('дата, случайная часть и исходное имя без пробелов и спецсимволов', () =>
    expect(remoteName(' отчёт (финал).PDF', D, 'a1b2c3')).toBe('20261022-130509-a1b2c3-_отчёт__финал_.PDF'));
  it('пустое имя — file', () => expect(remoteName('', D, 'a1b2c3')).toBe('20261022-130509-a1b2c3-file'));
  it('длинное имя — до 80 символов, расширение сохраняется', () => {
    const r = remoteName(`${'я'.repeat(200)}.txt`, D, 'a1b2c3');
    const name = r.slice('20261022-130509-a1b2c3-'.length);
    expect(name).toHaveLength(80);
    expect(name.endsWith('.txt')).toBe(true);
  });
  it('слеши и кавычки не проходят', () => expect(remoteName('../a"b\'c$d.sh', D, 'ffffff')).toBe('20261022-130509-ffffff-.._a_b_c_d.sh'));
});

describe('displayName и isImageName', () => {
  it('новое имя — исходное название', () => expect(displayName('20261022-130509-a1b2c3-x.log')).toBe('x.log'));
  it('старое имя без исходного — как есть', () => expect(displayName('20261021-215724-609469.png')).toBe('20261021-215724-609469.png'));
  it('полный путь — последняя часть', () => expect(displayName('/root/.cache/claude-vm-gui/uploads/20261022-130509-a1b2c3-a b.txt')).toBe('a b.txt'));
  it('картинки по расширению', () => {
    expect(isImageName('a.PNG')).toBe(true);
    expect(isImageName('a.jpeg')).toBe(true);
    expect(isImageName('a.webp')).toBe(true);
    expect(isImageName('a.svg')).toBe(false);
    expect(isImageName('png')).toBe(false);
  });
});

describe('outboxPaths', () => {
  const O = '/root/.cache/claude-vm-gui/outbox';
  it('путь в конце предложения — без точки', () => {
    expect(outboxPaths(`Скриншот: ${O}/a.png.`)).toEqual([`${O}/a.png`]);
  });
  it('кавычки, скобки и markdown-ссылка снимаются', () => {
    expect(outboxPaths(`\`${O}/a.txt\` "${O}/b.txt" (${O}/c.txt) <${O}/d.txt> [отчёт](${O}/r.html)`)).toEqual([
      `${O}/a.txt`, `${O}/b.txt`, `${O}/c.txt`, `${O}/d.txt`, `${O}/r.html`,
    ]);
  });
  it('пунктуация в конце, повтор — один раз, порядок появления', () => {
    expect(outboxPaths(`${O}/z.zip, ${O}/a.png; ${O}/z.zip! ${O}/q.pdf?`)).toEqual([`${O}/z.zip`, `${O}/a.png`, `${O}/q.pdf`]);
  });
  it('кириллица и вложенная папка', () => {
    expect(outboxPaths(`Готово: ${O}/2026/отчёт.html`)).toEqual([`${O}/2026/отчёт.html`]);
  });
  it('чужие папки и сама папка outbox — не файлы', () => {
    expect(outboxPaths(`/root/.cache/claude-vm-gui/uploads/x.png /tmp/a.png ${O}/ outbox/a.png`)).toEqual([]);
  });
});
