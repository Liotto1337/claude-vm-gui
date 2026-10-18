import { describe, expect, it } from 'vitest';
import { findHostLeaks } from '../../scripts/check-no-host.mjs';

describe('findHostLeaks', () => {
  it('находит файл с адресом ВМ', () => {
    const files = [
      { path: 'a.md', content: Buffer.from('ssh root@10.1.2.3') },
      { path: 'b.md', content: Buffer.from('ok') },
    ];
    expect(findHostLeaks('10.1.2.3', files)).toEqual(['a.md']);
  });

  it('пустой хост ничего не находит', () => {
    expect(findHostLeaks('', [{ path: 'a.md', content: Buffer.from('anything') }])).toEqual([]);
  });

  it('находит адрес внутри бинарного файла', () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]), Buffer.from('10.1.2.3'), Buffer.from([0, 0xff])]);
    expect(findHostLeaks('10.1.2.3', [{ path: 'shot.png', content: png }])).toEqual(['shot.png']);
  });

  it('не путает похожий адрес', () => {
    expect(findHostLeaks('10.1.2.3', [{ path: 'a.md', content: Buffer.from('10.1.2.30') }])).toEqual([]);
  });
});
