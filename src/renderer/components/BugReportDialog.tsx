import { useId, useLayoutEffect, useRef, useState } from 'react';
import { IMAGE_TYPES, REPORT_RECIPIENT, sendBugReport, validateImages } from '../bug-report';
import { getState } from '../state';

export function BugReportDialog({ onClose }: { onClose: () => void }) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [stage, setStage] = useState<'form' | 'consent' | 'sending' | 'sent'>('form');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');

  const dismiss = () => {
    if (stage === 'consent') setStage('form');
    else if (stage !== 'sending') onClose();
  };

  useLayoutEffect(() => {
    const el = dialog.current!;
    el.showModal();
    return () => el.close();
  }, []);
  useLayoutEffect(() => heading.current?.focus(), [stage]);

  const addFiles = async (selected: File[]) => {
    if (!selected.length) return;
    setChecking(true);
    setError('');
    try {
      const next = [...files, ...selected];
      await validateImages(next);
      setFiles(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setChecking(false);
    }
  };

  const send = async (consent: boolean) => {
    setStage('sending');
    try {
      await sendBugReport(title.trim(), description.trim(), files, consent ? getState() : null);
      setStage('sent');
    } catch (e) {
      setError((e as Error).message);
      setStage('form');
    }
  };

  return (
    <dialog
      ref={dialog}
      className="dialog dialog-compact bug-report-dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={stage === 'consent' ? `${id}-consent` : undefined}
      onCancel={(e) => { e.preventDefault(); dismiss(); }}
    >
      <h2 id={`${id}-title`} ref={heading} tabIndex={-1}>
        {stage === 'consent' ? 'Добавить диагностику?' : stage === 'sent' ? 'Отчёт отправлен' : 'Сообщить об ошибке'}
      </h2>
      {stage === 'form' ? (
        <form onSubmit={(e) => {
          e.preventDefault();
          if (checking || !title.trim() || !description.trim()) return;
          setError('');
          setStage('consent');
        }}>
          <p className="hint">Получатель — {REPORT_RECIPIENT}. Изображения отправляются с исходными метаданными.</p>
          <div className="field">
            <label htmlFor={`${id}-name`}>Название</label>
            <input id={`${id}-name`} required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={`${id}-description`}>Описание</label>
            <textarea id={`${id}-description`} required maxLength={5000} rows={4} value={description}
              onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={`${id}-images`}>Изображения (до 5 файлов, до 10 МБ всего)</label>
            <input id={`${id}-images`} type="file" multiple accept={IMAGE_TYPES} disabled={checking} onChange={(e) => {
              const selected = Array.from(e.currentTarget.files ?? []);
              e.currentTarget.value = '';
              void addFiles(selected);
            }} />
            {files.length ? (
              <ul className="bug-report-files">
                {files.map((file, i) => (
                  <li key={i} className="row gap-8">
                    <span className="grow">{file.name}</span>
                    <button type="button" className="btn" disabled={checking} aria-label={`Удалить ${file.name}`}
                      onClick={() => setFiles((current) => current.filter((_, index) => index !== i))}>Удалить</button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <div className="row end gap-8">
            <button type="button" className="btn" onClick={onClose}>Отмена</button>
            <button type="submit" className="btn btn-dark" disabled={checking || !title.trim() || !description.trim()}>
              {checking ? 'Проверяем изображения…' : 'Продолжить'}
            </button>
          </div>
        </form>
      ) : stage === 'consent' ? (
        <>
          <p id={`${id}-consent`}>
            Разрешить собрать и отправить версию приложения и ОС, сведения об устройстве, время и часовой пояс,
            язык, размер окна, тему, открытый экран, состояние и коды проверок подключения и версию Claude Code, если она известна?
          </p>
          <div className="row end gap-8">
            <button type="button" className="btn" onClick={() => setStage('form')}>Назад</button>
            <button type="button" className="btn" onClick={() => void send(false)}>Отправить без диагностики</button>
            <button type="button" className="btn btn-dark" onClick={() => void send(true)}>Разрешить и отправить</button>
          </div>
        </>
      ) : stage === 'sending' ? (
        <p role="status">Отправляем отчёт…</p>
      ) : (
        <div className="row end">
          <button type="button" className="btn btn-dark" onClick={onClose}>Готово</button>
        </div>
      )}
    </dialog>
  );
}
