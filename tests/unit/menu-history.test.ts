import { describe, expect, it } from 'vitest';
import type { MenuOption, ParsedMenu, ScreenState } from '../../src/shared/ipc';
import { answerOf, loadAnswers, nextAnswers, placeAnswers, saveAnswers, type MenuAnswer } from '../../src/renderer/menu-history';

const opt = (label: string, extra: Partial<MenuOption> = {}): MenuOption => ({ n: null, label, description: '', selected: false, ...extra });
const menu = (title: string, options: MenuOption[], kind: ParsedMenu['kind'] = 'single'): ScreenState => ({
  kind: 'menu', menu: { title, context: [], code: [], options, notes: [], hint: null, kind, tabs: null, axis: null },
});
const single = menu('Выбор', [opt('Да'), opt('Нет', { selected: true })]);
const multi = menu('Какие цвета?', [opt('Глина', { checked: true }), opt('Чёрный', { checked: true, selected: true }), opt('Белый', { checked: false }), opt('Submit', { submit: true })], 'multi');
const prompt: ScreenState = { kind: 'prompt', status: null, input: '' };

describe('answerOf', () => {
  it('один выбор — вариант под курсором', () => expect(answerOf((single as { menu: ParsedMenu }).menu, 'enter')).toBe('Выбор → выбрано: Нет'));
  it('несколько — отмеченные через запятую', () => expect(answerOf((multi as { menu: ParsedMenu }).menu, 'enter')).toBe('Какие цвета? → выбрано: Глина, Чёрный'));
  it('ответ цифрой — вариант с этим номером, а не под курсором', () => {
    const m = menu('Выбор', [opt('Да', { n: 1, selected: true }), opt('Нет', { n: 2 })]) as { menu: ParsedMenu };
    expect(answerOf(m.menu, '2')).toBe('Выбор → выбрано: Нет');
  });
  it('последней была Esc — отменено', () => expect(answerOf((single as { menu: ParsedMenu }).menu, 'esc')).toBe('Выбор → отменено'));
});

describe('nextAnswers', () => {
  it('меню → поле ввода: итог после якоря', () =>
    expect(nextAnswers(single, prompt, 'u7', 'enter', [], 100)).toEqual([{ id: 'answer-100', after: 'u7', text: 'Выбор → выбрано: Нет', at: 100 }]));
  it('меню → незнакомый экран — итога нет', () => expect(nextAnswers(single, { kind: 'unknown' }, 'u7', null, [], 1)).toEqual([]));
  it('меню → другое меню (следующий вопрос) — итог первого', () =>
    expect(nextAnswers(multi, single, 'u1', 'enter', [], 5).map((a) => a.text)).toEqual(['Какие цвета? → выбрано: Глина, Чёрный']));
  it('то же меню (курсор сдвинулся) — итога нет', () => expect(nextAnswers(single, single, 'u1', 'down', [], 5)).toEqual([]));
  it('«Review your answers» итогом не пишется — ответ уже записан по вопросу', () =>
    expect(nextAnswers(menu('Review your answers', [opt('Submit answers', { selected: true }), opt('Cancel')]), prompt, 'u1', 'enter', [], 5)).toEqual([]));
  it('не больше 50 — старые вытесняются', () => {
    const list: MenuAnswer[] = Array.from({ length: 50 }, (_, i) => ({ id: `a${i}`, after: null, text: `t${i}`, at: i }));
    const next = nextAnswers(single, prompt, null, 'enter', list, 99);
    expect(next).toHaveLength(50);
    expect(next[0].id).toBe('a1');
    expect(next[49].text).toBe('Выбор → выбрано: Нет');
  });
});

describe('хранение', () => {
  it('сохраняется и читается по ВМ и сессии; без хранилища — пусто, без исключений', () => {
    const store = new Map<string, string>();
    globalThis.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } as Storage;
    const list = [{ id: 'a', after: 'u1', text: 'x', at: 1 }];
    saveAnswers('h', 's', list);
    expect(loadAnswers('h', 's')).toEqual(list);
    expect(loadAnswers('h', 'other')).toEqual([]);
    globalThis.localStorage = { getItem: () => { throw new Error('нет'); }, setItem: () => { throw new Error('нет'); } } as unknown as Storage;
    expect(loadAnswers('h', 's')).toEqual([]);
    expect(() => saveAnswers('h', 's', list)).not.toThrow();
  });
});

describe('placeAnswers', () => {
  const a = (id: string, after: string | null): MenuAnswer => ({ id, after, text: id, at: 1 });
  it('итог после своего элемента; без якоря (меню — первый экран сессии) — вверху', () => {
    const r = placeAnswers(['u1', 'u2'], [a('x', 'u1'), a('y', null), a('z', 'u1')]);
    expect(r.top.map((x) => x.id)).toEqual(['y']);
    expect([...r.after.entries()].map(([k, v]) => [k, v.map((x) => x.id)])).toEqual([['u1', ['x', 'z']]]);
  });
  it('якорь не в загруженной части журнала (или сессию пересоздали с тем же именем) — итог не показывается, а не оседает внизу', () => {
    const r = placeAnswers(['u9'], [a('old', 'u1')]);
    expect(r.top).toEqual([]);
    expect(r.after.size).toBe(0);
  });
});
