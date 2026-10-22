import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { displayName, isImageName } from '@shared/upload-name';
import { api } from '../api';
import { typingDone, useAppState } from '../state';
import { ChatItemView } from './ChatItemView';
import { MenuCard } from './MenuCard';
import type { MenuAnswer } from '../menu-history';
import { IconFile, IconImage } from './icons';
import { Spinner } from './Spinner';

const NEAR_BOTTOM = 48;
const UP_KEYS = new Set(['ArrowUp', 'PageUp', 'Home']);

/** Лента переписки открытой сессии (вместо терминала, пока работает claude). */
export function ChatView({ session }: { session: string }) {
  const chat = useAppState().chat[session];
  const items = chat?.items ?? [];
  const status = chat?.screen?.kind === 'prompt' ? chat.screen.status : null;
  const working = status !== null || (!!chat?.busy && chat.screen?.kind !== 'menu');
  const menu = chat?.screen?.kind === 'menu' ? chat.screen.menu : null;
  // Итоги ответов на меню — на месте карточки: после элемента, который был последним, когда меню открылось
  const { answersAfter, answersLost } = useMemo(() => {
    const ids = new Set(items.map((i) => i.id));
    const after = new Map<string, MenuAnswer[]>();
    const lost: MenuAnswer[] = [];
    for (const a of chat?.answers ?? []) {
      if (a.after !== null && ids.has(a.after)) after.set(a.after, [...(after.get(a.after) ?? []), a]);
      else lost.push(a);
    }
    return { answersAfter: after, answersLost: lost };
  }, [items, chat?.answers]);
  const pending = chat?.pending ?? [];
  const typing = chat?.typing ?? {};
  // Пока ответ «печатается», лента следит за низом
  const [tick, setTick] = useState(0);
  const box = useRef<HTMLElement>(null);
  const atBottom = useRef(true);
  // Пользователь сам ушёл вверх (колесо, клавиши): слежение за низом — только когда докрутит до самого низа
  const userUp = useRef(false);
  const sentIds = useRef(new Set(pending.map((p) => p.id)));
  const hadMenu = useRef(false);
  const restore = useRef<number | null>(null);
  const [behind, setBehind] = useState(false);
  const [loading, setLoading] = useState(false);

  // Новые сообщения: прокрутка вниз, если пользователь и так был внизу; ранняя часть — без прыжка
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    if (restore.current !== null) {
      el.scrollTop = el.scrollHeight - restore.current;
      restore.current = null;
      return;
    }
    // Своё новое сообщение и вопрос Claude Code — вниз, где бы ни была лента (как на claude.ai)
    const fresh = pending.some((p) => !sentIds.current.has(p.id)) || (menu !== null && !hadMenu.current);
    hadMenu.current = menu !== null;
    sentIds.current = new Set(pending.map((p) => p.id));
    if (fresh) {
      atBottom.current = true;
      userUp.current = false;
      setBehind(false);
    }
    if (atBottom.current) el.scrollTop = el.scrollHeight;
    else setBehind(true);
  }, [items, status, pending, tick, menu, chat?.answers]);

  // Содержимое растёт само («печать» ответа) — держим низ, если пользователь внизу
  const inner = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
    const content = inner.current;
    if (!el || !content) return;
    const ro = new ResizeObserver(() => {
      if (atBottom.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, []);

  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (gap < 2) userUp.current = false;
    atBottom.current = gap < (userUp.current ? 2 : NEAR_BOTTOM);
    if (atBottom.current) setBehind(false);
  };
  const goingUp = () => {
    const el = box.current;
    if (!el || el.scrollTop <= 0) return; // некуда вверх — лента не прокручивается
    userUp.current = true;
    atBottom.current = false;
  };

  const loadEarlier = async () => {
    const el = box.current;
    if (el) restore.current = el.scrollHeight - el.scrollTop;
    setLoading(true);
    await api.chat.loadEarlier();
    setLoading(false);
  };

  return (
    <section
      aria-label="Переписка"
      className="chat"
      ref={box}
      // Щелчок по ленте отдаёт ей фокус: иначе фокус на body, Chromium листает ленту клавишами, а onKeyDown молчит
      tabIndex={-1}
      onScroll={onScroll}
      onWheel={(e) => e.deltaY < 0 && goingUp()}
      onKeyDown={(e) => UP_KEYS.has(e.key) && goingUp()}
    >
      <div className="chat-inner" ref={inner}>
        {chat?.hasEarlier ? (
          <button type="button" className="btn btn-sm chat-earlier" disabled={loading} onClick={() => void loadEarlier()}>
            Показать раньше
          </button>
        ) : null}
        {items.length === 0 && pending.length === 0 && !working ? <p className="caption chat-empty">Переписка пока пустая</p> : null}
        {items.map((i) => (
          <Fragment key={i.id}>
            <ChatItemView
              item={i}
              typingSince={typing[i.id]}
              onTyped={typing[i.id] !== undefined ? () => {
                typingDone(session, i.id);
                setTick((t) => t + 1);
              } : undefined}
            />
            {answersAfter.get(i.id)?.map((a) => <ChatItemView key={a.id} item={{ kind: 'note', id: a.id, text: a.text }} />)}
          </Fragment>
        ))}
        {/* Якорь итога не в загруженной части журнала (или журнал был пуст) — в конце */}
        {answersLost.map((a) => <ChatItemView key={a.id} item={{ kind: 'note', id: a.id, text: a.text }} />)}
        {pending.map((p) => (
          <div key={p.id} className={p.state === 'sending' ? 'bubble is-sending' : 'bubble'}>
            {p.files.map((f) => (
              <span key={f} className="img-chip">
                {isImageName(f) ? <IconImage /> : <IconFile />}
                {displayName(f)}
              </span>
            ))}
            {p.text ? <span className="bubble-text">{p.text}</span> : null}
          </div>
        ))}
        {menu ? <MenuCard session={session} menu={menu} /> : null}
        {working ? (
          <div className="chat-status" role="status">
            <Spinner /> {status ?? 'Claude работает…'}
          </div>
        ) : null}
      </div>
      {behind ? (
        <button
          type="button"
          className="btn btn-sm chat-new"
          onClick={() => {
            const el = box.current;
            userUp.current = false;
            atBottom.current = true;
            if (el) el.scrollTop = el.scrollHeight;
            setBehind(false);
          }}
        >
          ↓ Новые сообщения
        </button>
      ) : null}
    </section>
  );
}
