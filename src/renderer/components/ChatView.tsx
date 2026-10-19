import { useLayoutEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useAppState } from '../state';
import { ChatItemView } from './ChatItemView';

const NEAR_BOTTOM = 48;

/** Лента переписки открытой сессии (вместо терминала, пока работает claude). */
export function ChatView({ session }: { session: string }) {
  const chat = useAppState().chat[session];
  const items = chat?.items ?? [];
  const status = chat?.screen?.kind === 'prompt' ? chat.screen.status : null;
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
  }, [items, status]);

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
      <div className="chat-inner">
        {chat?.hasEarlier ? (
          <button type="button" className="btn btn-sm chat-earlier" disabled={loading} onClick={() => void loadEarlier()}>
            Показать раньше
          </button>
        ) : null}
        {items.length === 0 && !status ? <p className="caption chat-empty">Переписка пока пустая</p> : null}
        {items.map((i) => (
          <ChatItemView key={i.id} item={i} />
        ))}
        {status ? (
          <div className="chat-status" role="status">
            <span aria-hidden="true">✻</span> {status}
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
