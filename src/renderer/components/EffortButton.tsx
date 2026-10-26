import { useEffect, useRef, useState } from 'react';
import { IconChevron } from './icons';

const KEY_PAUSE_MS = 600;

/**
 * Effort у поля ввода: кнопка с текущим уровнем, по нажатию — панель с ползунком, делениями и подписями.
 * /effort уходит, когда выбор закончен: мышь или палец отпустили (pointerup, change), со стрелками клавиатуры —
 * после паузы, одной командой; нажатие на подпись — сразу этот уровень. Уровень, который уже отправлен, повторно
 * не отправляется. Неизвестный текущий уровень — бегунок посередине, на кнопке «Effort», и даже отпускание
 * на том же месте выбирает его. Панель закрывается вторым нажатием на кнопку, Esc и нажатием вне.
 * phone — панель по ширине поля ввода, подписи — в зоне касания.
 */
export function EffortButton({ levels, value, onCommit, phone = false }: { levels: string[]; value?: string; onCommit: (level: string) => void; phone?: boolean }) {
  const known = value !== undefined && levels.includes(value);
  const [at, setAt] = useState(known ? levels.indexOf(value!) : Math.floor((levels.length - 1) / 2));
  const [moved, setMoved] = useState(known);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const sent = useRef<string | null>(known ? value! : null);
  const keyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fromKeys = useRef(false);
  const commit = useRef(onCommit);
  commit.current = onCommit;
  const idx = Math.min(at, levels.length - 1);
  const current = moved ? levels[idx] : null;

  useEffect(() => {
    if (value !== undefined && levels.includes(value)) {
      setAt(levels.indexOf(value));
      setMoved(true);
      sent.current = value;
    }
  }, [value, levels]);

  const choose = (i: number) => {
    const level = levels[Math.min(i, levels.length - 1)];
    setAt(i);
    setMoved(true);
    if (level === sent.current) return;
    sent.current = level;
    commit.current(level);
  };
  const send = () => {
    if (input.current) choose(Number(input.current.value));
  };

  useEffect(() => {
    const el = input.current;
    if (!el) return;
    // change от мыши и пальца — выбор закончен; от клавиатуры он приходит на каждом шаге — ждём паузы
    const changed = () => {
      if (!fromKeys.current) send();
    };
    el.addEventListener('change', changed);
    return () => el.removeEventListener('change', changed);
  });
  useEffect(() => () => {
    if (keyTimer.current) clearTimeout(keyTimer.current);
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const pos = (i: number) => `${levels.length > 1 ? (i / (levels.length - 1)) * 100 : 50}%`;

  return (
    <div className="choice" ref={root} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
      <button
        type="button"
        className="choice-btn"
        title="Effort · отправит /effort"
        aria-label={current ? `Effort: ${current}` : 'Effort'}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {current ?? 'Effort'}
        <IconChevron />
      </button>
      {open ? (
        <div role="dialog" aria-label="Effort" className={`popup choice-menu effort-panel${phone ? ' is-phone' : ''}`}>
          <div className="caption choice-title">Effort · отправит /effort</div>
          <div className="effort-scale">
            <div className="effort-labels">
              {levels.map((l, i) => (
                <button
                  key={l}
                  type="button"
                  className={l === current ? 'effort-label is-on' : 'effort-label'}
                  aria-pressed={l === current}
                  style={{ left: pos(i) }}
                  onClick={() => choose(i)}
                >
                  {l}
                </button>
              ))}
            </div>
            <div className="effort-ticks" aria-hidden="true">
              {levels.map((l, i) => (
                <span key={l} className="effort-tick" style={{ left: pos(i) }} />
              ))}
            </div>
            <input
              ref={input}
              type="range"
              aria-label="Effort"
              aria-valuetext={current ?? 'не выбран'}
              min={0}
              max={levels.length - 1}
              step={1}
              value={idx}
              onChange={(e) => {
                setAt(Number(e.target.value));
                setMoved(true);
              }}
              onPointerDown={() => {
                fromKeys.current = false;
              }}
              onPointerUp={send}
              onKeyDown={() => {
                fromKeys.current = true;
              }}
              onKeyUp={() => {
                if (keyTimer.current) clearTimeout(keyTimer.current);
                keyTimer.current = setTimeout(send, KEY_PAUSE_MS);
              }}
              onBlur={() => {
                if (keyTimer.current) clearTimeout(keyTimer.current);
                if (fromKeys.current) send();
                fromKeys.current = false;
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
