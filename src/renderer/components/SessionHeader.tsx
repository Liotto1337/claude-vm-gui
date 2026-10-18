import { useState } from 'react';
import type { TmuxSession } from '@shared/ipc';
import { killSession, shortPath } from '../state';
import { ConfirmDialog } from './ConfirmDialog';
import { IconClose } from './icons';

export function SessionHeader({ session }: { session: TmuxSession }) {
  const [confirm, setConfirm] = useState(false);
  const what = session.claudeRunning ? 'в сессии запущен claude' : `в сессии ${session.command || 'shell'}`;
  return (
    <header className="session-header">
      <div className="session-title">
        <h1>{session.name}</h1>
        <span className="caption">
          {shortPath(session.cwd)} · {what}
        </span>
      </div>
      <button type="button" className="btn btn-sm" onClick={() => setConfirm(true)}>
        <IconClose />
        Завершить сессию
      </button>
      {confirm ? (
        <ConfirmDialog
          title={`Завершить сессию ${session.name}?`}
          text="tmux kill-session остановит claude и всё, что запущено в этой сессии."
          confirmLabel="Завершить"
          onCancel={() => setConfirm(false)}
          onConfirm={() => {
            setConfirm(false);
            void killSession(session.name);
          }}
        />
      ) : null}
    </header>
  );
}
