import { useId, useState } from 'react';

/** /compact с пожеланиями (команда однострочная — переводы строк становятся пробелами). */
export function compactCommand(keep: string): string {
  const t = keep.replace(/\s*\n\s*/g, ' ').trim();
  return t ? `/compact ${t}` : '/compact';
}

export function CompactDialog(props: { onConfirm: (command: string) => void; onCancel: () => void }) {
  const id = useId();
  const [keep, setKeep] = useState('');
  return (
    <div className="overlay" onKeyDown={(e) => e.key === 'Escape' && props.onCancel()}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-t`}
        className="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          props.onConfirm(compactCommand(keep));
        }}
      >
        <h2 id={`${id}-t`}>Сжать сессию?</h2>
        <p>История для Claude заменится краткой сводкой. Само сжатие тоже тратит токены.</p>
        <div className="field">
          <label htmlFor={`${id}-k`}>Что сохранить в сводке</label>
          <input id={`${id}-k`} value={keep} autoFocus onChange={(e) => setKeep(e.target.value)} />
        </div>
        <div className="row end gap-8">
          <button type="button" className="btn" onClick={props.onCancel}>Отмена</button>
          <button type="submit" className="btn btn-danger">Сжать</button>
        </div>
      </form>
    </div>
  );
}
