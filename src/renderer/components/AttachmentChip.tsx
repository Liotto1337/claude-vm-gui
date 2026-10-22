import type { Attachment } from '../attachments';
import { IconFile, IconImage } from './icons';


const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} КБ` : `${(n / 1024 / 1024).toFixed(1)} МБ`);

export function AttachmentChip({ a, onRemove, onRetry }: { a: Attachment; onRemove: () => void; onRetry: () => void }) {
  return (
    <div className={a.status === 'error' ? 'chip chip-error' : 'chip'}>
      <div className="chip-thumb">{a.image && a.url ? <img src={a.url} alt="Превью картинки" /> : a.image ? <IconImage /> : <IconFile />}</div>
      <div className="chip-text">
        <span className="ellipsis">{a.image && a.name === 'image.png' ? 'Вставленная картинка' : a.name}</span>
        {a.status === 'uploading' ? <span className="chip-status uploading">загружается… {a.percent}%</span> : null}
        {a.status === 'done' ? <span className="chip-status">загружено · {kb(a.size)}</span> : null}
        {a.status === 'error' ? (
          <span className="chip-status error">
            {a.error ?? 'ошибка'} ·{' '}
            <button type="button" className="link-btn" onClick={onRetry}>Повторить</button>
          </span>
        ) : null}
      </div>
      <button type="button" className="icon-btn chip-remove" aria-label="Убрать файл" onClick={onRemove}>×</button>
    </div>
  );
}
