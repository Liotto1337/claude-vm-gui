import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { MenuKey, MenuOption, ParsedMenu } from '@shared/ipc';
import { menuKeysFor, moveKeysFor, submitKeysFor, toggleKeysFor } from '@shared/screen-parse';
import { api } from '../api';

const KEY_MAP: Record<string, MenuKey> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'enter', Escape: 'esc', ' ': 'space',
};

const send = async (keys: MenuKey[]) => {
  for (const k of keys) {
    const r = await api.chat.key(k);
    if (!r.ok) break;
  }
};

/** Свой ответ («Type something.»): поле прямо в варианте; Enter — курсор на вариант, текст, Enter. */
function OwnAnswer({ menu, index, multi }: { menu: ParsedMenu; index: number; multi: boolean }) {
  const [text, setText] = useState('');
  const submit = async () => {
    if (!text.trim()) return;
    await send(moveKeysFor(menu, index));
    const r = await api.chat.typeText(text);
    if (r.ok && !multi) await api.chat.key('enter');
    setText('');
  };
  return (
    <input
      className="field menu-own"
      aria-label="Свой ответ"
      placeholder="Свой ответ…"
      value={text}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          void submit();
        }
      }}
    />
  );
}

function Label({ o }: { o: MenuOption }) {
  return (
    <span className="menu-label">
      {o.label}
      {o.description ? <span className="caption"> {o.description}</span> : null}
    </span>
  );
}

/**
 * Меню Claude Code (разрешение, вопрос, выбор) последним элементом ленты: один выбор — радиокнопки,
 * несколько — чекбоксы и «Готово»; клавиши уходят в claude как есть.
 */
export function MenuCard({ menu }: { menu: ParsedMenu }) {
  const card = useRef<HTMLDivElement>(null);
  const title = menu.title || 'Claude Code спрашивает';
  const multi = menu.kind === 'multi';

  useEffect(() => {
    card.current?.focus();
  }, [title]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    let k: MenuKey | undefined = KEY_MAP[e.key];
    if (e.key === 'Tab') k = e.shiftKey ? 'shift-tab' : 'tab';
    else if (/^[1-9]$/.test(e.key)) k = e.key as MenuKey;
    if (!k) return;
    e.preventDefault();
    // Стрелки не листают ленту и не выключают слежение за низом
    e.stopPropagation();
    void api.chat.key(k);
  };

  const shown = menu.options.map((o, i) => [o, i] as const).filter(([o]) => !o.submit);
  const tabs = menu.tabs && menu.tabs.labels.length > 1 ? menu.tabs : null;

  return (
    <div ref={card} role="group" aria-label={title} className="menu-card" tabIndex={-1} onKeyDown={onKey}>
      <div className="menu-head">
        {tabs ? <span className="caption">Вопрос {tabs.current + 1} из {tabs.labels.length}</span> : null}
        <span className="menu-title">{title}</span>
        {menu.context.map((c, i) => (
          <span key={i} className={menu.code[i] ? 'menu-context mono' : 'menu-context'}>{c}</span>
        ))}
      </div>
      <div role={multi ? 'group' : 'radiogroup'} aria-label="Варианты" className="menu-options">
        {shown.map(([o, i]) => {
          const box = multi && o.checked !== undefined;
          return (
            <div
              key={`${i}-${o.label}`}
              role={box ? 'checkbox' : 'radio'}
              aria-checked={box ? !!o.checked : o.selected}
              className={o.selected ? 'menu-option is-cursor' : 'menu-option'}
              onClick={() => void send(box ? toggleKeysFor(menu, i) : menuKeysFor(menu, i))}
            >
              <span className={box ? `menu-check${o.checked ? ' is-on' : ''}` : `menu-radio${o.selected ? ' is-on' : ''}`} aria-hidden="true" />
              <Label o={o} />
              {o.input ? <OwnAnswer menu={menu} index={i} multi={multi} /> : null}
            </div>
          );
        })}
      </div>
      {menu.axis ? (
        <div className="menu-axis">
          <button type="button" className="icon-btn" aria-label="Меньше" onClick={() => void api.chat.key('left')}>◀</button>
          <span>{menu.axis.value}</span>
          <button type="button" className="icon-btn" aria-label="Больше" onClick={() => void api.chat.key('right')}>▶</button>
        </div>
      ) : null}
      {menu.notes.length ? <div className="caption menu-notes">{menu.notes.join(' · ')}</div> : null}
      <div className="menu-foot">
        <div className="caption menu-hint">
          ↑↓ — выбор · {multi ? 'Пробел — отметить' : 'Enter — ответить'} · Esc — отмена{!multi && menu.options.some((o) => o.n) ? ' · цифра — сразу' : ''}
        </div>
        {multi && menu.options.some((o) => o.submit) ? (
          <button type="button" className="btn btn-sm btn-dark" onClick={() => void send(submitKeysFor(menu))}>Готово</button>
        ) : null}
      </div>
    </div>
  );
}
