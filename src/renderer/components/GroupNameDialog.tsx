import { useId, useState, type FormEvent } from 'react';
import { validGroupName } from '@shared/layout';

/** Название группы: новая или переименование. */
export function GroupNameDialog(props: { title: string; submitLabel: string; initial?: string; onSubmit: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState(props.initial ?? '');
  const id = useId();
  const valid = validGroupName(name);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    props.onSubmit(valid);
  };

  return (
    <div className="overlay" onKeyDown={(e) => e.key === 'Escape' && props.onClose()}>
      <form role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} className="dialog" onSubmit={submit}>
        <h2 id={`${id}-t`}>{props.title}</h2>
        <div className="field">
          <label htmlFor={`${id}-n`}>Название группы</label>
          <input id={`${id}-n`} value={name} autoFocus maxLength={60} onChange={(e) => setName(e.target.value)} />
          <span className={name.trim().length > 40 ? 'hint hint-error' : 'hint'}>От 1 до 40 символов</span>
        </div>
        <div className="row end gap-8">
          <button type="button" className="btn" onClick={props.onClose}>Отмена</button>
          <button type="submit" className="btn btn-dark" disabled={!valid}>{props.submitLabel}</button>
        </div>
      </form>
    </div>
  );
}
