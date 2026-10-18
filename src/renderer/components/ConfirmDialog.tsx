import { useId } from 'react';

export function ConfirmDialog(props: {
  title: string;
  text: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const id = useId();
  return (
    <div className="overlay" onKeyDown={(e) => e.key === 'Escape' && props.onCancel()}>
      <div role="dialog" aria-modal="true" aria-labelledby={id} className="dialog">
        <h2 id={id}>{props.title}</h2>
        <p>{props.text}</p>
        <div className="row end gap-8">
          <button type="button" className="btn" autoFocus onClick={props.onCancel}>Отмена</button>
          <button type="button" className="btn btn-danger" onClick={props.onConfirm}>{props.confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
