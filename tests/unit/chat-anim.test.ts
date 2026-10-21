import { describe, expect, it } from 'vitest';
import type { ChatItem } from '../../src/shared/ipc';
import { claimPending, nextTyping, revealCount, typingSpeed, TYPE_MAX_CHARS, type Pending } from '../../src/renderer/chat-anim';

describe('«печать» ответа', () => {
  it('короткий ответ — скорость чтения (не быстрее 120 символов/с)', () => expect(typingSpeed(60)).toBe(120));
  it('длинный ответ успевает примерно за 1,5 с', () => expect(typingSpeed(3000)).toBe(2000));
  it('revealCount растёт со временем и не больше длины', () => {
    expect(revealCount(60, 0)).toBe(0);
    expect(revealCount(60, 250)).toBe(30);
    expect(revealCount(60, 10_000)).toBe(60);
    expect(revealCount(3000, 1500)).toBe(3000);
  });
  it('отрицательное время — ноль', () => expect(revealCount(10, -5)).toBe(0));
});

describe('временный пузырь отправленного сообщения', () => {
  const u = (id: string, text: string, images = 0): ChatItem => ({ kind: 'user', id, text, images });
  const p = (id: string, text: string, seen: string[], state: Pending['state'] = 'sent', images = 0): Pending =>
    ({ id, text, images, state, seen: new Set(seen), at: 0 });

  it('новая запись журнала с тем же текстом забирает пузырь', () =>
    expect(claimPending([p('p1', 'привет', ['u0'])], [u('u0', 'привет'), u('u1', 'привет')], 1000)).toEqual([]));
  it('старая запись (была до отправки) не забирает', () =>
    expect(claimPending([p('p1', 'привет', ['u0'])], [u('u0', 'привет')], 1000).map((x) => x.id)).toEqual(['p1']));
  it('пробелы и переносы не мешают совпадению', () =>
    expect(claimPending([p('p1', 'a\r\n b', [])], [u('u1', 'a b')], 1000)).toEqual([]));
  it('два одинаковых сообщения — каждое забирает свою запись', () => {
    const pend = [p('p1', 'ок', []), p('p2', 'ок', [])];
    expect(claimPending(pend, [u('u1', 'ок')], 1000).map((x) => x.id)).toEqual(['p2']);
    expect(claimPending(pend, [u('u1', 'ок'), u('u2', 'ок')], 1000)).toEqual([]);
  });
  it('картинки без текста — по числу картинок', () =>
    expect(claimPending([p('p1', '', [], 'sent', 1)], [u('u1', '', 1)], 1000)).toEqual([]));
  it('доставленный пузырь без записи журнала уходит через 20 с', () => {
    const pend = [{ ...p('p1', 'x', []), at: 0 }];
    expect(claimPending(pend, [], 19_000)).toHaveLength(1);
    expect(claimPending(pend, [], 21_000)).toHaveLength(0);
  });
  it('отправляемый пузырь по таймауту не уходит', () =>
    expect(claimPending([{ ...p('p1', 'x', [], 'sending'), at: 0 }], [], 60_000)).toHaveLength(1));
  it('сообщение с «!» совпадает с записью «! cmd»', () =>
    expect(claimPending([p('p1', '!pwd', [])], [u('u1', '! pwd')], 1000)).toEqual([]));
  it('одна запись не забирает второй одинаковый пузырь на следующем вызове', () => {
    const first = claimPending([p('p1', 'ок', []), p('p2', 'ок', [])], [u('u1', 'ок')], 1000);
    expect(first.map((x) => x.id)).toEqual(['p2']);
    expect(claimPending(first, [u('u1', 'ок')], 2000).map((x) => x.id)).toEqual(['p2']);
  });
  it('пока Claude работает, доставленный пузырь не уходит (сообщение в очереди)', () => {
    const pend = [{ ...p('p1', 'x', []), at: 0 }];
    const kept = claimPending(pend, [], 60_000, true);
    expect(kept).toHaveLength(1);
    // отсчёт 20 с начинается заново после работы
    expect(claimPending(kept, [], 70_000)).toHaveLength(1);
    expect(claimPending(kept, [], 81_000)).toHaveLength(0);
  });
});

describe('какие ответы «печатаются»', () => {
  const a = (id: string, text = 'ответ'): ChatItem => ({ kind: 'assistant', id, text });
  const ev = (items: ChatItem[], reset = false, prepend = false) => ({ items, reset, prepend });

  it('новый ответ — печатается с текущего момента', () => expect(nextTyping({}, [], ev([a('x')]), 5)).toEqual({ x: 5 }));
  it('уже известный ответ и сообщения пользователя — нет', () =>
    expect(nextTyping({}, [a('x')], ev([a('x'), { kind: 'user', id: 'u', text: 'hi', images: 0 }]), 5)).toEqual({}));
  it('история при открытии и «Показать раньше» — сразу', () => {
    expect(nextTyping({}, [], ev([a('x')], true), 5)).toEqual({});
    expect(nextTyping({}, [], ev([a('x')], false, true), 5)).toEqual({});
  });
  it('новая лента (/clear, другая сессия) забывает прошлые «печати»', () =>
    expect(nextTyping({ old: 1 }, [a('old')], ev([a('y')], true), 5)).toEqual({}));
  it('продолжающийся ответ не перезапускается', () => expect(nextTyping({ x: 1 }, [a('x')], ev([a('x', 'длиннее')]), 5)).toEqual({ x: 1 }));
  it(`ответ длиннее ${TYPE_MAX_CHARS} символов — сразу, без печати`, () => {
    expect(nextTyping({}, [], ev([a('big', 'я'.repeat(TYPE_MAX_CHARS + 1))]), 5)).toEqual({});
    expect(nextTyping({}, [], ev([a('ok', 'я'.repeat(TYPE_MAX_CHARS))]), 5)).toEqual({ ok: 5 });
  });
});

describe('пузыри: слеш-команды и очередь', () => {
  const u = (id: string, text: string): ChatItem => ({ kind: 'user', id, text, images: 0 });
  const p = (id: string, text: string, seen: string[] = []): Pending => ({ id, text, images: 0, state: 'sent', seen: new Set(seen), at: 0 });
  it('«/model» и «/model opus» снимаются записями журнала', () => {
    expect(claimPending([p('1', '/model')], [u('a', '/model')], 1)).toEqual([]);
    expect(claimPending([p('1', '/model  opus')], [u('a', '/model opus')], 1)).toEqual([]);
  });
  it('«/model opus» не снимается записью «/model sonnet»', () =>
    expect(claimPending([p('1', '/model opus')], [u('a', '/model sonnet')], 1)).toHaveLength(1));
  it('три одинаковых «ок» в очереди, пока Claude занят: снимаются по одному, по мере записей', () => {
    let q = [p('1', 'ок'), p('2', 'ок'), p('3', 'ок')];
    q = claimPending(q, [u('a', 'ок')], 60_000, true);
    expect(q.map((x) => x.id)).toEqual(['2', '3']);
    q = claimPending(q, [u('a', 'ок')], 120_000, true);
    expect(q.map((x) => x.id)).toEqual(['2', '3']);
    q = claimPending(q, [u('a', 'ок'), u('b', 'ок')], 180_000, true);
    expect(q.map((x) => x.id)).toEqual(['3']);
    q = claimPending(q, [u('a', 'ок'), u('b', 'ок'), u('c', 'ок')], 240_000, false);
    expect(q).toEqual([]);
  });
});
