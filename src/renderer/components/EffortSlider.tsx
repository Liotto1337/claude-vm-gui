import { useEffect, useRef, useState } from 'react';

/**
 * Effort ползунком: двигать можно свободно, /effort уходит, когда ползунок отпустили (событие change),
 * а не на каждом шаге. value — последний выбранный уровень (неизвестен — середина, подпись «—»).
 */
export function EffortSlider({ levels, value, onCommit }: { levels: string[]; value?: string; onCommit: (level: string) => void }) {
  const known = value !== undefined && levels.includes(value);
  const [at, setAt] = useState(known ? levels.indexOf(value!) : Math.floor((levels.length - 1) / 2));
  const [moved, setMoved] = useState(known);
  const input = useRef<HTMLInputElement>(null);
  const commit = useRef(onCommit);
  commit.current = onCommit;

  useEffect(() => {
    if (value !== undefined && levels.includes(value)) {
      setAt(levels.indexOf(value));
      setMoved(true);
    }
  }, [value, levels]);

  useEffect(() => {
    const el = input.current;
    if (!el) return;
    const done = () => commit.current(levels[Number(el.value)]);
    el.addEventListener('change', done);
    return () => el.removeEventListener('change', done);
  }, [levels]);

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
        value={at}
        onChange={(e) => {
          setAt(Number(e.target.value));
          setMoved(true);
        }}
      />
      <span className="caption effort-value">{moved ? levels[at] : '—'}</span>
    </label>
  );
}
