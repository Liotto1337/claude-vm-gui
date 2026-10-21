import type { LayoutItem, SidebarLayout } from './ipc';

// Раскладка сайдбара: порядок, закрепление, группы, страницы. Чистые функции — состояние не меняют.
// Инвариант: в каждом списке (верхний уровень, сессии группы) закреплённые идут раньше незакреплённых;
// каждая сессия встречается не больше одного раза.

type Group = Extract<LayoutItem, { kind: 'group' }>;
type Member = Group['sessions'][number];
export type ItemRef = { session: string } | { group: string };
/** Куда вставить: список (null — верхний уровень) и позиция в нём, считая перемещаемый элемент на старом месте. */
export type Pos = { group: string | null; index: number };

export const EMPTY: SidebarLayout = { v: 1, items: [] };
const MAX_GROUP_NAME = 40;

const clone = (l: SidebarLayout): SidebarLayout => ({
  v: 1,
  items: l.items.map((i) => (i.kind === 'group' ? { ...i, sessions: i.sessions.map((m) => ({ ...m })) } : { ...i })),
});
const pinnedFirst = <T extends { pinned?: boolean }>(xs: T[]): T[] => [...xs.filter((x) => x.pinned), ...xs.filter((x) => !x.pinned)];
const pinnedCount = (xs: { pinned?: boolean }[]) => xs.filter((x) => x.pinned).length;
const findGroup = (l: SidebarLayout, id: string) => l.items.find((i): i is Group => i.kind === 'group' && i.id === id);

/** Где сессия: группа (или null) и индекс. */
function locate(l: SidebarLayout, name: string): { group: Group | null; index: number } | null {
  for (let i = 0; i < l.items.length; i++) {
    const it = l.items[i];
    if (it.kind === 'session' && it.name === name) return { group: null, index: i };
    if (it.kind === 'group') {
      const j = it.sessions.findIndex((m) => m.name === name);
      if (j >= 0) return { group: it, index: j };
    }
  }
  return null;
}

/** Вставка с прижатием к своей зоне: закреплённое — не ниже закреплённых, незакреплённое — не выше. */
function insertClamped<T extends { pinned?: boolean }>(list: T[], item: T, index: number): void {
  const p = pinnedCount(list);
  const at = item.pinned ? Math.min(Math.max(index, 0), p) : Math.min(Math.max(index, p), list.length);
  list.splice(at, 0, item);
}

export function validGroupName(s: string): string | null {
  const t = s.trim();
  return t.length >= 1 && t.length <= MAX_GROUP_NAME ? t : null;
}

/** Раскладка из файла: всё непонятное отбрасывается, дубликаты убираются, инвариант восстанавливается. */
export function normalize(raw: unknown): SidebarLayout {
  const r = raw as { items?: unknown } | null;
  if (!r || typeof r !== 'object' || !Array.isArray(r.items)) return { v: 1, items: [] };
  const seen = new Set<string>();
  const groupIds = new Set<string>();
  const items: LayoutItem[] = [];
  const member = (x: unknown): Member | null => {
    const m = x as { name?: unknown; pinned?: unknown } | null;
    if (!m || typeof m.name !== 'string' || m.name === '' || seen.has(m.name)) return null;
    seen.add(m.name);
    return m.pinned === true ? { name: m.name, pinned: true } : { name: m.name };
  };
  for (const x of r.items) {
    const it = x as Record<string, unknown> | null;
    if (!it || typeof it !== 'object') continue;
    if (it.kind === 'session') {
      const m = member(it);
      if (m) items.push({ kind: 'session', ...m });
    } else if (it.kind === 'group' && typeof it.id === 'string' && it.id !== '' && !groupIds.has(it.id) && Array.isArray(it.sessions)) {
      groupIds.add(it.id);
      const name = typeof it.name === 'string' ? (validGroupName(it.name) ?? 'Группа') : 'Группа';
      const g: Group = { kind: 'group', id: it.id, name, sessions: pinnedFirst(it.sessions.map(member).filter((m): m is Member => m !== null)) };
      if (it.pinned === true) g.pinned = true;
      if (it.collapsed === true) g.collapsed = true;
      items.push(g);
    }
  }
  return { v: 1, items: pinnedFirst(items) };
}

/** Сверка со списком tmux: исчезнувшие убираются, новые — первыми среди незакреплённых верхнего уровня. */
export function reconcile(l: SidebarLayout, names: string[]): SidebarLayout {
  const live = new Set(names);
  const out = clone(l);
  out.items = out.items.filter((i) => i.kind === 'group' || live.has(i.name));
  for (const i of out.items) if (i.kind === 'group') i.sessions = i.sessions.filter((m) => live.has(m.name));
  const known = new Set<string>();
  for (const i of out.items) {
    if (i.kind === 'session') known.add(i.name);
    else for (const m of i.sessions) known.add(m.name);
  }
  const fresh = names.filter((x) => !known.has(x)).map((name): LayoutItem => ({ kind: 'session', name }));
  out.items.splice(pinnedCount(out.items), 0, ...fresh);
  return out;
}

/** Перемещение сессии или группы. Группа — только на верхний уровень. */
export function move(l: SidebarLayout, ref: ItemRef, to: Pos): SidebarLayout {
  const out = clone(l);
  if ('group' in ref) {
    if (to.group !== null) return l;
    const from = out.items.findIndex((i) => i.kind === 'group' && i.id === ref.group);
    if (from < 0) return l;
    const [g] = out.items.splice(from, 1);
    insertClamped(out.items, g, from < to.index ? to.index - 1 : to.index);
    return out;
  }
  const at = locate(out, ref.session);
  if (!at) return l;
  const target = to.group === null ? null : findGroup(out, to.group);
  if (to.group !== null && !target) return l;
  const fromList: { pinned?: boolean; name?: string }[] = at.group ? at.group.sessions : out.items;
  const [removed] = fromList.splice(at.index, 1);
  const sameList = (at.group?.id ?? null) === to.group;
  const index = sameList && at.index < to.index ? to.index - 1 : to.index;
  // Закрепление действует внутри своего списка: при переезде в другой список снимается
  const pinned = sameList && removed.pinned === true;
  if (target) insertClamped(target.sessions, pinned ? { name: ref.session, pinned } : { name: ref.session }, index);
  else insertClamped(out.items, pinned ? { kind: 'session', name: ref.session, pinned } : { kind: 'session', name: ref.session }, index);
  return out;
}

/** Закрепить/открепить: закреплённое — в конец закреплённой зоны, открепленное — в начало незакреплённой. */
export function togglePin(l: SidebarLayout, ref: ItemRef): SidebarLayout {
  const out = clone(l);
  let list: { pinned?: boolean }[];
  let index: number;
  if ('group' in ref) {
    list = out.items;
    index = out.items.findIndex((i) => i.kind === 'group' && i.id === ref.group);
  } else {
    const at = locate(out, ref.session);
    if (!at) return l;
    list = at.group ? at.group.sessions : out.items;
    index = at.index;
  }
  if (index < 0) return l;
  const [item] = list.splice(index, 1);
  if (item.pinned) delete item.pinned;
  else item.pinned = true;
  list.splice(pinnedCount(list), 0, item);
  return out;
}

let seq = 0;
const newId = (l: SidebarLayout) => {
  let id: string;
  do id = `g${Date.now().toString(36)}${(seq++).toString(36)}`;
  while (findGroup(l, id));
  return id;
};

/** Новая группа первой среди незакреплённых; withSession — сразу положить в неё сессию. */
export function createGroup(l: SidebarLayout, name: string, withSession?: string): { layout: SidebarLayout; id: string } {
  const out = clone(l);
  const id = newId(out);
  out.items.splice(pinnedCount(out.items), 0, { kind: 'group', id, name: validGroupName(name) ?? 'Группа', sessions: [] });
  return { layout: withSession ? moveToGroup(out, withSession, id) : out, id };
}

export function renameGroup(l: SidebarLayout, id: string, name: string): SidebarLayout {
  const valid = validGroupName(name);
  if (!valid) return l;
  const out = clone(l);
  const g = findGroup(out, id);
  if (g) g.name = valid;
  return out;
}

/** Удалить группу: её сессии встают на её место (закреплёнными, если группа была закреплена). */
export function deleteGroup(l: SidebarLayout, id: string): SidebarLayout {
  const out = clone(l);
  const i = out.items.findIndex((x) => x.kind === 'group' && x.id === id);
  if (i < 0) return l;
  const g = out.items[i] as Group;
  const freed: LayoutItem[] = g.sessions.map((m) => (g.pinned ? { kind: 'session', name: m.name, pinned: true } : { kind: 'session', name: m.name }));
  out.items.splice(i, 1, ...freed);
  return out;
}

export function toggleCollapsed(l: SidebarLayout, id: string): SidebarLayout {
  const out = clone(l);
  const g = findGroup(out, id);
  if (!g) return l;
  if (g.collapsed) delete g.collapsed;
  else g.collapsed = true;
  return out;
}

/** В группу: первой среди незакреплённых сессий группы. */
export function moveToGroup(l: SidebarLayout, session: string, id: string): SidebarLayout {
  const g = findGroup(l, id);
  const at = locate(l, session);
  if (!g || !at || at.group?.id === id) return l;
  return move(l, { session }, { group: id, index: pinnedCount(g.sessions) });
}

/**
 * Только что созданная сессия — в группу, даже если список tmux её ещё не принёс (тогда её нет в раскладке).
 * Свёрнутая группа разворачивается, чтобы новую сессию было видно.
 */
export function addNewToGroup(l: SidebarLayout, session: string, id: string): SidebarLayout {
  if (!findGroup(l, id)) return l;
  const base = clone(l);
  const out = locate(base, session) ? moveToGroup(base, session, id) : base;
  const g = findGroup(out, id)!;
  if (!locate(out, session)) g.sessions.splice(pinnedCount(g.sessions), 0, { name: session });
  delete g.collapsed;
  return out;
}

/** Из группы — на верхний уровень, первой среди незакреплённых. */
export function removeFromGroup(l: SidebarLayout, session: string): SidebarLayout {
  const at = locate(l, session);
  if (!at?.group) return l;
  return move(l, { session }, { group: null, index: pinnedCount(l.items) });
}

// ── Строки и страницы ───────────────────────────────────────────────────────

export type Row =
  | { kind: 'section'; label: string }
  | { kind: 'divider' }
  | { kind: 'group'; id: string; continued: boolean }
  | { kind: 'session'; name: string; group: string | null };

/** Плоский список строк сайдбара. Сессии, которых нет в tmux, не показываются. */
export function rowsOf(l: SidebarLayout, live: Set<string>): Row[] {
  const rows: Row[] = [];
  const pinned = l.items.filter((i) => i.pinned);
  const rest = l.items.filter((i) => !i.pinned);
  const emit = (items: LayoutItem[]) => {
    for (const i of items) {
      if (i.kind === 'session') {
        if (live.has(i.name)) rows.push({ kind: 'session', name: i.name, group: null });
        continue;
      }
      rows.push({ kind: 'group', id: i.id, continued: false });
      if (!i.collapsed) for (const m of i.sessions) if (live.has(m.name)) rows.push({ kind: 'session', name: m.name, group: i.id });
    }
  };
  if (pinned.length > 0) {
    rows.push({ kind: 'section', label: 'Закреплённые' });
    emit(pinned);
  }
  const before = rows.length;
  emit(rest);
  if (pinned.length > 0 && rows.length > before) rows.splice(before, 0, { kind: 'divider' });
  return rows;
}

/**
 * Раскладка строк по страницам высотой available. Группа, разорванная страницей, повторяет заголовок
 * («продолжение»); страница не начинается с разделителя и не кончается заголовком группы, чьи сессии ушли дальше.
 */
export function paginate(rows: Row[], heights: Record<Row['kind'], number>, available: number): Row[][] {
  const pages: Row[][] = [[]];
  let used = 0;
  for (const row of rows) {
    let cur = pages[pages.length - 1];
    const h = heights[row.kind];
    if (cur.length > 0 && used + h > available) {
      const next: Row[] = [];
      let nextUsed = 0;
      const last = cur[cur.length - 1];
      if (last.kind === 'divider') cur.pop();
      if (last.kind === 'group' && !last.continued && row.kind === 'session' && row.group === last.id) {
        cur.pop();
        next.push(last);
        nextUsed += heights.group;
      } else if (row.kind === 'session' && row.group !== null) {
        next.push({ kind: 'group', id: row.group, continued: true });
        nextUsed += heights.group;
      }
      if (cur.length === 0) pages.pop();
      pages.push(next);
      cur = next;
      used = nextUsed;
    }
    if (row.kind === 'divider' && cur.length === 0) continue;
    cur.push(row);
    used += h;
  }
  return pages;
}
