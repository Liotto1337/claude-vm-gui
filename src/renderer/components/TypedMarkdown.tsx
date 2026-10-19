import { useEffect, useState } from 'react';
import { revealCount } from '../chat-anim';
import { Markdown } from './Markdown';
import { reducedMotion } from './Spinner';

/** Ответ Claude, который «печатается» посимвольно (как на claude.ai); since — время начала (performance.now). */
export function TypedMarkdown({ text, since, onDone }: { text: string; since: number; onDone: () => void }) {
  const [shown, setShown] = useState(() => (reducedMotion() ? text.length : revealCount(text.length, performance.now() - since)));
  useEffect(() => {
    if (shown >= text.length) return onDone();
    let raf = 0;
    const tick = () => {
      const n = revealCount(text.length, performance.now() - since);
      setShown(n);
      if (n < text.length) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [shown >= text.length]);
  return <Markdown text={text.slice(0, shown)} />;
}
