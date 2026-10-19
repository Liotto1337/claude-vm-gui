import { useLayoutEffect, useRef, useState } from 'react';
import { api } from '../api';
import { typingDone, useAppState } from '../state';
import { ChatItemView } from './ChatItemView';
import { IconImage } from './icons';
import { Spinner } from './Spinner';

const NEAR_BOTTOM = 48;

/** Лента переписки открытой сессии (вместо терминала, пока работает claude). */
export function ChatView({ session }: { session: string }) {
  const chat = useAppState().chat[session];
  const items = chat?.items ?? [];
  const status = chat?.screen?.kind === 'prompt' ? chat.screen.status : null;
  const working = status !== null || (!!chat?.busy && chat.screen?.kind !== 'menu');
  const pending = chat?.pending ?? [];
  const typing = chat?.typing ?? {};
  // Пока ответ «печатается», лента следит за низом
  const [tick, setTick] = useState(0);
  const box = useRef<HTMLElement>(null);
  const atBottom = useRef(true);
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
    if (atBottom.current) el.scrollTop = el.scrollHeight;
    else setBehind(true);
  }, [items, status, pending, tick]);

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
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM;
    if (atBottom.current) setBehind(false);
  };

  const loadEarlier = async () => {
    const el = box.current;
    if (el) restore.current = el.scrollHeight - el.scrollTop;
    setLoading(true);
    await api.chat.loadEarlier();
    setLoading(false);
  };

  return (
    <section aria-label="Переписка" className="chat" ref={box} onScroll={onScroll}>
      <div className="chat-inner" ref={inner}>
        {chat?.hasEarlier ? (
          <button type="button" className="btn btn-sm chat-earlier" disabled={loading} onClick={() => void loadEarlier()}>
            Показать раньше
          </button>
        ) : null}
        {items.length === 0 && pending.length === 0 && !working ? <p className="caption chat-empty">Переписка пока пустая</p> : null}
        {items.map((i) => (
          <ChatItemView
            key={i.id}
            item={i}
            typingSince={typing[i.id]}
            onTyped={typing[i.id] !== undefined ? () => {
              typingDone(session, i.id);
              setTick((t) => t + 1);
            } : undefined}
          />
        ))}
        {pending.map((p) => (
          <div key={p.id} className={p.state === 'sending' ? 'bubble is-sending' : 'bubble'}>
            {Array.from({ length: p.images }, (_, k) => (
              <span key={k} className="img-chip">
                <IconImage />
                Картинка
              </span>
            ))}
            {p.text ? <span className="bubble-text">{p.text}</span> : null}
          </div>
        ))}
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
