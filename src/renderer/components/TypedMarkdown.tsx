import { useEffect, useRef, useState } from 'react';
import { revealCount } from '../chat-anim';
import { Markdown } from './Markdown';
import { reducedMotion } from './Spinner';

/** Ответ Claude, который «печатается» посимвольно (как на claude.ai); since — время начала (performance.now). */
export function TypedMarkdown({ text, since, onDone }: { text: string; since: number; onDone: () => void }) {
  const [shown, setShown] = useState(() => (reducedMotion() ? text.length : revealCount(text.length, performance.now() - since)));
  // Текст может дописаться во время печати — кадры читают текущую длину, а не ту, что была при запуске
  const len = useRef(text.length);
  len.current = text.length;
  const done = shown >= text.length;
  useEffect(() => {
    if (done) return onDone();
    let raf = 0;
    const tick = () => {
      const n = revealCount(len.current, performance.now() - since);
      setShown(n);
      if (n < len.current) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [done]);
  return <Markdown text={text.slice(0, shown)} />;
}
