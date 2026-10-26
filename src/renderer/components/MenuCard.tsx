import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { MenuKey, MenuOption, ParsedMenu } from '@shared/ipc';
import { answerKeysFor, menuChoiceFrom, moveKeysFor, type MenuChoice } from '@shared/screen-parse';
import { api } from '../api';
import { menuKey, menuKeys } from '../state';

/** Сколько ждать, что Claude Code принял ответ (меню сменилось), прежде чем показать ошибку */
const ACCEPT_MS = 3000;

/** Клавиши, которые уходят в claude сразу: смена вопроса, отмена, ось effort */
const DIRECT: Record<string, MenuKey> = { ArrowLeft: 'left', ArrowRight: 'right', Escape: 'esc' };

/** То же меню, что на экране: заголовок, подписи вариантов, текущий вопрос (отметки и курсор не в счёт) */
const menuSig = (m: ParsedMenu) => JSON.stringify([m.title, m.options.map((o) => o.label), m.tabs?.current ?? null]);

/** Свой ответ («Type something.»): поле прямо в варианте, текст собирается локально. */
function OwnAnswer({ value, disabled, onChange, onFocus, onSubmit }: {
  value: string; disabled: boolean; onChange: (v: string) => void; onFocus: () => void; onSubmit: () => void;
}) {
  return (
    <input
      className="field menu-own"
      aria-label="Свой ответ"
      placeholder="Свой ответ…"
      value={value}
      disabled={disabled}
      onClick={(e) => e.stopPropagation()}
      onFocus={onFocus}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          onSubmit();
        }
      }}
    />
  );
}

function Label({ o }: { o: MenuOption }) {
  return (
    <span className="menu-label">
      {o.n !== null ? <span className="caption menu-n">{o.n}.</span> : null}
      {o.label}
      {o.description ? <span className="caption"> {o.description}</span> : null}
    </span>
  );
}

/**
 * Меню Claude Code (разрешение, вопрос, выбор) последним элементом ленты: один выбор — радиокнопки,
 * несколько — чекбоксы и «Готово». Выбор собирается в карточке без задержки; Enter, «Ответить» или «Готово»
 * отправляют его одной пачкой клавиш от состояния экрана (`answerKeysFor`). ←→, Esc и effort ◀ ▶ — сразу.
 */
export function MenuCard({ session, menu }: { session: string; menu: ParsedMenu }) {
  const card = useRef<HTMLDivElement>(null);
  const title = menu.title || 'Claude Code спрашивает';
  const multi = menu.kind === 'multi';
  const sig = menuSig(menu);
  const latest = useRef(menu);
  latest.current = menu;
  const [choice, setChoice] = useState<MenuChoice>(() => menuChoiceFrom(menu));
  const [sending, setSending] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    card.current?.focus();
  }, [title]);

  // Другое меню или следующий вопрос — выбор снова как на экране
  useEffect(() => {
    setChoice(menuChoiceFrom(latest.current));
    setSending(null);
    setError(null);
  }, [sig]);

  // Ответ ушёл, а меню то же — Claude Code его не принял: показываем, что реально выбрано
  useEffect(() => {
    if (sending === null) return;
    const t = setTimeout(() => {
      setChoice(menuChoiceFrom(latest.current));
      setError('Claude Code не принял ответ — проверьте выбор');
      setSending(null);
    }, ACCEPT_MS);
    return () => clearTimeout(t);
  }, [sending]);

  const shown = menu.options.map((o, i) => [o, i] as const).filter(([o]) => !o.submit);
  const tabs = menu.tabs && menu.tabs.labels.length > 1 ? menu.tabs : null;
  const isBox = (o: MenuOption | undefined) => multi && o?.checked !== undefined;
  const busy = sending !== null;

  const toggle = (i: number) => setChoice((c) => ({ ...c, cursor: i, checked: c.checked.map((v, j) => (j === i ? !v : v)) }));
  const pick = (i: number) => (isBox(menu.options[i]) ? toggle(i) : setChoice((c) => ({ ...c, cursor: i })));

  const send = async () => {
    if (busy) return;
    const o = menu.options[choice.cursor];
    // в меню с чекбоксами вариант без отметки («Chat about this») выбирается как обычный
    const plan = multi && o && o.checked === undefined && !o.input
      ? { keys: [...moveKeysFor(menu, choice.cursor), 'enter'] as MenuKey[], ownText: null, after: [] as MenuKey[] }
      : answerKeysFor(menu, choice);
    setError(null);
    setSending(Date.now());
    const stop = (message: string) => {
      setError(message);
      setSending(null);
    };
    const first = await menuKeys(session, plan.keys);
    if (!first.ok) return stop(first.error.message);
    if (plan.ownText === null) return;
    const typed = await api.chat.typeText(plan.ownText, session);
    if (!typed.ok) return stop(typed.error.message);
    const rest = await menuKeys(session, plan.after);
    if (!rest.ok) stop(rest.error.message);
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    let direct: MenuKey | undefined = DIRECT[e.key];
    if (e.key === 'Tab') direct = e.shiftKey ? 'shift-tab' : 'tab';
    if (direct) {
      e.preventDefault();
      e.stopPropagation();
      void menuKey(session, direct);
      return;
    }
    if (!['ArrowUp', 'ArrowDown', ' ', 'Enter'].includes(e.key) && !/^[1-9]$/.test(e.key)) return;
    // Стрелки не листают ленту и не выключают слежение за низом
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    if (e.key === 'Enter') return void send();
    if (e.key === ' ') return isBox(menu.options[choice.cursor]) ? toggle(choice.cursor) : undefined;
    if (/^[1-9]$/.test(e.key)) {
      const i = menu.options.findIndex((o) => o.n === Number(e.key));
      if (i >= 0) pick(i);
      return;
    }
    const at = shown.findIndex(([, i]) => i === choice.cursor);
    const next = shown[Math.min(shown.length - 1, Math.max(0, (at < 0 ? 0 : at) + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (next) setChoice((c) => ({ ...c, cursor: next[1] }));
  };

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
          const box = isBox(o);
          const on = box ? !!choice.checked[i] : choice.cursor === i;
          return (
            <div
              key={`${i}-${o.label}`}
              role={box ? 'checkbox' : 'radio'}
              aria-checked={on}
              aria-disabled={busy || undefined}
              className={choice.cursor === i ? 'menu-option is-cursor' : 'menu-option'}
              onClick={() => !busy && pick(i)}
            >
              <span className={box ? `menu-check${on ? ' is-on' : ''}` : `menu-radio${on ? ' is-on' : ''}`} aria-hidden="true" />
              <Label o={o} />
              {o.input ? (
                <OwnAnswer
                  value={choice.own}
                  disabled={busy}
                  onChange={(own) => setChoice((c) => ({ ...c, own, cursor: i }))}
                  onFocus={() => setChoice((c) => ({ ...c, cursor: i }))}
                  onSubmit={() => void send()}
                />
              ) : null}
            </div>
          );
        })}
      </div>
      {menu.axis ? (
        <div className="menu-axis">
          <button type="button" className="icon-btn" aria-label="Меньше" onClick={() => void menuKey(session, 'left')}>◀</button>
          <span>{menu.axis.value}</span>
          <button type="button" className="icon-btn" aria-label="Больше" onClick={() => void menuKey(session, 'right')}>▶</button>
        </div>
      ) : null}
      {menu.notes.length ? <div className="caption menu-notes">{menu.notes.join(' · ')}</div> : null}
      {error ? <div className="form-error menu-notes">{error}</div> : null}
      <div className="menu-foot">
        <div className="caption menu-hint">
          {busy ? 'отправляю…' : `↑↓ — выбор · ${multi ? 'Пробел — отметить · Enter — готово' : 'Enter — ответить'} · Esc — отмена`}
        </div>
        {multi && menu.options.some((o) => o.submit) ? (
          <button type="button" className="btn btn-sm btn-dark" disabled={busy} onClick={() => void send()}>Готово</button>
        ) : !multi ? (
          <button type="button" className="btn btn-sm btn-dark" disabled={busy} onClick={() => void send()}>Ответить</button>
        ) : null}
      </div>
    </div>
  );
}
