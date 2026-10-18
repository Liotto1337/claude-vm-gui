export interface HintItem {
  key: string;
  label: string;
  description?: string;
}

/** Всплывающий список подсказок над полем ввода. Выбор — мышью или клавишами из Composer. */
export function HintPopup({ items, active, onPick }: { items: HintItem[]; active: number; onPick: (i: number) => void }) {
  if (items.length === 0) return null;
  return (
    <ul role="listbox" aria-label="Подсказки" className="popup hint-popup">
      {items.map((it, i) => (
        <li
          key={it.key}
          role="option"
          aria-selected={i === active}
          className="popup-item hint-item"
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(i);
          }}
        >
          <span className="mono hint-label">{it.label}</span>
          {it.description ? <span className="hint-desc ellipsis">{it.description}</span> : null}
        </li>
      ))}
    </ul>
  );
}
