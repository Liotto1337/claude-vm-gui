import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react';
import type { LayoutItem, SidebarLayout, TmuxSession } from '@shared/ipc';
import {
  createGroup, deleteGroup, move, moveToGroup, paginate, removeFromGroup, renameGroup, rowsOf, toggleCollapsed, togglePin,
  type ItemRef, type Pos, type Row,
} from '@shared/layout';
import { killSession, openSession, shortPath, updateLayout, useAppState } from '../state';
import { ConfirmDialog } from './ConfirmDialog';
import { ContextMenu, type MenuEntry } from './ContextMenu';
import { GroupNameDialog } from './GroupNameDialog';
import { IconChevron, IconChevronLeft, IconChevronRight, IconClose, IconFolder, IconPin, IconPlus } from './icons';

/** Высоты строк — как в app.css (.row-*): по ним список делится на страницы. */
export const ROW_HEIGHTS = { section: 28, divider: 17, group: 34, session: 52 } as const;
const PAGER_H = 40;
const PAGE_FLIP_MS = 600;
const DND = 'application/x-cvg';

type Group = Extract<LayoutItem, { kind: 'group' }>;
type Drop = { key: string; edge: 'before' | 'after' | 'into' } | null;
/** ref — сессия или группа; list — пустое место списка */
type Menu = { x: number; y: number; ref: ItemRef | 'list' } | null;
type Dialog =
  | { kind: 'new-group'; session?: string }
  | { kind: 'rename'; id: string; name: string }
  | { kind: 'delete-group'; id: string; name: string }
  | { kind: 'kill'; name: string }
  | null;

const rowKey = (r: Row) => (r.kind === 'session' ? `s:${r.name}` : r.kind === 'group' ? `g:${r.id}` : r.kind);
const refKey = (ref: ItemRef) => ('session' in ref ? `s:${ref.session}` : `g:${ref.group}`);

/** Где лежит сессия и закреплена ли. */
function whereIs(l: SidebarLayout, name: string): { group: Group | null; index: number; pinned: boolean } | null {
  for (let i = 0; i < l.items.length; i++) {
    const it = l.items[i];
    if (it.kind === 'session' && it.name === name) return { group: null, index: i, pinned: !!it.pinned };
    if (it.kind === 'group') {
      const j = it.sessions.findIndex((m) => m.name === name);
      if (j >= 0) return { group: it, index: j, pinned: !!it.sessions[j].pinned };
    }
  }
  return null;
}
const groupById = (l: SidebarLayout, id: string) => l.items.find((i): i is Group => i.kind === 'group' && i.id === id) ?? null;
const groupIndex = (l: SidebarLayout, id: string) => l.items.findIndex((i) => i.kind === 'group' && i.id === id);

/** onNewSession — диалог новой сессии (group — сразу в эту группу). */
export function SessionList({ onNewSession }: { onNewSession: (group?: string) => void }) {
  const { sessions, current, layout } = useAppState();
  const byName = useMemo(() => new Map(sessions.map((s) => [s.name, s])), [sessions]);
  const live = useMemo(() => new Set(byName.keys()), [byName]);
  const rows = useMemo(() => rowsOf(layout, live), [layout, live]);

  const box = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    setHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);
  const pages = useMemo(() => {
    if (height <= 0) return [rows];
    const one = paginate(rows, ROW_HEIGHTS, height);
    return one.length > 1 ? paginate(rows, ROW_HEIGHTS, height - PAGER_H) : one;
  }, [rows, height]);
  const [page, setPage] = useState(0);
  const pageIdx = Math.min(page, pages.length - 1);

  // Выбранная сессия — на видимой странице
  useEffect(() => {
    if (!current) return;
    const i = pages.findIndex((p) => p.some((r) => r.kind === 'session' && r.name === current));
    if (i >= 0) setPage(i);
  }, [current]);

  const [drag, setDrag] = useState<ItemRef | null>(null);
  const [drop, setDrop] = useState<Drop>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const flip = useRef<ReturnType<typeof setTimeout> | null>(null);

  // После перестановки с клавиатуры фокус остаётся на том же элементе
  useEffect(() => {
    if (!focusKey) return;
    const i = pages.findIndex((p) => p.some((r) => rowKey(r) === focusKey));
    if (i >= 0 && i !== pageIdx) return setPage(i);
    box.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(focusKey)}"]`)?.focus();
    setFocusKey(null);
  }, [focusKey, pages, pageIdx]);

  // ── Перетаскивание ──
  const startDrag = (e: DragEvent, ref: ItemRef) => {
    e.dataTransfer.setData(DND, JSON.stringify(ref));
    e.dataTransfer.effectAllowed = 'move';
    setDrag(ref);
  };
  const endDrag = () => {
    setDrag(null);
    setDrop(null);
    if (flip.current) clearTimeout(flip.current);
  };
  const dropEdge = (e: DragEvent, row: Row): Drop => {
    if (!drag) return null;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    if (row.kind === 'group' && 'session' in drag) return { key: rowKey(row), edge: 'into' };
    return { key: rowKey(row), edge: after ? 'after' : 'before' };
  };
  const onDragOver = (e: DragEvent, row: Row) => {
    if (!drag || (row.kind !== 'session' && row.kind !== 'group')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const d = dropEdge(e, row);
    if (d?.key !== drop?.key || d?.edge !== drop?.edge) setDrop(d);
  };
  const onDrop = (e: DragEvent, row: Row) => {
    e.preventDefault();
    const ref = drag;
    const d = dropEdge(e, row);
    endDrag();
    if (!ref || !d) return;
    updateLayout((l) => {
      if (row.kind === 'group' && d.edge === 'into' && 'session' in ref) return moveToGroup(l, ref.session, row.id);
      const after = d.edge === 'after' ? 1 : 0;
      if ('group' in ref || (row.kind === 'session' && row.group === null) || row.kind === 'group') {
        // Группы — только на верхнем уровне: место считается по группе строки
        const topId = row.kind === 'group' ? row.id : row.kind === 'session' && row.group ? row.group : null;
        const index = topId
          ? groupIndex(l, topId) + after
          : l.items.findIndex((i) => i.kind === 'session' && i.name === (row as { name: string }).name) + after;
        return move(l, ref, { group: null, index });
      }
      if (row.kind !== 'session' || row.group === null) return l;
      const g = groupById(l, row.group);
      const index = (g?.sessions.findIndex((m) => m.name === row.name) ?? 0) + after;
      return move(l, ref, { group: row.group, index });
    });
  };
  const flipOnHover = (to: number) => () => {
    if (!drag) return;
    if (flip.current) clearTimeout(flip.current);
    flip.current = setTimeout(() => setPage(Math.max(0, Math.min(pages.length - 1, to))), PAGE_FLIP_MS);
  };
  const cancelFlip = () => {
    if (flip.current) clearTimeout(flip.current);
  };

  // ── Клавиатура ──
  const shift = (ref: ItemRef, delta: -1 | 1) =>
    updateLayout((l) => {
      let pos: Pos;
      if ('group' in ref) {
        const i = groupIndex(l, ref.group);
        pos = { group: null, index: delta < 0 ? i - 1 : i + 2 };
      } else {
        const at = whereIs(l, ref.session);
        if (!at) return l;
        pos = { group: at.group?.id ?? null, index: delta < 0 ? at.index - 1 : at.index + 2 };
      }
      if (pos.index < 0) return l;
      return move(l, ref, pos);
    });
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, ref: ItemRef) => {
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      shift(ref, e.key === 'ArrowUp' ? -1 : 1);
      setFocusKey(refKey(ref));
    } else if ((e.shiftKey && e.key === 'F10') || e.key === 'ContextMenu') {
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      setMenu({ x: r.left + 24, y: r.bottom - 6, ref });
    }
  };
  const onContext = (e: MouseEvent, ref: ItemRef) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, ref });
  };

  // ── Меню ──
  const listItems: MenuEntry[] = [
    { label: 'Новая сессия…', icon: <IconPlus />, onSelect: () => onNewSession() },
    { label: 'Новая группа…', icon: <IconFolder />, onSelect: () => setDialog({ kind: 'new-group' }) },
  ];
  // ПКМ и Shift+F10 по пустому месту списка (не по сессии и не по группе)
  const onListContext = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, [role="menu"], [role="dialog"], .overlay')) return;
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, ref: 'list' });
  };
  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || !((e.shiftKey && e.key === 'F10') || e.key === 'ContextMenu')) return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({ x: r.left + 24, y: r.top + 24, ref: 'list' });
  };

  const menuItems = (ref: ItemRef): MenuEntry[] => {
    if ('group' in ref) {
      const g = groupById(layout, ref.group);
      if (!g) return [];
      return [
        { label: g.pinned ? 'Открепить' : 'Закрепить', icon: <IconPin size={14} />, onSelect: () => updateLayout((l) => togglePin(l, ref)) },
        { label: g.collapsed ? 'Развернуть' : 'Свернуть', onSelect: () => updateLayout((l) => toggleCollapsed(l, g.id)) },
        { label: 'Переименовать…', onSelect: () => setDialog({ kind: 'rename', id: g.id, name: g.name }) },
        { label: 'Новая сессия…', icon: <IconPlus />, onSelect: () => onNewSession(g.id) },
        { label: '', separator: true },
        { label: 'Удалить группу', danger: true, icon: <IconClose />, onSelect: () => setDialog({ kind: 'delete-group', id: g.id, name: g.name }) },
      ];
    }
    const at = whereIs(layout, ref.session);
    const groups = layout.items.filter((i): i is Group => i.kind === 'group' && i.id !== at?.group?.id);
    return [
      { label: at?.pinned ? 'Открепить' : 'Закрепить', icon: <IconPin size={14} />, onSelect: () => updateLayout((l) => togglePin(l, ref)) },
      {
        label: 'Переместить в группу',
        icon: <IconFolder />,
        submenu: [
          ...groups.map((g): MenuEntry => ({ label: g.name, onSelect: () => updateLayout((l) => moveToGroup(l, ref.session, g.id)) })),
          ...(groups.length ? [{ label: '', separator: true }] : []),
          { label: 'Новая группа…', onSelect: () => setDialog({ kind: 'new-group', session: ref.session }) },
        ],
      },
      { label: 'Убрать из группы', disabled: !at?.group, onSelect: () => updateLayout((l) => removeFromGroup(l, ref.session)) },
      { label: '', separator: true },
      { label: 'Завершить сессию', danger: true, icon: <IconClose />, onSelect: () => setDialog({ kind: 'kill', name: ref.session }) },
    ];
  };

  // ── Строки ──
  const dropClass = (r: Row) => (drop && drop.key === rowKey(r) ? ` drop-${drop.edge}` : '');
  const renderSession = (r: Extract<Row, { kind: 'session' }>, s: TmuxSession, hidden: boolean) => {
    const pinned = whereIs(layout, s.name)?.pinned ?? false;
    const others = s.attachedClients - (current === s.name ? 1 : 0);
    const ref: ItemRef = { session: s.name };
    return (
      <li
        key={rowKey(r)}
        hidden={hidden}
        className={`row-session${r.group ? ' in-group' : ''}${dropClass(r)}`}
        onDragOver={(e) => onDragOver(e, r)}
        onDrop={(e) => onDrop(e, r)}
      >
        <button
          type="button"
          className="session-item"
          data-key={rowKey(r)}
          draggable
          aria-current={current === s.name ? 'page' : undefined}
          onClick={() => openSession(s.name)}
          onContextMenu={(e) => onContext(e, ref)}
          onKeyDown={(e) => onKey(e, ref)}
          onDragStart={(e) => startDrag(e, ref)}
          onDragEnd={endDrag}
        >
          <span className="session-line">
            <span className={s.claudeRunning ? 'dot dot-claude' : 'dot dot-idle'} aria-hidden="true" />
            <span className="session-name ellipsis">{s.name}</span>
            {others > 0 ? <span className="tag">открыта в cmd</span> : !s.claudeRunning ? <span className="caption">{s.command}</span> : null}
            {pinned ? <span className="pin"><IconPin label="Закреплена" /></span> : null}
          </span>
          <span className="session-cwd ellipsis">{shortPath(s.cwd)}</span>
        </button>
      </li>
    );
  };
  const renderGroup = (r: Extract<Row, { kind: 'group' }>, pageNo: number, hidden: boolean) => {
    const g = groupById(layout, r.id);
    if (!g) return null;
    const count = g.sessions.filter((m) => live.has(m.name)).length;
    const ref: ItemRef = { group: g.id };
    return (
      <li key={`${rowKey(r)}${r.continued ? `:c${pageNo}` : ''}`} hidden={hidden} className={`row-group${dropClass(r)}`} onDragOver={(e) => onDragOver(e, r)} onDrop={(e) => onDrop(e, r)}>
        <button
          type="button"
          className="group-header"
          data-key={r.continued ? undefined : rowKey(r)}
          draggable
          aria-expanded={!g.collapsed}
          aria-label={`Группа ${g.name}, сессий: ${count}${g.pinned ? ', закреплена' : ''}${r.continued ? ', продолжение' : ''}`}
          onClick={() => updateLayout((l) => toggleCollapsed(l, g.id))}
          onContextMenu={(e) => onContext(e, ref)}
          onKeyDown={(e) => onKey(e, ref)}
          onDragStart={(e) => startDrag(e, ref)}
          onDragEnd={endDrag}
        >
          {g.collapsed ? <IconChevronRight /> : <IconChevron />}
          <span className="ellipsis">{g.name}</span>
          {r.continued ? <span className="caption">продолжение</span> : <span className="group-count">{count}</span>}
          {g.pinned ? <span className="pin"><IconPin /></span> : null}
        </button>
      </li>
    );
  };

  const menuRef = menu?.ref;
  return (
    <div className="session-box" ref={box} tabIndex={0} role="group" aria-label="Список сессий (Shift+F10 — меню)"
      onContextMenu={onListContext} onKeyDown={onListKey}>
      <ul className="session-list">
        {/* Строки всех страниц в DOM, чужие страницы скрыты: при перелистывании во время перетаскивания
            тащимая строка не исчезает, иначе Chromium обрывает перетаскивание и dragend не приходит */}
        {pages.flatMap((p, pi) =>
          p.map((r, i) => {
            const hidden = pi !== pageIdx;
            if (r.kind === 'section') return <li key={`sec-${pi}-${i}`} hidden={hidden} className="row-section caption">{r.label}</li>;
            if (r.kind === 'divider') return <li key={`div-${pi}-${i}`} hidden={hidden} className="row-divider" role="separator" />;
            if (r.kind === 'group') return renderGroup(r, pi, hidden);
            const s = byName.get(r.name);
            return s ? renderSession(r, s, hidden) : null;
          }),
        )}
      </ul>
      {pages.length > 1 ? (
        <div className="pager">
          <button type="button" className="pager-btn" aria-label="Предыдущая страница" disabled={pageIdx === 0}
            onClick={() => setPage(pageIdx - 1)} onDragEnter={flipOnHover(pageIdx - 1)} onDragOver={(e) => drag && e.preventDefault()} onDragLeave={cancelFlip}>
            <IconChevronLeft />
          </button>
          <span className="caption">{pageIdx + 1} / {pages.length}</span>
          <button type="button" className="pager-btn" aria-label="Следующая страница" disabled={pageIdx === pages.length - 1}
            onClick={() => setPage(pageIdx + 1)} onDragEnter={flipOnHover(pageIdx + 1)} onDragOver={(e) => drag && e.preventDefault()} onDragLeave={cancelFlip}>
            <IconChevronRight size={14} />
          </button>
        </div>
      ) : null}

      {menu && menuRef ? (
        <ContextMenu
          label={
            menuRef === 'list'
              ? 'Список сессий'
              : 'session' in menuRef
                ? `Действия с сессией ${menuRef.session}`
                : `Действия с группой ${groupById(layout, menuRef.group)?.name ?? ''}`
          }
          x={menu.x}
          y={menu.y}
          items={menuRef === 'list' ? listItems : menuItems(menuRef)}
          onClose={() => setMenu(null)}
        />
      ) : null}

      {dialog?.kind === 'new-group' ? (
        <GroupNameDialog
          title="Новая группа"
          submitLabel="Создать"
          onClose={() => setDialog(null)}
          onSubmit={(name) => {
            setDialog(null);
            updateLayout((l) => createGroup(l, name, dialog.session).layout);
          }}
        />
      ) : null}
      {dialog?.kind === 'rename' ? (
        <GroupNameDialog
          title="Переименовать группу"
          submitLabel="Сохранить"
          initial={dialog.name}
          onClose={() => setDialog(null)}
          onSubmit={(name) => {
            setDialog(null);
            updateLayout((l) => renameGroup(l, dialog.id, name));
          }}
        />
      ) : null}
      {dialog?.kind === 'delete-group' ? (
        <ConfirmDialog
          title={`Удалить группу ${dialog.name}?`}
          text="Сессии останутся в списке, удалится только группа."
          confirmLabel="Удалить"
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            setDialog(null);
            updateLayout((l) => deleteGroup(l, dialog.id));
          }}
        />
      ) : null}
      {dialog?.kind === 'kill' ? (
        <ConfirmDialog
          title={`Завершить сессию ${dialog.name}?`}
          text="tmux kill-session остановит claude и всё, что запущено в этой сессии."
          confirmLabel="Завершить"
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            setDialog(null);
            void killSession(dialog.name);
          }}
        />
      ) : null}
    </div>
  );
}
