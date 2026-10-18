import { useEffect, useId, useState, type FormEvent } from 'react';
import { validateSessionName } from '@shared/quote';
import { api } from '../api';
import { createSession } from '../state';

export function NewSessionDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [dir, setDir] = useState('~');
  const [startClaude, setStartClaude] = useState(true);
  const [dirs, setDirs] = useState<string[]>([]);
  const [showDirs, setShowDirs] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const listId = useId();
  const nameOk = validateSessionName(name);

  useEffect(() => {
    if (!showDirs) return;
    const t = setTimeout(() => {
      void api.hints.dirs(dir).then((r) => setDirs(r.ok ? r.data.slice(0, 8) : []));
    }, 200);
    return () => clearTimeout(t);
  }, [dir, showDirs]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!nameOk || busy) return;
    setBusy(true);
    const err = await createSession(name, dir, startClaude);
    setBusy(false);
    if (err) setError(err);
    else onClose();
  };

  return (
    <div className="overlay" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <form role="dialog" aria-modal="true" aria-labelledby="ns-title" className="dialog" onSubmit={(e) => void submit(e)}>
        <h2 id="ns-title">Новая сессия</h2>
        <div className="field">
          <label htmlFor="ns-name">Имя сессии tmux</label>
          <input id="ns-name" value={name} autoFocus placeholder="claude-site" onChange={(e) => setName(e.target.value)} />
          <span className={name && !nameOk ? 'hint hint-error' : 'hint'}>Латиница, цифры, дефис и подчёркивание</span>
        </div>
        <div className="field dir-field">
          <label htmlFor="ns-dir">Рабочая папка на ВМ</label>
          <input
            id="ns-dir"
            className="mono"
            role="combobox"
            aria-expanded={showDirs && dirs.length > 0}
            aria-controls={listId}
            autoComplete="off"
            value={dir}
            onChange={(e) => {
              setDir(e.target.value);
              setShowDirs(true);
            }}
            onBlur={() => setTimeout(() => setShowDirs(false), 150)}
          />
          {showDirs && dirs.length > 0 ? (
            <ul id={listId} role="listbox" className="popup dir-popup">
              {dirs.map((d) => (
                <li
                  key={d}
                  role="option"
                  aria-selected="false"
                  className="popup-item mono"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setDir(d);
                    setShowDirs(false);
                  }}
                >
                  {d}
                </li>
              ))}
            </ul>
          ) : null}
          <span className="hint">Подсказки по папкам с ВМ появляются при вводе</span>
        </div>
        <label className="check">
          <input type="checkbox" checked={startClaude} onChange={(e) => setStartClaude(e.target.checked)} />
          Сразу запустить claude
        </label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="row end gap-8">
          <button type="button" className="btn" onClick={onClose}>Отмена</button>
          <button type="submit" className="btn btn-dark" disabled={!nameOk || busy}>Создать</button>
        </div>
      </form>
    </div>
  );
}
