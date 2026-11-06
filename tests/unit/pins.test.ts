import { beforeEach, describe, expect, it } from 'vitest';
import type { ChatItem } from '../../src/shared/ipc';
import { dropMissing, loadPins, orderPins, pinText, pinnable, preview, savePins, stepActive, togglePin, type Pin } from '../../src/renderer/pins';

const pin = (id: string, at = 0, text = id): Pin => ({ id, text, at });

describe('pinnable / pinText', () => {
  const user: ChatItem = { kind: 'user', id: 'u', text: '  Привет\n\nмир  ', images: [], files: [] };
  it('закрепляются сообщения пользователя и ответы Claude', () => {
    expect(pinnable(user)).toBe(true);
    expect(pinnable({ kind: 'assistant', id: 'a', text: 'x', files: [] })).toBe(true);
    expect(pinnable({ kind: 'thinking', id: 't' })).toBe(false);
    expect(pinnable({ kind: 'note', id: 'n', text: 'x' })).toBe(false);
  });
  it('текст — в одну строку', () => expect(pinText(user)).toBe('Привет мир'));
  it('без текста — вложения', () => {
    expect(pinText({ ...user, text: '', images: [{ mediaType: 'image/png', data: '' }] })).toBe('Изображение');
    expect(pinText({ ...user, text: '', files: ['/a/b.txt'] })).toBe('Файл');
  });
});

describe('preview', () => {
  it('короткий — как есть', () => expect(preview('abc', 5)).toBe('abc'));
  it('длинный — обрезается с многоточием', () => expect(preview('abcdefgh', 5)).toBe('abcd…'));
});

describe('togglePin', () => {
  it('добавляет и убирает', () => {
    const a = togglePin([], { id: 'x', text: 'X' }, 5);
    expect(a).toEqual([{ id: 'x', text: 'X', at: 5 }]);
    expect(togglePin(a, { id: 'x', text: 'X' }, 6)).toEqual([]);
  });
});

describe('orderPins', () => {
  it('по порядку в ленте; не загруженные (раньше) — в начале по времени закрепления', () => {
    const list = [pin('c', 1), pin('old2', 9), pin('a', 3), pin('old1', 2)];
    expect(orderPins(list, ['a', 'b', 'c']).map((p) => p.id)).toEqual(['old1', 'old2', 'a', 'c']);
  });
});

describe('stepActive', () => {
  const ordered = [pin('a'), pin('b'), pin('c')];
  it('после перехода — предыдущее закреплённое, по кругу', () => {
    expect(stepActive(ordered, 'c')).toBe('b');
    expect(stepActive(ordered, 'b')).toBe('a');
    expect(stepActive(ordered, 'a')).toBe('c');
  });
  it('неизвестный id — последнее', () => expect(stepActive(ordered, 'zzz')).toBe('c'));
  it('пусто — null', () => expect(stepActive([], null)).toBeNull());
});

describe('dropMissing', () => {
  const list = [pin('a'), pin('gone')];
  it('вся лента загружена — несуществующие убираются', () => expect(dropMissing(list, ['a'], false).map((p) => p.id)).toEqual(['a']));
  it('есть ранняя часть — ничего не трогаем (тот же массив)', () => expect(dropMissing(list, ['a'], true)).toBe(list));
  it('нечего убирать — тот же массив', () => {
    const one = [pin('a')];
    expect(dropMissing(one, ['a'], false)).toBe(one);
  });
});

describe('хранилище', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    globalThis.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } as Storage;
  });
  it('сохраняется и читается по хосту и сессии', () => {
    savePins('h', 's', [pin('a', 1)]);
    expect(loadPins('h', 's')).toEqual([pin('a', 1)]);
    expect(loadPins('h', 'other')).toEqual([]);
  });
  it('испорченное хранилище — пусто', () => {
    localStorage.setItem('cvg:pins:h:s', '{oops');
    expect(loadPins('h', 's')).toEqual([]);
  });
});
