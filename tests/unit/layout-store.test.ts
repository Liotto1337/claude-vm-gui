import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LayoutStore } from '../../src/main/layout-store';
import type { SidebarLayout } from '../../src/shared/ipc';

const lay = (...names: string[]): SidebarLayout => ({ v: 1, items: names.map((name) => ({ kind: 'session' as const, name })) });

describe('LayoutStore', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cvg-layout-'));
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('нет файла — пустая раскладка', () => expect(new LayoutStore(dir).get('h')).toEqual({ v: 1, items: [] }));

  it('сохранение с задержкой и flush', () => {
    const st = new LayoutStore(dir, 300);
    expect(st.save('h', lay('a'))).toEqual({ ok: true, data: undefined });
    expect(existsSync(join(dir, 'layout.json'))).toBe(false);
    expect(st.get('h')).toEqual(lay('a'));
    vi.advanceTimersByTime(300);
    expect(JSON.parse(readFileSync(join(dir, 'layout.json'), 'utf8')).h).toEqual(lay('a'));
    st.save('h', lay('b'));
    st.flush();
    expect(JSON.parse(readFileSync(join(dir, 'layout.json'), 'utf8')).h).toEqual(lay('b'));
  });

  it('отдельные раскладки для разных ВМ', () => {
    const st = new LayoutStore(dir, 0);
    st.save('one', lay('a'));
    st.save('two', lay('b'));
    st.flush();
    const again = new LayoutStore(dir);
    expect(again.get('one')).toEqual(lay('a'));
    expect(again.get('two')).toEqual(lay('b'));
  });

  it('повреждённый файл — пустая раскладка, перезаписывается при сохранении', () => {
    writeFileSync(join(dir, 'layout.json'), '{oops');
    const st = new LayoutStore(dir, 0);
    expect(st.get('h')).toEqual({ v: 1, items: [] });
    st.save('h', lay('a'));
    st.flush();
    expect(JSON.parse(readFileSync(join(dir, 'layout.json'), 'utf8')).h).toEqual(lay('a'));
  });

  it('сохраняется нормализованная раскладка', () => {
    const st = new LayoutStore(dir, 0);
    st.save('h', { v: 1, items: [{ kind: 'session', name: 'a' }, { kind: 'session', name: 'a' }] });
    expect(st.get('h')).toEqual(lay('a'));
  });
});
