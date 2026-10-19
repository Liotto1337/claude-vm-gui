import { useEffect, useState } from 'react';

// Звёздочка Claude Code: переливается теми же символами, что спиннер в консоли
const GLYPHS = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'];
const STEP_MS = 120;

export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function Spinner() {
  const [i, setI] = useState(4);
  useEffect(() => {
    if (reducedMotion()) return;
    const t = setInterval(() => setI((n) => (n + 1) % GLYPHS.length), STEP_MS);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="spinner" aria-hidden="true">
      {GLYPHS[i]}
    </span>
  );
}
