import { useEffect, useRef, useState } from 'react';

const KEY_PAUSE_MS = 600;

/**
 * Effort ползунком. /effort уходит, когда выбор закончен: мышь или палец отпустили (pointerup, change),
 * со стрелками клавиатуры — после паузы, одной командой (иначе каждый шаг уходил бы в claude отдельно).
 * Уровень, который уже отправлен, повторно не отправляется. Неизвестный текущий уровень — бегунок посередине,
 * подпись «—», и даже отпускание на том же месте выбирает его.
 */
export function EffortSlider({ levels, value, onCommit }: { levels: string[]; value?: string; onCommit: (level: string) => void }) {
  const known = value !== undefined && levels.includes(value);
  const [at, setAt] = useState(known ? levels.indexOf(value!) : Math.floor((levels.length - 1) / 2));
  const [moved, setMoved] = useState(known);
  const input = useRef<HTMLInputElement>(null);
  const sent = useRef<string | null>(known ? value! : null);
  const keyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fromKeys = useRef(false);
  const commit = useRef(onCommit);
  commit.current = onCommit;

  useEffect(() => {
    if (value !== undefined && levels.includes(value)) {
      setAt(levels.indexOf(value));
      setMoved(true);
      sent.current = value;
    }
  }, [value, levels]);

  const send = () => {
    const el = input.current;
    if (!el) return;
    const level = levels[Math.min(Number(el.value), levels.length - 1)];
    setMoved(true);
    if (level === sent.current) return;
    sent.current = level;
    commit.current(level);
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

  return (
    <label className="effort" title="Effort · отправит /effort">
      <span className="caption">Effort</span>
      <input
        ref={input}
        type="range"
        aria-label="Effort"
        aria-valuetext={moved ? levels[at] : 'не выбран'}
        min={0}
        max={levels.length - 1}
        step={1}
        value={Math.min(at, levels.length - 1)}
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
      <span className="caption effort-value">{moved ? levels[Math.min(at, levels.length - 1)] : '—'}</span>
    </label>
  );
}
