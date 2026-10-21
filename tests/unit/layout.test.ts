import { describe, expect, it } from 'vitest';
import type { LayoutItem, SidebarLayout } from '../../src/shared/ipc';
import {
  addNewToGroup, createGroup, deleteGroup, move, moveToGroup, normalize, paginate, reconcile, removeFromGroup, renameGroup, rowsOf,
  toggleCollapsed, togglePin, validGroupName, type Row,
} from '../../src/shared/layout';

const L = (items: LayoutItem[]): SidebarLayout => ({ v: 1, items });
const s = (name: string): LayoutItem => ({ kind: 'session', name });
const pinned = (name: string): LayoutItem => ({ kind: 'session', name, pinned: true });
const g = (id: string, sessions: string[], extra: Partial<Extract<LayoutItem, { kind: 'group' }>> = {}): LayoutItem => ({
  kind: 'group', id, name: id.toUpperCase(), sessions: sessions.map((name) => ({ name })), ...extra,
});
/** Плоское представление: имена сессий и «#id[...]» для групп. */
const n = (l: SidebarLayout) =>
  l.items.map((i) => (i.kind === 'session' ? `${i.pinned ? '*' : ''}${i.name}` : `${i.pinned ? '*' : ''}#${i.id}[${i.sessions.map((x) => `${x.pinned ? '*' : ''}${x.name}`).join(',')}]`));

describe('reconcile', () => {
  it('новая сессия первой среди незакреплённых', () =>
    expect(n(reconcile(L([pinned('a'), s('b')]), ['a', 'b', 'c']))).toEqual(['*a', 'c', 'b']));
  it('несколько новых — в порядке tmux', () => expect(n(reconcile(L([s('b')]), ['x', 'b', 'y']))).toEqual(['x', 'y', 'b']));
  it('исчезнувшие убраны, пустая группа осталась', () =>
    expect(n(reconcile(L([s('a'), g('g1', ['b'])]), ['a']))).toEqual(['a', '#g1[]']));
  it('сессия из группы не дублируется на верхнем уровне', () =>
    expect(n(reconcile(L([g('g1', ['b'])]), ['b']))).toEqual(['#g1[b]']));
});

describe('move', () => {
  it('прижимает к границе зоны: закреплённая не уходит ниже незакреплённых', () =>
    expect(n(move(L([pinned('a'), s('b'), s('c')]), { session: 'a' }, { group: null, index: 3 }))).toEqual(['*a', 'b', 'c']));
  it('незакреплённая не поднимается выше закреплённых', () =>
    expect(n(move(L([pinned('a'), s('b'), s('c')]), { session: 'c' }, { group: null, index: 0 }))).toEqual(['*a', 'c', 'b']));
  it('перестановка внутри зоны (индекс — позиция до удаления)', () =>
    expect(n(move(L([s('a'), s('b'), s('c')]), { session: 'a' }, { group: null, index: 2 }))).toEqual(['b', 'a', 'c']));
  it('сессия в группу и обратно', () => {
    const into = move(L([s('a'), g('g1', ['b'])]), { session: 'a' }, { group: 'g1', index: 1 });
    expect(n(into)).toEqual(['#g1[b,a]']);
    expect(n(move(into, { session: 'b' }, { group: null, index: 1 }))).toEqual(['#g1[a]', 'b']);
  });
  it('группа в группу не вкладывается', () => {
    const l = L([g('g1', []), g('g2', [])]);
    expect(move(l, { group: 'g1' }, { group: 'g2', index: 0 })).toEqual(l);
  });
  it('группа переставляется на верхнем уровне', () =>
    expect(n(move(L([s('a'), g('g1', [])]), { group: 'g1' }, { group: null, index: 0 }))).toEqual(['#g1[]', 'a']));
  it('закреплённая внутри группы тоже прижимается', () =>
    expect(n(move(L([g('g1', ['x', 'y'], { sessions: [{ name: 'x', pinned: true }, { name: 'y' }] })]), { session: 'x' }, { group: 'g1', index: 2 })))
      .toEqual(['#g1[*x,y]']));
  it('переезд в другой список снимает закрепление', () =>
    expect(n(move(L([pinned('a'), g('g1', ['x'])]), { session: 'a' }, { group: 'g1', index: 0 }))).toEqual(['#g1[a,x]']));
  it('неизвестная сессия — без изменений', () => {
    const l = L([s('a')]);
    expect(move(l, { session: 'zzz' }, { group: null, index: 0 })).toEqual(l);
  });
});

describe('togglePin', () => {
  it('закреплённая встаёт в конец закреплённой зоны', () =>
    expect(n(togglePin(L([pinned('a'), s('b'), s('c')]), { session: 'c' }))).toEqual(['*a', '*c', 'b']));
  it('открепление — в начало незакреплённых', () =>
    expect(n(togglePin(L([pinned('a'), pinned('b'), s('c')]), { session: 'a' }))).toEqual(['*b', 'a', 'c']));
  it('в группе — наверх группы', () => expect(n(togglePin(L([g('g1', ['x', 'y'])]), { session: 'y' }))).toEqual(['#g1[*y,x]']));
  it('группа закрепляется целиком', () => expect(n(togglePin(L([s('a'), g('g1', ['x'])]), { group: 'g1' }))).toEqual(['*#g1[x]', 'a']));
});

describe('группы', () => {
  it('createGroup: новая группа первой среди незакреплённых, с сессией', () => {
    const { layout, id } = createGroup(L([pinned('a'), s('b'), s('c')]), 'Работа', 'c');
    expect(layout.items.find((i) => i.kind === 'group')).toMatchObject({ id, name: 'Работа' });
    expect(n(layout)).toEqual(['*a', `#${id}[c]`, 'b']);
  });
  it('createGroup: id уникальны', () => {
    const a = createGroup(L([]), 'x');
    const b = createGroup(a.layout, 'y');
    expect(a.id).not.toBe(b.id);
  });
  it('renameGroup', () => expect(renameGroup(L([g('g1', [])]), 'g1', 'Игры').items[0]).toMatchObject({ name: 'Игры' }));
  it('deleteGroup: сессии на место группы', () =>
    expect(n(deleteGroup(L([s('a'), g('g1', ['x', 'y']), s('b')]), 'g1'))).toEqual(['a', 'x', 'y', 'b']));
  it('deleteGroup закреплённой группы: сессии закреплены', () =>
    expect(n(deleteGroup(L([g('g1', ['x'], { pinned: true }), s('b')]), 'g1'))).toEqual(['*x', 'b']));
  it('addNewToGroup: сессии ещё нет в раскладке — встаёт в группу', () =>
    expect(n(addNewToGroup(L([s('a'), g('g1', ['x'])]), 'new', 'g1'))).toEqual(['a', '#g1[new,x]']));
  it('addNewToGroup: уже на верхнем уровне — переносится', () =>
    expect(n(addNewToGroup(L([s('new'), g('g1', [])]), 'new', 'g1'))).toEqual(['#g1[new]']));
  it('addNewToGroup: свёрнутая группа разворачивается', () =>
    expect(addNewToGroup(L([g('g1', [], { collapsed: true })]), 'new', 'g1').items[0]).not.toHaveProperty('collapsed'));
  it('addNewToGroup: уже в этой свёрнутой группе — исходная раскладка не меняется на месте', () => {
    const l = L([g('g1', ['new'], { collapsed: true })]);
    const out = addNewToGroup(l, 'new', 'g1');
    expect(out.items[0]).not.toHaveProperty('collapsed');
    expect(l.items[0]).toHaveProperty('collapsed', true);
  });
  it('addNewToGroup: группы нет — раскладка не меняется', () => {
    const l = L([s('a')]);
    expect(addNewToGroup(l, 'new', 'nope')).toBe(l);
  });
  it('addNewToGroup: потом reconcile с живой сессией её не трогает', () =>
    expect(n(reconcile(addNewToGroup(L([g('g1', [])]), 'new', 'g1'), ['new']))).toEqual(['#g1[new]']));
  it('toggleCollapsed', () => expect(toggleCollapsed(L([g('g1', [])]), 'g1').items[0]).toMatchObject({ collapsed: true }));
  it('moveToGroup: первой среди незакреплённых группы', () =>
    expect(n(moveToGroup(L([s('a'), g('g1', ['x'], { sessions: [{ name: 'p', pinned: true }, { name: 'x' }] })]), 'a', 'g1'))).toEqual(['#g1[*p,a,x]']));
  it('removeFromGroup: на верхний уровень, первой среди незакреплённых', () =>
    expect(n(removeFromGroup(L([pinned('p'), s('b'), g('g1', ['x'])]), 'x'))).toEqual(['*p', 'x', 'b', '#g1[]']));
});

describe('normalize', () => {
  it('мусор — пустая раскладка', () => {
    expect(normalize(null)).toEqual(L([]));
    expect(normalize({ v: 1, items: 'x' })).toEqual(L([]));
  });
  it('дубликат сессии убирается, инвариант восстанавливается', () =>
    expect(n(normalize({ v: 1, items: [s('a'), pinned('b'), s('a'), g('g1', ['a', 'c'])] }))).toEqual(['*b', 'a', '#g1[c]']));
  it('непонятные элементы и поля отбрасываются', () =>
    expect(normalize({ v: 1, items: [{ kind: 'x' }, { kind: 'session', name: 5 }, { kind: 'group', id: 'g', name: 'G', sessions: [{ name: 'q' }, 3] }] }))
      .toEqual(L([{ kind: 'group', id: 'g', name: 'G', sessions: [{ name: 'q' }] }])));
});

describe('validGroupName', () => {
  it('обрезка', () => expect(validGroupName('  Работа ')).toBe('Работа'));
  it('пусто — null', () => expect(validGroupName('   ')).toBeNull());
  it('длиннее 40 — null', () => expect(validGroupName('я'.repeat(41))).toBeNull());
  it('40 — можно', () => expect(validGroupName('я'.repeat(40))).toBe('я'.repeat(40)));
});

describe('rowsOf и paginate', () => {
  const H = { section: 28, divider: 17, group: 34, session: 52 } as const;
  const live = (...xs: string[]) => new Set(xs);

  it('свёрнутая группа — одна строка; раздел «Закреплённые» только если есть', () => {
    expect(rowsOf(L([s('a'), g('g1', ['b'], { collapsed: true })]), live('a', 'b'))).toEqual([
      { kind: 'session', name: 'a', group: null },
      { kind: 'group', id: 'g1', continued: false },
    ]);
    expect(rowsOf(L([pinned('a'), s('b')]), live('a', 'b'))).toEqual([
      { kind: 'section', label: 'Закреплённые' },
      { kind: 'session', name: 'a', group: null },
      { kind: 'divider' },
      { kind: 'session', name: 'b', group: null },
    ]);
  });
  it('сессии, которых нет в tmux, не показываются', () =>
    expect(rowsOf(L([s('a'), s('gone')]), live('a'))).toEqual([{ kind: 'session', name: 'a', group: null }]));

  it('всё помещается — одна страница', () => {
    const rows = rowsOf(L([s('a'), s('b')]), live('a', 'b'));
    expect(paginate(rows, H, 500)).toEqual([rows]);
  });
  it('группа, разорванная страницей, повторяет заголовок', () => {
    const big = L([g('g1', ['a', 'b', 'c', 'd'])]);
    const pages = paginate(rowsOf(big, live('a', 'b', 'c', 'd')), H, 200);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[1][0]).toEqual({ kind: 'group', id: 'g1', continued: true });
    const sessions = pages.flat().filter((r): r is Extract<Row, { kind: 'session' }> => r.kind === 'session').map((r) => r.name);
    expect(sessions).toEqual(['a', 'b', 'c', 'd']);
  });
  it('страница не начинается с разделителя и не кончается заголовком группы', () => {
    const l = L([pinned('a'), pinned('b'), pinned('c'), g('g1', ['x', 'y'])]);
    const pages = paginate(rowsOf(l, live('a', 'b', 'c', 'x', 'y')), H, 28 + 52 * 3 + 17 + 34);
    for (const p of pages) {
      expect(p[0].kind).not.toBe('divider');
      expect(p[p.length - 1].kind === 'group' && !(p[p.length - 1] as { continued: boolean }).continued && p !== pages[pages.length - 1]).toBe(false);
    }
  });
  it('строка выше доступной высоты всё равно попадает на страницу', () =>
    expect(paginate([{ kind: 'session', name: 'a', group: null }], H, 10)).toEqual([[{ kind: 'session', name: 'a', group: null }]]));
  it('пустой список — одна пустая страница', () => expect(paginate([], H, 100)).toEqual([[]]));
});
