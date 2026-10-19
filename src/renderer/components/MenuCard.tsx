import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { MenuKey, ParsedMenu } from '@shared/ipc';
import { menuKeysFor } from '@shared/screen-parse';
import { api } from '../api';

const KEY_MAP: Record<string, MenuKey> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'enter', Escape: 'esc',
};
/** Строка контекста похожа на команду, путь или код — моноширинно. */
const looksLikeCode = (s: string) => /^[$>~/.]|\/|^\s*\d+\s|[{}();=]/.test(s);

/** Меню Claude Code (разрешение, вопрос, выбор) карточкой; клавиши уходят в claude как есть. */
export function MenuCard({ menu }: { menu: ParsedMenu }) {
  const card = useRef<HTMLDivElement>(null);
  const title = menu.title || 'Claude Code спрашивает';

  useEffect(() => {
    card.current?.focus();
  }, [title]);

  const send = async (keys: MenuKey[]) => {
    for (const k of keys) {
      const r = await api.chat.key(k);
      if (!r.ok) break;
    }
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    let k: MenuKey | undefined = KEY_MAP[e.key];
    if (e.key === 'Tab') k = e.shiftKey ? 'shift-tab' : 'tab';
    else if (/^[1-9]$/.test(e.key)) k = e.key as MenuKey;
    if (!k) return;
    e.preventDefault();
    void api.chat.key(k);
  };

  return (
    <div ref={card} role="group" aria-label={title} className="menu-card" tabIndex={-1} onKeyDown={onKey}>
      <div className="menu-head">
        <span className="menu-title">{title}</span>
        {menu.context.map((c, i) => (
          <span key={i} className={looksLikeCode(c) ? 'menu-context mono' : 'menu-context'}>{c}</span>
        ))}
      </div>
      <div role="listbox" aria-label="Варианты" className="menu-options">
        {menu.options.map((o, i) => (
          <div
            key={`${i}-${o.label}`}
            role="option"
            aria-selected={o.selected}
            className="menu-option"
            onClick={() => void send(menuKeysFor(menu, i))}
          >
            <span className={o.selected ? 'menu-num menu-num-on' : 'menu-num'}>{o.n ?? (o.selected ? '❯' : '')}</span>
            <span className="menu-label">
              {o.label}
              {o.description ? <span className="caption"> {o.description}</span> : null}
            </span>
          </div>
        ))}
      </div>
      {menu.notes.length ? <div className="caption menu-notes">{menu.notes.join(' · ')}</div> : null}
      <div className="caption menu-hint">↑↓ — выбор · Enter — ответить · Esc — отмена{menu.options.some((o) => o.n) ? ' · цифра — сразу' : ''}</div>
    </div>
  );
}
