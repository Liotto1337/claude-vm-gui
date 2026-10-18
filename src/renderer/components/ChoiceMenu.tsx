import { useEffect, useRef, useState } from 'react';
import { IconCheck, IconChevron } from './icons';

export interface Choice {
  value: string;
  label: string;
  description?: string;
}

/** Кнопка с выпадающим меню выбора (модель, effort). */
export function ChoiceMenu(props: {
  buttonLabel: string;
  menuLabel: string;
  title: string;
  choices: Choice[];
  selected?: string;
  onSelect: (c: Choice) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="choice" ref={root} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
      <button type="button" className="choice-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {props.buttonLabel}
        <IconChevron />
      </button>
      {open ? (
        <div role="menu" aria-label={props.menuLabel} className="popup choice-menu">
          <div className="caption choice-title">{props.title}</div>
          {props.choices.map((c) => (
            <button
              key={c.value}
              type="button"
              role="menuitemradio"
              aria-checked={c.value === props.selected}
              className="choice-item"
              onClick={() => {
                setOpen(false);
                props.onSelect(c);
              }}
            >
              <span className="choice-text">
                <span>{c.label}</span>
                {c.description ? <span className="caption">{c.description}</span> : null}
              </span>
              {c.value === props.selected ? <IconCheck /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
