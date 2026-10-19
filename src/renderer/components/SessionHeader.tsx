import { useState } from 'react';
import type { TmuxSession } from '@shared/ipc';
import { killSession, setViewOverride, shortPath } from '../state';
import { ConfirmDialog } from './ConfirmDialog';
import { IconClose } from './icons';

/** mode — что сейчас показано; переключатель «Лента | Терминал» — только когда запущен claude. */
export function SessionHeader({ session, mode = 'terminal' }: { session: TmuxSession; mode?: 'chat' | 'terminal' }) {
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
      {session.claudeRunning ? (
        <div role="group" aria-label="Вид" className="seg">
          <button type="button" aria-pressed={mode === 'chat'} onClick={() => setViewOverride(null)}>Лента</button>
          <button type="button" aria-pressed={mode === 'terminal'} onClick={() => setViewOverride('terminal')}>Терминал</button>
        </div>
      ) : null}
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
