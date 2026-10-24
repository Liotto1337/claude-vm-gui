import { useEffect, useRef, useState } from 'react';
import type { ContextCategory, TmuxSession } from '@shared/ipc';
import { contextView } from '@shared/context-parse';
import { formatTokens } from '@shared/usage';
import { api } from '../api';
import { contextNow, windowFor } from '../context-window';
import { useAppState } from '../state';
import { terminalTheme } from '../terminal-theme';
import { CompactDialog } from './CompactDialog';

const REFRESH_MS = 10_000;
const WAIT_MS = 15_000;
/** Когда /context уходил в сессию последний раз (между перемонтированиями шапки) */
const lastSent = new Map<string, number>();

const ANSI = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'] as const;
/** Цвет категории — палитра терминала текущей темы, как значки в выводе /context */
function categoryColor(c: ContextCategory): string {
  const code = Number(c.color?.slice(5));
  const theme = terminalTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light') as Record<string, string | undefined>;
  const i = code >= 90 ? code - 90 : code - 30;
  if (!(i >= 0 && i < 8)) return 'var(--text-3)';
  const key = code >= 90 ? `bright${ANSI[i][0].toUpperCase()}${ANSI[i].slice(1)}` : ANSI[i];
  return theme[key] ?? 'var(--text-3)';
}
const NOT_USED = new Set(['Free space', 'Autocompact buffer']);
const hhmm = (t: number) => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

/** Значок «Контекст N %» в шапке сессии и панель: разбивка из /context, «до автосжатия», «Сжать сессию». */
export function ContextBadge({ session }: { session: TmuxSession }) {
  const c = useAppState().chat[session.name];
  const ctx = c?.context ?? { used: null, usedAt: null, model: null, snapshot: null, snapshotAt: null, snapshotModel: null };
  const now = contextNow(ctx);
  const view = contextView(now.used, windowFor(ctx));
  const free = !!c && !c.busy && c.screen?.kind === 'prompt' && c.screen.status === null && c.screen.input.trim() === '';
  const [open, setOpen] = useState(false);
  /** Замер пришёл в это открытие панели — пометка времени не нужна */
  const [fresh, setFresh] = useState(false);
  const [waitingFrom, setWaitingFrom] = useState<number | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  /** Замер, который был до отправки /context: новый отличается от него */
  const sentOver = useRef<number | null>(null);

  // Пришёл новый замер или вышло время — «обновляю…» снимается
  useEffect(() => {
    if (waitingFrom === null) return;
    if (ctx.snapshotAt !== null && ctx.snapshotAt !== sentOver.current) {
      setFresh(true);
      return setWaitingFrom(null);
    }
    const t = setTimeout(() => setWaitingFrom(null), WAIT_MS);
    return () => clearTimeout(t);
  }, [waitingFrom, ctx.snapshotAt]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const toggle = () => {
    if (open) return setOpen(false);
    const now = Date.now();
    setOpen(true);
    setFresh(false);
    setError(null);
    if (free && now - (lastSent.get(session.name) ?? 0) >= REFRESH_MS) {
      lastSent.set(session.name, now);
      sentOver.current = ctx.snapshotAt;
      setWaitingFrom(now);
      void api.term.send('/context', [], session.name).then((r) => {
        if (!r.ok) setWaitingFrom(null);
      });
    }
  };

  const label = view.pct !== null ? `Контекст ${view.pct} %` : view.used !== null ? `Контекст ${formatTokens(view.used)}` : 'Контекст —';
  const snap = ctx.snapshot;
  // разбивка старее ответа и заметно расходится с ним — полоска одним цветом, чтобы не спорила с числом
  const used = snap && now.fresh ? snap.categories.filter((k) => !NOT_USED.has(k.name)) : [];
  const note =
    waitingFrom !== null ? 'обновляю…' : !snap ? 'Разбивка недоступна' : !fresh && ctx.snapshotAt !== null ? `Разбивка на ${hhmm(ctx.snapshotAt)}` : null;

  return (
    <div className="choice context" ref={root} onKeyDown={(e) => e.key === 'Escape' && !confirm && setOpen(false)}>
      <button type="button" className={`choice-btn context-badge context-${view.level}`} aria-haspopup="dialog" aria-expanded={open} onClick={toggle}>
        {label}
      </button>
      {open ? (
        <div role="dialog" aria-label="Контекст" className="popup choice-menu context-panel">
          <div className="caption choice-title">Контекст</div>
          <div className="usage-row">
            <div className="usage-head">
              <span>Использовано: {view.pct !== null ? `${view.pct} %` : view.used !== null ? formatTokens(view.used) : '—'}</span>
              {view.used !== null && view.window !== null ? <span className="caption">{formatTokens(view.used)} / {formatTokens(view.window)}</span> : null}
            </div>
            {view.window !== null && view.used !== null ? (
              <div role="progressbar" aria-label="Использовано" aria-valuenow={view.pct ?? 0} aria-valuemin={0} aria-valuemax={100} className="bar bar-thin context-bar">
                {used.length > 0 ? (
                  used.map((k) => <div key={k.name} className="bar-fill" style={{ width: `${(k.tokens / view.window!) * 100}%`, background: categoryColor(k) }} />)
                ) : (
                  <div className="bar-fill" style={{ width: `${view.pct}%` }} />
                )}
              </div>
            ) : null}
          </div>
          {snap ? (
            <ul className="context-list">
              {snap.categories.map((k) => (
                <li key={k.name} className="context-row">
                  <span className="context-dot" style={{ background: categoryColor(k), opacity: k.dim ? 0.5 : 1 }} aria-hidden="true" />
                  <span className="context-name">{k.name}</span>
                  <span className="caption">{formatTokens(k.tokens)}</span>
                  <span className="caption context-pct">{k.pct.toFixed(1)} %</span>
                </li>
              ))}
            </ul>
          ) : null}
          {note ? <div className="caption">{note}</div> : null}
          {error ? <div className="form-error">{error}</div> : null}
          <div className="context-foot">
            <span className="caption">{view.toAutocompact !== null ? `Токенов до автосжатия: ${formatTokens(view.toAutocompact)}` : ''}</span>
            <button type="button" className="btn btn-sm" disabled={!free} title={free ? undefined : 'Дождитесь окончания ответа'} onClick={() => setConfirm(true)}>
              Сжать сессию
            </button>
          </div>
        </div>
      ) : null}
      {confirm ? (
        <CompactDialog
          onCancel={() => setConfirm(false)}
          onConfirm={(command) => {
            setConfirm(false);
            setOpen(false);
            void api.term.send(command, [], session.name).then((r) => {
              if (!r.ok) {
                setOpen(true);
                setError(r.error.message);
              }
            });
          }}
        />
      ) : null}
    </div>
  );
}
